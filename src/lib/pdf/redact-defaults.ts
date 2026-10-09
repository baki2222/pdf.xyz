/**
 * The redaction tool's plain data: the box shape, the fills it offers, and the
 * box its form starts with.
 *
 * This is a LEAF module on purpose. `e2e/client-proof/cases.ts` imports
 * `DEFAULT_REDACTION_DRAFT` to locate its pixel checks, and Playwright loads
 * that file as CommonJS. `./redact` imports `./render`, which uses
 * `import.meta.url` — a SyntaxError under CommonJS — and importing the
 * constant from there made the whole client-proof spec load zero tests.
 * Keep this file free of runtime imports; `src/tests/e2e-cjs-load.test.ts`
 * compiles every module Playwright loads as CommonJS and fails if one cannot.
 */

/** Fill colors offered for a redaction box. */
export type RedactionFill = "black" | "white";

/**
 * Every fill the tool offers, in the order the runner shows them. The runner's
 * fill control renders THIS list, and `redact-paint.test.ts` walks it — so a
 * fill added here is offered and proven to reach the pixels in the same edit,
 * rather than offered by one list and tested against another.
 */
export const REDACTION_FILL_OPTIONS: readonly {
  value: RedactionFill;
  label: string;
}[] = [
  { value: "black", label: "Black" },
  { value: "white", label: "White" },
];

/**
 * A rectangle to redact, in PDF points with a bottom-left origin (the standard
 * PDF coordinate space), on a specific 1-based page. `x`/`y` locate the box's
 * lower-left corner; `width`/`height` size it.
 */
export interface RedactionRect {
  /** 1-based page number. */
  page: number;
  /** Distance of the box's left edge from the page's left edge, in points. */
  x: number;
  /** Distance of the box's bottom edge from the page's bottom edge, in points. */
  y: number;
  /** Box width in points. */
  width: number;
  /** Box height in points. */
  height: number;
}

/**
 * The box the runner's form starts with — what "Add area" adds when the user
 * touches nothing. Exported because it is the one rectangle every redaction
 * proof can name without a drag: the unit paint test and the browser proof
 * (e2e/client-proof/cases.ts) both locate their pixel regions from it, so
 * moving the default moves the checks with it.
 */
export const DEFAULT_REDACTION_DRAFT: Readonly<RedactionRect> = {
  page: 1,
  x: 36,
  y: 36,
  width: 200,
  height: 72,
};
