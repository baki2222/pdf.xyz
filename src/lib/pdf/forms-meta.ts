/**
 * The pdf-lib-free slice of the forms module: the couple of pure helpers the
 * fill-forms UI needs while RENDERING (filtering fields, naming downloads).
 *
 * They live apart from `./forms` so the runner can import them statically
 * without dragging pdf-lib into the tool page's initial chunk — `./forms`
 * itself is class-heavy (its inspectors `instanceof`-check pdf-lib field
 * classes throughout) and is loaded dynamically inside the runner's handlers
 * instead, where the work actually happens. `./forms` re-exports both, so
 * existing importers and tests see one unchanged surface.
 */

import { outputName } from "./files";
import type { FormFieldType } from "./forms";

/** A sensible download name for a filled form, derived from the source. */
export function filledFormsOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "filled");
}

/** Whether a classified type is one we can actually fill. */
export function isFillableType(type: FormFieldType): boolean {
  return type !== "unsupported";
}
