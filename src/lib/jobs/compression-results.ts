/**
 * Client-facing result metadata for deep compression: **whether the size figure
 * is a compression figure.**
 *
 * The panel's "shrank this file by 98%" is computed on the client from two byte
 * counts and nothing else. That was true of the number and false of the claim: a
 * native engine that dropped 197 of 200 pages produced exactly that headline, so
 * the more of the document was destroyed, the better the run appeared to have
 * gone. Page loss now fails the job outright — but the case where the input
 * could not be counted still ships, and there the size difference is a fact
 * about two files whose relationship was never established.
 *
 * So the verdict travels with the artifact. `pageCheck` is the field the UI must
 * consult before calling a smaller file a compressed one.
 */

/** How much confidence the run's size figure carries. */
export type CompressionPageCheck = "verified" | "unverified" | "not-applicable";

export interface CompressionResultBlock {
  pageCheck: CompressionPageCheck;
  /** Input page count when known; `null` when it could not be established. */
  pagesIn: number | null;
  /** Output page count when known; `null` on paths that do not measure it. */
  pagesOut: number | null;
  /**
   * What a target-size run asked for and got (2026-10-31). Present only on a
   * job that asked for a target — its absence is how the panel tells a worker
   * that ignored the target (an image older than the feature) from one that
   * tried and could not reach it.
   */
  target?: CompressionTargetBlock;
}

/** A target-size run, as the job record carries it. Counts only. */
export interface CompressionTargetBlock {
  targetBytes: number;
  /** At or under the target — re-derived from the two sizes below, never trusted. */
  met: boolean;
  /** Engine runs the worker made to get there. */
  attempts: number;
  /** Size of the artifact that shipped. */
  outputBytes: number;
}

/** A non-negative safe integer, or `null`. */
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

/**
 * Re-bound a target block. `met` is RECOMPUTED from the two sizes: a block
 * claiming the target was met by a file over it is the one lie this field
 * exists to prevent, so the claim is not read at all. A block missing either
 * size is dropped whole rather than guessed at.
 */
function buildTargetBlock(raw: unknown): CompressionTargetBlock | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const t = raw as Partial<Record<keyof CompressionTargetBlock, unknown>>;
  const targetBytes = count(t.targetBytes);
  const outputBytes = count(t.outputBytes);
  const attempts = count(t.attempts);
  if (targetBytes === null || outputBytes === null || attempts === null) {
    return undefined;
  }
  return {
    targetBytes,
    met: outputBytes <= targetBytes,
    attempts,
    outputBytes,
  };
}

const CHECKS: readonly CompressionPageCheck[] = [
  "verified",
  "unverified",
  "not-applicable",
];

/** True when a value plausibly came from the real compression contract. */
export function isCompressionResultBlock(
  value: unknown,
): value is CompressionResultBlock {
  return (
    !!value &&
    typeof value === "object" &&
    CHECKS.includes((value as CompressionResultBlock).pageCheck)
  );
}

/** Clamp to a positive integer, or `null`. Never `0` — see below. */
function pageNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  // `0` is not a page count a comparison can use, and persisting it would let a
  // reader treat "we could not count" as "the document has no pages".
  return n >= 1 ? n : null;
}

/**
 * Re-bound an untrusted compression block for persistence.
 *
 * The one invariant enforced beyond clamping: a `verified` verdict requires both
 * counts to be present and `pagesOut >= pagesIn`. A block claiming verification
 * without the numbers that would justify it is downgraded to `unverified` rather
 * than trusted — the whole value of the field is that "verified" means something
 * was checked, and a verdict nothing supports is the failure this exists to stop.
 */
export function buildCompressionResultBlock(
  raw: CompressionResultBlock,
): CompressionResultBlock {
  const pagesIn = pageNumber(raw.pagesIn);
  const pagesOut = pageNumber(raw.pagesOut);
  const claimed = CHECKS.includes(raw.pageCheck) ? raw.pageCheck : "unverified";

  const justified =
    claimed !== "verified" ||
    (pagesIn !== null && pagesOut !== null && pagesOut >= pagesIn);

  const target = buildTargetBlock(raw.target);
  return {
    pageCheck: justified ? claimed : "unverified",
    pagesIn,
    pagesOut,
    ...(target ? { target } : {}),
  };
}
