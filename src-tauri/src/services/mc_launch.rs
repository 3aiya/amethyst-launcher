//! A from-scratch Minecraft launch engine, replacing the `minecraft-launcher-core`
//! (MCLC) npm package the original Electron app used. This is the highest-risk
//! part of the port: MCLC is a mature, widely-used library handling asset/library
//! downloads, natives extraction, and Mojang's argument-template spec, and this
//! is a hand-rolled equivalent of that spec. It covers the standard cases
//! (vanilla, Fabric-merged jsons, Forge via the installer) but hasn't been
//! run against every historical version quirk MCLC has accumulated fixes for -
//! test thoroughly, especially on very old (pre-1.13 legacy `minecraftArguments`)
//! versions.

use crate::types::{Account, ProgressPayload, QuickPlayTarget};
use super::net;
use anyhow::{anyhow, bail, Result};
use futures_util::{stream, StreamExt};
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;

const ASSETS_BASE: &str = "https://resources.download.minecraft.net";

fn classpath_separator() -> &'static str {
    if cfg!(windows) {
        ";"
    } else {
        ":"
    }
}

fn current_os_name() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

fn rule_allows(rules: &Value) -> bool {
    let Some(rules) = rules.as_array() else { return true };
    if rules.is_empty() {
        return true;
    }
    let mut allowed = false;
    for rule in rules {
        let action = rule.get("action").and_then(|v| v.as_str()).unwrap_or("allow");
        let os_matches = match rule.get("os") {
            Some(os) => {
                let name_ok = os
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(|n| n == current_os_name())
                    .unwrap_or(true);
                let arch_ok = os
                    .get("arch")
                    .and_then(|v| v.as_str())
                    .map(|a| a == std::env::consts::ARCH || (a == "x86" && std::env::consts::ARCH == "x86_64"))
                    .unwrap_or(true);
                name_ok && arch_ok
            }
            None => true,
        };
        let features_ok = match rule.get("features") {
            // We don't set any optional features (demo mode, custom resolution,
            // quick-play) at rule-check time, so any rule requiring one is skipped.
            Some(features) => features.as_object().map(|o| o.is_empty()).unwrap_or(true),
            None => true,
        };
        if os_matches && features_ok {
            allowed = action == "allow";
        }
    }
    allowed
}

struct LibraryDownload {
    url: String,
    dest: PathBuf,
    sha1: Option<String>,
    size: Option<u64>,
    /// Ancient/custom maven libs are best-effort, like before.
    required: bool,
}

fn str_field<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|v| v.as_str())
}

/// A library's identity with the *version* dropped:
/// `"group:artifact:version[:classifier]"` -> `"group:artifact[:classifier]"`.
///
/// Two entries sharing this key are the same jar at different versions, and
/// only one of them may go on the classpath. The classifier has to stay in
/// the key: `org.lwjgl:lwjgl:3.3.3` and `org.lwjgl:lwjgl:3.3.3:natives-windows`
/// are genuinely different jars that both belong there, whereas
/// `org.ow2.asm:asm:9.10.1` + `org.ow2.asm:asm:9.6` are not - Fabric's
/// `LoaderUtil.verifyClasspath` aborts the game outright when it sees both
/// ("duplicate ASM classes found on classpath").
pub fn library_coords(name: &str) -> String {
    let parts: Vec<&str> = name.split(':').collect();
    match parts.len() {
        0..=2 => name.to_string(),
        3 => format!("{}:{}", parts[0], parts[1]),
        _ => format!("{}:{}:{}", parts[0], parts[1], parts[3..].join(":")),
    }
}

/// Downloads every library this version json lists (respecting per-library OS
/// rules), extracting native jars into `natives_dir`. Returns the full
/// classpath list, in order, ending with the main client jar.
async fn prepare_libraries(
    version_json: &Value,
    libraries_root: &Path,
    natives_dir: &Path,
    mut on_progress: impl FnMut(i64, i64),
) -> Result<Vec<PathBuf>> {
    std::fs::create_dir_all(natives_dir)?;
    let libraries = version_json["libraries"].as_array().cloned().unwrap_or_default();

    // Walk the json first (classpath order, natives, what to fetch), then
    // fetch everything in parallel.
    let mut classpath_entries: Vec<(PathBuf, bool)> = Vec::new();
    let mut native_jars: Vec<PathBuf> = Vec::new();
    let mut jobs: Vec<LibraryDownload> = Vec::new();
    let mut queued = HashSet::new();
    let mut queue = |job: LibraryDownload| {
        if queued.insert(job.dest.clone()) {
            jobs.push(job);
        }
    };
    // Only the first version of any given jar reaches the classpath. A merged
    // Fabric/Forge json concatenates the loader's libraries with the vanilla
    // ones, and where both pin the same jar at different versions (vanilla
    // 1.21.8 ships asm 9.6, Fabric loader 0.19.5 needs asm 9.10.1) putting
    // both on the classpath is what Fabric kills the launch over. The loader's
    // libraries are listed first in those jsons - exactly the precedence the
    // vanilla launcher gives a child version json - so first-wins picks the
    // one the loader asked for.
    let mut seen_coords: HashSet<String> = HashSet::new();

    for lib in &libraries {
        if let Some(rules) = lib.get("rules") {
            if !rule_allows(rules) {
                continue;
            }
        }

        // Natives are keyed separately below, so a shadowed artifact still
        // gets its native jar extracted.
        let artifact_shadowed = str_field(lib, "name")
            .is_some_and(|name| !seen_coords.insert(library_coords(name)));

        let downloads = lib.get("downloads");

        // Modern "downloads.artifact" form.
        if artifact_shadowed {
            // Skip the classpath entry and the download both.
        } else if let Some(artifact) = downloads.and_then(|d| d.get("artifact")) {
            if let (Some(path), Some(url)) = (str_field(artifact, "path"), str_field(artifact, "url")) {
                let dest = libraries_root.join(path);
                if url.is_empty() {
                    // Generated locally by the Forge installer's processors
                    // (patched client, etc.) - there's nothing to download.
                    if !dest.exists() {
                        bail!("Missing locally-generated library {path}; try reinstalling this instance.");
                    }
                } else {
                    queue(LibraryDownload {
                        url: url.to_string(),
                        dest: dest.clone(),
                        sha1: str_field(artifact, "sha1").map(str::to_string),
                        size: artifact.get("size").and_then(|v| v.as_u64()),
                        required: true,
                    });
                }
                classpath_entries.push((dest, true));
            }
        } else if let Some(name) = str_field(lib, "name") {
            // Legacy libraries only have a maven `name` + optional custom `url` base.
            if let Some(path) = maven_name_to_path(name) {
                let base = str_field(lib, "url").unwrap_or("https://libraries.minecraft.net/");
                let url = format!("{}/{path}", base.trim_end_matches('/'));
                let dest = libraries_root.join(&path);
                queue(LibraryDownload { url, dest: dest.clone(), sha1: None, size: None, required: false });
                classpath_entries.push((dest, false));
            }
        }

        // Natives (both the modern per-OS "classifiers" form and the newer
        // "natives" + classifiers map some 1.13+ jsons still carry for compat).
        if let Some(classifiers) = downloads.and_then(|d| d.get("classifiers")) {
            let natives_key = lib
                .get("natives")
                .and_then(|n| n.get(current_os_name()))
                .and_then(|v| v.as_str());
            if let Some(key) = natives_key {
                let key = key.replace("${arch}", if cfg!(target_pointer_width = "64") { "64" } else { "32" });
                if let Some(classifier) = classifiers.get(&key) {
                    if let (Some(path), Some(url)) = (str_field(classifier, "path"), str_field(classifier, "url")) {
                        let dest = libraries_root.join(path);
                        queue(LibraryDownload {
                            url: url.to_string(),
                            dest: dest.clone(),
                            sha1: str_field(classifier, "sha1").map(str::to_string),
                            size: classifier.get("size").and_then(|v| v.as_u64()),
                            required: true,
                        });
                        native_jars.push(dest);
                    }
                }
            }
        }
    }

    let total = jobs.len() as i64;
    on_progress(0, total);
    let mut pending = stream::iter(jobs)
        .map(|job| async move {
            match net::ensure_file(&job.url, &job.dest, job.sha1.as_deref(), job.size).await {
                Err(e) if job.required => {
                    let name = job.dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                    Err(e.context(format!("Couldn't download library {name}")))
                }
                _ => Ok(()),
            }
        })
        .buffer_unordered(net::CONCURRENCY);
    let mut done = 0;
    while let Some(result) = pending.next().await {
        result?;
        done += 1;
        on_progress(done, total);
    }
    drop(pending);

    for jar in &native_jars {
        extract_natives_jar(jar, natives_dir)?;
    }

    let mut seen = HashSet::new();
    Ok(classpath_entries
        .into_iter()
        .filter(|(dest, required)| *required || dest.exists())
        .filter_map(|(dest, _)| seen.insert(dest.clone()).then_some(dest))
        .collect())
}

fn maven_name_to_path(name: &str) -> Option<String> {
    // group:artifact:version[:classifier]
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let group_path = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let classifier = parts.get(3).map(|c| format!("-{c}")).unwrap_or_default();
    Some(format!("{group_path}/{artifact}/{version}/{artifact}-{version}{classifier}.jar"))
}

fn extract_natives_jar(jar_path: &Path, natives_dir: &Path) -> Result<()> {
    let file = std::fs::File::open(jar_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let name = entry.name().to_string();
        if name.starts_with("META-INF/") || entry.is_dir() {
            continue;
        }
        // Only pull the actual native libs (.dll/.so/.dylib), skip class files etc.
        if !(name.ends_with(".dll") || name.ends_with(".so") || name.ends_with(".dylib")) {
            continue;
        }
        let out_path = natives_dir.join(Path::new(&name).file_name().unwrap_or_default());
        let mut out_file = std::fs::File::create(&out_path)?;
        std::io::copy(&mut entry, &mut out_file)?;
    }
    Ok(())
}

#[derive(serde::Deserialize)]
struct AssetIndex {
    objects: std::collections::HashMap<String, AssetObject>,
}
#[derive(serde::Deserialize)]
struct AssetObject {
    hash: String,
    size: u64,
}

/// Downloads the asset index + every referenced object into
/// `<gameDirectory>/assets` (shared across all profiles, like MCLC/vanilla do).
async fn prepare_assets(
    version_json: &Value,
    assets_root: &Path,
    mut on_progress: impl FnMut(i64, i64),
) -> Result<String> {
    let asset_index_id = version_json["assetIndex"]["id"].as_str().unwrap_or("legacy").to_string();
    let asset_index_url = version_json["assetIndex"]["url"].as_str();

    let indexes_dir = assets_root.join("indexes");
    std::fs::create_dir_all(&indexes_dir)?;
    let index_path = indexes_dir.join(format!("{asset_index_id}.json"));

    if let Some(url) = asset_index_url {
        let sha1 = version_json["assetIndex"]["sha1"].as_str();
        let size = version_json["assetIndex"]["size"].as_u64();
        net::ensure_file(url, &index_path, sha1, size).await?;
    } else if !index_path.exists() {
        bail!("Version json has no assetIndex.url and no cached index either.");
    }
    let index: AssetIndex = serde_json::from_slice(&std::fs::read(&index_path)?)?;
    let objects_dir = assets_root.join("objects");
    let total = index.objects.len() as i64;

    // Size check only for what's already there: hashing thousands of files
    // on every launch would be slow, and downloads are hash-checked anyway.
    let missing: Vec<(String, u64)> = index
        .objects
        .into_values()
        .filter(|obj| {
            let dest = objects_dir.join(&obj.hash[0..2]).join(&obj.hash);
            !net::file_matches(&dest, None, Some(obj.size))
        })
        .map(|obj| (obj.hash, obj.size))
        .collect();

    let mut done = total - missing.len() as i64;
    on_progress(done, total);
    let objects_dir = &objects_dir;
    let mut pending = stream::iter(missing)
        .map(|(hash, size)| async move {
            let prefix = &hash[0..2];
            let dest = objects_dir.join(prefix).join(&hash);
            net::download(&format!("{ASSETS_BASE}/{prefix}/{hash}"), &dest, Some(&hash), Some(size), |_, _| {}).await
        })
        .buffer_unordered(net::CONCURRENCY);
    while let Some(result) = pending.next().await {
        result?;
        done += 1;
        on_progress(done, total);
    }

    Ok(asset_index_id)
}

pub struct LaunchOptions<'a> {
    pub profile_dir: &'a Path,
    pub game_directory: &'a Path, // shared base dir, holds assets/libraries/runtimes
    pub version_json: &'a Value,
    pub effective_version_id: &'a str,
    pub version_custom: Option<&'a str>,
    pub minecraft_jar_override: Option<&'a Path>,
    pub java_path: &'a str,
    pub ram_min_mb: i64,
    pub ram_max_mb: i64,
    pub extra_jvm_args: &'a [String],
    pub window_width: i64,
    pub window_height: i64,
    pub account: &'a Account,
    pub forge_installer_ran: bool,
    pub quick_play: Option<&'a QuickPlayTarget>,
}

fn substitute(template: &str, vars: &std::collections::HashMap<&str, String>) -> String {
    let mut out = template.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("${{{k}}}"), v);
    }
    out
}

fn collect_arg_strings(value: &Value, vars: &std::collections::HashMap<&str, String>, out: &mut Vec<String>) {
    match value {
        Value::String(s) => out.push(substitute(s, vars)),
        Value::Object(obj) => {
            let rules_ok = obj.get("rules").map(rule_allows).unwrap_or(true);
            if !rules_ok {
                return;
            }
            match obj.get("value") {
                Some(Value::String(s)) => out.push(substitute(s, vars)),
                Some(Value::Array(arr)) => {
                    for v in arr {
                        if let Value::String(s) = v {
                            out.push(substitute(s, vars));
                        }
                    }
                }
                _ => {}
            }
        }
        _ => {}
    }
}

/// Builds the full `java <jvm args> <main class> <game args>` argument list
/// per Mojang's version-json argument-template spec (falls back to the
/// pre-1.13 flat `minecraftArguments` string when `arguments` isn't present).
#[allow(clippy::too_many_arguments)]
fn build_arguments(
    opts: &LaunchOptions,
    classpath: &[PathBuf],
    natives_dir: &Path,
    assets_root: &Path,
    asset_index_id: &str,
    client_jar: &Path,
    libraries_root: &Path,
) -> Vec<String> {
    let classpath_str = {
        let mut parts: Vec<String> = classpath.iter().map(|p| p.to_string_lossy().to_string()).collect();
        parts.push(client_jar.to_string_lossy().to_string());
        parts.join(classpath_separator())
    };

    let mut vars = std::collections::HashMap::new();
    vars.insert("natives_directory", natives_dir.to_string_lossy().to_string());
    vars.insert("launcher_name", "amethyst-launcher".to_string());
    vars.insert("launcher_version", "1.0.0".to_string());
    vars.insert("classpath", classpath_str);
    vars.insert("classpath_separator", classpath_separator().to_string());
    vars.insert("library_directory", libraries_root.to_string_lossy().to_string());
    vars.insert("auth_player_name", opts.account.name.clone());
    vars.insert("version_name", opts.version_custom.unwrap_or(opts.effective_version_id).to_string());
    vars.insert("game_directory", opts.profile_dir.to_string_lossy().to_string());
    vars.insert("assets_root", assets_root.to_string_lossy().to_string());
    vars.insert("game_assets", assets_root.to_string_lossy().to_string());
    vars.insert("assets_index_name", asset_index_id.to_string());
    vars.insert("auth_uuid", opts.account.uuid.clone());
    vars.insert("auth_access_token", opts.account.access_token.clone());
    vars.insert("auth_session", opts.account.access_token.clone());
    vars.insert("user_type", "msa".to_string());
    vars.insert("user_properties", "{}".to_string());
    vars.insert("version_type", "release".to_string());
    vars.insert("resolution_width", opts.window_width.to_string());
    vars.insert("resolution_height", opts.window_height.to_string());
    if let Some(qp) = opts.quick_play {
        match qp.kind {
            crate::types::QuickPlayType::Singleplayer => {
                vars.insert("quickPlaySingleplayer", qp.target.clone());
            }
            crate::types::QuickPlayType::Multiplayer => {
                vars.insert("quickPlayMultiplayer", qp.target.clone());
            }
        }
    }

    let mut jvm_args = vec![
        format!("-Xms{}M", opts.ram_min_mb),
        format!("-Xmx{}M", opts.ram_max_mb),
        format!("-Djava.library.path={}", natives_dir.to_string_lossy()),
    ];
    let mut game_args = Vec::new();

    if let Some(args) = opts.version_json.get("arguments") {
        if let Some(jvm) = args.get("jvm").and_then(|v| v.as_array()) {
            for v in jvm {
                collect_arg_strings(v, &vars, &mut jvm_args);
            }
        } else {
            jvm_args.push("-cp".to_string());
            jvm_args.push(vars["classpath"].clone());
        }
        if let Some(game) = args.get("game").and_then(|v| v.as_array()) {
            for v in game {
                collect_arg_strings(v, &vars, &mut game_args);
            }
        }
    } else {
        // Legacy pre-1.13 flat string.
        jvm_args.push("-cp".to_string());
        jvm_args.push(vars["classpath"].clone());
        if let Some(flat) = opts.version_json.get("minecraftArguments").and_then(|v| v.as_str()) {
            for token in flat.split_whitespace() {
                game_args.push(substitute(token, &vars));
            }
        }
    }

    for extra in opts.extra_jvm_args {
        jvm_args.push(extra.clone());
    }

    let main_class = opts
        .version_json
        .get("mainClass")
        .and_then(|v| v.as_str())
        .unwrap_or("net.minecraft.client.main.Main")
        .to_string();

    let mut all = jvm_args;
    all.push(main_class);
    all.extend(game_args);
    all
}

pub enum LaunchEvent {
    #[allow(dead_code)]
    Progress(ProgressPayload),
    Log(String),
    Close(i32),
}

/// Downloads everything the given version json needs (libraries, natives,
/// assets) and returns the ready-to-run java argument list.
pub async fn prepare_and_build_args(
    opts: &LaunchOptions<'_>,
    mut on_progress: impl FnMut(ProgressPayload),
) -> Result<Vec<String>> {
    // The Forge installer writes its (partly locally-generated) libraries
    // into the profile's own directory rather than the shared one.
    let libraries_root = if opts.forge_installer_ran {
        opts.profile_dir.join("libraries")
    } else {
        opts.game_directory.join("libraries")
    };
    let natives_dir = opts.profile_dir.join("natives").join(opts.effective_version_id);
    let assets_root = opts.game_directory.join("assets");

    let classpath = prepare_libraries(opts.version_json, &libraries_root, &natives_dir, |task, total| {
        on_progress(ProgressPayload { phase: "libraries".into(), task, total });
    })
    .await?;

    let asset_index_id = prepare_assets(opts.version_json, &assets_root, |task, total| {
        on_progress(ProgressPayload { phase: "assets".into(), task, total });
    })
    .await?;

    let client_jar = match opts.minecraft_jar_override {
        Some(p) => p.to_path_buf(),
        None => opts
            .profile_dir
            .join("versions")
            .join(opts.effective_version_id)
            .join(format!("{}.jar", opts.effective_version_id)),
    };

    if opts.forge_installer_ran {
        // Forge's installer already wrote the merged version json + extra
        // Forge-only libraries under profile_dir/versions/<forge id>; nothing
        // else to do here besides trust that json for mainClass/arguments,
        // which the caller already loaded into `version_json`.
    }

    Ok(build_arguments(opts, &classpath, &natives_dir, &assets_root, &asset_index_id, &client_jar, &libraries_root))
}

pub fn spawn_game(java_path: &str, args: &[String], cwd: &Path) -> Result<Child> {
    let child = tokio::process::Command::new(java_path)
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| anyhow!("Failed to launch Java: {e}"))?;
    Ok(child)
}

/// Takes the child's stdout/stderr pipes and streams them as `Log` events,
/// then polls `shared_child` (an Arc so `stop_game` can still kill the same
/// process) until it exits and sends a final `Close` event. Splitting it this
/// way - rather than owning the `Child` outright - is what lets the launch
/// command keep a live handle to kill on "Stop".
pub async fn pump_output(
    shared_child: std::sync::Arc<tokio::sync::Mutex<Option<Child>>>,
    tx: tokio::sync::mpsc::UnboundedSender<LaunchEvent>,
) {
    let (stdout, stderr) = {
        let mut guard = shared_child.lock().await;
        match guard.as_mut() {
            Some(child) => (child.stdout.take(), child.stderr.take()),
            None => (None, None),
        }
    };

    let tx_out = tx.clone();
    let stdout_task = tokio::spawn(async move {
        if let Some(stdout) = stdout {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = tx_out.send(LaunchEvent::Log(line));
            }
        }
    });

    let tx_err = tx.clone();
    let stderr_task = tokio::spawn(async move {
        if let Some(stderr) = stderr {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = tx_err.send(LaunchEvent::Log(line));
            }
        }
    });

    // Poll for exit rather than holding the lock across a long `.wait()`, so
    // `stop_game` can still grab the lock and kill the process in the meantime.
    let code = loop {
        {
            let mut guard = shared_child.lock().await;
            match guard.as_mut() {
                Some(child) => match child.try_wait() {
                    Ok(Some(status)) => break status.code().unwrap_or(0),
                    Ok(None) => {}
                    Err(_) => break -1,
                },
                None => break 0, // already killed by stop_game
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    };

    *shared_child.lock().await = None;

    // Send `Close` the moment we know the process is gone - don't make it
    // wait on the log readers hitting EOF. On a normal exit those finish
    // almost instantly anyway, but after a forced kill (Stop button /
    // Windows TerminateProcess) the stdout/stderr pipes can stay open
    // longer than the process itself, which used to hang this event
    // forever and leave the UI stuck showing "running".
    let _ = tx.send(LaunchEvent::Close(code));
    stdout_task.abort();
    stderr_task.abort();
}

#[cfg(test)]
mod tests {
    use super::library_coords;

    #[test]
    fn same_jar_at_two_versions_shares_a_key() {
        // The pair that stops Fabric from starting.
        assert_eq!(library_coords("org.ow2.asm:asm:9.10.1"), library_coords("org.ow2.asm:asm:9.6"));
    }

    #[test]
    fn classifier_keeps_natives_distinct() {
        // These all belong on the classpath together - collapsing them would
        // strip every LWJGL native and leave the game unable to open a window.
        let base = library_coords("org.lwjgl:lwjgl:3.3.3");
        let windows = library_coords("org.lwjgl:lwjgl:3.3.3:natives-windows");
        let linux = library_coords("org.lwjgl:lwjgl:3.3.3:natives-linux");
        assert_ne!(base, windows);
        assert_ne!(windows, linux);
    }

    #[test]
    fn version_is_the_only_thing_dropped() {
        assert_eq!(library_coords("org.ow2.asm:asm:9.6"), "org.ow2.asm:asm");
        assert_eq!(library_coords("org.lwjgl:lwjgl:3.3.3:natives-windows"), "org.lwjgl:lwjgl:natives-windows");
        // Malformed/short names are passed through rather than mangled.
        assert_eq!(library_coords("weird-name"), "weird-name");
    }
}
