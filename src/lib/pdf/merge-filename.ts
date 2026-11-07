import type { PDFDocument, PDFFont, PDFPage } from "pdf-lib";
import type { PdfLibModule } from "./pdf-lib";
import {
  embedStampFont,
  INK,
  placeStamp,
  toRgb,
  viewerSize,
  visibleBox,
} from "./stamp";

/**
 * Merge PDF's "file name at the foot of its pages" (audit merge-pdf#6,
 * 2026-11-07): each source file's name, small, at the bottom left of every
 * page it contributed, as a reader sees the page (its crop box, turned by its
 * `/Rotate`). Loaded with the option only, so a plain merge never pays for it.
 */

/** The name's size in points; shrunk to {@link MIN_SIZE} before shortening. */
export const MERGE_FILENAME_SIZE = 8;
const MIN_SIZE = 6;
/** Distance from the page's left and bottom edges, in points. */
export const MERGE_FILENAME_MARGIN = 18;
const ELLIPSIS = "…";

export interface FileNameGroup {
  name: string;
  pages: readonly PDFPage[];
}

/** Draw each group's name on each of its pages. */
export async function stampFileNames(
  lib: PdfLibModule,
  groups: readonly FileNameGroup[],
): Promise<void> {
  const doc = groups.find((g) => g.pages.length > 0)?.pages[0]?.doc;
  if (!doc) return;
  const names = groups.map((g) => g.name).filter((n) => n.trim() !== "");
  if (names.length === 0) return;
  const shared = await tryFont(doc, names);
  const color = toRgb(lib.rgb, INK);
  for (const group of groups) {
    if (group.name.trim() === "") continue;
    const { name, font } = shared
      ? { name: group.name, font: shared }
      : await drawableName(doc, group.name);
    for (const page of group.pages) {
      const box = visibleBox(page);
      const rotation = page.getRotation().angle;
      const room = Math.max(
        0,
        viewerSize(box, rotation).width - 2 * MERGE_FILENAME_MARGIN,
      );
      const { text, size } = fitName(name, room, (t, s) =>
        font.widthOfTextAtSize(t, s),
      );
      if (text === "") continue;
      const place = placeStamp({
        box,
        pageRotation: rotation,
        textWidth: font.widthOfTextAtSize(text, size),
        textHeight: font.heightAtSize(size),
        h: "left",
        v: "bottom",
        margin: MERGE_FILENAME_MARGIN,
      });
      page.drawText(text, {
        x: place.x,
        y: place.y,
        size,
        font,
        color,
        rotate: lib.degrees(place.rotate),
      });
    }
  }
}

/** One font for all of `names` (and the ellipsis), or null if none can. */
async function tryFont(
  doc: PDFDocument,
  names: readonly string[],
): Promise<PDFFont | null> {
  try {
    return await embedStampFont(doc, [...names, ELLIPSIS]);
  } catch {
    return null;
  }
}

/** Emoji and the joiners and selectors that build them: pictures, not letters. */
const PICTURED =
  /[\p{Extended_Pictographic}\p{Join_Control}\p{Variation_Selector}]/gu;

/** Helvetica, built into every PDF reader, draws all of Latin-1. */
function latinOnly(text: string): string {
  return Array.from(text, (c) => {
    const n = c.codePointAt(0) ?? 0;
    return (n >= 0x20 && n <= 0x7e) || (n >= 0xa0 && n <= 0xff) ? c : "?";
  }).join("");
}

/**
 * A name with a font that can draw it, when the names cannot share one (two
 * scripts no single face covers, or an emoji). The names are not text the
 * visitor typed, so this never fails the merge: the name as it is, then
 * without its emoji (never embedded), then with every character Helvetica
 * cannot draw replaced by "?", as the contents page does.
 */
async function drawableName(
  doc: PDFDocument,
  name: string,
): Promise<{ name: string; font: PDFFont }> {
  const unpictured = name.replace(PICTURED, "").replace(/\s+/g, " ").trim();
  for (const candidate of [name, unpictured]) {
    if (candidate === "") continue;
    const font = await tryFont(doc, [candidate]);
    if (font) return { name: candidate, font };
  }
  const latin = latinOnly(name);
  return { name: latin, font: await embedStampFont(doc, [latin, ELLIPSIS]) };
}

/**
 * The name at the largest size from {@link MERGE_FILENAME_SIZE} down to
 * {@link MIN_SIZE} that fits `room`; still too wide at the smallest, the
 * longest opening that fits with "…" after it.
 */
export function fitName(
  name: string,
  room: number,
  width: (text: string, size: number) => number,
): { text: string; size: number } {
  for (let size = MERGE_FILENAME_SIZE; size >= MIN_SIZE; size -= 1) {
    if (width(name, size) <= room) return { text: name, size };
  }
  const chars = Array.from(name);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const part = chars.slice(0, mid).join("").trimEnd() + ELLIPSIS;
    if (width(part, MIN_SIZE) <= room) lo = mid;
    else hi = mid - 1;
  }
  return {
    text: lo === 0 ? "" : chars.slice(0, lo).join("").trimEnd() + ELLIPSIS,
    size: MIN_SIZE,
  };
}
