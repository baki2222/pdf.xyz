import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
  StandardFonts,
} from "pdf-lib";
import { mergePdfs, splitPdf } from "./engine";
import {
  combineRanges,
  readTopLevelBookmarks,
  splitPdfBySize,
} from "./split-modes";
import {
  buildSplitParts,
  parsePageList,
  parseRanges,
  rangesFromStarts,
} from "./ranges";
import { sortMergeItems } from "./merge-order";
import {
  makeStructuredPdf,
  STRUCTURED_FIELD_VALUE,
} from "@/tests/fixtures-structured-pdf";

/**
 * Merge PDF's sort / per-file pages / per-file bookmarks, and Split PDF's
 * by-size / by-bookmarks / merge-ranges modes — every assertion re-opens the
 * OUTPUT bytes, never the plan that produced them. Page identity is carried by
 * page WIDTH (unique per page of a fixture), so order is read from the file.
 */

/** Pages whose widths are `widths`, optionally with a top-level outline. */
async function makePdf(
  widths: number[],
  outline: {
    title: string;
    page?: number;
    url?: string;
    kids?: number[];
  }[] = [],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, 100]);
  if (outline.length > 0) writeOutline(doc, outline);
  return doc.save();
}

/** A hand-built /Outlines tree: no engine code writes the fixture. */
function writeOutline(
  doc: PDFDocument,
  items: { title: string; page?: number; url?: string; kids?: number[] }[],
): void {
  const ctx = doc.context;
  const pages = doc.getPages();
  const rootRef = ctx.nextRef();
  const refs = items.map(() => ctx.nextRef());
  items.forEach((item, i) => {
    const dict: Record<string, unknown> = {
      Title: PDFString.of(item.title),
      Parent: rootRef,
    };
    if (i > 0) dict.Prev = refs[i - 1];
    if (i < items.length - 1) dict.Next = refs[i + 1];
    if (item.page !== undefined) {
      dict.Dest = [pages[item.page]!.ref, PDFName.of("Fit")];
    } else if (item.url) {
      dict.A = { S: "URI", URI: PDFString.of(item.url) };
    }
    if (item.kids?.length) {
      const kidRefs = item.kids.map(() => ctx.nextRef());
      item.kids.forEach((p, k) => {
        ctx.assign(
          kidRefs[k]!,
          ctx.obj({
            Title: PDFString.of(`${item.title} / child ${k + 1}`),
            Parent: refs[i]!,
            ...(k > 0 ? { Prev: kidRefs[k - 1]! } : {}),
            ...(k < kidRefs.length - 1 ? { Next: kidRefs[k + 1]! } : {}),
            Dest: [pages[p]!.ref, PDFName.of("Fit")],
          }),
        );
      });
      dict.First = kidRefs[0];
      dict.Last = kidRefs[kidRefs.length - 1];
      dict.Count = -kidRefs.length;
    }
    ctx.assign(refs[i]!, ctx.obj(dict as never));
  });
  ctx.assign(
    rootRef,
    ctx.obj({
      Type: "Outlines",
      First: refs[0]!,
      Last: refs[refs.length - 1]!,
      Count: items.length,
    }),
  );
  doc.catalog.set(PDFName.of("Outlines"), rootRef);
}

async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => Math.round(p.getSize().width));
}

interface ReadBookmark {
  title: string;
  /** 0-based output page the bookmark opens, or null for none. */
  page: number | null;
  children: ReadBookmark[];
}

/** Read the output's outline back, independently of the writer. */
async function readOutline(bytes: Uint8Array): Promise<ReadBookmark[]> {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const pageIndex = new Map(
    doc.getPages().map((p, i) => [p.ref.toString(), i]),
  );
  const root = doc.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  const siblings = (first: unknown): ReadBookmark[] => {
    const out: ReadBookmark[] = [];
    let cur = first instanceof PDFRef ? ctx.lookup(first) : undefined;
    let guard = 0;
    while (cur instanceof PDFDict && guard++ < 1000) {
      const title = ctx.lookup(cur.get(PDFName.of("Title")));
      const dest = ctx.lookup(cur.get(PDFName.of("Dest")));
      const head = dest instanceof PDFArray ? dest.get(0) : undefined;
      out.push({
        title:
          title instanceof PDFString || title instanceof PDFHexString
            ? title.decodeText()
            : "",
        page:
          head instanceof PDFRef
            ? (pageIndex.get(head.toString()) ?? -1)
            : null,
        children: siblings(cur.get(PDFName.of("First"))),
      });
      const next = cur.get(PDFName.of("Next"));
      cur = next instanceof PDFRef ? ctx.lookup(next) : undefined;
    }
    return out;
  };
  return root ? siblings(root.get(PDFName.of("First"))) : [];
}

describe("merge: per-file page selection", () => {
  it("takes only the chosen pages of each file, in file order", async () => {
    const a = await makePdf([11, 12, 13, 14, 15]);
    const b = await makePdf([21, 22, 23]);
    const out = await mergePdfs([a, b], {
      pages: [parsePageList("1-3,5", 5), parsePageList("2", 3)],
    });
    expect(await widths(out)).toEqual([11, 12, 13, 15, 22]);
  });

  it("a missing entry takes every page; a selection never reorders", async () => {
    const a = await makePdf([11, 12, 13]);
    const b = await makePdf([21, 22]);
    // "3,1" parses to the SET {1,3}: page selection picks, it does not reorder.
    const out = await mergePdfs([a, b], {
      pages: [undefined, parsePageList("2,1", 2)],
    });
    expect(await widths(out)).toEqual([11, 12, 13, 21, 22]);
    const picked = await mergePdfs([a, b], {
      pages: [parsePageList("3,1", 3)],
    });
    expect(await widths(picked)).toEqual([11, 13, 21, 22]);
  });

  it("the default (no options) is unchanged: every page of every file", async () => {
    const a = await makePdf([11, 12]);
    const b = await makePdf([21, 22, 23]);
    expect(await widths(await mergePdfs([a, b]))).toEqual([11, 12, 21, 22, 23]);
    expect(await widths(await mergePdfs([a, b], {}))).toEqual([
      11, 12, 21, 22, 23,
    ]);
  });

  it("a file with nothing selected is refused by number", async () => {
    const a = await makePdf([11]);
    await expect(mergePdfs([a, a], { pages: [[], undefined] })).rejects.toThrow(
      /File 1 has no pages selected/,
    );
  });

  it("drops a source bookmark whose page was not selected, keeps the rest", async () => {
    const a = await makePdf(
      [11, 12, 13],
      [
        { title: "A intro", page: 0 },
        { title: "A dropped", page: 1 },
        { title: "A end", page: 2 },
      ],
    );
    const b = await makePdf([21]);
    const out = await mergePdfs([a, b], { pages: [[0, 2], undefined] });
    const outline = await readOutline(out);
    expect(outline.map((o) => [o.title, o.page])).toEqual([
      ["A intro", 0],
      ["A end", 1],
    ]);
  });
});

describe("merge: a page left out takes its form field with it", () => {
  /** Every string in every object of the file, decoded (streams unpacked by load). */
  const strings = async (bytes: Uint8Array) => {
    const doc = await PDFDocument.load(bytes);
    const found: string[] = [];
    const visit = (obj: unknown, depth: number): void => {
      if (depth > 20) return;
      if (obj instanceof PDFString || obj instanceof PDFHexString) {
        found.push(obj.decodeText());
      } else if (obj instanceof PDFDict) {
        for (const [, v] of obj.entries()) visit(v, depth + 1);
      } else if (obj instanceof PDFArray) {
        for (const v of obj.asArray()) visit(v, depth + 1);
      }
    };
    for (const [, obj] of doc.context.enumerateIndirectObjects()) visit(obj, 0);
    return { found, fields: doc.getForm().getFields().length };
  };

  it("the field on an unselected page is not in the merged file; selected, it is (control)", async () => {
    const form = await makeStructuredPdf(3);
    const other = await makePdf([21]);
    const without = await strings(
      await mergePdfs([form, other], { pages: [[1, 2], undefined] }),
    );
    expect(without.fields).toBe(0);
    expect(without.found).not.toContain(STRUCTURED_FIELD_VALUE);
    const withIt = await strings(
      await mergePdfs([form, other], { pages: [[0], undefined] }),
    );
    expect(withIt.fields).toBe(1);
    expect(withIt.found).toContain(STRUCTURED_FIELD_VALUE);
  });
});

describe("merge: a bookmark for each file", () => {
  it("writes one top-level bookmark per file, titled by name, at its first page", async () => {
    const a = await makePdf([11, 12, 13]);
    const b = await makePdf([21, 22], [{ title: "B chapter", page: 1 }]);
    const c = await makePdf([31]);
    const out = await mergePdfs([a, b, c], {
      pages: [[1, 2], undefined, undefined],
      fileBookmarks: ["alpha.pdf", "beta – β.pdf", "gamma.pdf"],
    });
    const outline = await readOutline(out);
    expect(outline.map((o) => [o.title, o.page])).toEqual([
      ["alpha.pdf", 0],
      ["beta – β.pdf", 2],
      ["gamma.pdf", 4],
    ]);
    // The file's own bookmarks are kept, beneath its bookmark, re-pointed.
    expect(outline[1]!.children.map((o) => [o.title, o.page])).toEqual([
      ["B chapter", 3],
    ]);
    expect(outline[0]!.children).toEqual([]);
    expect(await widths(out)).toEqual([12, 13, 21, 22, 31]);
  });

  it("without the option no bookmark is invented (positive control)", async () => {
    const a = await makePdf([11]);
    const b = await makePdf([21], [{ title: "B only", page: 0 }]);
    const outline = await readOutline(await mergePdfs([a, b]));
    expect(outline.map((o) => [o.title, o.page])).toEqual([["B only", 1]]);
  });
});

describe("merge: sort", () => {
  const items = [
    { name: "b-report.pdf", seq: 0 },
    { name: "A-cover.pdf", seq: 1 },
    { name: "file10.pdf", seq: 2 },
    { name: "file2.pdf", seq: 3 },
  ];
  it("Name A–Z is case-insensitive and numeric-aware", () => {
    expect(sortMergeItems(items, "name-asc").map((i) => i.name)).toEqual([
      "A-cover.pdf",
      "b-report.pdf",
      "file2.pdf",
      "file10.pdf",
    ]);
  });
  it("Name Z–A is the exact reverse", () => {
    expect(sortMergeItems(items, "name-desc").map((i) => i.name)).toEqual([
      "file10.pdf",
      "file2.pdf",
      "b-report.pdf",
      "A-cover.pdf",
    ]);
  });
  it("As added restores the order the files came in", () => {
    const shuffled = sortMergeItems(items, "name-desc");
    expect(sortMergeItems(shuffled, "added").map((i) => i.seq)).toEqual([
      0, 1, 2, 3,
    ]);
  });
  it("the sorted order is the merged page order", async () => {
    const bytes = {
      "b.pdf": await makePdf([20]),
      "a.pdf": await makePdf([10]),
      "c.pdf": await makePdf([30]),
    };
    const list = Object.keys(bytes).map((name, seq) => ({ name, seq }));
    const sorted = sortMergeItems(list, "name-asc");
    const out = await mergePdfs(
      sorted.map((i) => bytes[i.name as keyof typeof bytes]),
    );
    expect(await widths(out)).toEqual([10, 20, 30]);
  });
});

/** A deterministic, poorly compressible page: `lines` lines of noise. */
async function makeNoisyPdf(linesPerPage: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  linesPerPage.forEach((lines, i) => {
    const page = doc.addPage([100 + i, 800]);
    for (let l = 0; l < lines; l++) {
      let text = "";
      for (let c = 0; c < 60; c++) text += (rand() % 36).toString(36);
      page.drawText(text, { x: 5, y: 790 - (l % 100) * 7, size: 5, font });
    }
  });
  return doc.save();
}

describe("split: by file size", () => {
  it("every part is within the target, together they hold every page in order, and each is as full as it can be", async () => {
    const source = await makeNoisyPdf([40, 10, 60, 25, 30, 5, 50, 45, 20, 35]);
    const target = 9_000;
    const { files, oversized } = await splitPdfBySize(source, target, "doc");
    expect(oversized).toEqual([]);
    expect(files.length).toBeGreaterThan(2);
    for (const f of files)
      expect(f.bytes.byteLength).toBeLessThanOrEqual(target);
    const all = (await Promise.all(files.map((f) => widths(f.bytes)))).flat();
    expect(all).toEqual(await widths(source));
    // Greedy: one more page on any part but the last would cross the target,
    // measured by the plain split engine, not by the packer.
    for (const [i, f] of files.slice(0, -1).entries()) {
      const next = files[i + 1]!.indices[0]!;
      const [grown] = await splitPdf(source, [
        { name: "x.pdf", indices: [...f.indices, next] },
      ]);
      expect(grown!.bytes.byteLength).toBeGreaterThan(target);
    }
    // Names follow the split's usual pattern.
    expect(files[0]!.name).toMatch(/^doc-1-pages?-1/);
    expect(files.map((f) => f.name)).toEqual(
      buildSplitParts(
        "doc",
        files.map((f) => ({
          start: f.indices[0]!,
          end: f.indices[f.indices.length - 1]!,
        })),
      ).map((p) => p.name),
    );
  });

  it("reports a single page bigger than the target and still writes it alone", async () => {
    const source = await makeNoisyPdf([5, 300, 5]);
    const small = await splitPdfBySize(source, 1e9, "doc");
    // Health: a target above the whole file gives one part, nothing reported.
    expect(small.files.length).toBe(1);
    expect(small.oversized).toEqual([]);
    const target = 8_000;
    const { files, oversized } = await splitPdfBySize(source, target, "doc");
    expect(oversized).toEqual([1]);
    const big = files.find((f) => f.indices.includes(1))!;
    expect(big.indices).toEqual([1]);
    expect(big.bytes.byteLength).toBeGreaterThan(target);
    for (const f of files.filter((f) => f !== big)) {
      expect(f.bytes.byteLength).toBeLessThanOrEqual(target);
    }
    const all = (await Promise.all(files.map((f) => widths(f.bytes)))).flat();
    expect(all).toEqual(await widths(source));
  });

  it("refuses a target of zero", async () => {
    const source = await makeNoisyPdf([1]);
    await expect(splitPdfBySize(source, 0, "doc")).rejects.toThrow(
      /greater than zero/,
    );
  });
});

describe("split: by bookmarks", () => {
  it("cuts at each top-level bookmark's page; earlier pages form their own file", async () => {
    const source = await makePdf(
      [11, 12, 13, 14, 15, 16],
      [
        { title: "Chapter 1", page: 1, kids: [2] },
        { title: "Website", url: "https://example.com" },
        { title: "Chapter 2", page: 3, kids: [4, 5] },
      ],
    );
    const marks = await readTopLevelBookmarks(source);
    // Children and the URL entry are not cut points.
    expect(marks).toEqual([
      { title: "Chapter 1", pageIndex: 1 },
      { title: "Chapter 2", pageIndex: 3 },
    ]);
    const ranges = rangesFromStarts(
      marks.map((m) => m.pageIndex),
      6,
    );
    const parts = await splitPdf(source, buildSplitParts("doc", ranges));
    expect(await Promise.all(parts.map((p) => widths(p.bytes)))).toEqual([
      [11],
      [12, 13],
      [14, 15, 16],
    ]);
  });

  it("a PDF with no bookmarks has no cut points", async () => {
    expect(await readTopLevelBookmarks(await makePdf([11, 12]))).toEqual([]);
  });

  it("starts are sorted and de-duplicated, and a start at page 1 adds no empty file", () => {
    expect(rangesFromStarts([3, 0, 3, 1], 5)).toEqual([
      { start: 0, end: 0 },
      { start: 1, end: 2 },
      { start: 3, end: 4 },
    ]);
    expect(rangesFromStarts([], 3)).toEqual([{ start: 0, end: 2 }]);
  });
});

describe("split: merge selected ranges into one file", () => {
  it("yields ONE file holding every range's pages, in the order typed", async () => {
    const source = await makePdf([11, 12, 13, 14, 15, 16]);
    const out = await combineRanges(source, parseRanges("5-6, 1-2", 6));
    expect(await widths(out)).toEqual([15, 16, 11, 12]);
  });

  it("the default split of the same ranges is still one file per range (control)", async () => {
    const source = await makePdf([11, 12, 13, 14, 15, 16]);
    const parts = await splitPdf(
      source,
      buildSplitParts("doc", parseRanges("5-6, 1-2", 6)),
    );
    expect(parts.length).toBe(2);
  });
});
