/**
 * Split PDF's "By file size" field, named once (audit #2, 2026-11-17), so
 * the runner draws it and the Compress size guide quotes it from the same
 * definitions. A guide that quoted the runner's JSX would go stale the day
 * the field was relabelled; and `catalog.ts` must not import a runner.
 */
import { MB } from "./size-presets";
import { decimalBytes } from "./size-targets";

export const SPLIT_SIZE_LABEL = "Maximum size per file (MB)";
/** The field's step and minimum, in MB. */
export const SPLIT_SIZE_STEP_MB = 0.1;
export const SPLIT_SIZE_MIN_MB = 0.1;
/** The field's unit: size-presets' MB, 1,048,576 bytes. */
export { MB as SPLIT_MB };
/** The step as a whole number of steps per MB (10), so the arithmetic stays in integers. */
export const SPLIT_STEPS_PER_MB = Math.round(1 / SPLIT_SIZE_STEP_MB);

/** Whether `bytes` can be typed exactly in the field: a whole number of steps. */
export const typeableInSplit = (bytes: number) =>
  (bytes * SPLIT_STEPS_PER_MB) % MB === 0;

/** A whole number of steps, printed as the field shows it (19 -> "1.9", 10 -> "1"). */
const printSteps = (steps: number) => String(steps / SPLIT_STEPS_PER_MB);

/** The value to type for `bytes` (1 MB -> "1"). Throws if it cannot be typed exactly. */
export function splitTypedMb(bytes: number): string {
  if (!typeableInSplit(bytes)) {
    throw new Error(
      `${bytes} bytes cannot be typed in steps of ${SPLIT_SIZE_STEP_MB} MB`,
    );
  }
  return printSteps((bytes * SPLIT_STEPS_PER_MB) / MB);
}

/**
 * The largest value the field takes that stays under the size a form means
 * when it counts 1 MB as 1,000,000 bytes (1 MB -> "0.9", 2 MB -> "1.9").
 */
export function splitPortalSafeMb(bytes: number): string {
  return printSteps(
    Math.floor((decimalBytes(bytes) * SPLIT_STEPS_PER_MB) / MB),
  );
}
