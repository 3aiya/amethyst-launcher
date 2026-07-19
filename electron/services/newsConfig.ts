/**
 * The News panel reads a simple JSON feed - host one anywhere (a GitHub Gist
 * raw URL, a file in your Amethyst Community website, a GitHub Pages repo,
 * etc.) with this shape:
 *
 * [
 *   { "title": "1.2.0 released", "body": "Short summary...", "date": "2026-07-01", "url": "https://..." },
 *   { "title": "Server maintenance", "body": "...", "date": "2026-06-20" }
 * ]
 *
 * `url` is optional - if present, clicking the item opens it in the browser.
 * Newest-first order is up to you; the launcher displays the array as-is.
 */

export const NEWS_FEED_URL = "PUT_YOUR_NEWS_FEED_URL_HERE";

/** Social links shown at the bottom of the News panel. Leave any value as ""
 * to hide that icon. */
export const SOCIAL_LINKS = {
  modrinth: "https://modrinth.com/user/MaIY_a",
  discord: "https://discord.gg/ZNzqkytxn",
  twitter: "",
  youtube: "https://www.youtube.com/@MaIY_a",
  reddit: "",
};
