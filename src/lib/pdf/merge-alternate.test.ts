/**
 * Merge PDF's "Alternate pages" mode: one page from each file in turn
 * (A1, B1, A2, B2, …), what is left of a longer file appended in its order,
 * and a per-file Reverse for the double-sided scan — a fronts file and a
 * backs file scanned last page first.
 *
 * Every assertion re-opens the SAVED bytes. Page identity is carried by page
 * WIDTH (unique per page of a fixture), read back with pdf-lib, so the order
 * is the file's and never the plan's.
 */
import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
} from "pdf-lib";
import { mergePdfs } from "./engine";
import { mergeAlternating } from "./merge-alternate";
import { interleavePages } from "./merge-order";
import { parsePageList } from "./ranges";
import {
  makeStructuredPdf,
  STRUCTURED_FIELD_NAME,
  STRUCTURED_FIELD_VALUE,
} from "@/tests/fixtures-structured-pdf";

async function makePdf(
  widths: number[],
  bookmark?: { title: string; page: number },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, 100]);
  if (bookmark) {
    const ctx = doc.context;
    const rootRef = ctx.nextRef();
    const itemRef = ctx.nextRef();
    ctx.assign(
      itemRef,
      ctx.obj({
        Title: PDFString.of(bookmark.title),
        Parent: rootRef,
        Dest: [doc.getPage(bookmark.page).ref, PDFName.of("Fit")],
      }),
    );
    ctx.assign(
      rootRef,
      ctx.obj({ Type: "Outlines", First: itemRef, Last: itemRef, Count: 1 }),
    );
    doc.catalog.set(PDFName.of("Outlines"), rootRef);
  }
  return doc.save();
}

async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => Math.round(p.getSize().width));
}

/** Top-level bookmarks as [title, 0-based output page], read independently. */
async function outline(bytes: Uint8Array): Promise<[string, number][]> {
  const doc = await PDFDocument.load(bytes);
  const index = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i]));
  const root = doc.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  const out: [string, number][] = [];
  let cur = root?.get(PDFName.of("First"));
  while (cur instanceof PDFRef) {
    const item = doc.context.lookup(cur, PDFDict);
    const title = item.get(PDFName.of("Title"));
    const dest = doc.context.lookup(item.get(PDFName.of("Dest")));
    const head = dest instanceof PDFArray ? dest.get(0) : undefined;
    out.push([
      title instanceof PDFString || title instanceof PDFHexString
        ? title.decodeText()
        : "",
      head instanceof PDFRef ? (index.get(head.toString()) ?? -1) : -1,
    ]);
    cur = item.get(PDFName.of("Next"));
  }
  return out;
}

describe("interleavePages (the pure order)", () => {
  it("takes one from each list in turn and appends the leftovers in order", () => {
    expect(
      interleavePages([["a1", "a2", "a3", "a4"], ["b1", "b2"], ["c1"]]),
    ).toEqual(["a1", "b1", "c1", "a2", "b2", "a3", "a4"]);
  });

  it("one list, or none, is itself", () => {
    expect(interleavePages([[1, 2, 3]])).toEqual([1, 2, 3]);
    expect(interleavePages([])).toEqual([]);
  });
});

describe("merge: Alternate pages", () => {
  it("interleaves A1, B1, A2, B2 in the saved file", async () => {
    const a = await makePdf([11, 12, 13]);
    const b = await makePdf([21, 22, 23]);
    expect(await widths(await mergeAlternating([a, b]))).toEqual([
      11, 21, 12, 22, 13, 23,
    ]);
  });

  it("appends the longer file's leftover pages in their own order", async () => {
    const a = await makePdf([11, 12, 13, 14]);
    const b = await makePdf([21]);
    expect(await widths(await mergeAlternating([a, b]))).toEqual([
      11, 21, 12, 13, 14,
    ]);
    // And the other way round: the short file first.
    expect(await widths(await mergeAlternating([b, a]))).toEqual([
      21, 11, 12, 13, 14,
    ]);
  });

  it("double-sided scan: fronts, then backs scanned last page first, with Reverse on the backs", async () => {
    // Sheet k has front 1k and back 2k. The backs file holds them in the
    // order the scanner fed them: sheet 3's back first.
    const fronts = await makePdf([11, 12, 13]);
    const backs = await makePdf([23, 22, 21]);
    const out = await mergeAlternating([fronts, backs], {
      reverse: [false, true],
    });
    expect(await widths(out)).toEqual([11, 21, 12, 22, 13, 23]);
  });

  it("positive control: without Reverse the same scan comes out wrong", async () => {
    const fronts = await makePdf([11, 12, 13]);
    const backs = await makePdf([23, 22, 21]);
    const out = await mergeAlternating([fronts, backs]);
    expect(await widths(out)).toEqual([11, 23, 12, 22, 13, 21]);
    expect(await widths(out)).not.toEqual([11, 21, 12, 22, 13, 23]);
  });

  it("honours each file's page selection before alternating, and Reverse after it", async () => {
    const a = await makePdf([11, 12, 13, 14, 15]);
    const b = await makePdf([21, 22, 23]);
    const out = await mergeAlternating([a, b], {
      pages: [parsePageList("1-3", 5), undefined],
      reverse: [false, true],
    });
    expect(await widths(out)).toEqual([11, 23, 12, 22, 13, 21]);
  });

  it("a file with nothing selected is refused by number, as in a plain merge", async () => {
    const a = await makePdf([11]);
    await expect(
      mergeAlternating([a, a], { pages: [undefined, []] }),
    ).rejects.toThrow(/File 2 has no pages selected/);
  });

  it("a file's own bookmark still opens its page after the pages move", async () => {
    const a = await makePdf([11, 12]);
    const b = await makePdf([22, 21], { title: "Back of sheet 1", page: 1 });
    const out = await mergeAlternating([a, b], { reverse: [false, true] });
    expect(await widths(out)).toEqual([11, 21, 12, 22]);
    // Page 21 (the bookmark's page) is output page 2, index 1.
    expect(await outline(out)).toEqual([["Back of sheet 1", 1]]);
  });

  it("carries a form like a plain merge does", async () => {
    const form = await makeStructuredPdf(2);
    const other = await makePdf([21, 22]);
    const out = await mergeAlternating([form, other]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(4);
    expect(doc.getForm().getFields().length).toBe(
      (await PDFDocument.load(await mergePdfs([form, other])))
        .getForm()
        .getFields().length,
    );
    expect(doc.getForm().getTextField(STRUCTURED_FIELD_NAME).getText()).toBe(
      STRUCTURED_FIELD_VALUE,
    );
  });
});

describe("merge: the default is unchanged", () => {
  it("one file after another, every page, in file order", async () => {
    const a = await makePdf([11, 12, 13]);
    const b = await makePdf([21, 22, 23]);
    expect(await widths(await mergePdfs([a, b]))).toEqual([
      11, 12, 13, 21, 22, 23,
    ]);
  });
});
