import type { ImagePageSizeId } from "./image-page-layout";

/*
 * Kept OUT of image-page-layout.ts (2026-11-07): that module is imported by
 * src/lib/jobs/ocr.ts and so reaches OCR PDF's first load, and this table of
 * Letter regions with their names, and the Intl lookup, cost every such page
 * about 330 B gz there. Only JPG/PNG to PDF's runner and copy read it.
 */

/**
 * The page size the RUNNER starts on, by the browser's region (audit
 * jpg-to-pdf#1, 2026-11-07). Until then every visitor started on US Letter,
 * and most of the world prints on A4.
 *
 * DEFAULT_IMAGE_PAGE_OPTIONS above stays the ENGINE's default for a caller
 * that passes no options (the layout it always drew); a person using the
 * tool gets `imagePageSizeForLocales(navigator.languages)` instead, and the
 * page copy describes that (IMAGE_PAGE_FACT in src/lib/tools/tool-facts.ts).
 */
export const WORLD_PAGE_SIZE: ImagePageSizeId = "a4";
export const LETTER_REGION_PAGE_SIZE: ImagePageSizeId = "letter";

/**
 * The regions CLDR's supplemental measurementData lists with paperSize
 * "US-Letter". `name` is how the page copy names the first few, in order.
 */
export const LETTER_PAPER_REGIONS: readonly { code: string; name: string }[] = [
  { code: "US", name: "the United States" },
  { code: "CA", name: "Canada" },
  { code: "MX", name: "Mexico" },
  { code: "PH", name: "the Philippines" },
  { code: "BZ", name: "Belize" },
  { code: "CL", name: "Chile" },
  { code: "CO", name: "Colombia" },
  { code: "CR", name: "Costa Rica" },
  { code: "GT", name: "Guatemala" },
  { code: "NI", name: "Nicaragua" },
  { code: "PA", name: "Panama" },
  { code: "PR", name: "Puerto Rico" },
  { code: "SV", name: "El Salvador" },
  { code: "VE", name: "Venezuela" },
];

/**
 * The region of a BCP 47 tag, filling in the likely one when the tag has
 * none ("en" → US, "fr" → FR); undefined for a tag that does not parse.
 */
function regionOfLocale(tag: string): string | undefined {
  try {
    return new Intl.Locale(tag).maximize().region;
  } catch {
    return undefined;
  }
}

/**
 * The paper the runner starts on for a browser whose preferred languages are
 * `locales` (navigator.languages): the FIRST preference decides, Letter for
 * a Letter region and A4 for every other region, an empty list or a tag that
 * does not parse.
 */
export function imagePageSizeForLocales(
  locales: readonly string[],
): ImagePageSizeId {
  const first = locales[0];
  const region = first ? regionOfLocale(first) : undefined;
  return region && LETTER_PAPER_REGIONS.some((r) => r.code === region)
    ? LETTER_REGION_PAGE_SIZE
    : WORLD_PAGE_SIZE;
}
