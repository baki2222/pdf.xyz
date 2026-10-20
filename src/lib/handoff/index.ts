/**
 * Public entry point for the workspace → tool handoff. UI code should import the
 * high-level {@link stashHandoff} / {@link claimHandoff} helpers here rather than
 * touching the store or backends directly.
 *
 * A single browser-scoped {@link HandoffStore} is created lazily, backed by
 * IndexedDB when available and by memory otherwise. All bytes stay in the
 * browser's origin-private storage — nothing is ever uploaded.
 */

import { declaredContentTypeFor } from "@/lib/jobs/mime-by-format";
import { MemoryHandoffBackend, type HandoffBackend } from "./backend";
import { IndexedDbHandoffBackend, isIndexedDbAvailable } from "./idb";
import { HANDOFF_MAX_TOTAL_BYTES, totalHandoffBytes } from "./record";
import { HandoffStore } from "./store";
import {
  eligibleFilesFor,
  handoffCapabilityFor,
  takesOneFile,
} from "./capability";
import type { HandoffMeta } from "./origin";
import type { HandoffFileEntry, HandoffRecord } from "./types";

export type { HandoffFileEntry, HandoffRecord, HandoffSummary } from "./types";
export {
  DEFAULT_HANDOFF_TTL_MS,
  HANDOFF_MAX_TOTAL_BYTES,
  isHandoffExpired,
  makeHandoffRecord,
  summarizeHandoff,
  totalHandoffBytes,
} from "./record";
export { newHandoffId, looksLikeHandoffId } from "./ids";
export { HANDOFF_PARAM, readHandoffId, stripHandoffFromUrl } from "./url";
export {
  eligibleFilesFor,
  handoffCapabilityFor,
  type HandoffCapability,
  type HandoffMode,
} from "./capability";
export { HandoffStore } from "./store";
export {
  DROP_SURFACES,
  HANDOFF_ORIGINS,
  HANDOFF_TARGET_PARKED,
  HANDOFF_TARGET_WORKSPACE,
  MAX_TRAIL,
  RESERVED_HANDOFF_TARGETS,
  originPhrase,
  readOrigin,
  readPending,
  readTrail,
  type DropSurface,
  type HandoffMeta,
  type HandoffOrigin,
  type OriginContext,
  type PendingStep,
  type RemedyProblem,
} from "./origin";
export { MemoryHandoffBackend, type HandoffBackend } from "./backend";
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

/**
 * The files a hand-off to `toolSlug` would actually carry: nothing for a tool
 * that cannot receive one, only the files its runner can open, and just the
 * first of those for a single-file tool.
 *
 * ONE definition of that gating, for every surface that launches a tool with
 * files — through `launchWithFiles`. They were about to be two copies, and two
 * copies of a gate drift.
 */
export function handoffPayload(
  toolSlug: string,
  files: readonly File[],
): File[] {
  const cap = handoffCapabilityFor(toolSlug);
  if (!cap.supported) return [];
  const eligible = eligibleFilesFor(toolSlug, [...files]);
  return takesOneFile(cap.mode) ? eligible.slice(0, 1) : eligible;
}
