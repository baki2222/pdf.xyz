/**
 * The bounded, content-free vocabulary for the **cleanup evidence exporter / projector**
 * (Phase 43) — the offline bridge that turns a RAW provider export (an operator's own
 * `aws s3api list-objects-v2` + `head-object` capture, or a normalized dump) into the two
 * Phase 42 bounded shapes: the cleanup-check EVIDENCE the absence-verifier reads
 * (`../ingest`) and the artifact-cleanup INVENTORY the dry-run sweeper reads
 * (`../../artifacts/cleanup/inventory`).
 *
 * The projector's whole reason to exist is a PRIVACY seam. A raw provider export is dense
 * with locators and identifiers the rest of the worker layer must never see — object keys,
 * bucket names, signed URLs, endpoints, regions, account ids, ETags, filenames, arbitrary
 * user-metadata, and whatever a hostile export smuggles alongside. The projector reads ONLY
 * a bounded allowlist of fields off each raw object and emits ONLY bounded enums, coarse
 * buckets, and the SAME coarse retention facts the app already stamps on the object. Every
 * other field is never read, so it can never reach the projected document, the receipt, or
 * a downstream tool. This module is the closed vocabulary that projection produces.
 *
 * Like the rest of the subsystem it obeys the worker honesty contract:
 *  - it NEVER calls the cloud (the export is produced out-of-band with the operator's own
 *    credentials — mirroring `../ingest` and `../../lifecycle/verify`);
 *  - every token here is a low-cardinality, redaction-stable enum — never a filename, key,
 *    bucket, URL, endpoint, region, id, token, size, instant, or byte;
 *  - it projects only what it can positively read; a thin/garbled export degrades to the
 *    honest `insufficient` verdict rather than a fabricated record, and a present object
 *    that positively should be gone (a tombstone) is surfaced as an `unsafe` signal.
 */

/**
 * The bounded DIALECT of the raw export the projector was told to read. This names the
 * SHAPE of the input, never a bucket or endpoint:
 *  - `aws-s3`  — an AWS S3 `list-objects-v2` / `head-object` capture (native field names
 *    like `Contents`, `ContentType`, `Metadata`, `LastModified`);
 *  - `generic` — an already-normalized export using the bounded field names directly.
 */
export const PROJECTION_SOURCE_PROVIDERS = ["aws-s3", "generic"] as const;
export type ProjectionSourceProvider =
  (typeof PROJECTION_SOURCE_PROVIDERS)[number];

/**
 * The bounded TARGET format the projector emits:
 *  - `evidence`  — cleanup-check evidence objects (`{ presence, expiresAtMs?, deleted?,
 *    activeDelete? }`) the absence-verifier `pnpm worker:cleanup-check` reads;
 *  - `inventory` — artifact-cleanup inventory records (bounded lifecycle/manifest/provider/
 *    kind/processor enums + coarse age/size buckets) the dry-run sweeper
 *    `pnpm worker:artifact-cleanup` reads.
 */
export const PROJECTION_TARGETS = ["evidence", "inventory"] as const;
export type ProjectionTarget = (typeof PROJECTION_TARGETS)[number];

/**
 * The bounded, content-free reasons a single raw object degraded during projection. Each is
 * a low-cardinality token safe to count in a receipt — never an echo of the offending value:
 *  - `invalid-record`     — a raw entry was not a JSON object, so it was dropped (never
 *    passed through, which could leak a hostile scalar) and counted;
 *  - `unusable-lifecycle` — a lifecycle metadata value was present but failed strict decode,
 *    so it contributed no retention evidence (fails toward "no evidence", never a guess);
 *  - `unusable-manifest`  — a manifest metadata value was present but failed strict decode,
 *    so the record's manifest state is `invalid`;
 *  - `unknown-kind`       — a content-type was present but maps to no recognized output kind;
 *  - `unrecognized-status`— a presence/status hint could not be mapped to present/absent, so
 *    the observation degraded to `error` (unknowable this run);
 *  - `missing-metadata`   — the record carried no usable lifecycle, manifest, or kind fact
 *    (a bare listing entry): projectable, but not enough to prove anything;
 *  - `present-tombstoned` — the POSITIVE unsafe signal: a present object carries a deletion
 *    tombstone, i.e. bytes that should be gone remain.
 */
export const PROJECTION_WARNINGS = [
  "invalid-record",
  "unusable-lifecycle",
  "unusable-manifest",
  "unknown-kind",
  "unrecognized-status",
  "missing-metadata",
  "present-tombstoned",
] as const;
export type ProjectionWarning = (typeof PROJECTION_WARNINGS)[number];

/**
 * The bounded CATEGORIES a dropped raw field is tallied under, so the receipt can report
 * "how much, and of what kind, was discarded" WITHOUT ever naming a field or reading a
 * value. A field's NAME (a structural token) decides its category; its VALUE is never read:
 *  - `locator`       — object key, bucket, prefix, path, filename, listing name;
 *  - `url`           — signed/presigned URLs, endpoints, hrefs;
 *  - `identity`      — account id, region, owner, user id, IP;
 *  - `integrity`     — ETag, version id, checksum, storage class, content hash;
 *  - `metadata-blob` — an unrecognized user-metadata sub-key (the value is never read);
 *  - `other`         — any other unrecognized top-level field.
 */
export const DROPPED_FIELD_CATEGORIES = [
  "locator",
  "url",
  "identity",
  "integrity",
  "metadata-blob",
  "other",
] as const;
export type DroppedFieldCategory = (typeof DROPPED_FIELD_CATEGORIES)[number];

/**
 * The projector's aggregate VERDICT — the single value the CLI maps to an exit code:
 *  - `projected`    — at least one record projected with usable metadata, no unsafe signal;
 *  - `insufficient` — the export parsed, but nothing usable could be projected (an empty or
 *    metadata-thin export): honest "not enough evidence", never a fabricated success;
 *  - `unsafe`       — a positive unsafe condition was detected (a present-tombstoned object,
 *    or a structurally invalid record): the export shows something that should not be.
 */
export const PROJECTION_VERDICTS = [
  "projected",
  "insufficient",
  "unsafe",
] as const;
export type ProjectionVerdict = (typeof PROJECTION_VERDICTS)[number];

/** Stable identity of the projection policy — stamped on receipts for an audit trail. */
export const PROJECTION_POLICY_ID = "pdfxyz-cleanup-evidence-projector";
/** Bump when the projection vocabulary or its transform semantics change. */
export const PROJECTION_POLICY_VERSION = 1;

/** The schema tag the projected document carries so a consumer can pin the shape. */
export const PROJECTION_SCHEMA = "pdfxyz.cleanup-projection/1" as const;

/** A content-free tally of dropped fields per {@link DroppedFieldCategory}. */
export type DroppedFieldCounts = Readonly<Record<DroppedFieldCategory, number>>;

/** A content-free tally of {@link ProjectionWarning}s. */
export type ProjectionWarningCounts = Readonly<
  Record<ProjectionWarning, number>
>;

/**
 * The content-free **projection receipt** — the durable, auditable summary of one projection
 * run. It rides alongside the projected records (a downstream tool ignores it) and is safe to
 * log, forward to a SIEM, or paste into a ticket: every field is a bounded enum, a small
 * integer count, or a stable policy constant — NEVER an object key, bucket, URL, endpoint,
 * region, id, filename, size, instant, byte, or any echo of a dropped field's value.
 */
export interface ProjectionReceipt {
  /** Fixed category so a receipt is self-describing in a mixed sink. */
  readonly category: "cleanup-projection";
  /** The bounded target format this run projected into. */
  readonly target: ProjectionTarget;
  /** The bounded source dialect this run read. */
  readonly source: ProjectionSourceProvider;
  /** The aggregate verdict (drives the exit code). */
  readonly verdict: ProjectionVerdict;
  /** Raw entries seen in the export (the input array length). */
  readonly inputRecords: number;
  /** Bounded records emitted into the projected document. */
  readonly projectedRecords: number;
  /** Structurally-invalid raw entries dropped (never passed through). */
  readonly droppedRecords: number;
  /** Records that carried at least one usable lifecycle / manifest / kind / probe fact. */
  readonly usableMetadata: number;
  /** Positive unsafe conditions detected (present-tombstoned + invalid records). */
  readonly unsafe: number;
  /** Total raw fields read past (never consumed) across every object. */
  readonly droppedFields: number;
  /** The dropped-field total broken down by bounded category. */
  readonly droppedByCategory: DroppedFieldCounts;
  /** Per-reason warning counts (bounded reasons only). */
  readonly warnings: ProjectionWarningCounts;
  /** Stable policy identity — the vocabulary/transform version this run used. */
  readonly policyId: string;
  readonly policyVersion: number;
  /** Optional ISO-8601 timestamp, when the caller supplied a clock. */
  readonly at?: string;
}

/** A zeroed {@link DroppedFieldCounts} — the starting tally. */
export function emptyDroppedFieldCounts(): Record<
  DroppedFieldCategory,
  number
> {
  return {
    locator: 0,
    url: 0,
    identity: 0,
    integrity: 0,
    "metadata-blob": 0,
    other: 0,
  };
}

/** A zeroed {@link ProjectionWarningCounts} — the starting tally. */
export function emptyWarningCounts(): Record<ProjectionWarning, number> {
  return {
    "invalid-record": 0,
    "unusable-lifecycle": 0,
    "unusable-manifest": 0,
    "unknown-kind": 0,
    "unrecognized-status": 0,
    "missing-metadata": 0,
    "present-tombstoned": 0,
  };
}
