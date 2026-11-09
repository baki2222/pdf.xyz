/**
 * Pure helpers for building and reasoning about {@link HandoffRecord}s — no DOM,
 * no storage, no clock of their own (every timestamp is passed in). This keeps
 * TTL/expiry and summarization deterministic and unit-testable.
 */

import { MAX_TRAIL, type HandoffMeta } from "./origin";
import type { HandoffFileEntry, HandoffRecord, HandoffSummary } from "./types";

/** How long a handoff stays valid before it's treated as expired (30 minutes). */
export const DEFAULT_HANDOFF_TTL_MS = 30 * 60 * 1000;

/**
 * Upper bound on the total bytes a single handoff will carry. Files are already
 * capped at 100 MB each by the workspace; this bounds a *batch* so we never
 * write an unreasonable amount into IndexedDB. Over budget → the caller falls
 * back to the normal file picker (honest degrade), never a silent truncation.
 */
export const HANDOFF_MAX_TOTAL_BYTES = 300 * 1024 * 1024;

/**
 * The shape version every new record is written with.
 *
 *  - 1 (no `v` field): files, target, timing, and from 2026-10 the origin,
 *    trail and pending step.
 *  - 2 (2026-11-09): also `names`, the display names of the tools the
 *    receiving page names — its job row's steps, and the tool a result,
 *    remedy or hint came from. Until then the receiving page looked every
 *    name up in the tool directory, which rode every tool page's first load
 *    for it. A record of version 1 (stashed before the deploy, claimed
 *    after it) carries no names; the claim fetches the directory on demand
 *    for it (`./claim`), so it reads exactly as before.
 */
export const HANDOFF_RECORD_VERSION = 2;

/** Sum the byte size across a set of handoff entries. */
export function totalHandoffBytes(files: readonly HandoffFileEntry[]): number {
  return files.reduce((sum, file) => sum + Math.max(0, file.size), 0);
}

/**
 * Inputs to {@link makeHandoffRecord}; timing is injected, never read here.
 * The origin is REQUIRED: a record that does not say where its files came
 * from makes the receiving page guess, and it used to guess "your workspace".
 */
export interface MakeHandoffInput extends HandoffMeta {
  id: string;
  toolSlug: string;
  files: HandoffFileEntry[];
  /** Creation time (ms epoch), supplied by the caller. */
  now: number;
  /** Time-to-live in ms; defaults to {@link DEFAULT_HANDOFF_TTL_MS}. */
  ttlMs?: number;
}

/** Build a well-formed {@link HandoffRecord} with a computed expiry. */
export function makeHandoffRecord({
  id,
  toolSlug,
  files,
  now,
  ttlMs = DEFAULT_HANDOFF_TTL_MS,
  origin,
  trail,
  pending,
  names,
}: MakeHandoffInput): HandoffRecord {
  const ttl =
    Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_HANDOFF_TTL_MS;
  return {
    id,
    toolSlug,
    files,
    createdAt: now,
    expiresAt: now + ttl,
    origin,
    // Only what was given: an absent trail is not an empty job.
    ...(trail && trail.length > 0 ? { trail: trail.slice(-MAX_TRAIL) } : {}),
    ...(pending ? { pending } : {}),
    v: HANDOFF_RECORD_VERSION,
    ...(names && Object.keys(names).length > 0 ? { names: { ...names } } : {}),
  };
}

/** True when `now` is at or past the record's expiry. */
export function isHandoffExpired(record: HandoffRecord, now: number): boolean {
  return now >= record.expiresAt;
}

/** Project a record down to its byte-free {@link HandoffSummary}. */
export function summarizeHandoff(record: HandoffRecord): HandoffSummary {
  return {
    id: record.id,
    toolSlug: record.toolSlug,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    fileCount: record.files.length,
    totalBytes: totalHandoffBytes(record.files),
  };
}
