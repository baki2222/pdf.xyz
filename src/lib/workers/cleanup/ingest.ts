/**
 * Pure, node-free **ingest parser** for operator-supplied cleanup evidence (Phase 42).
 *
 * The app never calls the cloud, so it cannot itself observe whether a bucket reaped an object
 * (mirroring `../lifecycle/verify`). An operator produces the evidence out-of-band with their
 * own credentials — e.g. a script that HEADs the artifact objects the app expected to be gone
 * and emits a content-free summary — and pipes that document to the CLI. This module is the
 * CLI's **trust boundary**: it turns that untrusted JSON into a bounded list of
 * {@link CleanupObjectEvidence} the verifier can evaluate.
 *
 * It is deliberately paranoid about honesty:
 *  - **No-leak by construction.** It reads ONLY the bounded fields it understands — `presence`,
 *    `expiresAtMs`, `deleted`, `activeDelete` — and validates each against a strict shape. Every
 *    OTHER field (a hostile `objectKey`, `bucket`, `signedUrl`, `endpoint`, message, …) is never
 *    read, so it can never reach the verifier or the output. Nothing is ever copied through.
 *  - **Fail closed on a broken export.** A structurally invalid object (bad `presence`, a
 *    non-integer expiry, a non-boolean flag) fails the WHOLE parse with a content-free issue
 *    code, rather than silently verifying a subset and reporting a falsely-clean picture.
 *  - **Bounded.** Hard caps on document size and object count keep a hostile/huge document from
 *    becoming a DoS.
 */

import {
  CLEANUP_PRESENCE,
  type CleanupObjectEvidence,
  type CleanupPresence,
} from "./types";
import type { ArtifactLifecycleMetadata } from "../artifacts/lifecycle";

/** The schema tag the evidence document may carry (optional; never required). */
export const CLEANUP_EVIDENCE_SCHEMA = "pdfxyz.cleanup-evidence/1" as const;

/** Caps that keep a hostile/huge document from becoming a DoS. */
const MAX_DOCUMENT_CHARS = 4 * 1024 * 1024; // 4 MiB — an evidence summary is far smaller.
const MAX_OBJECTS = 100_000;

/** A content-free reason an evidence document could not be parsed. */
export type CleanupIngestIssue =
  | "empty-document" // nothing to parse
  | "too-large" // beyond the safety caps (chars or object count)
  | "malformed-json" // not valid JSON
  | "not-an-object" // valid JSON but not an evidence object or array
  | "no-objects" // no `objects` array (and not a bare array) to evaluate
  | "object-invalid"; // an object failed strict field validation

/** Outcome of parsing an evidence document. */
export type ParseCleanupEvidenceResult =
  | { ok: true; objects: CleanupObjectEvidence[] }
  | { ok: false; issues: CleanupIngestIssue[] };

/** A plain object (not null, not an array). */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A finite, non-negative integer (an epoch-ms instant). Mirrors the lifecycle codec's guard. */
function isEpochMs(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Recognize a bounded presence enum value. */
function asPresence(value: unknown): CleanupPresence | null {
  return typeof value === "string" &&
    (CLEANUP_PRESENCE as readonly string[]).includes(value)
    ? (value as CleanupPresence)
    : null;
}

/**
 * Validate ONE raw object into a bounded {@link CleanupObjectEvidence}, or `null` when it is
 * structurally invalid. Only the four understood fields are read; every other field is ignored,
 * so a hostile identifier riding along in the object can never survive. The lifecycle record is
 * reconstructed from the coarse expiry/tombstone facts (or `null` when the object carries
 * neither), so the verifier re-evaluates it exactly as the Phase 41 boundary would.
 */
function toEvidence(raw: unknown): CleanupObjectEvidence | null {
  const obj = asRecord(raw);
  if (!obj) return null;

  const presence = asPresence(obj.presence);
  if (presence === null) return null;

  // `activeDelete` is an optional boolean; a present-but-non-boolean value is malformed.
  let activeDelete = false;
  if (obj.activeDelete !== undefined) {
    if (typeof obj.activeDelete !== "boolean") return null;
    activeDelete = obj.activeDelete;
  }

  // Lifecycle facts are optional. When present they must be well-formed: `expiresAtMs` a finite
  // non-negative integer, `deleted` a boolean. An object with neither carries no lifecycle
  // evidence (`null`) — the honest "present, but nothing to judge its expiry by" case.
  const hasExpiry = obj.expiresAtMs !== undefined;
  const hasDeleted = obj.deleted !== undefined;
  if (hasExpiry && !isEpochMs(obj.expiresAtMs)) return null;
  if (hasDeleted && typeof obj.deleted !== "boolean") return null;

  let lifecycle: ArtifactLifecycleMetadata | null = null;
  if (hasExpiry || hasDeleted) {
    lifecycle = {
      // A tombstone with no explicit expiry uses a placeholder `0` (an unusable instant): the
      // evaluator then resolves it to `deleted` from the tombstone alone, clock-independently.
      expiresAtMs: hasExpiry ? (obj.expiresAtMs as number) : 0,
      deleted: hasDeleted ? (obj.deleted as boolean) : false,
    };
  }

  return { presence, lifecycle, activeDelete };
}

/**
 * Parse an operator-supplied cleanup evidence document into a bounded list of
 * {@link CleanupObjectEvidence}. Accepts either the tagged object shape
 * (`{ schema?, objects: [...] }`) or a bare `[ ... ]` array. Defensive: bounded, tolerant of
 * unknown fields, and every failure is a content-free {@link CleanupIngestIssue} that never
 * echoes the input.
 */
export function parseCleanupEvidence(text: string): ParseCleanupEvidenceResult {
  if (typeof text !== "string" || text.trim() === "") {
    return { ok: false, issues: ["empty-document"] };
  }
  if (text.length > MAX_DOCUMENT_CHARS) {
    return { ok: false, issues: ["too-large"] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, issues: ["malformed-json"] };
  }

  // Accept a bare array of objects, or the tagged `{ objects: [...] }` envelope.
  let rawObjects: unknown;
  if (Array.isArray(parsed)) {
    rawObjects = parsed;
  } else {
    const obj = asRecord(parsed);
    if (!obj) return { ok: false, issues: ["not-an-object"] };
    if (!Array.isArray(obj.objects))
      return { ok: false, issues: ["no-objects"] };
    rawObjects = obj.objects;
  }

  const list = rawObjects as unknown[];
  if (list.length > MAX_OBJECTS) {
    return { ok: false, issues: ["too-large"] };
  }

  const objects: CleanupObjectEvidence[] = [];
  for (const raw of list) {
    const evidence = toEvidence(raw);
    // Fail closed: a broken export is a usage error, not a silently-verified subset.
    if (evidence === null) return { ok: false, issues: ["object-invalid"] };
    objects.push(evidence);
  }

  return { ok: true, objects };
}
