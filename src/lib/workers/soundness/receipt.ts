/**
 * The content-free **quarantine / soundness receipt**: the durable, per-rejection
 * record the executor emits when the file-soundness gate terminally blocks an input.
 *
 * "Quarantine" here is a RECEIPT plus the executor's existing active deletion — it
 * is NOT a byte-retaining store. The rejected input bytes are wiped on the terminal
 * failure exactly like any other terminal disposition (see the executor's
 * `wipeInputs`), and this receipt keeps NONE of them alive: it carries only a bounded
 * reason enum, the stable policy id/version, a coarse size bucket + small input
 * count, the processor family, and an optional timestamp. There is deliberately no
 * field for a filename, object key, signed URL, temp path, byte excerpt, OCR text,
 * declared size, or any secret — so a receipt is safe to log, count, or forward to an
 * operator sink verbatim. See docs/SECURITY.md and docs/OBSERVABILITY.md.
 *
 * Node-free and dependency-light: it defines its OWN coarse byte bucketer rather than
 * importing the observability layer (which imports the soundness *types*), so there
 * is no import cycle and the receipt module can be reused anywhere.
 */

import type { ProcessorKind } from "../observability/metrics";
import { SOUNDNESS_POLICY_ID, SOUNDNESS_POLICY_VERSION } from "./policy";
import type { SoundnessReason, SoundnessVerdict } from "./types";

/**
 * Coarse, bounded size buckets for a receipt. A raw byte count can, in aggregate,
 * fingerprint a document, so the receipt records only which bucket the input's total
 * size fell into. `unknown` covers a non-finite/negative measurement.
 */
export const SOUNDNESS_SIZE_BUCKETS = [
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
export type SoundnessSizeBucket = (typeof SOUNDNESS_SIZE_BUCKETS)[number];

const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;

/** Map a raw byte total to its coarse {@link SoundnessSizeBucket}. Total; never throws. */
export function soundnessSizeBucket(bytes: number): SoundnessSizeBucket {
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
 * A content-free quarantine receipt. Every field is a bounded enum, a stable policy
 * constant, a coarse bucket, a small count, or an optional ISO timestamp — never a
 * user string, identifier, or byte.
 */
export interface SoundnessReceipt {
  /** The bounded verdict that produced this receipt (always `unsound` for a block). */
  readonly verdict: SoundnessVerdict;
  /** The bounded reason the input was rejected. */
  readonly reason: SoundnessReason;
  /** Stable policy identity — the id and schema version, never the tuned values. */
  readonly policyId: string;
  readonly policyVersion: number;
  /** The processor family the job would have run (compress/ocr/other). */
  readonly processor: ProcessorKind;
  /** Coarse bucket of the job's total input bytes. */
  readonly sizeBucket: SoundnessSizeBucket;
  /** Small, bounded count of inputs the job referenced. */
  readonly inputCount: number;
  /** Optional ISO-8601 timestamp, when the caller supplied a clock. */
  readonly at?: string;
}

/** The bounded inputs a receipt is built from — all content-free. */
export interface SoundnessReceiptInput {
  readonly verdict: SoundnessVerdict;
  readonly reason: SoundnessReason;
  readonly processor: ProcessorKind;
  /** Total bytes across the job's inputs; bucketed here and then discarded. */
  readonly totalBytes: number;
  /** Number of inputs the job referenced. */
  readonly inputCount: number;
  /** Optional ISO-8601 timestamp. Omitted from the receipt when absent. */
  readonly at?: string;
}

/**
 * Build a {@link SoundnessReceipt} from bounded, content-free inputs. Stamps the
 * stable policy id/version, buckets the total size, and clamps the input count to a
 * non-negative integer. The raw byte total never becomes a field. Pure and total.
 */
export function buildSoundnessReceipt(
  input: SoundnessReceiptInput,
): SoundnessReceipt {
  const inputCount =
    typeof input.inputCount === "number" && Number.isFinite(input.inputCount)
      ? Math.max(0, Math.floor(input.inputCount))
      : 0;
  return {
    verdict: input.verdict,
    reason: input.reason,
    policyId: SOUNDNESS_POLICY_ID,
    policyVersion: SOUNDNESS_POLICY_VERSION,
    processor: input.processor,
    sizeBucket: soundnessSizeBucket(input.totalBytes),
    inputCount,
    ...(input.at ? { at: input.at } : {}),
  };
}
