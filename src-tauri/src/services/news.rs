//! Port of `services/news.ts`.

use super::config::{self, admin_api_url, NEWS_FEED_URL};
use super::{net, remote};
use crate::types::{NewsItem, SocialLinks};

fn is_configured(url: &str) -> bool {
    !url.is_empty() && !url.starts_with("PUT_YOUR")
}

/// The admin dashboard's feed always wins once it's configured, so posts made
/// there reach every launcher. `override_url` (`AmethystSettings::news_feed_url`,
/// a leftover from the old Admin panel) and the compile-time `NEWS_FEED_URL`
/// are only fallbacks for builds without a dashboard - a stale override saved
/// on some PC must not hide the dashboard's posts.
pub async fn get_news(override_url: Option<&str>) -> Vec<NewsItem> {
    let url = admin_api_url("news")
        .or_else(|| override_url.filter(|u| !u.is_empty()).map(str::to_string))
        .unwrap_or_else(|| NEWS_FEED_URL.to_string());
    if !is_configured(&url) {
        return Vec::new();
    }
    let Ok(resp) = net::client().get(&url).send().await else { return Vec::new() };
    if !resp.status().is_success() {
        return Vec::new();
    }
    resp.json::<Vec<NewsItem>>().await.unwrap_or_default()
}

/// The dashboard's links when it's reachable, else the compiled-in ones.
pub async fn get_social_links() -> SocialLinks {
    remote::get_config().await.social_links.unwrap_or_else(config::social_links)
}
