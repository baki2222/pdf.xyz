/**
 * Each page's size as Resize PDF's page picker labels it (audit resize-pdf#6,
 * 2026-11-08): the "Making mixed page sizes match" job needs to SEE which
 * pages are the odd ones out. Read from the page as displayed — the visible
 * frame `resizePdf` itself resizes (`visiblePageFrame`, via `getPageSizes`).
 *
 * Its own module, imported by the resize runner only.
 */
import { RESIZE_SIZES } from "@/lib/pdf/resize";
import { fromPoints } from "@/lib/pdf/length-units";

/** How far, in points, a side may be from a named size and still be it. */
export const NAMED_SIZE_TOLERANCE_PT = 1;

/**
 * "A4", "US Letter landscape", or "141.1 × 105.8 mm" for a size with no
 * name in the Resize table.
 */
export function pageSizeCaption(width: number, height: number): string {
  const near = (a: number, b: number) =>
    Math.abs(a - b) <= NAMED_SIZE_TOLERANCE_PT;
  for (const { label, size } of RESIZE_SIZES) {
    if (near(width, size.width) && near(height, size.height)) return label;
    if (near(width, size.height) && near(height, size.width)) {
      return `${label} landscape`;
    }
  }
  return `${fromPoints(width, "mm")} × ${fromPoints(height, "mm")} mm`;
}
