import { useCallback, useEffect, useRef, useState } from "react";
import type { SkinVariant } from "../../types/global";
import type { WardrobeSkin } from "./types";
import { hashString } from "./skinImage";

const KEY = "amethyst.skins.wardrobe.v1";

function read(): WardrobeSkin[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(list: WardrobeSkin[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full or unavailable - the in-memory list still works this session */
  }
}

export interface NewSkin {
  name: string;
  variant: SkinVariant;
  data: string;
  sprite: string;
  source: string;
}

/**
 * The player's saved skins. Lives in localStorage (skins are a few KB each),
 * so the wardrobe survives restarts without needing any backend storage.
 */
export function useWardrobe() {
  const [skins, setSkins] = useState<WardrobeSkin[]>(read);
  const latest = useRef(skins);
  latest.current = skins;

  useEffect(() => write(skins), [skins]);

  /** Adds a skin, or returns the existing entry if the same image is already saved. */
  const add = useCallback((skin: NewSkin): { skin: WardrobeSkin; duplicate: boolean } => {
    const same = latest.current.find((s) => hashString(s.data) === hashString(skin.data));
    if (same) return { skin: same, duplicate: true };
    const created: WardrobeSkin = {
      id: `skin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      favorite: false,
      addedAt: Date.now(),
      ...skin,
    };
    // Update the ref now too, so a batch of adds before the next render still catches duplicates.
    latest.current = [created, ...latest.current];
    setSkins((prev) => [created, ...prev]);
    return { skin: created, duplicate: false };
  }, []);

  const update = useCallback((id: string, patch: Partial<Pick<WardrobeSkin, "name" | "favorite" | "variant">>) => {
    setSkins((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const remove = useCallback((id: string) => {
    setSkins((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return { skins, add, update, remove };
}

const WORN_KEY = "amethyst.skins.worn.v1";

/** Remembers which wardrobe skin was last worn, per account. */
export function readWornId(accountKey: string): string | null {
  try {
    const map = JSON.parse(localStorage.getItem(WORN_KEY) ?? "{}");
    return typeof map[accountKey] === "string" ? map[accountKey] : null;
  } catch {
    return null;
  }
}

export function writeWornId(accountKey: string, id: string | null) {
  try {
    const map = JSON.parse(localStorage.getItem(WORN_KEY) ?? "{}");
    if (id) map[accountKey] = id;
    else delete map[accountKey];
    localStorage.setItem(WORN_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}
