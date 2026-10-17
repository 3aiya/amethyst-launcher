//! Port of `services/skinManager.ts`.

use super::net;
use crate::types::SkinVariant;
use anyhow::{bail, Result};
use base64::Engine;
use std::path::{Path, PathBuf};

const SKIN_URL: &str = "https://api.minecraftservices.com/minecraft/profile/skins";

pub async fn set_skin_from_file(access_token: &str, file_path: &Path, variant: SkinVariant) -> Result<()> {
    let bytes = std::fs::read(file_path)?;
    let variant_str = match variant {
        SkinVariant::Classic => "classic",
        SkinVariant::Slim => "slim",
    };

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name("skin.png")
        .mime_str("image/png")?;
    let form = reqwest::multipart::Form::new()
        .text("variant", variant_str)
        .part("file", part);

    let client = net::client();
    let resp = client
        .post(SKIN_URL)
        .bearer_auth(access_token)
        .multipart(form)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        bail!("Skin upload failed: {status} {text}");
    }
    Ok(())
}

pub async fn reset_skin(access_token: &str) -> Result<()> {
    let client = net::client();
    let resp = client
        .delete(format!("{SKIN_URL}/active"))
        .bearer_auth(access_token)
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        bail!("Skin reset failed: {status} {text}");
    }
    Ok(())
}

// ---- Offline skins -----------------------------------------------------
//
// Offline accounts have no Mojang profile, so there's nowhere to upload a
// skin to. Instead the PNG (and its arm model) is kept locally and served to
// the game through the CustomSkinLoader mod - see `custom_skin_loader`.

pub fn offline_skin_path(game_directory: &Path, uuid: &str) -> PathBuf {
    game_directory.join("offline-skins").join(format!("{uuid}.png"))
}

fn offline_model_path(game_directory: &Path, uuid: &str) -> PathBuf {
    game_directory.join("offline-skins").join(format!("{uuid}.model"))
}

pub fn offline_skin_variant(game_directory: &Path, uuid: &str) -> SkinVariant {
    match std::fs::read_to_string(offline_model_path(game_directory, uuid)).as_deref() {
        Ok("slim") => SkinVariant::Slim,
        _ => SkinVariant::Classic,
    }
}

/// Reads width/height out of a PNG's IHDR chunk, or `None` if it isn't a PNG.
fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < 24 || &bytes[..8] != SIGNATURE || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    Some((width, height))
}

pub fn save_offline_skin(game_directory: &Path, uuid: &str, file_path: &Path, variant: SkinVariant) -> Result<()> {
    let bytes = std::fs::read(file_path)?;
    match png_dimensions(&bytes) {
        Some((64, 64)) | Some((64, 32)) => {}
        Some((w, h)) => bail!("Skins must be 64x64 (or legacy 64x32) - this one is {w}x{h}."),
        None => bail!("That file isn't a PNG image."),
    }
    let dest = offline_skin_path(game_directory, uuid);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(dest, bytes)?;
    let model = match variant {
        SkinVariant::Classic => "classic",
        SkinVariant::Slim => "slim",
    };
    std::fs::write(offline_model_path(game_directory, uuid), model)?;
    Ok(())
}

/// Moves a skin saved under the old, server-incompatible offline UUID (see
/// `auth::legacy_offline_uuid`) to the account's current one.
pub fn migrate_legacy_offline_skin(game_directory: &Path, name: &str) {
    let legacy = crate::services::auth::legacy_offline_uuid(name);
    let current = crate::services::auth::offline_uuid(name);
    for (from, to) in [
        (offline_skin_path(game_directory, &legacy), offline_skin_path(game_directory, &current)),
        (offline_model_path(game_directory, &legacy), offline_model_path(game_directory, &current)),
    ] {
        if from.exists() && !to.exists() {
            let _ = std::fs::rename(from, to);
        }
    }
}

pub fn remove_offline_skin(game_directory: &Path, uuid: &str) -> Result<()> {
    for path in [offline_skin_path(game_directory, uuid), offline_model_path(game_directory, uuid)] {
        if path.exists() {
            std::fs::remove_file(path)?;
        }
    }
    Ok(())
}

// ---- Profile lookup ----------------------------------------------------
//
// Powers the Skins page's "find a player" box and the picture of what the
// signed-in account is wearing right now. Everything comes straight from
// Mojang (username -> uuid -> session profile -> texture), so it needs no
// third-party skin mirror and always reflects the real, current skin.

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinLookup {
    pub name: String,
    pub uuid: String,
    /// Base64 PNG, or `None` when the player has never set a custom skin.
    pub skin: Option<String>,
    pub variant: SkinVariant,
    /// Base64 PNG of the player's cape, if they own and wear one.
    pub cape: Option<String>,
}

async fn fetch_texture_base64(client: &reqwest::Client, url: &str) -> Result<String> {
    if !url.starts_with("http://textures.minecraft.net/") && !url.starts_with("https://textures.minecraft.net/") {
        bail!("Mojang returned a texture from an unexpected host.");
    }
    let bytes = client.get(url).send().await?.error_for_status()?.bytes().await?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Looks a player up by username or by UUID (dashed or not).
pub async fn lookup_profile(query: &str) -> Result<SkinLookup> {
    let query = query.trim();
    if query.is_empty() {
        bail!("Type a Minecraft username first.");
    }
    let client = net::client();

    let compact: String = query.chars().filter(|c| *c != '-').collect();
    let is_uuid = compact.len() == 32 && compact.chars().all(|c| c.is_ascii_hexdigit());

    let uuid = if is_uuid {
        compact.to_lowercase()
    } else {
        if query.len() > 16 || !query.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            bail!("That doesn't look like a Minecraft username - use up to 16 letters, numbers or underscores.");
        }
        let resp = client
            .get(format!("https://api.mojang.com/users/profiles/minecraft/{query}"))
            .send()
            .await?;
        let status = resp.status();
        if status == reqwest::StatusCode::NOT_FOUND || status == reqwest::StatusCode::NO_CONTENT {
            bail!("No Minecraft account is named \"{query}\".");
        }
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            bail!("Mojang is rate-limiting lookups - wait a minute and try again.");
        }
        if !status.is_success() {
            bail!("Mojang lookup failed: {status}");
        }
        let json: serde_json::Value = resp.json().await?;
        match json["id"].as_str() {
            Some(id) => id.to_string(),
            None => bail!("Mojang didn't return a profile for \"{query}\"."),
        }
    };

    let resp = client
        .get(format!("https://sessionserver.mojang.com/session/minecraft/profile/{uuid}"))
        .send()
        .await?;
    let status = resp.status();
    if status == reqwest::StatusCode::NOT_FOUND || status == reqwest::StatusCode::NO_CONTENT {
        bail!("That profile doesn't exist.");
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        bail!("Mojang is rate-limiting lookups - wait a minute and try again.");
    }
    if !status.is_success() {
        bail!("Mojang profile lookup failed: {status}");
    }
    let profile: serde_json::Value = resp.json().await?;
    let name = profile["name"].as_str().unwrap_or(query).to_string();

    let textures_b64 = profile["properties"]
        .as_array()
        .and_then(|props| props.iter().find(|p| p["name"].as_str() == Some("textures")))
        .and_then(|p| p["value"].as_str());

    let mut skin_url: Option<String> = None;
    let mut cape_url: Option<String> = None;
    let mut variant = SkinVariant::Classic;
    if let Some(encoded) = textures_b64 {
        let decoded = base64::engine::general_purpose::STANDARD.decode(encoded)?;
        let textures: serde_json::Value = serde_json::from_slice(&decoded)?;
        let skin = &textures["textures"]["SKIN"];
        if let Some(url) = skin["url"].as_str() {
            skin_url = Some(url.to_string());
            if skin["metadata"]["model"].as_str() == Some("slim") {
                variant = SkinVariant::Slim;
            }
        }
        if let Some(url) = textures["textures"]["CAPE"]["url"].as_str() {
            cape_url = Some(url.to_string());
        }
    }

    let skin = match skin_url {
        Some(url) => Some(fetch_texture_base64(&client, &url).await?),
        None => None,
    };
    // A cape is decoration - never fail the whole lookup because it 404s.
    let cape = match cape_url {
        Some(url) => fetch_texture_base64(&client, &url).await.ok(),
        None => None,
    };

    Ok(SkinLookup { name, uuid, skin, variant, cape })
}

// ---- Capes -------------------------------------------------------------
//
// Capes can't be uploaded - they're unlocked on the Microsoft account itself.
// What a launcher can do is list the ones the account owns and pick which one
// is worn, which is exactly what the Skins page's Capes tab does.

const PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnedCape {
    pub id: String,
    /// Mojang's alias, tidied up for display ("MineCon 2016").
    pub name: String,
    /// Base64 PNG of the cape texture; `None` when it couldn't be downloaded.
    pub data: Option<String>,
    /// True for the one the account is wearing right now.
    pub active: bool,
}

/// "MineCon2016" -> "MineCon 2016", "Migrator" -> "Migrator". Mojang's aliases
/// are camel-case words with the year glued on; the rest is left alone.
fn pretty_cape_name(alias: &str) -> String {
    let chars: Vec<char> = alias.trim().chars().collect();
    let mut out = String::with_capacity(chars.len() + 2);
    for (i, c) in chars.iter().enumerate() {
        if i > 0 {
            let prev = chars[i - 1];
            let boundary = (prev.is_lowercase() && c.is_uppercase()) || (prev.is_alphabetic() && c.is_ascii_digit());
            if boundary && prev != ' ' {
                out.push(' ');
            }
        }
        out.push(*c);
    }
    if out.is_empty() {
        "Cape".to_string()
    } else {
        out
    }
}

fn active_cape_id(profile: &serde_json::Value) -> Option<String> {
    profile["capes"]
        .as_array()?
        .iter()
        .find(|c| c["state"].as_str() == Some("ACTIVE"))
        .and_then(|c| c["id"].as_str())
        .map(str::to_string)
}

/// Turns a non-2xx response from the profile API into a message worth showing.
async fn profile_error(resp: reqwest::Response, what: &str) -> anyhow::Error {
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return anyhow::anyhow!("Your Microsoft session has expired - sign in again, then retry.");
    }
    let text = resp.text().await.unwrap_or_default();
    anyhow::anyhow!("{what} failed: {status} {text}")
}

/// Every cape the signed-in account owns, textures included, with the worn one flagged.
pub async fn list_capes(access_token: &str) -> Result<Vec<OwnedCape>> {
    let client = net::client();
    let resp = client.get(PROFILE_URL).bearer_auth(access_token).send().await?;
    if !resp.status().is_success() {
        return Err(profile_error(resp, "Loading your capes").await);
    }
    let profile: serde_json::Value = resp.json().await?;

    let mut capes = Vec::new();
    for cape in profile["capes"].as_array().map(Vec::as_slice).unwrap_or_default() {
        let Some(id) = cape["id"].as_str() else { continue };
        // A missing texture only costs that tile its picture, so never fail the list.
        let data = match cape["url"].as_str() {
            Some(url) => fetch_texture_base64(client, url).await.ok(),
            None => None,
        };
        capes.push(OwnedCape {
            id: id.to_string(),
            name: pretty_cape_name(cape["alias"].as_str().unwrap_or("Cape")),
            data,
            active: cape["state"].as_str() == Some("ACTIVE"),
        });
    }
    Ok(capes)
}

/// Wears `cape_id`, or takes the cape off when it is `None`. Returns the id
/// Mojang reports as active afterwards, so the UI can trust the result.
pub async fn set_cape(access_token: &str, cape_id: Option<&str>) -> Result<Option<String>> {
    let client = net::client();
    let url = format!("{PROFILE_URL}/capes/active");
    let resp = match cape_id {
        Some(id) => {
            client
                .put(&url)
                .bearer_auth(access_token)
                .json(&serde_json::json!({ "capeId": id }))
                .send()
                .await?
        }
        None => client.delete(&url).bearer_auth(access_token).send().await?,
    };
    if !resp.status().is_success() {
        return Err(profile_error(resp, if cape_id.is_some() { "Wearing that cape" } else { "Removing your cape" }).await);
    }
    // Both calls answer with the updated profile.
    let profile: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    Ok(active_cape_id(&profile))
}
