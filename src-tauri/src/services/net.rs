//! Shared HTTP plumbing for every download the launcher makes.
//!
//! Built for slow/flaky connections:
//! - one pooled client, so thousands of asset requests reuse a handful of
//!   TLS connections instead of handshaking per file;
//! - a *read* timeout (no data for N seconds) rather than a total one, so a
//!   big file on a slow line isn't killed just for taking a while;
//! - retries with backoff around the whole transfer (request + body + hash),
//!   not just the headers, and on 5xx/429 as well as dropped connections;
//! - files land under a `.part` name and are only renamed into place once
//!   complete and verified, and a leftover `.part` is resumed with `Range`.

use anyhow::{anyhow, Result};
use serde::de::DeserializeOwned;
use sha1::{Digest, Sha1};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

pub const USER_AGENT: &str = concat!("amethyst-launcher/", env!("CARGO_PKG_VERSION"));

/// How many files to fetch at once for bulk downloads (assets, libraries,
/// Java runtime, modpack files). Enough to hide round-trip latency without
/// splitting a slow line so thin that every transfer times out.
pub const CONCURRENCY: usize = 8;

const MAX_ATTEMPTS: u32 = 5;

pub fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(30))
            .pool_idle_timeout(Duration::from_secs(90))
            .tcp_keepalive(Duration::from_secs(30))
            .build()
            .expect("failed to build reqwest client")
    })
}

/// Walks a `reqwest::Error`'s full cause chain, since its default `Display`
/// only shows a generic top-level message ("error sending request for url
/// (...)") and hides the actual DNS/TLS/connect failure underneath it.
pub fn describe_error(e: &reqwest::Error) -> String {
    let mut msg = e.to_string();
    let mut source = std::error::Error::source(e);
    while let Some(s) = source {
        msg.push_str(&format!(" -> {s}"));
        source = s.source();
    }
    msg
}

/// Outcome of one attempt: `Retry` errors are worth another go after a
/// pause (network drops, timeouts, 5xx/429, bad hash), `Fatal` ones aren't
/// (404, disk errors).
enum Failure {
    Retry(anyhow::Error, Option<Duration>),
    Fatal(anyhow::Error),
}

impl From<reqwest::Error> for Failure {
    fn from(e: reqwest::Error) -> Self {
        Failure::Retry(anyhow!(describe_error(&e)), None)
    }
}

impl From<std::io::Error> for Failure {
    fn from(e: std::io::Error) -> Self {
        Failure::Fatal(e.into())
    }
}

fn status_failure(url: &str, resp: &reqwest::Response) -> Failure {
    let status = resp.status();
    let err = anyhow!("HTTP {status} for {url}");
    let retryable = status.is_server_error()
        || status == reqwest::StatusCode::TOO_MANY_REQUESTS
        || status == reqwest::StatusCode::REQUEST_TIMEOUT;
    if retryable {
        let retry_after = resp
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok())
            .filter(|&s| s <= 60)
            .map(Duration::from_secs);
        Failure::Retry(err, retry_after)
    } else {
        Failure::Fatal(err)
    }
}

/// 0.5s, 1s, 2s, 4s... (capped at 10s) plus up to 250ms of jitter, so a
/// batch of parallel downloads that failed together doesn't retry in lockstep.
fn backoff(attempt: u32) -> Duration {
    let base = 500u64.saturating_mul(1 << (attempt - 1).min(5)).min(10_000);
    let jitter = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64 % 250)
        .unwrap_or(0);
    Duration::from_millis(base + jitter)
}

async fn with_retry<T, F, Fut>(url: &str, mut attempt_fn: F) -> Result<T>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = std::result::Result<T, Failure>>,
{
    let mut last_err = None;
    for attempt in 1..=MAX_ATTEMPTS {
        match attempt_fn().await {
            Ok(v) => return Ok(v),
            Err(Failure::Fatal(e)) => return Err(e),
            Err(Failure::Retry(e, retry_after)) => {
                last_err = Some(e);
                if attempt < MAX_ATTEMPTS {
                    tokio::time::sleep(retry_after.unwrap_or_else(|| backoff(attempt))).await;
                }
            }
        }
    }
    let e = last_err.unwrap_or_else(|| anyhow!("unknown error"));
    Err(e.context(format!("Download failed after {MAX_ATTEMPTS} attempts: {url}")))
}

/// Fetches a whole (small) response body, retrying the full transfer.
pub async fn get_bytes(url: &str) -> Result<Vec<u8>> {
    with_retry(url, move || async move {
        let resp = client().get(url).send().await?;
        if !resp.status().is_success() {
            return Err(status_failure(url, &resp));
        }
        Ok(resp.bytes().await?.to_vec())
    })
    .await
}

pub async fn get_json<T: DeserializeOwned>(url: &str) -> Result<T> {
    let bytes = get_bytes(url).await?;
    serde_json::from_slice(&bytes).map_err(|e| anyhow!("Invalid JSON from {url}: {e}"))
}

pub fn sha1_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha1::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Whether `path` already holds the expected file. With no hash or size to
/// check against, existing is enough - downloads only ever appear under
/// their real name once complete.
pub fn file_matches(path: &Path, sha1: Option<&str>, size: Option<u64>) -> bool {
    let Ok(meta) = std::fs::metadata(path) else { return false };
    if size.is_some_and(|s| s != meta.len()) {
        return false;
    }
    match sha1 {
        Some(expected) => sha1_file(path).is_ok_and(|h| h.eq_ignore_ascii_case(expected)),
        None => true,
    }
}

fn part_path(destination: &Path) -> PathBuf {
    let mut name = destination.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    destination.with_file_name(name)
}

/// Downloads `url` to `destination` unless it's already there and matches.
pub async fn ensure_file(url: &str, destination: &Path, sha1: Option<&str>, size: Option<u64>) -> Result<()> {
    if file_matches(destination, sha1, size) {
        return Ok(());
    }
    download(url, destination, sha1, size, |_, _| {}).await
}

/// Downloads `url` to `destination`, reporting `(downloaded, total)` bytes.
/// Streams into `<name>.part` (resuming one left by an earlier attempt or
/// run), verifies size/SHA-1 when given, then renames it into place.
pub async fn download(
    url: &str,
    destination: &Path,
    sha1: Option<&str>,
    size: Option<u64>,
    mut on_bytes: impl FnMut(u64, u64),
) -> Result<()> {
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let part = part_path(destination);
    let mut last_err = None;
    for attempt in 1..=MAX_ATTEMPTS {
        match download_attempt(url, destination, &part, sha1, size, &mut on_bytes).await {
            Ok(()) => return Ok(()),
            Err(Failure::Fatal(e)) => return Err(e),
            Err(Failure::Retry(e, retry_after)) => {
                last_err = Some(e);
                if attempt < MAX_ATTEMPTS {
                    tokio::time::sleep(retry_after.unwrap_or_else(|| backoff(attempt))).await;
                }
            }
        }
    }
    let e = last_err.unwrap_or_else(|| anyhow!("unknown error"));
    Err(e.context(format!("Download failed after {MAX_ATTEMPTS} attempts: {url}")))
}

async fn download_attempt(
    url: &str,
    destination: &Path,
    part: &Path,
    sha1: Option<&str>,
    size: Option<u64>,
    on_bytes: &mut impl FnMut(u64, u64),
) -> std::result::Result<(), Failure> {
    let mut have = std::fs::metadata(part).map(|m| m.len()).unwrap_or(0);
    if size.is_some_and(|s| have > s) {
        std::fs::remove_file(part)?;
        have = 0;
    }

    let mut req = client().get(url);
    if have > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let mut resp = req.send().await?;

    let status = resp.status();
    if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        // The .part is stale, or complete but never verified; start over.
        let _ = std::fs::remove_file(part);
        return Err(Failure::Retry(anyhow!("Range not satisfiable for {url}"), Some(Duration::ZERO)));
    }
    if !status.is_success() {
        return Err(status_failure(url, &resp));
    }
    let resumed = have > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT;
    if !resumed {
        have = 0;
    }

    let total = resp.content_length().map(|len| len + have).or(size).unwrap_or(0);
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(resumed)
        .truncate(!resumed)
        .open(part)
        .await?;

    let mut done = have;
    let mut last_reported = done;
    on_bytes(done, total);
    loop {
        let chunk = match resp.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(e) => {
                // Keep what arrived so the next attempt resumes from here.
                let _ = file.flush().await;
                return Err(e.into());
            }
        };
        file.write_all(&chunk).await?;
        done += chunk.len() as u64;
        if done - last_reported >= 128 * 1024 {
            last_reported = done;
            on_bytes(done, total);
        }
    }
    file.flush().await?;
    drop(file);
    on_bytes(done, total.max(done));

    if let Some(expected) = size.filter(|&s| s != done) {
        let _ = std::fs::remove_file(part);
        return Err(Failure::Retry(anyhow!("Size mismatch for {url}: expected {expected}, got {done}"), None));
    }
    if let Some(expected) = sha1 {
        if !sha1_file(part)?.eq_ignore_ascii_case(expected) {
            let _ = std::fs::remove_file(part);
            return Err(Failure::Retry(anyhow!("Checksum mismatch for {url} (corrupted in transit)"), None));
        }
    }
    if destination.exists() {
        std::fs::remove_file(destination)?;
    }
    std::fs::rename(part, destination)?;
    Ok(())
}
