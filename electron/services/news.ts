import { NEWS_FEED_URL, SOCIAL_LINKS } from "./newsConfig";
import type { NewsItem, SocialLinks } from "../../shared/ipc-types";

function isConfigured(): boolean {
  return Boolean(NEWS_FEED_URL) && !NEWS_FEED_URL.startsWith("PUT_YOUR");
}

export async function getNews(): Promise<NewsItem[]> {
  if (!isConfigured()) return [];
  try {
    const response = await fetch(NEWS_FEED_URL);
    if (!response.ok) return [];
    const data = (await response.json()) as NewsItem[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function getSocialLinks(): SocialLinks {
  return SOCIAL_LINKS;
}
