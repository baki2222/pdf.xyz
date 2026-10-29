/**
 * The PDF-to-image facts other modules quote: the format a tool produces, by
 * slug, and the resolution presets. Their own module, with no imports,
 * because `./pdf-to-image` — where they lived — brings the page-range parser
 * and the file-name helpers with it: the tool route's dispatcher
 * (`tool-runner.tsx`) put those in every tool page's first load for the
 * format (~2.6 KB gz), and the catalogue in the palette's and the ticket's
 * fetch for the presets' wording. `./pdf-to-image` re-exports all of it.
 */
export type RasterFormat = "png" | "jpg";

/** Map a catalog slug to the image format its runner produces. */
export function rasterFormatForSlug(slug: string): RasterFormat {
  return slug === "pdf-to-png" ? "png" : "jpg";
}

/** A selectable render-resolution preset. */
export interface RasterResolution {
  id: string;
  label: string;
  /** Dots per inch to rasterize at (PDF user space is 72 dpi). */
  dpi: number;
}

/** Resolution presets offered in the UI, lowest → highest. */
export const RASTER_RESOLUTIONS: readonly RasterResolution[] = [
  { id: "screen", label: "Screen", dpi: 96 },
  { id: "high", label: "High", dpi: 150 },
  { id: "print", label: "Print", dpi: 300 },
];

/** "a, b or c" — a reader's list. */
function orList(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

/**
 * "Screen (96 DPI), High (150 DPI) or Print (300 DPI)" — the presets as the
 * tool pages and guides name them, built from the list the runner renders.
 */
export const RASTER_RESOLUTION_CHOICES = orList(
  RASTER_RESOLUTIONS.map((r) => `${r.label} (${r.dpi} DPI)`),
);

/** "96, 150 or 300" — the same presets, as numbers. */
export const RASTER_RESOLUTION_DPIS = orList(
  RASTER_RESOLUTIONS.map((r) => String(r.dpi)),
);
