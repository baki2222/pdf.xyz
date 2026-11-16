/**
 * Split PDF's "By file size" field, named once (audit #2, 2026-11-17), so
 * the runner draws it and the Compress size guide quotes it from the same
 * definitions. A guide that quoted the runner's JSX would go stale the day
 * the field was relabelled; and `catalog.ts` must not import a runner.
 *
 * Constants only, importing nothing but `./size-presets`: the runner's panel
 * chunk loads this module, and an import of `./size-targets` here once put
 * the guides' table lists and `?size=` parser into Split PDF's page (review
 * of 2026-11-17, +248 B gz). What the guide tells a reader to type is in
 * `./split-size-guide`.
 */
import { MB } from "./size-presets";

export const SPLIT_SIZE_LABEL = "Maximum size per file (MB)";
/** The field's step and minimum, in MB. */
export const SPLIT_SIZE_STEP_MB = 0.1;
export const SPLIT_SIZE_MIN_MB = 0.1;
/** The field's unit: size-presets' MB, 1,048,576 bytes. */
export { MB as SPLIT_MB };
/** The step as a whole number of steps per MB (10), so the arithmetic stays in integers. */
export const SPLIT_STEPS_PER_MB = Math.round(1 / SPLIT_SIZE_STEP_MB);
