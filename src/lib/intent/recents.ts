/**
 * The tools this browser recently finished a job in — slugs and times, never
 * a file name or anything a file holds — kept in their own key so a
 * workspace open in another tab cannot overwrite them (decision D-3).
 *
 * Read by the home desk's "Recent" slot (and, later, the palette and the
 * mobile menu); written when a result appears (redesign E.8). Every read and
 * write is wrapped: a browser that refuses storage (a private window, a
 * blocked site) gets no recents and no error.
 *
 * Listeners are a Set, with a reset for tests: vitest runs `isolate: false`,
 * so a module-level single slot would leak between files.
 */
import { useSyncExternalStore } from "react";

export const RECENTS_STORAGE_KEY = "pdfxyz.recents.v1";
/** The most a browser remembers; older ones fall off. */
export const MAX_RECENTS = 8;

export interface RecentTool {
  readonly slug: string;
  /** When the job finished, ms since the epoch. */
  readonly at: number;
}

interface Stored {
  readonly version: 1;
  readonly items: readonly RecentTool[];
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMPTY: readonly RecentTool[] = Object.freeze([]);

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The stored list, validated: anything malformed reads as nothing. */
function parse(raw: string | null): readonly RecentTool[] {
  if (!raw) return EMPTY;
  try {
    const value = JSON.parse(raw) as Partial<Stored> | null;
    if (!value || value.version !== 1 || !Array.isArray(value.items))
      return EMPTY;
    const seen = new Set<string>();
    const out: RecentTool[] = [];
    for (const item of value.items as unknown[]) {
      if (typeof item !== "object" || item === null) continue;
      const { slug, at } = item as Record<string, unknown>;
      if (typeof slug !== "string" || !SLUG.test(slug) || seen.has(slug))
        continue;
      if (typeof at !== "number" || !Number.isFinite(at)) continue;
      seen.add(slug);
      out.push({ slug, at });
      if (out.length === MAX_RECENTS) break;
    }
    return out;
  } catch {
    return EMPTY;
  }
}

function readRaw(): string | null {
  try {
    return store()?.getItem(RECENTS_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** The recent tools, newest first. */
export function readRecents(): readonly RecentTool[] {
  return parse(readRaw());
}

const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

/** Remember that a job finished in `slug` — first, and once. */
export function recordCompletion(slug: string, now: number = Date.now()): void {
  if (!SLUG.test(slug)) return;
  const items = [
    { slug, at: now },
    ...readRecents().filter((item) => item.slug !== slug),
  ].slice(0, MAX_RECENTS);
  try {
    store()?.setItem(
      RECENTS_STORAGE_KEY,
      JSON.stringify({ version: 1, items } satisfies Stored),
    );
  } catch {
    // Storage refused (full, blocked): the job still finished; it is just
    // not remembered.
  }
  notify();
}

/** Forget every recent tool. */
export function clearRecents(): void {
  try {
    store()?.removeItem(RECENTS_STORAGE_KEY);
  } catch {
    // Nothing stored that can be reached: nothing to forget.
  }
  notify();
}

// One parsed list per stored string, so a snapshot is the same object until
// the storage really changes (useSyncExternalStore compares by identity).
let cachedRaw: string | null = null;
let cached: readonly RecentTool[] = EMPTY;
function snapshot(): readonly RecentTool[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parse(raw);
  }
  return cached;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab finished a job: the `storage` event says so here.
  const onStorage = (event: StorageEvent) => {
    if (event.key === RECENTS_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const serverSnapshot = () => EMPTY;

/**
 * The recent tools, live: empty on the server and in the first client render
 * (so hydration matches), then what this browser remembers, updated when a
 * job finishes here or in another tab.
 */
export function useRecents(): readonly RecentTool[] {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** Test seam: drop every listener and the cached snapshot. */
export function resetRecentsForTests(): void {
  listeners.clear();
  cachedRaw = null;
  cached = EMPTY;
}
