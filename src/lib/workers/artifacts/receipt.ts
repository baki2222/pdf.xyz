/**
 * The content-free **artifact-provenance receipt**: the durable, per-event record the
 * executor may emit at each point in a produced output set's lifecycle — when a
 * manifest is GENERATED for a published set, when the gate REJECTS a set before
 * publication, and when a published set is CLEANED (deleted with its manifest state).
 *
 * Like the quarantine receipt it is a RECEIPT, not a byte-retaining store. A rejected
 * set is never persisted (the gate runs BEFORE any `writeArtifact`); a cleaned set's
 * bytes are deleted by the same disposition; a generated set's bytes live only as the
 * already-downloadable artifacts. This receipt keeps NONE of them alive. It carries
 * only a bounded {@link ArtifactReceiptCategory}, a bounded reason enum, the stable
 * policy id/version, the processor family, a coarse size bucket + small output count,
 * and an optional timestamp. There is deliberately no field for a filename, object
 * key, signed URL, temp path, byte excerpt, OCR text, output kind detail beyond the
 * bounded enum, or any secret — so a receipt is safe to log, count, or forward to an
 * operator sink verbatim. See docs/SECURITY.md and docs/OBSERVABILITY.md.
 *
 * Node-free and dependency-light: it defines its OWN coarse byte bucketer rather than
 * importing the observability layer, so there is no import cycle and the receipt
 * module can be reused anywhere.
 */

import type { ProcessorKind } from "../observability/metrics";
import { ARTIFACT_POLICY_ID, ARTIFACT_POLICY_VERSION } from "./policy";
import type { ArtifactReason } from "./types";

/**
 * The bounded lifecycle event a receipt records for a produced output set:
 *  - `generated` — a manifest was generated for a set that PASSED the gate and was
 *    published (the honest provenance record of what was minted);
 *  - `rejected`  — the gate BLOCKED the set before publication (no bytes persisted);
 *  - `cleaned`   — a published set (and the transient manifest that described it) was
 *    DELETED together, so no manifest state outlives the artifacts it described.
 * A closed enum, so the receipt's telemetry label space never grows.
 */
export const ARTIFACT_RECEIPT_CATEGORIES = [
  "generated",
  "rejected",
  "cleaned",
] as const;
export type ArtifactReceiptCategory =
  (typeof ARTIFACT_RECEIPT_CATEGORIES)[number];

/**
 * Coarse, bounded size buckets for a receipt. A raw byte count can, in aggregate,
 * fingerprint a document, so the receipt records only which bucket the outputs' total
 * size fell into. `unknown` covers a non-finite/negative measurement.
 */
export const ARTIFACT_SIZE_BUCKETS = [
  "0",
  "<1KiB",
  "1KiB-64KiB",
  "64KiB-1MiB",
  "1MiB-10MiB",
  "10MiB-100MiB",
  "100MiB-1GiB",
  "1GiB+",
  "unknown",
] as const;
export type ArtifactSizeBucket = (typeof ARTIFACT_SIZE_BUCKETS)[number];

const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;

/** Map a raw byte total to its coarse {@link ArtifactSizeBucket}. Total; never throws. */
export function artifactSizeBucket(bytes: number): ArtifactSizeBucket {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return "unknown";
  }
  if (bytes === 0) return "0";
  if (bytes < KIB) return "<1KiB";
  if (bytes < 64 * KIB) return "1KiB-64KiB";
  if (bytes < MIB) return "64KiB-1MiB";
  if (bytes < 10 * MIB) return "1MiB-10MiB";
  if (bytes < 100 * MIB) return "10MiB-100MiB";
  if (bytes < GIB) return "100MiB-1GiB";
  return "1GiB+";
}

/**
 * A content-free artifact-provenance receipt. Every field is a bounded enum, a stable
 * policy constant, a coarse bucket, a small count, or an optional ISO timestamp —
 * never a user string, identifier, or byte.
 */
export interface ArtifactReceipt {
  /** The bounded lifecycle event this receipt records. */
  readonly category: ArtifactReceiptCategory;
  /** The bounded reason: `ok` for generated/cleaned, else the reject reason. */
  readonly reason: ArtifactReason;
  /** Stable policy identity — the id and schema version, never the tuned values. */
  readonly policyId: string;
  readonly policyVersion: number;
  /** The processor family the job ran (compress/ocr/other). */
  readonly processor: ProcessorKind;
  /** Coarse bucket of the outputs' total bytes. */
  readonly sizeBucket: ArtifactSizeBucket;
  /** Small, bounded count of outputs the job produced. */
  readonly artifactCount: number;
  /** Optional ISO-8601 timestamp, when the caller supplied a clock. */
  readonly at?: string;
}

/** The bounded inputs a receipt is built from — all content-free. */
export interface ArtifactReceiptInput {
  /** The bounded lifecycle event to record (generated / rejected / cleaned). */
  readonly category: ArtifactReceiptCategory;
  /** The bounded reason (`ok` for generated/cleaned, else the reject reason). */
  readonly reason: ArtifactReason;
  readonly processor: ProcessorKind;
  /** Total bytes across the produced outputs; bucketed here and then discarded. */
  readonly totalBytes: number;
  /** Number of outputs the job produced. */
  readonly artifactCount: number;
  /** Optional ISO-8601 timestamp. Omitted from the receipt when absent. */
  readonly at?: string;
}

/**
 * Build an {@link ArtifactReceipt} from bounded, content-free inputs. Stamps the
 * stable policy id/version, buckets the total size, and clamps the output count to a
 * non-negative integer. The raw byte total never becomes a field. Pure and total.
 */
export function buildArtifactReceipt(
  input: ArtifactReceiptInput,
): ArtifactReceipt {
  const artifactCount =
    typeof input.artifactCount === "number" &&
    Number.isFinite(input.artifactCount)
      ? Math.max(0, Math.floor(input.artifactCount))
      : 0;
  return {
    category: input.category,
    reason: input.reason,
    policyId: ARTIFACT_POLICY_ID,
    policyVersion: ARTIFACT_POLICY_VERSION,
    processor: input.processor,
    sizeBucket: artifactSizeBucket(input.totalBytes),
    artifactCount,
    ...(input.at ? { at: input.at } : {}),
  };
}
