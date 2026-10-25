// @native-canvas
import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFString,
  PDFHexString,
  StandardFonts,
} from "pdf-lib";
import { mergePdfs, splitPdf } from "./engine";
import { sortMergeItems } from "./merge-order";
import { buildSplitParts, parsePageList } from "./ranges";
import { planTextSplit } from "./split-text";
import { extractPdfText, type PdfTextReader } from "./text";

/**
 * Merge PDF's contents page and Split PDF's "By text". Every assertion
 * re-opens the OUTPUT: the contents page's text through pdf.js, its links'
 * `/Dest` through the page tree, and each split part's pages by width (unique
 * per page of a fixture).
 */

const legacy: PdfTextReader = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Awaited<
    ReturnType<PdfTextReader>
  >;

async function makePdf(
  widths: number[],
  bookmarkFirstPage?: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, 400]);
  if (bookmarkFirstPage) {
    const ctx = doc.context;
    const root = ctx.nextRef();
    const item = ctx.nextRef();
    ctx.assign(
      item,
      ctx.obj({
        Title: PDFString.of(bookmarkFirstPage),
        Parent: root,
        Dest: [doc.getPage(0).ref, PDFName.of("Fit")],
      }),
    );
    ctx.assign(
      root,
      ctx.obj({ Type: "Outlines", First: item, Last: item, Count: 1 }),
    );
    doc.catalog.set(PDFName.of("Outlines"), root);
  }
  return doc.save();
}

async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => Math.round(p.getSize().width));
}

/** Each Link on `pageIndex`: the 0-based page its /Dest opens. */
async function linkTargets(
  bytes: Uint8Array,
  pageIndex: number,
): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  const index = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i]));
  const annots = doc
    .getPage(pageIndex)
    .node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  return (annots?.asArray() ?? []).map((ref) => {
    const a = doc.context.lookup(ref) as PDFDict;
    expect(a.get(PDFName.of("Subtype"))).toBe(PDFName.of("Link"));
    const dest = a.lookup(PDFName.of("Dest"), PDFArray);
    const head = dest.get(0);
    return head instanceof PDFRef ? (index.get(head.toString()) ?? -1) : -2;
  });
}

/** Top-level bookmarks: title → 0-based output page. */
async function outline(bytes: Uint8Array): Promise<[string, number][]> {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const index = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i]));
  const out: [string, number][] = [];
  const walk = (first: unknown) => {
    let cur = first instanceof PDFRef ? ctx.lookup(first) : undefined;
    while (cur instanceof PDFDict) {
      const t = ctx.lookup(cur.get(PDFName.of("Title")));
      const dest = ctx.lookup(cur.get(PDFName.of("Dest")));
      const head = dest instanceof PDFArray ? dest.get(0) : undefined;
      out.push([
        t instanceof PDFString || t instanceof PDFHexString
          ? t.decodeText()
          : "",
        head instanceof PDFRef ? (index.get(head.toString()) ?? -1) : -2,
      ]);
      walk(cur.get(PDFName.of("First")));
      const next = cur.get(PDFName.of("Next"));
      cur = next instanceof PDFRef ? ctx.lookup(next) : undefined;
    }
  };
  const root = doc.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  if (root) walk(root.get(PDFName.of("First")));
  return out;
}

describe("merge: contents page", () => {
  it("lists each file at its start page, after sort and page selection, every line a link", async () => {
    const files = [
      { name: "b-report.pdf", seq: 0, bytes: await makePdf([21, 22]) },
      {
        name: "a-intro.pdf",
        seq: 1,
        bytes: await makePdf([11, 12, 13], "Intro own bookmark"),
      },
      { name: "c-final.pdf", seq: 2, bytes: await makePdf([31]) },
    ];
    const sorted = sortMergeItems(files, "name-asc");
    expect(sorted.map((f) => f.name)).toEqual([
      "a-intro.pdf",
      "b-report.pdf",
      "c-final.pdf",
    ]);
    const titles = sorted.map((f) => f.name.replace(/\.pdf$/, ""));
    const out = await mergePdfs(
      sorted.map((f) => f.bytes),
      {
        // a-intro: pages 1 and 3 only.
        pages: [parsePageList("1,3", 3), undefined, undefined],
        fileBookmarks: titles,
        contentsPage: titles,
      },
    );
    // One contents page in front, then the selected pages in sorted order.
    expect((await widths(out)).slice(1)).toEqual([11, 13, 21, 22, 31]);

    const { pages } = await extractPdfText(out, legacy);
    const toc = pages[0]!.text.replace(/[ .]{3,}/g, " … ");
    expect(toc).toMatch(/Contents/);
    expect(toc).toMatch(/a-intro … 2/);
    expect(toc).toMatch(/b-report … 4/);
    expect(toc).toMatch(/c-final … 6/);

    // Each link opens the page its line names (0-based: 1, 3, 5).
    expect(await linkTargets(out, 0)).toEqual([1, 3, 5]);

    // Bookmarks follow the pages, shifted by the contents page.
    expect(await outline(out)).toEqual([
      ["a-intro", 1],
      ["Intro own bookmark", 1],
      ["b-report", 3],
      ["c-final", 5],
    ]);
  });

  it("without the option no page is added (control)", async () => {
    const a = await makePdf([11, 12]);
    const b = await makePdf([21]);
    expect(await widths(await mergePdfs([a, b]))).toEqual([11, 12, 21]);
    const withToc = await mergePdfs([a, b], { contentsPage: ["a", "b"] });
    expect(await widths(withToc)).toEqual([300, 11, 12, 21]);
  });

  it("runs onto more contents pages when the list is long, and numbers count them all", async () => {
    const one = await makePdf([50]);
    const n = 60;
    const titles = Array.from({ length: n }, (_, i) => `file ${i + 1}`);
    const out = await mergePdfs(
      titles.map(() => one),
      { contentsPage: titles },
    );
    const doc = await PDFDocument.load(out);
    const tocPages = doc.getPageCount() - n;
    expect(tocPages).toBeGreaterThan(1);
    const all: number[] = [];
    for (let p = 0; p < tocPages; p++) all.push(...(await linkTargets(out, p)));
    expect(all).toEqual(titles.map((_, i) => tocPages + i));
    const { pages } = await extractPdfText(out, legacy);
    expect(pages[tocPages - 1]!.text.replace(/[ .]{3,}/g, " … ")).toContain(
      `file ${n} … ${tocPages + n}`,
    );
  });
});

async function textPdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pages.forEach((lines, i) => {
    const page = doc.addPage([100 + i, 400]);
    lines.forEach((line, k) =>
      page.drawText(line, { x: 20, y: 360 - k * 20, size: 12, font }),
    );
  });
  return doc.save();
}

describe("split: by text", () => {
  const PAGES = [
    ["Cover letter"],
    ["Invoice 001", "Statement of", "account"],
    ["details continue"],
    ["INVOICE 002"],
    [], // no text layer
    ["invoice 003"],
  ];

  it("starts a file at every page containing the phrase; earlier pages are their own file", async () => {
    const bytes = await textPdf(PAGES);
    const { pages } = await extractPdfText(bytes, legacy);
    const plan = planTextSplit(pages, "invoice", false);
    expect(plan.matched).toEqual([1, 3, 5]);
    expect(plan.noText).toEqual([5]);
    const parts = buildSplitParts("doc", plan.ranges);
    const files = await splitPdf(bytes, parts);
    expect(await Promise.all(files.map((f) => widths(f.bytes)))).toEqual([
      [100],
      [101, 102],
      [103, 104],
      [105],
    ]);
  });

  it("match case narrows it, and a phrase broken across lines still matches", async () => {
    const bytes = await textPdf(PAGES);
    const { pages } = await extractPdfText(bytes, legacy);
    expect(planTextSplit(pages, "Invoice", true).matched).toEqual([1]);
    expect(planTextSplit(pages, "INVOICE", true).matched).toEqual([3]);
    expect(planTextSplit(pages, "statement of account", false).matched).toEqual(
      [1],
    );
    expect(planTextSplit(pages, "nowhere", false).ranges).toEqual([]);
    expect(planTextSplit(pages, "  ", false).matched).toEqual([]);
  });
});
