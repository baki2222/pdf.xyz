/**
 * The browser's hand-off store and the operations on it: stash, claim,
 * purge, clear. Pure plumbing — no table of tools.
 *
 * Its own module since 2026-11-09 (perf/per-tool-first-load). It lived in
 * `./index`, the public entry, which also holds `handoffPayload` and so
 * imports the capability tables (`./capability`: the runner registry, the
 * mode tables, the tool directory). The claim (`./claim`) imported it from
 * there, and the claim is in every tool page's first load — so the tables
 * were too. `./index` re-exports all of this, so a caller that wants the
 * whole library keeps one import, and the ONE store instance lives here
 * whichever way it is reached.
 */

import { declaredContentTypeFor } from "@/lib/jobs/mime-by-format";
import { MemoryHandoffBackend, type HandoffBackend } from "./backend";
import { IndexedDbHandoffBackend, isIndexedDbAvailable } from "./idb";
import { HANDOFF_MAX_TOTAL_BYTES, totalHandoffBytes } from "./record";
import { HandoffStore } from "./store";
import type { HandoffMeta } from "./origin";
import type { HandoffFileEntry, HandoffRecord } from "./types";

let singleton: HandoffStore | null = null;

/** Pick the best available backend for this runtime (IndexedDB → memory). */
function resolveBackend(): HandoffBackend {
  return isIndexedDbAvailable()
    ? new IndexedDbHandoffBackend()
    : new MemoryHandoffBackend();
}

/** The lazily-created, process-wide handoff store for the current browser. */
export function getHandoffStore(): HandoffStore {
  if (!singleton) {
    singleton = new HandoffStore({ backend: resolveBackend() });
  }
  return singleton;
}

/** Override the store (tests only) so specs can inject a memory backend + clock. */
export function __setHandoffStoreForTests(store: HandoffStore | null): void {
  singleton = store;
}

/** Turn browser `File`s into handoff entries (a File already is a Blob). */
export function filesToHandoffEntries(files: File[]): HandoffFileEntry[] {
  return files.map((file) => ({
    name: file.name,
    size: file.size,
    type: file.type,
    blob: file,
  }));
}

/**
 * Stash files for `toolSlug` and return the handoff id, or null if nothing could
 * be stashed (no files, over the total-bytes budget, or a storage failure). A
 * null result tells the caller the files did not travel.
 *
 * `meta.origin` is required — where the files came from is the receiving
 * page's first sentence, and only the creator knows it. Launch surfaces go
 * through `launchWithFiles` (`@/lib/intent/launch`), which also decides what
 * travels and reports a failure instead of opening an empty tool.
 */
export async function stashHandoff(
  toolSlug: string,
  files: readonly File[],
  meta: HandoffMeta,
): Promise<string | null> {
  if (files.length === 0) return null;
  const entries = filesToHandoffEntries([...files]);
  if (totalHandoffBytes(entries) > HANDOFF_MAX_TOTAL_BYTES) return null;
  const record = await getHandoffStore().create(toolSlug, entries, meta);
  return record?.id ?? null;
}

/** Claim (and consume) a handoff by id. Null when missing/expired/unreadable. */
export async function claimHandoff(id: string): Promise<HandoffRecord | null> {
  return getHandoffStore().claim(id);
}

/**
 * Reconstruct real `File` objects from a claimed handoff's entries.
 *
 * An entry the browser gave no type keeps its name's type, read through the
 * table the server validates uploads with — or none. It used to be given
 * `application/pdf` whatever it was, so a `.docx` with no declared type
 * reached the tool claiming to be a PDF.
 */
export function handoffEntriesToFiles(entries: HandoffFileEntry[]): File[] {
  return entries.map(
    (entry) =>
      new File([entry.blob], entry.name, {
        type: entry.type || declaredContentTypeFor(entry.name) || "",
      }),
  );
}

/** Best-effort purge of expired handoffs (e.g. on page load / unload). */
export async function purgeExpiredHandoffs(): Promise<void> {
  await getHandoffStore().purgeExpired();
}

/**
 * Best-effort deletion of **every** handoff in this browser — the bytes backing
 * a "clear session" control. Never throws; a storage failure degrades to a
 * no-op (there is simply nothing more we can delete).
 */
export async function clearHandoffs(): Promise<void> {
  await getHandoffStore().clear();
}
