/**
 * The tools the HTML-render engine owns, as a LEAF module: no imports.
 *
 * Apart from `engine.ts` (which re-exports them) for the same reason as
 * `office-conversion/tools.ts`: the web tier states and enforces this engine's
 * per-file ceiling (`@/lib/workers/engine-file-ceilings`), and `engine.ts`
 * pulls pdf-lib and the URL validator in with it.
 */
export const HTML_TO_PDF_TOOL = "html-to-pdf";
export const WEBPAGE_TO_PDF_TOOL = "webpage-to-pdf";
export const HTML_RENDER_TOOLS = [
  HTML_TO_PDF_TOOL,
  WEBPAGE_TO_PDF_TOOL,
] as const;
export type HtmlRenderTool = (typeof HTML_RENDER_TOOLS)[number];
