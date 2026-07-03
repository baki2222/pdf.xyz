/**
 * The **artifact-inventory record model** and its defensive parser — the offline,
 * content-free input to the Phase 42 storage-artifact cleanup verifier / dry-run
 * sweeper (`./evaluate`).
 *
 * The load-bearing constraint of this whole subsystem is the same one the bucket
 * lifecycle verifier (`../../lifecycle/verify`) lives under: the app **never calls the
 * cloud**. Listing a real bucket's objects and reading their metadata needs a provider
 * API call this build deliberately does not make. So a cleanup check is done against a
 * *synthetic inventory* an operator produces out-of-band with their own credentials —
 * e.g. by projecting `aws s3api list-objects-v2` + `head-object` output into the bounded,
 * content-free shape below — and hands to the CLI. That projected document is itself
 * content-free by construction: it carries only bounded lifecycle/manifest/provider/kind
 * ENUMS, the SAME coarse retention facts the app already stamps on the object
 * (`x-amz-meta-artifact-lifecycle` decodes to `{ expiresAtMs, deleted }`), and coarse
 * age/size BUCKETS — never an object key, bucket name, signed URL, filename, temp path,
 * byte, or hash of user content.
 *
 * This module parses that document into normalized {@link ArtifactInventoryRecord}s the
 * evaluator can categorize. Honesty & privacy posture, mirrored across the worker layer:
 *  - Node-free, CLOCK-free leaf: pure string/JSON parsing and data normalization, no I/O,
 *    no clock, and no cloud call, so it composes into the CLI and any status surface
 *    without pulling a Node built-in. The CLI reads the operator's file/stdin; this only
 *    ever sees text. The lifecycle state is resolved LATER, in the evaluator, against the
 *    run clock — exactly as Phase 41 resolves it at retrieval — so this parser stays pure.
 *  - Tolerant + bounded: an unknown/garbage field value degrades to the honest `unknown`
 *    sentinel (never a fabricated `live`/`expired`), a non-object entry is preserved as a
 *    structurally-invalid record (never silently dropped, which would under-count and let
 *    a corrupt inventory read as "clean"), and every failure is a content-free
 *    {@link InventoryIssue} that never echoes the input.
 *  - Content-free output by construction: a normalized record is only bounded enums,
 *    coarse buckets, and coarse retention facts that are CONSUMED to derive a bounded
 *    lifecycle state and then discarded — so nothing this module produces, nor anything
 *    downstream reports, can carry a locator, a raw instant, or user content.
 */

import {
  ARTIFACT_LIFECYCLE_STATES,
  type StorageArtifactLifecycle,
} from "../lifecycle";
import { RETRIEVAL_STORAGE_PROVIDERS } from "../access";
import { ARTIFACT_OUTPUT_KINDS, type ArtifactOutputKind } from "../types";
import { PROCESSOR_KINDS, type ProcessorKind } from "../../observability/metrics";

/** Caps that keep a hostile/huge synthetic inventory from becoming a DoS. */
const MAX_INVENTORY_CHARS = 1024 * 1024; // 1 MiB — a projected inventory is small.
const MAX_INVENTORY_RECORDS = 100_000;

/**
 * The coarse manifest/provenance state recoverable from an object's safe metadata,
 * WITHOUT reading the manifest blob's contents. `valid`/`invalid` require the operator
 * to have re-validated provenance structurally (the same check the retrieval boundary
 * runs, decoding `x-amz-meta-artifact-manifest`); `absent` is a manifest-less object (a
 * legacy write, or metadata-stripping storage); `unknown` is "the projection did not
 * record a manifest fact at all".
 */
export const INVENTORY_MANIFEST_STATES = [
  "valid",
  "invalid",
  "absent",
  "unknown",
] as const;
export type InventoryManifestState = (typeof INVENTORY_MANIFEST_STATES)[number];

/**
 * The bounded storage provider a record's backing object lives on, EXTENDED with
 * `unknown` for a projection that did not record one. Never a bucket, region, or
 * endpoint — the same closed distinction the retrieval boundary uses.
 */
export const INVENTORY_PROVIDERS = [
  ...RETRIEVAL_STORAGE_PROVIDERS,
  "unknown",
] as const;
export type InventoryProvider = (typeof INVENTORY_PROVIDERS)[number];

/**
 * Coarse object-age buckets. A raw creation/last-modified instant can, in aggregate,
 * fingerprint work, so the parser buckets it at the boundary and discards the raw
 * number — the same philosophy as the worker metric buckets. `unknown` covers an
 * absent/unparseable age.
 */
export const OBJECT_AGE_BUCKETS = [
  "under-1h",
  "1-24h",
  "1-7d",
  "7-30d",
  "over-30d",
  "unknown",
] as const;
export type ObjectAgeBucket = (typeof OBJECT_AGE_BUCKETS)[number];

/** Coarse object-size buckets. Raw byte size is bucketed and discarded like age. */
export const OBJECT_SIZE_BUCKETS = [
  "under-64kb",
  "64kb-1mb",
  "1-10mb",
  "10-100mb",
  "over-100mb",
  "unknown",
] as const;
export type ObjectSizeBucket = (typeof OBJECT_SIZE_BUCKETS)[number];

/**
 * One normalized artifact-inventory record: the bounded, content-free projection of a
 * single storage object's safe metadata. Every field is a closed enum, a coarse bucket,
 * or a coarse retention fact consumed to resolve a bounded lifecycle state — never a
 * locator or user content.
 *
 * Lifecycle is represented as EVIDENCE, resolved to a state by the evaluator against the
 * run clock (see `./evaluate`), so this record stays clock-free:
 *  - `declaredLifecycle` — a pre-resolved state the projection may carry directly;
 *  - `expiresAtMs` / `deleted` — the raw retention evidence (the decoded
 *    `x-amz-meta-artifact-lifecycle` `{ e, d? }` blob). When present, the evaluator
 *    RE-DERIVES the state from it via {@link evaluateArtifactLifecycle}, exactly as the
 *    retrieval boundary does, and the raw instant is discarded — so a pre-resolved
 *    `declaredLifecycle` can never disagree with fresh evidence.
 *
 * `wellFormed` is the honesty bit: `false` marks a raw entry that was not even an object
 * (structurally invalid), so the evaluator can surface it rather than silently dropping it.
 */
export interface ArtifactInventoryRecord {
  /** A pre-resolved Phase 41 lifecycle state, when the projection carried one; else `null`. */
  readonly declaredLifecycle: StorageArtifactLifecycle | null;
  /** Raw retention deadline (epoch ms) evidence, consumed by the evaluator and discarded. */
  readonly expiresAtMs: number | null;
  /** Explicit tombstone evidence — the object was deleted before its window elapsed. */
  readonly deleted: boolean;
  /** Coarse manifest/provenance state; never the manifest blob's contents. */
  readonly manifest: InventoryManifestState;
  /** Bounded storage provider; `unknown` when the projection recorded none. */
  readonly provider: InventoryProvider;
  /** Bounded output kind; `unknown` for a content-type that maps to no recognized kind. */
  readonly kind: ArtifactOutputKind;
  /** Bounded processor/tool family, when the projection recorded it. */
  readonly processor: ProcessorKind;
  /** Coarse object-age bucket (raw age discarded at parse). */
  readonly age: ObjectAgeBucket;
  /** Coarse object-size bucket (raw size discarded at parse). */
  readonly size: ObjectSizeBucket;
  /** `false` when the raw entry was not a JSON object (structurally invalid record). */
  readonly wellFormed: boolean;
}

/** The normalized inventory (a list of records). */
export interface ArtifactInventory {
  readonly records: readonly ArtifactInventoryRecord[];
}

/** A content-free reason a synthetic inventory document could not be parsed. */
export type InventoryIssueCode =
  | "empty-document" // nothing to parse
  | "too-large" // beyond the safety caps (chars or record count)
  | "malformed-json" // not valid JSON
  | "not-an-object" // valid JSON but not an inventory object/array
  | "no-records"; // no `artifacts`/`records` array to evaluate

export interface InventoryIssue {
  readonly code: InventoryIssueCode;
  /** One-line, content-free explanation. Never echoes the document. */
  readonly message: string;
}

/** Outcome of parsing a synthetic inventory document. */
export type ParseInventoryResult =
  | { ok: true; inventory: ArtifactInventory }
  | { ok: false; issues: InventoryIssue[] };

/** A plain object (not null, not an array). */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A finite, non-negative number, or `null`. */
function asNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** Narrow a string to a member of a bounded tuple, else `undefined`. */
function asEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** Bucket a raw object age (milliseconds) into a coarse {@link ObjectAgeBucket}. */
export function objectAgeBucket(ageMs: number | null): ObjectAgeBucket {
  if (ageMs === null) return "unknown";
  const h = ageMs / 3_600_000;
  if (h < 1) return "under-1h";
  if (h < 24) return "1-24h";
  if (h < 24 * 7) return "1-7d";
  if (h < 24 * 30) return "7-30d";
  return "over-30d";
}

/** Bucket a raw object size (bytes) into a coarse {@link ObjectSizeBucket}. */
export function objectSizeBucket(bytes: number | null): ObjectSizeBucket {
  if (bytes === null) return "unknown";
  const kb = bytes / 1024;
  if (kb < 64) return "under-64kb";
  if (kb < 1024) return "64kb-1mb";
  if (kb < 1024 * 10) return "1-10mb";
  if (kb < 1024 * 100) return "10-100mb";
  return "over-100mb";
}

/**
 * Normalize one raw inventory entry into a bounded {@link ArtifactInventoryRecord}.
 * Total and tolerant: a non-object entry becomes a fully-`unknown`, `wellFormed:false`
 * record (surfaced, never dropped); any unrecognized field value degrades to the honest
 * `unknown`/`null` sentinel rather than a fabricated concrete state. Accepts a raw
 * `ageMs`/`sizeBytes` number (bucketed here and discarded) OR a pre-bucketed
 * `age`/`size` enum string — the raw number never survives into the record. The
 * retention evidence (`expiresAtMs`/`deleted`) is carried, but its lifecycle state is
 * resolved later by the evaluator against the run clock.
 */
export function normalizeInventoryRecord(raw: unknown): ArtifactInventoryRecord {
  const r = asRecord(raw);
  if (!r) {
    return {
      declaredLifecycle: null,
      expiresAtMs: null,
      deleted: false,
      manifest: "unknown",
      provider: "unknown",
      kind: "unknown",
      processor: "other",
      age: "unknown",
      size: "unknown",
      wellFormed: false,
    };
  }

  const age =
    asEnum(r.age, OBJECT_AGE_BUCKETS) ?? objectAgeBucket(asNonNegative(r.ageMs));
  const size =
    asEnum(r.size, OBJECT_SIZE_BUCKETS) ??
    objectSizeBucket(asNonNegative(r.sizeBytes));

  return {
    declaredLifecycle: asEnum(r.lifecycle, ARTIFACT_LIFECYCLE_STATES) ?? null,
    expiresAtMs: asNonNegative(r.expiresAtMs),
    deleted: r.deleted === true,
    manifest: asEnum(r.manifest, INVENTORY_MANIFEST_STATES) ?? "unknown",
    provider: asEnum(r.provider, INVENTORY_PROVIDERS) ?? "unknown",
    kind: asEnum(r.kind, ARTIFACT_OUTPUT_KINDS) ?? "unknown",
    processor: asEnum(r.processor, PROCESSOR_KINDS) ?? "other",
    age,
    size,
    wellFormed: true,
  };
}

/**
 * Parse a synthetic inventory document (the JSON an operator projects from their bucket
 * listing) into a normalized {@link ArtifactInventory}. Accepts a bare `[...]` array, a
 * `{ artifacts: [...] }`, or a `{ records: [...] }` envelope. Defensive: bounded,
 * tolerant of unknown fields, and every failure is a content-free {@link InventoryIssue}
 * that never echoes the input.
 */
export function parseArtifactInventory(text: string): ParseInventoryResult {
  if (typeof text !== "string" || text.trim() === "") {
    return {
      ok: false,
      issues: [{ code: "empty-document", message: "The inventory document is empty." }],
    };
  }
  if (text.length > MAX_INVENTORY_CHARS) {
    return {
      ok: false,
      issues: [
        {
          code: "too-large",
          message: "The inventory document exceeds the size a cleanup inventory can be.",
        },
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      issues: [
        { code: "malformed-json", message: "The inventory document is not valid JSON." },
      ],
    };
  }

  // A bare array is the inventory; otherwise look for an `artifacts`/`records` array.
  let rawRecords: unknown[] | null = null;
  if (Array.isArray(parsed)) {
    rawRecords = parsed;
  } else {
    const obj = asRecord(parsed);
    if (!obj) {
      return {
        ok: false,
        issues: [
          {
            code: "not-an-object",
            message: "The inventory document is not an artifact inventory object or array.",
          },
        ],
      };
    }
    if (Array.isArray(obj.artifacts)) rawRecords = obj.artifacts;
    else if (Array.isArray(obj.records)) rawRecords = obj.records;
  }

  if (rawRecords === null) {
    return {
      ok: false,
      issues: [
        {
          code: "no-records",
          message: "The inventory document contains no artifact records to evaluate.",
        },
      ],
    };
  }
  if (rawRecords.length > MAX_INVENTORY_RECORDS) {
    return {
      ok: false,
      issues: [
        {
          code: "too-large",
          message: "The inventory document has more records than the cleanup verifier will evaluate at once.",
        },
      ],
    };
  }

  return {
    ok: true,
    inventory: { records: rawRecords.map(normalizeInventoryRecord) },
  };
}
