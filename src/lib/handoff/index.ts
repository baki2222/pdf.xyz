/**
 * Public entry point for the workspace → tool handoff. UI code should import the
 * high-level {@link stashHandoff} / {@link claimHandoff} helpers here rather than
 * touching the store or backends directly.
 *
 * A single browser-scoped {@link HandoffStore} is created lazily, backed by
 * IndexedDB when available and by memory otherwise. All bytes stay in the
 * browser's origin-private storage — nothing is ever uploaded.
 */

import { MemoryHandoffBackend, type HandoffBackend } from "./backend";
import { IndexedDbHandoffBackend, isIndexedDbAvailable } from "./idb";
import { HANDOFF_MAX_TOTAL_BYTES, totalHandoffBytes } from "./record";
import { HandoffStore } from "./store";
import type { HandoffFileEntry, HandoffRecord } from "./types";

export type {
  HandoffFileEntry,
  HandoffRecord,
  HandoffSummary,
} from "./types";
export {
  DEFAULT_HANDOFF_TTL_MS,
  HANDOFF_MAX_TOTAL_BYTES,
  isHandoffExpired,
  makeHandoffRecord,
  summarizeHandoff,
  totalHandoffBytes,
} from "./record";
export { newHandoffId, looksLikeHandoffId } from "./ids";
export {
  eligibleFilesFor,
  handoffCapabilityFor,
  type HandoffCapability,
  type HandoffMode,
} from "./capability";
export { HandoffStore } from "./store";
export {
  MemoryHandoffBackend,
  type HandoffBackend,
} from "./backend";
export { IndexedDbHandoffBackend, isIndexedDbAvailable } from "./idb";

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
 * null result tells the caller to fall back to the normal file picker.
 */
export async function stashHandoff(
  toolSlug: string,
  files: File[],
): Promise<string | null> {
  if (files.length === 0) return null;
  const entries = filesToHandoffEntries(files);
  if (totalHandoffBytes(entries) > HANDOFF_MAX_TOTAL_BYTES) return null;
  const record = await getHandoffStore().create(toolSlug, entries);
  return record?.id ?? null;
}

/** Claim (and consume) a handoff by id. Null when missing/expired/unreadable. */
export async function claimHandoff(id: string): Promise<HandoffRecord | null> {
  return getHandoffStore().claim(id);
}

/** Reconstruct real `File` objects from a claimed handoff's entries. */
export function handoffEntriesToFiles(entries: HandoffFileEntry[]): File[] {
  return entries.map(
    (entry) =>
      new File([entry.blob], entry.name, {
        type: entry.type || "application/pdf",
      }),
  );
}

/** Best-effort purge of expired handoffs (e.g. on page load / unload). */
export async function purgeExpiredHandoffs(): Promise<void> {
  await getHandoffStore().purgeExpired();
}
