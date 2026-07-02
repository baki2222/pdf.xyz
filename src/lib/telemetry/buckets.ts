/**
 * Coarse, privacy-safe bucketing for telemetry dimensions.
 *
 * pdf.xyz processes documents entirely in the browser. A raw byte count, file
 * count, or millisecond duration can, in aggregate, fingerprint a *specific*
 * document — so product events never carry those raw numbers. Instead they carry
 * a coarse bucket label from a fixed, low-cardinality set: enough to answer
 * "are people compressing big files?" or "do batches usually have a few files or
 * many?" without ever pinning a value to one user's document.
 *
 * Every function here is pure (no clock, no DOM) and returns one of a small,
 * enumerated set of labels, so the buckets are deterministically testable and
 * the label space is a hard schema constraint, not a free-form string.
 */

/** Coarse file/page count bucket. `"unknown"` guards non-finite/negative input. */
export type CountBucket =
  | "0"
  | "1"
  | "2-5"
  | "6-20"
  | "21-50"
  | "50+"
  | "unknown";

/** Coarse byte-size bucket. Boundaries are powers-of-two KB/MB. */
export type SizeBucket =
  | "<100KB"
  | "100KB-1MB"
  | "1-10MB"
  | "10-50MB"
  | "50-100MB"
  | "100MB+"
  | "unknown";

/** Coarse elapsed-time bucket, in human units. */
export type DurationBucket =
  | "<250ms"
  | "250ms-1s"
  | "1-5s"
  | "5-30s"
  | "30s+"
  | "unknown";

const KB = 1024;
const MB = 1024 * KB;

/**
 * A single classifier tier: any value strictly below `ceiling` gets `label`.
 * Tiers are evaluated in order; the first match wins.
 */
interface Tier<L extends string> {
  readonly ceiling: number;
  readonly label: L;
}

/**
 * Map a non-negative number to the first tier whose `ceiling` it falls under,
 * or `overflow` if it exceeds every tier. Non-finite or negative input yields
 * `"unknown"` so a bad measurement can never masquerade as a real bucket.
 */
function classify<L extends string>(
  value: number,
  tiers: readonly Tier<L>[],
  overflow: L,
): L | "unknown" {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "unknown";
  }
  for (const tier of tiers) {
    if (value < tier.ceiling) return tier.label;
  }
  return overflow;
}

const COUNT_TIERS: readonly Tier<CountBucket>[] = [
  { ceiling: 1, label: "0" },
  { ceiling: 2, label: "1" },
  { ceiling: 6, label: "2-5" },
  { ceiling: 21, label: "6-20" },
  { ceiling: 51, label: "21-50" },
];

const SIZE_TIERS: readonly Tier<SizeBucket>[] = [
  { ceiling: 100 * KB, label: "<100KB" },
  { ceiling: 1 * MB, label: "100KB-1MB" },
  { ceiling: 10 * MB, label: "1-10MB" },
  { ceiling: 50 * MB, label: "10-50MB" },
  { ceiling: 100 * MB, label: "50-100MB" },
];

const DURATION_TIERS: readonly Tier<DurationBucket>[] = [
  { ceiling: 250, label: "<250ms" },
  { ceiling: 1000, label: "250ms-1s" },
  { ceiling: 5000, label: "1-5s" },
  { ceiling: 30000, label: "5-30s" },
];

/** Bucket a file/page count (e.g. how many PDFs a batch carried). */
export function countBucket(count: number): CountBucket {
  return classify(Math.floor(count), COUNT_TIERS, "50+");
}

/** Bucket a byte size (e.g. an output file's size), coarsely by KB/MB tiers. */
export function sizeBucket(bytes: number): SizeBucket {
  return classify(bytes, SIZE_TIERS, "100MB+");
}

/** Bucket an elapsed duration in milliseconds. */
export function durationBucket(ms: number): DurationBucket {
  return classify(ms, DURATION_TIERS, "30s+");
}
