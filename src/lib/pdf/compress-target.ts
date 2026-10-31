/**
 * "Target size" for deep compression (2026-10-31) — the client-safe half.
 *
 * The presets and bounds the panel offers, the label a target is shown by,
 * and the sentence the panel says once a run is back. The worker's options
 * parser takes its bounds from here, so the panel cannot offer a value the
 * worker refuses (`target-size.test.ts` holds every preset to the parser).
 *
 * KB is 1,024 bytes, the unit every size on the page is printed in
 * (`formatBytes`), so "under your 200 KB target" compares like with like.
 * Some upload portals count 1 KB as 1,000 bytes; the guide says so and
 * suggests aiming a little lower.
 */
import { formatBytes } from "@/lib/utils";

export const KB = 1024;
const MB = 1024 * KB;

/** The smallest target the worker accepts: below it a PDF is hardly a page. */
export const MIN_TARGET_BYTES = 20 * KB;
/** The largest it accepts — the native engine's absolute input ceiling. */
export const MAX_TARGET_BYTES = 2 * 1024 * MB;

/** The panel's presets — the sizes application portals ask for most. */
export const TARGET_SIZE_PRESETS = [
  { bytes: 100 * KB, label: "100 KB" },
  { bytes: 200 * KB, label: "200 KB" },
  { bytes: 500 * KB, label: "500 KB" },
  { bytes: MB, label: "1 MB" },
] as const;

/** The panel's words for the choice, named once so copy can quote them. */
export const TARGET_SIZE_LABELS = {
  heading: "Target size",
  none: "No target",
  custom: "Custom",
} as const;

/** A target as the panel names it: whole MB when it is one, else KB. */
export function targetLabel(bytes: number): string {
  if (bytes % MB === 0) return `${bytes / MB} MB`;
  return `${Math.round(bytes / KB)} KB`;
}

/** What the run that drew a result asked for, and what the server said back. */
export interface TargetOutcomeInput {
  /** The target the run asked for, in bytes. */
  targetBytes: number;
  /** The size of the file the browser actually received. */
  outputBytes: number;
  /**
   * The target the job record says the worker applied, or `null` when the
   * record carries none — a worker image older than this feature runs the
   * job at the Quality setting and ignores the target it was sent.
   */
  appliedTargetBytes: number | null;
  /** Whether the run already asked for Grayscale (then it is no suggestion). */
  grayscale: boolean;
}

export interface TargetOutcome {
  /** True only when the received file is at or under the target. */
  met: boolean;
  text: string;
}

/**
 * The sentence the panel shows under a target run. `met` is read from the
 * bytes the browser RECEIVED, never from the server's own verdict: the
 * reader's question is about the file in their hand.
 */
export function targetOutcome({
  targetBytes,
  outputBytes,
  appliedTargetBytes,
  grayscale,
}: TargetOutcomeInput): TargetOutcome {
  const target = targetLabel(targetBytes);
  const now = formatBytes(outputBytes);
  const met = outputBytes <= targetBytes;
  if (appliedTargetBytes !== targetBytes) {
    return {
      met,
      text: `Our server did not apply your ${target} target to this run; it compressed at your Quality setting. The file is ${now}${met ? "" : `, above your ${target} target`}.`,
    };
  }
  if (met) return { met, text: `Now ${now} — under your ${target} target.` };
  return {
    met,
    text: `The smallest we could make is ${now}, above your ${target} target. ${grayscale ? "Try splitting the file." : "Try Grayscale, or split the file."}`,
  };
}
