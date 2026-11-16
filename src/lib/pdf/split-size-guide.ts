/**
 * What the Compress size guide tells a reader to type in Split PDF's "By file
 * size" field (audit #2, 2026-11-17), from the field's own definitions in
 * `./split-size`.
 *
 * Kept apart from `split-size.ts` so Split PDF's runner, which reads only the
 * field's constants, never loads `size-targets.ts` (the guides' tables and
 * `?size=` parsing). `split-size.test.ts` holds `split-size.ts` to
 * importing nothing but `./size-presets`.
 */
import { decimalBytes } from "./size-targets";
import { SPLIT_MB, SPLIT_SIZE_STEP_MB, SPLIT_STEPS_PER_MB } from "./split-size";

/** Whether `bytes` can be typed exactly in the field: a whole number of steps. */
export const typeableInSplit = (bytes: number) =>
  (bytes * SPLIT_STEPS_PER_MB) % SPLIT_MB === 0;

/** A whole number of steps, printed as the field shows it (19 -> "1.9", 10 -> "1"). */
const printSteps = (steps: number) => String(steps / SPLIT_STEPS_PER_MB);

/** The value to type for `bytes` (1 MB -> "1"). Throws if it cannot be typed exactly. */
export function splitTypedMb(bytes: number): string {
  if (!typeableInSplit(bytes)) {
    throw new Error(
      `${bytes} bytes cannot be typed in steps of ${SPLIT_SIZE_STEP_MB} MB`,
    );
  }
  return printSteps((bytes * SPLIT_STEPS_PER_MB) / SPLIT_MB);
}

/**
 * The largest value the field takes that stays under the size a form means
 * when it counts 1 MB as 1,000,000 bytes (1 MB -> "0.9", 2 MB -> "1.9").
 */
export function splitPortalSafeMb(bytes: number): string {
  return printSteps(
    Math.floor((decimalBytes(bytes) * SPLIT_STEPS_PER_MB) / SPLIT_MB),
  );
}
