/**
 * The tool the EPUB engine owns, as a LEAF module: no imports.
 *
 * Apart from `engine.ts` for the same reason as `html-render/tools.ts`: the
 * web tier states and enforces this engine's per-file ceiling
 * (`@/lib/workers/engine-file-ceilings`) and must not pull the engine (zlib,
 * pdf-lib) in to read one string.
 */
export const EPUB_TO_PDF_TOOL = "epub-to-pdf";
export const EPUB_TOOLS = [EPUB_TO_PDF_TOOL] as const;
export type EpubTool = (typeof EPUB_TOOLS)[number];
