/**
 * EPUB to PDF's limits, as a LEAF (its only import is the leaf `./tools`), so
 * the tool page, the upload gate and the engine read the same numbers.
 *
 * The book is rendered by the HTML renderer's Chromium (`../html-render`), so
 * the binary, the time bound and the output cap are that engine's
 * (`resolveNativeHtmlRenderConfig`); only what is particular to a ZIP of
 * chapters lives here. `EPUB_TOOLS` is re-exported so the guard that walks
 * every `*native-config.ts` links this engine to the ceiling it declares by
 * the identity of that list (`worker-engine-ceilings-declared.test.ts`).
 */
export { EPUB_TOOLS, EPUB_TO_PDF_TOOL } from "./tools";

const MIB = 1024 * 1024;

/**
 * The largest .epub the engine is handed, in bytes, and the figure the tool
 * page states through `@/lib/workers/engine-file-ceilings`. As with the HTML
 * renderer, `PDFXYZ_EPUB_MAX_INPUT_BYTES` can only RAISE it: a lower override
 * would make the page overstate what the engine accepts.
 */
export const EPUB_DEFAULT_MAX_INPUT_BYTES = 50 * MIB;

/** The most files (ZIP entries) one book may hold. */
export const EPUB_MAX_ENTRIES = 10_000;

/** The most bytes all of a book's files may unpack to, together. */
export const EPUB_MAX_UNPACKED_BYTES = 300 * MIB;

/**
 * The most one file may grow when unpacked, as a multiple of its packed size —
 * checked only for files that unpack past {@link EPUB_RATIO_FLOOR_BYTES}, so a
 * small, very repetitive stylesheet is not mistaken for a bomb.
 */
export const EPUB_MAX_ENTRY_RATIO = 100;
export const EPUB_RATIO_FLOOR_BYTES = 1 * MIB;

/** The most chapter files (linear spine items) one book may print. */
export const EPUB_MAX_SPINE_ITEMS = 300;

/** The largest XML file (container, package, nav, NCX) the engine parses. */
export const EPUB_MAX_XML_BYTES = 8 * MIB;

export interface NativeEpubConfig {
  maxInputBytes: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

export function resolveNativeEpubConfig(
  env: Record<string, string | undefined> = process.env,
): NativeEpubConfig {
  return {
    maxInputBytes: Math.max(
      parsePositiveInt(
        env.PDFXYZ_EPUB_MAX_INPUT_BYTES,
        EPUB_DEFAULT_MAX_INPUT_BYTES,
      ),
      EPUB_DEFAULT_MAX_INPUT_BYTES,
    ),
  };
}
