/**
 * Ordering by name and a bookmark per image on JPG / PNG to PDF (audit
 * png-to-pdf#6, 2026-11-08). Natural order was applied once, on the first
 * pick; images added later always joined the end, and the engine wrote no
 * outline, so a 40-screenshot trail had no way to jump to screenshot 23.
 *
 * A LEAF: only the image runner, `image-to-pdf.ts` and the tool copy import
 * it. pdf-lib is passed in, never imported, so this costs no page anything.
 */
import type { PDFDocument } from "pdf-lib";
import type { ImagePageOptions } from "./image-page-layout";
import type { PdfLibModule } from "./pdf-lib";

export const IMAGE_ORDER_LABELS = {
  /** The button in the Image order heading. */
  sortByName: "Sort by name",
} as const;

/**
 * File names in reading order, numbers compared as numbers ("page 2" before
 * "page 10"), case and accents ignored: what a file manager's name sort does.
 */
export function compareFileNames(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

export type ImageBookmarksId = NonNullable<ImagePageOptions["bookmarks"]>;

export const IMAGE_BOOKMARKS_LABELS = {
  heading: "Bookmarks",
  /** Shown while the output is one PDF per image, where it does nothing. */
  perImageNote: "Each PDF in the ZIP holds one image, so it has no bookmarks.",
} as const;

export const IMAGE_BOOKMARKS_CHOICES: readonly {
  id: ImageBookmarksId;
  label: string;
}[] = [
  { id: "none", label: "None" },
  { id: "per-image", label: "One per image" },
];

/** The fewest images a PDF needs before a bookmark per image is written. */
export const MIN_BOOKMARKED_IMAGES = 2;

/**
 * Write `entries` — one per image, in page order, titled with its file name
 * and pointing at the first page it became — as `doc`'s outline, and ask a
 * viewer to open with the bookmark panel showing. Nothing is written for
 * fewer than {@link MIN_BOOKMARKED_IMAGES}: one bookmark for one image is a
 * panel with nothing to choose.
 */
export function writeImageBookmarks(
  lib: PdfLibModule,
  doc: PDFDocument,
  entries: readonly { title: string; pageIndex: number }[],
): void {
  if (entries.length < MIN_BOOKMARKED_IMAGES) return;
  const { PDFName, PDFHexString } = lib;
  const ctx = doc.context;
  const pages = doc.getPages();
  const root = ctx.nextRef();
  const refs = entries.map(() => ctx.nextRef());
  entries.forEach((entry, i) => {
    const page = pages[entry.pageIndex]!;
    ctx.assign(
      refs[i]!,
      ctx.obj({
        Title: PDFHexString.fromText(entry.title),
        Parent: root,
        ...(i > 0 ? { Prev: refs[i - 1]! } : {}),
        ...(i < entries.length - 1 ? { Next: refs[i + 1]! } : {}),
        Dest: [page.ref, "Fit"],
      }),
    );
  });
  ctx.assign(
    root,
    ctx.obj({
      Type: "Outlines",
      First: refs[0]!,
      Last: refs[refs.length - 1]!,
      Count: entries.length,
    }),
  );
  doc.catalog.set(PDFName.of("Outlines"), root);
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
}
