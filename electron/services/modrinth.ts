/**
 * Thin wrapper around the public Modrinth API (api.modrinth.com/v2).
 * No auth needed for search/browse - Modrinth just asks for a descriptive
 * User-Agent, which is set in USER_AGENT below (edit it to point at your
 * own project/contact if you want).
 */

import type { BrowseCategory, ModrinthSearchResult, ModrinthVersion, ModrinthVersionFile } from "../../shared/ipc-types";

const API_BASE = "https://api.modrinth.com/v2";
const USER_AGENT = "amethyst-launcher/1.0.0 (github.com/PUT_YOUR_GITHUB_USERNAME_HERE/amethyst-launcher)";

/** Maps our tabs to Modrinth's actual project_type facet + any extra
 * category facet needed (datapacks are tagged as mods with a "datapack"
 * category rather than having their own project_type). */
const CATEGORY_FACETS: Record<BrowseCategory, { projectType: string; extraCategory?: string }> = {
  modpack: { projectType: "modpack" },
  mod: { projectType: "mod" },
  resourcepack: { projectType: "resourcepack" },
  datapack: { projectType: "mod", extraCategory: "datapack" },
  shader: { projectType: "shader" },
};

function headers(): Record<string, string> {
  return { "User-Agent": USER_AGENT };
}

export interface ModrinthSearchPage {
  results: ModrinthSearchResult[];
  totalHits: number;
  offset: number;
  limit: number;
}

export async function search(query: string, category: BrowseCategory, offset = 0): Promise<ModrinthSearchPage> {
  const { projectType, extraCategory } = CATEGORY_FACETS[category];
  const facets: string[][] = [[`project_type:${projectType}`]];
  if (extraCategory) facets.push([`categories:${extraCategory}`]);

  const limit = 20;
  const params = new URLSearchParams({
    query,
    facets: JSON.stringify(facets),
    limit: String(limit),
    offset: String(offset),
    index: "relevance",
  });

  const response = await fetch(`${API_BASE}/search?${params.toString()}`, { headers: headers() });
  if (!response.ok) throw new Error(`Modrinth search failed (${response.status}).`);
  const data = (await response.json()) as {
    hits: Array<{
      project_id: string;
      slug: string;
      title: string;
      description: string;
      icon_url: string | null;
      downloads: number;
      author: string;
    }>;
    total_hits: number;
  };

  return {
    results: data.hits.map((hit) => ({
      id: hit.project_id,
      slug: hit.slug,
      title: hit.title,
      description: hit.description,
      iconUrl: hit.icon_url,
      downloads: hit.downloads,
      author: hit.author,
      category,
    })),
    totalHits: data.total_hits,
    offset,
    limit,
  };
}

export async function getVersions(projectId: string): Promise<ModrinthVersion[]> {
  const url = `${API_BASE}/project/${projectId}/version`;
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) throw new Error(`Failed to load versions (${response.status}).`);
  const data = (await response.json()) as Array<{
    id: string;
    version_number: string;
    game_versions: string[];
    loaders: string[];
    files: Array<{ url: string; filename: string; primary: boolean }>;
  }>;

  return data.map((v) => ({
    id: v.id,
    versionNumber: v.version_number,
    gameVersions: v.game_versions,
    loaders: v.loaders,
    files: v.files.map((f) => ({ url: f.url, filename: f.filename, primary: f.primary })),
  }));
}

/** Picks the file to actually download from a version - the one marked
 * primary, or the first file if none are. */
export function primaryFile(version: ModrinthVersion): ModrinthVersionFile | null {
  return version.files.find((f) => f.primary) ?? version.files[0] ?? null;
}
