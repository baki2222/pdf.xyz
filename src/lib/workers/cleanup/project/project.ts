/**
 * The pure, node-free **projection transform** (Phase 43): raw provider export → the two
 * Phase 42 bounded, content-free shapes.
 *
 * This is the CLI's trust boundary and its privacy seam in one. A raw `aws s3api
 * list-objects-v2` / `head-object` capture (or a normalized dump) is dense with locators and
 * identifiers — object keys, bucket names, signed URLs, endpoints, regions, account ids,
 * ETags, filenames, arbitrary user-metadata, byte snippets — none of which the rest of the
 * worker layer may ever see. The transform reads ONLY a bounded ALLOWLIST of fields off each
 * raw object and emits ONLY bounded enums, coarse buckets, and the SAME coarse retention
 * facts the app already stamps on the object. Every other field is never read — so no hostile
 * value can survive into the projected document, the receipt, or a downstream tool. Fields it
 * passes over are TALLIED by name-derived category for the receipt, but their values are never
 * touched.
 *
 * Honesty posture, mirrored across the worker layer:
 *  - it makes NO cloud call; the export is produced out-of-band with the operator's own
 *    credentials (`../ingest`, `../../lifecycle/verify`);
 *  - a lifecycle/manifest metadata value is decoded through the SAME strict codecs the
 *    retrieval boundary uses, so a tampered value collapses to "no evidence" rather than a
 *    half-trusted record;
 *  - it projects only what it can positively read: a metadata-thin export degrades to the
 *    honest `insufficient` verdict, never a fabricated record; a present object carrying a
 *    deletion tombstone is surfaced as an `unsafe` signal (bytes that should be gone remain).
 */

import { decodeArtifactLifecycleMetadata } from "../../storage/s3-lifecycle-metadata";
import { decodeArtifactManifestMetadata } from "../../storage/s3-manifest-metadata";
import { outputKindForContentType } from "../../artifacts/manifest";
import {
  objectAgeBucket,
  objectSizeBucket,
  INVENTORY_MANIFEST_STATES,
  INVENTORY_PROVIDERS,
  OBJECT_AGE_BUCKETS,
  OBJECT_SIZE_BUCKETS,
  type InventoryManifestState,
  type InventoryProvider,
  type ObjectAgeBucket,
  type ObjectSizeBucket,
} from "../../artifacts/cleanup/inventory";
import { ARTIFACT_OUTPUT_KINDS, type ArtifactOutputKind } from "../../artifacts/types";
import { PROCESSOR_KINDS, type ProcessorKind } from "../../observability/metrics";
import { CLEANUP_PRESENCE, type CleanupPresence } from "../types";
import {
  emptyDroppedFieldCounts,
  emptyWarningCounts,
  type DroppedFieldCategory,
  type ProjectionReceipt,
  type ProjectionSourceProvider,
  type ProjectionTarget,
  type ProjectionVerdict,
  type ProjectionWarning,
  PROJECTION_POLICY_ID,
  PROJECTION_POLICY_VERSION,
} from "./types";

/** Caps that keep a hostile/huge export from becoming a DoS. Mirrors the ingest parser. */
const MAX_DOCUMENT_CHARS = 4 * 1024 * 1024; // 4 MiB — a projected export summary is far smaller.
const MAX_OBJECTS = 100_000;

/** A content-free reason a provider export could not be parsed (an input error → exit 1). */
export type ProjectionIssue =
  | "empty-document"
  | "too-large"
  | "malformed-json"
  | "not-an-object"
  | "no-objects";

/**
 * One projected cleanup-check EVIDENCE record, in the exact serializable shape the verifier's
 * ingest parser reads (`{ presence, expiresAtMs?, deleted?, activeDelete? }`). Optional fields
 * are emitted only when positively known, so a projected document stays minimal.
 */
export interface EvidenceRecordJson {
  readonly presence: CleanupPresence;
  readonly expiresAtMs?: number;
  readonly deleted?: boolean;
  readonly activeDelete?: boolean;
}

/**
 * One projected artifact-cleanup INVENTORY record, in the serializable shape the sweeper's
 * inventory parser reads — bounded lifecycle/manifest/provider/kind/processor enums plus
 * coarse age/size BUCKETS (the raw age/size is bucketed here and discarded) and the coarse
 * retention evidence (`expiresAtMs`/`deleted`, emitted only when known).
 */
export interface InventoryRecordJson {
  readonly expiresAtMs?: number;
  readonly deleted?: boolean;
  readonly manifest: InventoryManifestState;
  readonly provider: InventoryProvider;
  readonly kind: ArtifactOutputKind;
  readonly processor: ProcessorKind;
  readonly age: ObjectAgeBucket;
  readonly size: ObjectSizeBucket;
}

/** The outcome of a projection: an input error, or projected records + a content-free receipt. */
export type ProjectionResult =
  | { readonly ok: false; readonly issue: ProjectionIssue }
  | {
      readonly ok: true;
      readonly target: "evidence";
      readonly records: EvidenceRecordJson[];
      readonly receipt: ProjectionReceipt;
      readonly verdict: ProjectionVerdict;
    }
  | {
      readonly ok: true;
      readonly target: "inventory";
      readonly records: InventoryRecordJson[];
      readonly receipt: ProjectionReceipt;
      readonly verdict: ProjectionVerdict;
    };

/** Options for a projection run. `now` buckets ages from absolute `LastModified` instants. */
export interface ProjectionOptions {
  readonly target: ProjectionTarget;
  readonly source: ProjectionSourceProvider;
  readonly now: number;
}

/** A plain object (not null, not an array). */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A finite, non-negative integer (an epoch-ms instant). Mirrors the lifecycle codec guard. */
function isEpochMs(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** A finite, non-negative number (a raw size/age), else `null`. */
function asNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Narrow a string to a member of a bounded tuple, else `undefined`. */
function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** Parse an instant: a bare epoch-ms number, or an ISO-8601 string. `null` when unusable. */
function parseInstant(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** Strip content-type params and lower-case, so it matches the manifest kind table. */
function bareContentType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const bare = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return bare.length > 0 ? bare : null;
}

/** S3 error codes that mean a genuine `404` — the object is gone. */
const ABSENT_ERROR_CODES = ["nosuchkey", "notfound", "no-such-key", "404"];

/** The lifecycle/manifest metadata sub-keys we understand (AWS strips `x-amz-meta-`). */
const LIFECYCLE_META_KEYS = ["artifact-lifecycle", "x-amz-meta-artifact-lifecycle"];
const MANIFEST_META_KEYS = ["artifact-manifest", "x-amz-meta-artifact-manifest"];

/** The complete allowlist of top-level keys the extractor READS (never counted as dropped). */
const READ_KEYS = new Set<string>([
  "presence",
  "httpStatusCode",
  "statusCode",
  "HTTPStatusCode",
  "ResponseMetadata",
  "Error",
  "error",
  "DeleteMarker",
  "ContentType",
  "contentType",
  "ContentLength",
  "Size",
  "size",
  "sizeBytes",
  "LastModified",
  "lastModified",
  "ageMs",
  "age",
  "Metadata",
  "metadata",
  "x-amz-meta-artifact-lifecycle",
  "x-amz-meta-artifact-manifest",
  "expiresAtMs",
  "deleted",
  "lifecycle",
  "manifest",
  "provider",
  "kind",
  "processor",
  "activeDelete",
]);

/** The Metadata sub-keys the extractor reads (never counted as a dropped metadata blob). */
const READ_META_SUBKEYS = new Set<string>([...LIFECYCLE_META_KEYS, ...MANIFEST_META_KEYS]);

/**
 * Classify a DROPPED field by its NAME alone (its value is never read) into a bounded
 * {@link DroppedFieldCategory}. Best-effort and total; only ever affects a receipt COUNT.
 * Order matters: integrity is checked before identity so `versionId` is not mis-read as an id.
 */
function classifyDroppedField(name: string): DroppedFieldCategory {
  const n = name.toLowerCase();
  if (
    n.includes("etag") ||
    n.includes("versionid") ||
    n.includes("checksum") ||
    n.includes("hash") ||
    n.includes("storageclass") ||
    n.includes("sha") ||
    n.includes("crc") ||
    n.includes("md5")
  ) {
    return "integrity";
  }
  if (
    n.includes("url") ||
    n.includes("href") ||
    n.includes("uri") ||
    n.includes("endpoint") ||
    n.includes("location") ||
    n.includes("presigned")
  ) {
    return "url";
  }
  if (
    n.includes("key") ||
    n.includes("bucket") ||
    n.includes("prefix") ||
    n.includes("path") ||
    n.includes("filename") ||
    n === "name" ||
    n.includes("delimiter")
  ) {
    return "locator";
  }
  if (
    n.includes("owner") ||
    n.includes("account") ||
    n.includes("region") ||
    n.includes("user") ||
    n === "ip" ||
    n.includes("ipaddress") ||
    n.endsWith("id") ||
    n === "id"
  ) {
    return "identity";
  }
  return "other";
}

/** A running tally the per-object extractor writes into. */
interface Tally {
  dropped: Record<DroppedFieldCategory, number>;
  droppedTotal: number;
  warnings: Record<ProjectionWarning, number>;
  usableMetadata: number;
  unsafe: number;
  droppedRecords: number;
}

/** Increment a warning counter. */
function warn(tally: Tally, reason: ProjectionWarning): void {
  tally.warnings[reason] += 1;
}

/** The bounded facts extracted from one raw object — the union used by both targets. */
interface ExtractedObject {
  presence: CleanupPresence;
  lifecycle: { expiresAtMs: number; deleted: boolean } | null;
  manifest: InventoryManifestState;
  kind: ArtifactOutputKind;
  processor: ProcessorKind;
  provider: InventoryProvider;
  age: ObjectAgeBucket;
  size: ObjectSizeBucket;
  activeDelete: boolean;
  usable: boolean;
}

/** Read the first string value found among the given top-level keys / Metadata sub-keys. */
function readMetaValue(
  raw: Record<string, unknown>,
  metadata: Record<string, unknown> | null,
  keys: readonly string[],
): string | null {
  for (const k of keys) {
    if (typeof raw[k] === "string") return raw[k] as string;
  }
  if (metadata) {
    for (const k of keys) {
      if (typeof metadata[k] === "string") return metadata[k] as string;
    }
  }
  return null;
}

/** Resolve the bounded presence of one object from whatever status hint it carries. */
function resolvePresence(raw: Record<string, unknown>, tally: Tally): CleanupPresence {
  const explicit = asEnum(raw.presence, CLEANUP_PRESENCE);
  if (explicit) return explicit;

  // An explicit provider error: a `NoSuchKey` is a clean `absent`; a transient is `error`.
  const errCode =
    (asRecord(raw.Error)?.Code as unknown) ??
    (typeof raw.error === "string" ? raw.error : undefined);
  if (typeof errCode === "string") {
    const lc = errCode.toLowerCase();
    if (ABSENT_ERROR_CODES.some((c) => lc.includes(c))) return "absent";
    // A known transient (5xx/slowdown/timeout) is an honest `error`; anything else warns.
    if (
      lc.includes("slowdown") ||
      lc.includes("internal") ||
      lc.includes("unavailable") ||
      lc.includes("timeout") ||
      lc.includes("500") ||
      lc.includes("503")
    ) {
      return "error";
    }
    warn(tally, "unrecognized-status");
    return "error";
  }

  if (raw.DeleteMarker === true) return "absent";

  // A numeric HTTP status, at the top level or under S3's ResponseMetadata.
  const statusRaw =
    raw.httpStatusCode ??
    raw.statusCode ??
    raw.HTTPStatusCode ??
    asRecord(raw.ResponseMetadata)?.HTTPStatusCode;
  if (typeof statusRaw === "number" && Number.isFinite(statusRaw)) {
    if (statusRaw >= 200 && statusRaw < 300) return "present";
    if (statusRaw === 404 || statusRaw === 410) return "absent";
    if (statusRaw >= 500 && statusRaw < 600) return "error";
    warn(tally, "unrecognized-status");
    return "error";
  }

  // No status hint: a listed / head-returned object is present by default.
  return "present";
}

/** Resolve the coarse retention evidence (from a metadata blob, else normalized fields). */
function resolveLifecycle(
  raw: Record<string, unknown>,
  metadata: Record<string, unknown> | null,
  tally: Tally,
): { expiresAtMs: number; deleted: boolean } | null {
  const metaRaw = readMetaValue(raw, metadata, LIFECYCLE_META_KEYS);
  if (metaRaw !== null) {
    const decoded = decodeArtifactLifecycleMetadata(metaRaw);
    if (decoded) return { expiresAtMs: decoded.expiresAtMs, deleted: decoded.deleted };
    // Present but unusable — fail toward "no evidence", never a guess.
    warn(tally, "unusable-lifecycle");
    return null;
  }
  // Normalized retention evidence: an epoch-ms expiry and/or an explicit tombstone. A
  // tombstone with no expiry uses a `0` placeholder, exactly as the verifier's ingest does.
  const hasExpiry = isEpochMs(raw.expiresAtMs);
  const deleted = raw.deleted === true;
  if (hasExpiry || deleted) {
    return { expiresAtMs: hasExpiry ? (raw.expiresAtMs as number) : 0, deleted };
  }
  return null;
}

/** Extract one raw object into the bounded {@link ExtractedObject}, or `null` when invalid. */
function extractObject(
  raw: unknown,
  opts: ProjectionOptions,
  tally: Tally,
): ExtractedObject | null {
  const obj = asRecord(raw);
  if (!obj) {
    // A non-object entry is a corrupt/hostile record: dropped (never passed through, which
    // could leak a hostile scalar) and counted as a positive unsafe signal.
    warn(tally, "invalid-record");
    tally.droppedRecords += 1;
    tally.unsafe += 1;
    return null;
  }

  const metadata = asRecord(obj.Metadata) ?? asRecord(obj.metadata);

  // Tally every top-level field we do NOT read, by name-derived category. Values never read.
  for (const key of Object.keys(obj)) {
    if (READ_KEYS.has(key)) continue;
    tally.dropped[classifyDroppedField(key)] += 1;
    tally.droppedTotal += 1;
  }
  // Tally unrecognized Metadata sub-keys as opaque metadata blobs (values never read).
  if (metadata) {
    for (const sub of Object.keys(metadata)) {
      if (READ_META_SUBKEYS.has(sub)) continue;
      tally.dropped["metadata-blob"] += 1;
      tally.droppedTotal += 1;
    }
  }

  const presence = resolvePresence(obj, tally);
  const lifecycle = resolveLifecycle(obj, metadata, tally);

  // Manifest: a normalized enum wins; else decode the metadata blob; else `absent` when a
  // metadata container was present (we looked, none), or `unknown` when none was recorded.
  const manifestMetaRaw = readMetaValue(obj, metadata, MANIFEST_META_KEYS);
  const decodedManifest =
    manifestMetaRaw !== null ? decodeArtifactManifestMetadata(manifestMetaRaw) : null;
  let manifest: InventoryManifestState;
  const normalizedManifest = asEnum(obj.manifest, INVENTORY_MANIFEST_STATES);
  if (normalizedManifest) {
    manifest = normalizedManifest;
  } else if (manifestMetaRaw !== null) {
    manifest = decodedManifest ? "valid" : "invalid";
    if (!decodedManifest) warn(tally, "unusable-manifest");
  } else if (metadata) {
    manifest = "absent";
  } else {
    manifest = "unknown";
  }

  // Kind: a normalized enum, else the decoded manifest's kind, else the content-type mapping.
  let kind: ArtifactOutputKind =
    asEnum(obj.kind, ARTIFACT_OUTPUT_KINDS) ?? decodedManifest?.outputKind ?? "unknown";
  if (kind === "unknown" && !asEnum(obj.kind, ARTIFACT_OUTPUT_KINDS) && !decodedManifest) {
    const ct = bareContentType(obj.ContentType ?? obj.contentType);
    if (ct !== null) {
      kind = outputKindForContentType(ct);
      if (kind === "unknown") warn(tally, "unknown-kind");
    }
  }

  const processor: ProcessorKind =
    asEnum(obj.processor, PROCESSOR_KINDS) ?? decodedManifest?.processor ?? "other";

  const provider: InventoryProvider =
    asEnum(obj.provider, INVENTORY_PROVIDERS) ??
    (opts.source === "aws-s3" ? "remote-configured" : "unknown");

  // Age: a normalized bucket, else a raw relative `ageMs`, else `now - LastModified` (a
  // future/absent instant → unknown). Size: a normalized bucket, else a raw byte count.
  let age: ObjectAgeBucket = asEnum(obj.age, OBJECT_AGE_BUCKETS) ?? "unknown";
  if (age === "unknown" && !asEnum(obj.age, OBJECT_AGE_BUCKETS)) {
    const ageMs = asNonNegative(obj.ageMs);
    if (ageMs !== null) {
      age = objectAgeBucket(ageMs);
    } else {
      const modified = parseInstant(obj.LastModified ?? obj.lastModified);
      if (modified !== null) {
        const delta = opts.now - modified;
        age = objectAgeBucket(delta >= 0 ? delta : null);
      }
    }
  }
  const size: ObjectSizeBucket =
    asEnum(obj.size, OBJECT_SIZE_BUCKETS) ??
    objectSizeBucket(asNonNegative(obj.ContentLength ?? obj.Size ?? obj.sizeBytes));

  const activeDelete = obj.activeDelete === true;

  // A record is "usable" when it carries something that lets a downstream tool reach a
  // non-`unknown` conclusion: a real cleanup observation, retention evidence, a decided
  // manifest, or a recognized kind. Everything-unknown is a bare listing entry.
  const usableForEvidence = presence !== "present" || lifecycle !== null;
  const usableForInventory =
    lifecycle !== null || manifest === "valid" || manifest === "invalid" || kind !== "unknown";
  const usable = opts.target === "evidence" ? usableForEvidence : usableForInventory;
  if (usable) tally.usableMetadata += 1;
  else warn(tally, "missing-metadata");

  // The positive unsafe signal: a present object explicitly tombstoned — bytes that should be
  // gone remain. (An absent tombstoned object is the GOOD case and is never flagged.)
  if (presence === "present" && lifecycle?.deleted === true) {
    warn(tally, "present-tombstoned");
    tally.unsafe += 1;
  }

  return { presence, lifecycle, manifest, kind, processor, provider, age, size, activeDelete, usable };
}

/** Serialize an {@link ExtractedObject} into a minimal evidence record. */
function toEvidenceRecord(e: ExtractedObject): EvidenceRecordJson {
  const record: {
    presence: CleanupPresence;
    expiresAtMs?: number;
    deleted?: boolean;
    activeDelete?: boolean;
  } = { presence: e.presence };
  if (e.lifecycle) {
    if (e.lifecycle.expiresAtMs > 0) record.expiresAtMs = e.lifecycle.expiresAtMs;
    if (e.lifecycle.deleted) record.deleted = true;
  }
  if (e.activeDelete) record.activeDelete = true;
  return record;
}

/** Serialize an {@link ExtractedObject} into a minimal inventory record. */
function toInventoryRecord(e: ExtractedObject): InventoryRecordJson {
  const record: {
    expiresAtMs?: number;
    deleted?: boolean;
    manifest: InventoryManifestState;
    provider: InventoryProvider;
    kind: ArtifactOutputKind;
    processor: ProcessorKind;
    age: ObjectAgeBucket;
    size: ObjectSizeBucket;
  } = {
    manifest: e.manifest,
    provider: e.provider,
    kind: e.kind,
    processor: e.processor,
    age: e.age,
    size: e.size,
  };
  if (e.lifecycle) {
    if (e.lifecycle.expiresAtMs > 0) record.expiresAtMs = e.lifecycle.expiresAtMs;
    if (e.lifecycle.deleted) record.deleted = true;
  }
  return record;
}

/** Extract the raw entries array from the bounded envelope shapes, or an input issue. */
function readEnvelope(text: string): { ok: true; entries: unknown[] } | { ok: false; issue: ProjectionIssue } {
  if (typeof text !== "string" || text.trim() === "") return { ok: false, issue: "empty-document" };
  if (text.length > MAX_DOCUMENT_CHARS) return { ok: false, issue: "too-large" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, issue: "malformed-json" };
  }

  // Accept a bare array, an S3 `{ Contents: [...] }` listing, or `{ objects | records: [...] }`.
  let entries: unknown;
  if (Array.isArray(parsed)) {
    entries = parsed;
  } else {
    const obj = asRecord(parsed);
    if (!obj) return { ok: false, issue: "not-an-object" };
    if (Array.isArray(obj.Contents)) entries = obj.Contents;
    else if (Array.isArray(obj.objects)) entries = obj.objects;
    else if (Array.isArray(obj.records)) entries = obj.records;
    else return { ok: false, issue: "no-objects" };
  }

  const list = entries as unknown[];
  if (list.length > MAX_OBJECTS) return { ok: false, issue: "too-large" };
  return { ok: true, entries: list };
}

/**
 * Project a raw provider export document into the chosen bounded target format plus a
 * content-free {@link ProjectionReceipt}. Pure and total: a parse failure is a content-free
 * {@link ProjectionIssue} (never an echo of the input); otherwise every record is bounded by
 * construction. `at` is the optional ISO stamp for the receipt.
 */
export function projectProviderExport(
  text: string,
  opts: ProjectionOptions,
  at?: string,
): ProjectionResult {
  const envelope = readEnvelope(text);
  if (!envelope.ok) return { ok: false, issue: envelope.issue };

  const tally: Tally = {
    dropped: emptyDroppedFieldCounts(),
    droppedTotal: 0,
    warnings: emptyWarningCounts(),
    usableMetadata: 0,
    unsafe: 0,
    droppedRecords: 0,
  };

  const extracted: ExtractedObject[] = [];
  for (const raw of envelope.entries) {
    const e = extractObject(raw, opts, tally);
    if (e) extracted.push(e);
  }

  const projectedRecords = extracted.length;
  const verdict: ProjectionVerdict =
    tally.unsafe > 0
      ? "unsafe"
      : projectedRecords === 0 || tally.usableMetadata === 0
        ? "insufficient"
        : "projected";

  const receipt: ProjectionReceipt = {
    category: "cleanup-projection",
    target: opts.target,
    source: opts.source,
    verdict,
    inputRecords: envelope.entries.length,
    projectedRecords,
    droppedRecords: tally.droppedRecords,
    usableMetadata: tally.usableMetadata,
    unsafe: tally.unsafe,
    droppedFields: tally.droppedTotal,
    droppedByCategory: tally.dropped,
    warnings: tally.warnings,
    policyId: PROJECTION_POLICY_ID,
    policyVersion: PROJECTION_POLICY_VERSION,
    ...(at ? { at } : {}),
  };

  if (opts.target === "evidence") {
    return { ok: true, target: "evidence", records: extracted.map(toEvidenceRecord), receipt, verdict };
  }
  return { ok: true, target: "inventory", records: extracted.map(toInventoryRecord), receipt, verdict };
}
