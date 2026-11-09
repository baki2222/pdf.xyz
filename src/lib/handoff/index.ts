/**
 * Public entry point for the workspace → tool handoff. UI code should import the
 * high-level {@link stashHandoff} / {@link claimHandoff} helpers here rather than
 * touching the store or backends directly.
 *
 * A single browser-scoped {@link HandoffStore} is created lazily, backed by
 * IndexedDB when available and by memory otherwise. All bytes stay in the
 * browser's origin-private storage — nothing is ever uploaded.
 */

import { HANDOFF_MAX_TOTAL_BYTES } from "./record";
import { getRunnerKind } from "@/lib/pdf/registry";
import {
  eligibleFilesFor,
  handoffCapabilityFor,
  takesOneFile,
} from "./capability";

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
export {
  __setHandoffStoreForTests,
  claimHandoff,
  clearHandoffs,
  filesToHandoffEntries,
  getHandoffStore,
  handoffEntriesToFiles,
  purgeExpiredHandoffs,
  stashHandoff,
} from "./session";

/**
 * The files a hand-off to `toolSlug` would actually carry: nothing for a tool
 * that cannot receive one, only the files its runner can open, and just the
 * first of those for a single-file tool.
 *
 * A worker batch (a `batch` tool with no in-browser runner: its panel's list
 * takes each file as a job of its own) carries the longest prefix of those
 * that fits one hand-off (`HANDOFF_MAX_TOTAL_BYTES`), and always the first,
 * so a first file over the budget still fails at the stash. WAS every
 * eligible file, uncapped (batch plan P6), so a set past the budget failed
 * outright where, staged, its first file had travelled: four 80 MB PDFs for
 * PDF to Word opened nothing (`launch.test.ts`). A combine stays all or
 * nothing — merging a subset is a different document — and so do client
 * batches, which never staged one file.
 *
 * Generic over the metadata it reads (name, type, size), so the workspace
 * can ask it of its staged files before any `File` is touched, and say what
 * will travel with the gate that decides it.
 *
 * ONE definition of that gating, for every surface that launches a tool with
 * files — through `launchWithFiles`. They were about to be two copies, and two
 * copies of a gate drift.
 */
export function handoffPayload<
  T extends { name: string; type: string; size: number },
>(toolSlug: string, files: readonly T[]): T[] {
  const cap = handoffCapabilityFor(toolSlug);
  if (!cap.supported) return [];
  const eligible = eligibleFilesFor(toolSlug, [...files]);
  if (takesOneFile(cap.mode)) return eligible.slice(0, 1);
  if (cap.mode !== "batch" || getRunnerKind(toolSlug)) return eligible;
  let total = 0;
  const fits: T[] = [];
  for (const file of eligible) {
    total += file.size;
    if (fits.length > 0 && total > HANDOFF_MAX_TOTAL_BYTES) break;
    fits.push(file);
  }
  return fits;
}
