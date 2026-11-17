// @native-canvas
import { describe, expect, it } from "vitest";
import {
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
} from "pdf-lib";
import { mergePdfs } from "./engine";
import type { MergePageRef } from "./merge-pages";
import { extractPdfText, type PdfTextReader } from "./text";
import {
  makeStructuredPdf,
  STRUCTURED_FIELD_NAME,
  STRUCTURED_FIELD_VALUE,
} from "@/tests/fixtures-structured-pdf";

/**
 * Merge PDF's Arrange pages: `mergePdfs(files, { order })`. Every assertion
 * re-opens the SAVED bytes; a page is known by its WIDTH (unique per page of
 * a fixture), a rotation by `getRotation().angle`, a bookmark or contents
 * line by the output page its /Dest opens, a footer by pdf.js's text.
 */

const legacy: PdfTextReader = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Awaited<
    ReturnType<PdfTextReader>
  >;

interface PageSpec {
  width: number;
  rotate?: number;
}

async function makePdf(
  pages: (number | PageSpec)[],
  bookmark?: { title: string; page: number },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const spec of pages) {
    const { width, rotate } =
      typeof spec === "number" ? { width: spec, rotate: 0 } : spec;
    const page = doc.addPage([width, 400]);
    if (rotate) page.setRotation(degrees(rotate));
  }
  if (bookmark) {
    const ctx = doc.context;
    const root = ctx.nextRef();
    const item = ctx.nextRef();
    ctx.assign(
      item,
      ctx.obj({
        Title: PDFString.of(bookmark.title),
        Parent: root,
        Dest: [doc.getPage(bookmark.page).ref, PDFName.of("Fit")],
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

async function rotations(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => p.getRotation().angle);
}

/** Bookmarks, depth first: [title, 0-based output page, depth]. */
async function outline(bytes: Uint8Array): Promise<[string, number, number][]> {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const index = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i]));
  const out: [string, number, number][] = [];
  const walk = (first: unknown, depth: number) => {
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
        depth,
      ]);
      walk(cur.get(PDFName.of("First")), depth + 1);
      const next = cur.get(PDFName.of("Next"));
      cur = next instanceof PDFRef ? ctx.lookup(next) : undefined;
    }
  };
  const root = doc.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  if (root) walk(root.get(PDFName.of("First")), 0);
  return out;
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
    const dest = a.lookup(PDFName.of("Dest"), PDFArray);
    const head = dest.get(0);
    return head instanceof PDFRef ? (index.get(head.toString()) ?? -1) : -2;
  });
}

/** Where pdf.js draws `name` on page `index`, in the reader's view. */
async function namePlace(bytes: Uint8Array, index: number, name: string) {
  const lib = await legacy();
  const doc = await lib.getDocument({ data: bytes.slice(), verbosity: 0 })
    .promise;
  const page = await doc.getPage(index + 1);
  const viewport = page.getViewport({ scale: 1 });
  const items = (await page.getTextContent()).items.filter(
    (i) => "str" in i && i.str === name,
  ) as { transform: number[] }[];
  expect(items, `"${name}" on page ${index + 1}`).toHaveLength(1);
  const [x, y] = viewport.convertToViewportPoint(
    items[0]!.transform[4]!,
    items[0]!.transform[5]!,
  );

  return { x, y, width: viewport.width, height: viewport.height };
}

const EM_DASH = String.fromCodePoint(0x2014);

const ref = (file: number, page: number, rotation?: number): MergePageRef =>
  rotation === undefined ? { file, page } : { file, page, rotation };

describe("merge: Arrange pages (order)", () => {
  it("1. interleaves pages of two files in the order given", async () => {
    const a = await makePdf([11, 12, 13]);
    const b = await makePdf([21, 22]);
    // Files are listed in the order their first pages appear: b, then a.
    const out = await mergePdfs([b, a], {
      order: [ref(0, 0), ref(1, 0), ref(1, 2), ref(0, 1)],
    });
    expect(await widths(out)).toEqual([21, 11, 13, 22]);
  });

  it("2. orders pages inside one file; `pages` still never reorders (control)", async () => {
    const a = await makePdf([11, 12, 13]);
    expect(
      await widths(await mergePdfs([a], { order: [ref(0, 2), ref(0, 0)] })),
    ).toEqual([13, 11]);
    expect(await widths(await mergePdfs([a], { pages: [[2, 0]] }))).toEqual([
      11, 13,
    ]);
  });

  it("3. sets the absolute rotation given, and leaves a page with none as it was", async () => {
    const a = await makePdf([
      11,
      { width: 12, rotate: 270 },
      { width: 13, rotate: 180 },
    ]);
    const out = await mergePdfs([a], {
      order: [ref(0, 0, 90), ref(0, 1, 0), ref(0, 2)],
    });
    expect(await widths(out)).toEqual([11, 12, 13]);
    expect(await rotations(out)).toEqual([90, 0, 180]);
    // A NaN is refused with the engine's own sentence, not pdf-lib's.
    await expect(
      mergePdfs([a], { order: [ref(0, 0, Number.NaN), ref(0, 1)] }),
    ).rejects.toThrow(/Each page rotation must be a number of degrees/);
  });

  it("3b. a rotation survives an interleaving move", async () => {
    const a = await makePdf([11, 12]);
    const b = await makePdf([21]);
    const out = await mergePdfs([a, b], {
      order: [ref(0, 0), ref(1, 0, 90), ref(0, 1, 270)],
    });
    expect(await widths(out)).toEqual([11, 21, 12]);
    expect(await rotations(out)).toEqual([0, 90, 270]);
  });

  it("4. refuses an order it cannot follow", async () => {
    const a = await makePdf([11, 12]);
    const b = await makePdf([21, 22]);
    const files = [a, b];
    await expect(
      mergePdfs(files, { order: [ref(0, 0), ref(0, 0), ref(1, 0)] }),
    ).rejects.toThrow(/twice/);
    await expect(
      mergePdfs(files, { order: [ref(0, 0), ref(1, 5)] }),
    ).rejects.toThrow(/out of range/);
    await expect(
      mergePdfs(files, { order: [ref(0, 0), ref(2, 0)] }),
    ).rejects.toThrow(/not given/);
    await expect(
      mergePdfs(files, { order: [ref(0, 0), ref(0, 1)] }),
    ).rejects.toThrow(
      `File 2 has no pages selected ${EM_DASH} choose at least one page or remove it.`,
    );
    await expect(
      mergePdfs(files, { order: [ref(1, 0), ref(0, 0)] }),
    ).rejects.toThrow(/order their first pages appear/);
    await expect(
      mergePdfs(files, {
        order: [ref(0, 0), ref(1, 0)],
        pages: [[0], [0]],
      }),
    ).rejects.toThrow(/either pages or order/);
    const mixed = [ref(0, 0), ref(1, 0), ref(0, 1)];
    for (const option of [
      { fileBookmarks: ["a", "b"] },
      { contentsPage: ["a", "b"] },
      { blankAfterOdd: true },
    ]) {
      await expect(
        mergePdfs(files, { order: mixed, ...option }),
        JSON.stringify(option),
      ).rejects.toThrow(/each file's pages to be together/);
      // Control: the same option with the files kept together is taken.
      await expect(
        mergePdfs(files, {
          order: [ref(0, 1), ref(0, 0), ref(1, 0)],
          ...option,
        }),
      ).resolves.toBeInstanceOf(Uint8Array);
    }
  });

  it("5. a bookmark for each file opens its run's first page; a file's own bookmark follows its page", async () => {
    const a = await makePdf([11, 12, 13]);
    const b = await makePdf([21, 22]);
    const grouped = await mergePdfs([b, a], {
      order: [ref(0, 1), ref(0, 0), ref(1, 0)],
      fileBookmarks: ["b", "a"],
    });
    expect(await widths(grouped)).toEqual([22, 21, 11]);
    expect(
      (await outline(grouped)).filter(([, , depth]) => depth === 0),
    ).toEqual([
      ["b", 0, 0],
      ["a", 2, 0],
    ]);
    // A source bookmark on a's third page, after an interleaving move.
    const marked = await makePdf([11, 12, 13], { title: "Total", page: 2 });
    const mixed = await mergePdfs([marked, b], {
      order: [ref(0, 0), ref(1, 0), ref(0, 2), ref(1, 1)],
    });
    expect(await widths(mixed)).toEqual([11, 21, 13, 22]);
    expect(await outline(mixed)).toEqual([["Total", 2, 0]]);
  });

  it("6. a form field on a moved page stays in the form, on that page", async () => {
    const form = await makeStructuredPdf(2);
    const other = await makePdf([21, 22]);
    const out = await mergePdfs([other, form], {
      order: [ref(0, 0), ref(1, 0), ref(0, 1), ref(1, 1)],
    });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(4);
    const field = doc.getForm().getTextField(STRUCTURED_FIELD_NAME);
    expect(field.getText()).toBe(STRUCTURED_FIELD_VALUE);
    const widget = field.acroField.getWidgets()[0]!;
    const widgetRef = doc.context.getObjectRef(widget.dict);
    const onPage = doc
      .getPages()
      .findIndex((p) =>
        (p.node.lookupMaybe(PDFName.of("Annots"), PDFArray)?.asArray() ?? [])
          .map(String)
          .includes(String(widgetRef)),
      );
    expect(onPage).toBe(1);
    expect(widget.P()?.toString()).toBe(doc.getPage(1).ref.toString());
  });

  it("7. grouped and reordered runs: blanks after each odd run but the last, contents lines at each run's start", async () => {
    const a = await makePdf([11, 12, 13]);
    const b = await makePdf([21, 22]);
    const c = await makePdf([31]);
    const out = await mergePdfs([a, b, c], {
      order: [ref(0, 2), ref(0, 0), ref(1, 1), ref(2, 0)],
      blankAfterOdd: true,
      contentsPage: ["a", "b", "c"],
    });
    const w = await widths(out);
    // Contents page (and its pad), a's two pages (even: no pad), b's one
    // page (odd: padded), then c, last, unpadded.
    const body = w.slice(w.indexOf(13));
    expect(body).toEqual([13, 11, 22, 22, 31]);
    expect(await linkTargets(out, 0)).toEqual([
      w.indexOf(13),
      w.indexOf(22),
      w.indexOf(31),
    ]);
  });

  it("8. the file name is stamped after the turn, at the corner the reader sees, on interleaved pages", async () => {
    const a = await makePdf([300, 310]);
    const b = await makePdf([320]);
    const turnedSource = await makePdf([{ width: 330, rotate: 90 }]);
    const out = await mergePdfs([a, b], {
      order: [ref(0, 0), ref(1, 0, 90), ref(0, 1)],
      fileNames: ["alpha", "beta"],
    });
    const { pages } = await extractPdfText(out, legacy);
    expect(pages.map((p) => p.text.trim())).toEqual(["alpha", "beta", "alpha"]);
    expect(await rotations(out)).toEqual([0, 90, 0]);
    // Bottom left as the page is SHOWN, like a page already at /Rotate 90.
    const turned = await namePlace(out, 1, "beta");
    const control = await namePlace(
      await mergePdfs([turnedSource], { fileNames: ["gamma"] }),
      0,
      "gamma",
    );
    for (const place of [turned, control]) {
      expect(place.width).toBeGreaterThan(place.height);
      expect(place.x).toBeLessThan(60);
      expect(place.y).toBeGreaterThan(place.height - 40);
    }
  });

  it("9. an order equal to the file-mode concatenation gives what `pages` gives", async () => {
    const a = await makePdf([11, 12, 13], { title: "A3", page: 2 });
    const b = await makePdf([21, 22]);
    const viaPages = await mergePdfs([a, b], {
      pages: [[0, 2], undefined],
      fileBookmarks: ["a", "b"],
    });
    const viaOrder = await mergePdfs([a, b], {
      order: [ref(0, 0), ref(0, 2), ref(1, 0), ref(1, 1)],
      fileBookmarks: ["a", "b"],
    });
    expect(await widths(viaOrder)).toEqual(await widths(viaPages));
    expect(await widths(viaOrder)).toEqual([11, 13, 21, 22]);
    expect(await outline(viaOrder)).toEqual(await outline(viaPages));
    expect((await outline(viaOrder)).length).toBe(3);
  });
});
