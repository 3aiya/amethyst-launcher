//! Port of `services/auth.ts`.
//!
//! Offline login is a direct 1:1 port (same MD5 UUID scheme Mojang uses for
//! offline/cracked accounts).
//!
//! Microsoft login is the one place this port can't be a drop-in swap: the
//! original used `msmc`, which bundles its own pre-registered Azure AD
//! application ID so you never had to create one. There is no public,
//! reusable client ID like that for Rust, so this file implements the same
//! Microsoft -> Xbox Live -> XSTS -> Minecraft chain by hand, but you must
//! register your own free Azure app and put its Application (client) ID in
//! `MS_CLIENT_ID` below:
//!   1. https://portal.azure.com -> Azure Active Directory -> App registrations -> New registration
//!   2. IMPORTANT - "Supported account types": pick "Accounts in any organizational
//!      directory and personal Microsoft accounts" (or "Personal Microsoft accounts
//!      only"). The default option ("...this organizational directory only") is a
//!      single-tenant work/school-only app - personal Microsoft/Xbox accounts (which
//!      is what every Minecraft login is) can't sign into it at all, and what looks
//!      like a "needs admin approval" wall is actually just that mismatch. If you
//!      already created the app with the wrong option: App registrations -> your app
//!      -> Manifest -> set `"signInAudience"` to `"AzureADandPersonalMicrosoftAccount"`
//!      (or `"PersonalMicrosoftAccount"`) and save - no need to start over.
//!   3. Redirect URI: add a "Public client/native" platform with redirect URI
//!      `http://localhost:{MS_REDIRECT_PORT}/callback` (matches the constant below)
//!   4. Authentication -> enable "Allow public client flows"
//!   5. Copy the "Application (client) ID" into MS_CLIENT_ID
//!
//! Note: personal Microsoft accounts have no concept of "admin consent" (that's an
//! Azure AD org-tenant idea), so once step 2 is right, XboxLive.signin/offline_access
//! need nothing extra approved - the person just gets Microsoft's standard sign-in
//! consent screen and clicks Yes. The one thing that can't be removed short of going
//! through Microsoft's (paid, multi-week) Publisher Verification process is the
//! "This app isn't verified, continue only if you trust it" notice - every
//! self-registered third-party launcher shows that, it's cosmetic, and it doesn't
//! block sign-in.
//!
//! Everything else (the Xbox Live/XSTS/Minecraft token exchange) needs no
//! registration - it's the same public flow every third-party launcher uses.

use crate::types::{Account, AuthMode};
use anyhow::{anyhow, bail, Result};
use md5::{Digest, Md5};
use serde::Deserialize;
use serde_json::json;
use std::net::TcpListener;
use std::io::{Read, Write};
use std::time::{SystemTime, UNIX_EPOCH};

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub const MS_CLIENT_ID: &str = "be9f87fe-2f44-4e07-b292-e8fbd9f7e335";
const MS_REDIRECT_PORT: u16 = 43110;
const MS_SCOPE: &str = "XboxLive.signin offline_access";

/// The UUID an offline-mode server gives this name - Java's
/// `UUID.nameUUIDFromBytes("OfflinePlayer:<name>")`, i.e. an MD5 with the
/// version-3 and IETF variant bits set. It has to match the server's exactly,
/// or the game treats the server-side player as someone else (and, among
/// other things, won't show them their own skin). Unhyphenated.
pub fn offline_uuid(name: &str) -> String {
    let mut bytes = legacy_offline_digest(name);
    bytes[6] = (bytes[6] & 0x0f) | 0x30;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    hex::encode(bytes)
}

/// The UUID earlier launcher versions gave offline accounts: the same MD5
/// without the version/variant bits. Only kept to migrate old data.
pub fn legacy_offline_uuid(name: &str) -> String {
    hex::encode(legacy_offline_digest(name))
}

fn legacy_offline_digest(name: &str) -> [u8; 16] {
    Md5::digest(format!("OfflinePlayer:{name}")).into()
}

pub fn offline_login(username: &str) -> Result<Account> {
    let trimmed = username.trim();
    if trimmed.is_empty() {
        bail!("Username cannot be empty.");
    }
    if trimmed.chars().count() > 25 {
        bail!("Username is too long.");
    }

    Ok(Account {
        name: trimmed.to_string(),
        uuid: offline_uuid(trimmed),
        access_token: "0".to_string(),
        refresh_token: None,
        auth_mode: AuthMode::Offline,
        last_used_at: None,
        token_refreshed_at: None,
    })
}

#[derive(Deserialize)]
struct MsTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct XblResponse {
    #[serde(rename = "Token")]
    token: String,
    #[serde(rename = "DisplayClaims")]
    display_claims: XblDisplayClaims,
}
#[derive(Deserialize)]
struct XblDisplayClaims {
    xui: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
struct McLoginResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct McProfileResponse {
    id: String,
    name: String,
}

/// Opens the system browser to Microsoft's login page and spins up a tiny
/// localhost server to catch the OAuth redirect - the desktop-app pattern
/// Microsoft recommends instead of an embedded webview.
/// A random PKCE `code_verifier` (RFC 7636) - built from two UUIDv4s (64 hex
/// chars, well within the required 43-128 range and already restricted to
/// the allowed unreserved character set) rather than pulling in a `rand`
/// dependency just for this.
fn generate_pkce_verifier() -> String {
    let a = uuid::Uuid::new_v4().simple().to_string();
    let b = uuid::Uuid::new_v4().simple().to_string();
    format!("{a}{b}")
}

fn pkce_challenge(verifier: &str) -> String {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

/// Returns `(auth_code, pkce_code_verifier)` - the verifier has to be handed
/// back to `exchange_code_for_token` later, since it's what proves the token
/// request came from the same client that started the sign-in.
fn authorize_interactive() -> Result<(String, String)> {
    let code_verifier = generate_pkce_verifier();
    let code_challenge = pkce_challenge(&code_verifier);

    let redirect_uri = format!("http://localhost:{MS_REDIRECT_PORT}/callback");
    let auth_url = format!(
        "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?\
         client_id={MS_CLIENT_ID}&response_type=code&redirect_uri={}&scope={}&prompt=select_account\
         &code_challenge={}&code_challenge_method=S256",
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(MS_SCOPE),
        urlencoding::encode(&code_challenge)
    );

    let listener = TcpListener::bind(("127.0.0.1", MS_REDIRECT_PORT))
        .map_err(|e| anyhow!("Could not open local auth listener: {e}"))?;

    open::that(&auth_url).map_err(|e| anyhow!("Could not open the browser: {e}"))?;

    let (mut stream, _) = listener.accept()?;
    let mut buf = [0u8; 4096];
    let n = stream.read(&mut buf)?;
    let request = String::from_utf8_lossy(&buf[..n]);
    let first_line = request.lines().next().unwrap_or_default();

    // Properly parse the request line's query string instead of a naive
    // "code=" substring search - that both missed URL-decoding the value
    // (the auth code can contain %2B/%3D/etc., and Azure will reject it as
    // an "invalid code" if we send it back still percent-encoded) and could
    // in principle match "code=" appearing inside some other parameter.
    let request_target = first_line.split_whitespace().nth(1).unwrap_or_default();
    let query = request_target.splitn(2, '?').nth(1).unwrap_or_default();
    let code = query
        .split('&')
        .find_map(|pair| {
            let mut kv = pair.splitn(2, '=');
            let key = kv.next()?;
            let value = kv.next()?;
            (key == "code").then(|| urlencoding::decode(value).ok().map(|c| c.into_owned()))?
        })
        .ok_or_else(|| anyhow!("Microsoft sign-in did not return an auth code."))?;

    let body = "<html><body>Signed in - you can close this tab and return to Amethyst Launcher.</body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());

    Ok((code, code_verifier))
}

async fn exchange_code_for_token(client: &reqwest::Client, code: &str, code_verifier: &str) -> Result<MsTokenResponse> {
    let redirect_uri = format!("http://localhost:{MS_REDIRECT_PORT}/callback");
    let params = [
        ("client_id", MS_CLIENT_ID),
        ("code", code),
        ("grant_type", "authorization_code"),
        ("redirect_uri", &redirect_uri),
        ("scope", MS_SCOPE),
        ("code_verifier", code_verifier),
    ];
    let resp = client
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&params)
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        bail!("Microsoft token exchange failed: {status} - {body}");
    }
    Ok(resp.json().await?)
}

async fn refresh_ms_token(client: &reqwest::Client, refresh_token: &str) -> Result<MsTokenResponse> {
    let params = [
        ("client_id", MS_CLIENT_ID),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
        ("scope", MS_SCOPE),
    ];
    let resp = client
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")

        .form(&params)
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        bail!("Microsoft token refresh failed: {status} - {body}");
    }
    Ok(resp.json().await?)
}

/// A response-body-aware helper: `error_for_status()` alone throws away the
/// response text, which for Mojang/Xbox APIs is where the actually-useful
/// error detail lives - a bare "403 Forbidden" with no body tells you
/// nothing.
async fn ok_or_body_error(resp: reqwest::Response, context: &str) -> Result<reqwest::Response> {
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    bail!("{context}: {status} - {body}")
}

/// Runs the Xbox Live -> XSTS -> Minecraft chain that every third-party
/// launcher uses once it already has a Microsoft `access_token`.
async fn xbox_and_minecraft_login(client: &reqwest::Client, ms_access_token: &str) -> Result<(String, String)> {
    // 1. Xbox Live user token
    let xbl_resp = client
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .json(&json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": format!("d={ms_access_token}")
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        }))
        .send()
        .await?;
    let xbl: XblResponse = ok_or_body_error(xbl_resp, "Xbox Live sign-in failed").await?.json().await?;

    let user_hash = xbl
        .display_claims
        .xui
        .get(0)
        .and_then(|v| v.get("uhs"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("Xbox Live response missing user hash."))?
        .to_string();

    // 2. XSTS token
    let xsts_resp = client
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .json(&json!({
            "Properties": {
                "SandboxId": "RETAIL",
                "UserTokens": [xbl.token]
            },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT"
        }))
        .send()
        .await?;
    let xsts: XblResponse = ok_or_body_error(xsts_resp, "Xbox XSTS authorization failed (account may lack an Xbox profile)")
        .await?
        .json()
        .await?;

    // 3. Minecraft login-with-xbox
    let mc_resp = client
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&json!({ "identityToken": format!("XBL3.0 x={user_hash};{}", xsts.token) }))
        .send()
        .await?;
    let mc_login: McLoginResponse = ok_or_body_error(mc_resp, "Minecraft login-with-Xbox failed").await?.json().await?;

    Ok((mc_login.access_token, user_hash))
}

/// A single client shared by every Microsoft/Xbox/Minecraft call. Setting a
/// real `User-Agent` matters here: `api.minecraftservices.com` sits behind
/// bot protection that silently 403s requests carrying reqwest's generic
/// default UA string, with no explanation in the (empty) response body.
fn ms_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("amethyst-launcher/1.0.0")
        .build()
        .expect("failed to build reqwest client")
}

pub async fn login_with_microsoft() -> Result<Account> {
    if MS_CLIENT_ID.starts_with("PUT_YOUR") {
        bail!(
            "Microsoft sign-in isn't configured yet. Register a free Azure app and set \
             MS_CLIENT_ID in src-tauri/src/services/auth.rs (see the comment at the top of that file)."
        );
    }

    let (code, code_verifier) = authorize_interactive()?;
    let client = ms_http_client();
    let ms_token = exchange_code_for_token(&client, &code, &code_verifier).await?;
    let (mc_access_token, _hash) = xbox_and_minecraft_login(&client, &ms_token.access_token).await?;

    let profile_resp = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(&mc_access_token)
        .send()
        .await?;
    let profile: McProfileResponse = ok_or_body_error(profile_resp, "Fetching the Minecraft profile failed")
        .await?
        .json()
        .await?;

    Ok(Account {
        name: profile.name,
        uuid: profile.id,
        access_token: mc_access_token,
        refresh_token: ms_token.refresh_token,
        auth_mode: AuthMode::Microsoft,
        last_used_at: None,
        token_refreshed_at: Some(now_ms()),
    })
}

pub async fn refresh_microsoft_login(refresh_token: &str) -> Result<Account> {
    let client = ms_http_client();
    let ms_token = refresh_ms_token(&client, refresh_token).await?;
    let (mc_access_token, _hash) = xbox_and_minecraft_login(&client, &ms_token.access_token).await?;

    let profile_resp = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(&mc_access_token)
        .send()
        .await?;
    let profile: McProfileResponse = ok_or_body_error(profile_resp, "Fetching the Minecraft profile failed")
        .await?
        .json()
        .await?;

    Ok(Account {
        name: profile.name,
        uuid: profile.id,
        access_token: mc_access_token,
        refresh_token: ms_token.refresh_token.or_else(|| Some(refresh_token.to_string())),
        auth_mode: AuthMode::Microsoft,
        last_used_at: None,
        token_refreshed_at: Some(now_ms()),
    })
}
