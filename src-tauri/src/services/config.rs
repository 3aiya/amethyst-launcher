//! Port of `discordConfig.ts`, `newsConfig.ts`, and `amethystRemoteConfig.ts`.
//! Same "edit these constants to go live" pattern as the original.

use crate::types::SocialLinks;

// ---- discordConfig.ts -------------------------------------------------
pub const DISCORD_CLIENT_ID: &str = "1525477067284676628";
pub const DISCORD_LARGE_IMAGE_KEY: &str = "amethyst_logo_placeholder";
pub const DISCORD_LARGE_IMAGE_TEXT: &str = "Amethyst Launcher";

// ---- newsConfig.ts ------------------------------------------------------
/// The News panel reads a simple JSON feed - host one anywhere (a GitHub
/// Gist raw URL, a file on your own site, GitHub Pages, etc.) shaped like:
/// `[{ "title": "...", "body": "...", "date": "2026-07-01", "url": "..." }]`
pub const NEWS_FEED_URL: &str = "PUT_YOUR_NEWS_FEED_URL_HERE";

pub fn social_links() -> SocialLinks {
    SocialLinks {
        modrinth: String::new(),
        discord: String::new(),
        twitter: String::new(),
        youtube: String::new(),
        reddit: String::new(),
    }
}

// ---- Admin dashboard ------------------------------------------------------
/// Public API of the `amethyst-admin` dashboard on Vercel, e.g.
/// "https://amethyst-admin.vercel.app/api/public". Once set, news, social
/// links, the announcement banner, maintenance mode, the server mods and
/// usage stats all come from the dashboard. While it's still the placeholder,
/// the launcher falls back to `NEWS_FEED_URL` and `social_links()`, and server
/// Play launches without any server mods.
pub const ADMIN_API_BASE: &str = "https://amethyst-launcher-admin.vercel.app/api/public";

/// `ADMIN_API_BASE/<path>`, or `None` when the dashboard isn't configured.
pub fn admin_api_url(path: &str) -> Option<String> {
    if ADMIN_API_BASE.is_empty() || ADMIN_API_BASE.starts_with("PUT_YOUR") {
        return None;
    }
    Some(format!("{}/{path}", ADMIN_API_BASE.trim_end_matches('/')))
}

// ---- CurseForge -------------------------------------------------------------
/// CurseForge's official API needs a key from https://console.curseforge.com.
/// It is read at build time from the `CURSEFORGE_API_KEY` environment
/// variable and is never committed. Without one, Browse goes through the
/// public `api.curse.tools` mirror, which serves the same v1 API without a key.
const CURSEFORGE_API_KEY: Option<&str> = option_env!("CURSEFORGE_API_KEY");

const CURSEFORGE_OFFICIAL_API: &str = "https://api.curseforge.com/v1";
const CURSEFORGE_PROXY_API: &str = "https://api.curse.tools/v1";

/// Base URL of the CurseForge v1 API plus the key to send with it, if any.
pub fn curseforge_api() -> (&'static str, Option<&'static str>) {
    let key = CURSEFORGE_API_KEY.filter(|k| !k.trim().is_empty());
    match key {
        Some(key) => (CURSEFORGE_OFFICIAL_API, Some(key)),
        None => (CURSEFORGE_PROXY_API, None),
    }
}
