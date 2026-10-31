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
import { DEEP_COMPRESSION_PRESETS } from "./offered-kinds";

export const KB = 1024;
const MB = 1024 * KB;

/** The smallest target the worker accepts: below it a PDF is hardly a page. */
export const MIN_TARGET_BYTES = 20 * KB;
/** The largest it accepts — the native engine's absolute input ceiling. */
export const MAX_TARGET_BYTES = 2 * 1024 * MB;

/** The panel's presets — the sizes application portals ask for most. */
export const TARGET_SIZE_PRESETS: readonly { bytes: number; label: string }[] =
  [100 * KB, 200 * KB, 500 * KB, MB].map((bytes) => ({
    bytes,
    label: targetLabel(bytes),
  }));

/** The panel's words for the choice, named once so copy can quote them. */
export const TARGET_SIZE_LABELS = {
  heading: "Target size",
  none: "No target",
  custom: "Custom",
} as const;

/**
 * The line under the choice. "Extreme" is the floor preset's own label, so a
 * rename moves this sentence with it.
 */
export const TARGET_SIZE_HINT = `Our server starts at your Quality setting and steps down, as far as ${DEEP_COMPRESSION_PRESETS[0].label}, until the file fits. Each step is another run, so it can take longer. Grayscale is used only if you tick it.`;

/** The sizes the copy's worked example uses ("Now 184.0 KB — under your 200 KB target."). */
export const TARGET_EXAMPLE = { targetBytes: 200 * KB, outputBytes: 184 * KB };

/** The panel's choice: no target, a preset (its bytes), or a typed KB value. */
export type TargetChoice = "none" | "custom" | number;

/** The largest whole-KB target below a file of `originalBytes`. */
export function maxTargetKb(originalBytes: number): number {
  return Math.ceil(originalBytes / KB) - 1;
}

/**
 * The bytes a choice asks for: `undefined` for no target, `"invalid"` for a
 * value the worker would refuse — under the floor, not below the file's own
 * size, or not a whole number of KB. The run waits on an invalid one.
 */
export function chosenTargetBytes(
  choice: TargetChoice,
  customKb: string,
  originalBytes: number,
): number | undefined | "invalid" {
  if (choice === "none") return undefined;
  let bytes: number;
  if (choice === "custom") {
    if (!/^\d{1,7}$/.test(customKb.trim())) return "invalid";
    bytes = Number(customKb.trim()) * KB;
  } else bytes = choice;
  return bytes >= MIN_TARGET_BYTES && bytes < originalBytes ? bytes : "invalid";
}

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
