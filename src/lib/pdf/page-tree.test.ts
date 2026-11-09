// @native-canvas
// Hostile lane l03: the page tree, checked and settled once after the parse
// (`./page-tree`), through every loader an engine uses. Each test is named
// for the matrix finding it closes; the inputs are the matrix's own builders.
//
// Before this module, pdf-lib "loaded" each of these files and every engine
// then met a raw TypeError / RangeError on its first page walk (shown to the
// user verbatim by runner-kit's errorMessage), or went on with ZERO pages and
// reported success.
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as lib from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import {
  errorMessage,
  failureCode,
} from "@/components/tools/runner/runner-kit";
import { readPageBoard } from "@/components/tools/runner/use-single-pdf";
import { getEditPageSizes } from "@/lib/pdf/edit";
import {
  getPageCount,
  getPageRotations,
  loadPdf,
  rotatePages,
  setPageRotations,
  UNREADABLE_PDF_MESSAGE,
} from "@/lib/pdf/engine";
import { nUpPdf } from "@/lib/pdf/n-up";
import { countPdfPagesDetailed } from "@/lib/pdf/page-count";
import { readPdfFrames } from "@/lib/pdf/page-frame";
import { addPageNumbers } from "@/lib/pdf/page-numbers";
import {
  DEFAULT_MEDIA_BOX,
  PAGE_TREE_FLATTEN_DEPTH,
  damagedPageMessage,
  settlePageTree,
} from "@/lib/pdf/page-tree";
import { countPagesWithPdfjs } from "@/lib/pdf/pdfjs-page-count";
import { probePdf } from "@/lib/pdf/probe";
import { splitPagesInHalf } from "@/lib/pdf/split-half";
import { malformedPdfs } from "@/tests/malformed-pdf-fixtures";
import { runBounded } from "@/tests/hostile/bounded";
import {
  mediaBoxHugePdf,
  numbersMediaBoxPdf,
  numbersRotatePdf,
  objectSelfRefPdf,
  objectStreamOnlyPdf,
  parentCyclePdf,
} from "@/tests/hostile/conversion-out.fixtures";
import {
  ONE_PAGE,
  deepPageTreeObjects,
  latin1,
  rawPdf,
  xrefStreamPdf,
} from "@/tests/hostile/page-structure.raw";
import {
  CONVERTERS,
  EDITORS,
  STAMPERS,
  all,
  each,
  editingInput,
  outcome,
  stamping,
} from "@/tests/hostile/page-tree.entries";

const MAX_BYTES = 50 * 1024 * 1024;

const require = createRequire(import.meta.url);
type Counter = Parameters<typeof countPagesWithPdfjs>[1];
let pdfjsPromise: ReturnType<NonNullable<Counter>> | null = null;
/** pdf.js, the reader a user's viewer (and our own preview) is. */
const counter: Counter = () =>
  (pdfjsPromise ??= import(
    /* @vite-ignore */ pathToFileURL(
      require.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
    ).href
  ) as ReturnType<NonNullable<Counter>>);

const UNREADABLE = {
  kind: "refused",
  message: UNREADABLE_PDF_MESSAGE,
  unreadable: true,
} as const;
const DAMAGED_PAGE_1 = {
  kind: "refused",
  message: damagedPageMessage(1),
  unreadable: true,
} as const;

/**
 * The stampers' refusal of an unusable file. `overlay-top` reads the hostile
 * file as the OVERLAY, and its own loader (overlay.ts loadOverlay) restates
 * the refusal about the overlay — the right file, in its own words — and
 * keeps its kind.
 *
 * Inverted 2026-11-09 (l03#49): this used to pin `unreadable: false` and one
 * sentence for every refusal, because loadOverlay flattened them all; a
 * page-tree refusal then reached telemetry as unprocessable_entity and a
 * damaged page lost its number.
 */
const OVERLAY_REFUSAL = new Map<object, object>([
  [
    UNREADABLE,
    {
      kind: "refused",
      message:
        "The overlay file couldn't be read as a PDF — it may be corrupted or not a PDF.",
      unreadable: true,
    },
  ],
  [
    DAMAGED_PAGE_1,
    {
      kind: "refused",
      message:
        "Page 1 of the overlay PDF is damaged and couldn't be read, so this file can't be processed without losing that page.",
      unreadable: true,
    },
  ],
]);
const stampersRefuse = (refusal: object) => ({
  ...all(STAMPERS, refusal),
  "overlay-top": OVERLAY_REFUSAL.get(refusal)!,
});

/**
 * Every /Kids-cycle fixture through every entry point, in ONE bounded child
 * (`page-tree-cycles.child.ts`): the walk's visited set is all that stands
 * between a cycle and an endless loop, so a regression must fail a test, not
 * hang or crash the run. Keyed by fixture, then by entry point.
 */
type CycleMap = Record<string, Record<string, unknown>>;
let cycles: CycleMap;
beforeAll(async () => {
  const r = await runBounded(
    "src/tests/hostile/page-tree-cycles.child.ts",
    [],
    120_000,
  );
  if (r.kind !== "settled") {
    throw new Error(`cycle child did not settle: ${JSON.stringify(r)}`);
  }
  cycles = r.value as CycleMap;
}, 150_000);

/** The child's map for one fixture, held to its pinned size first. */
function cyclesOf(fixture: string): Record<string, unknown> {
  const map = cycles[fixture];
  expect(map, fixture).toBeDefined();
  // 3 gates + 9 stampers + 7 editors + 4 converters + 4 readers.
  expect(Object.keys(map!)).toHaveLength(27);
  return map!;
}

/** What a cyclic tree gets from every family: the unreadable-file words. */
const cycleRefused = () => ({
  ...all({ loadPdf: 0, getPageCount: 0, getPageRotations: 0 }, UNREADABLE),
  ...stampersRefuse(UNREADABLE),
  ...all(EDITORS, UNREADABLE),
  ...all(CONVERTERS, UNREADABLE),
  readPageBoard: { message: UNREADABLE_PDF_MESSAGE, code: "unreadable_input" },
  probe: "unreadable",
  count: { ok: false, unknown: "unparseable" },
  // `frames` is recorded as "output" when readPdfFrames returned null.
  frames: { kind: "output" },
});

/* ------------------------------------------------------------------ *
 *  Health: the real-producer corpus is left exactly as parsed
 * ------------------------------------------------------------------ */

const CORPUS = path.join(process.cwd(), "src/tests/fixtures/legit-corpus");
const corpus = readdirSync(CORPUS).filter((f) => f.endsWith(".pdf"));

describe("page tree: positive control", () => {
  it("the real-producer corpus is all here, and every file is untouched", async () => {
    // A corpus that quietly shrank would make "zero repairs" vacuous.
    expect(corpus.length).toBeGreaterThanOrEqual(14);
    let deepest = 0;
    for (const file of corpus) {
      const doc = await lib.PDFDocument.load(
        readFileSync(path.join(CORPUS, file)),
      );
      const verdict = settlePageTree(lib, doc);
      expect(verdict, file).toMatchObject({ ok: true, repaired: [] });
      if (verdict.ok) deepest = Math.max(deepest, verdict.depth);
    }
    // The flatten threshold sits far above anything a real producer wrote.
    expect(deepest).toBeGreaterThanOrEqual(1);
    expect(deepest * 10).toBeLessThanOrEqual(PAGE_TREE_FLATTEN_DEPTH);
  });

  it("the flatten threshold is far below where pdf-lib's own recursion fails", async () => {
    // Second, independent bound on the constant: pdf-lib, with NO help from
    // us, still walks a tree 4x the threshold. The threshold is a margin,
    // not the edge (measured overflow: between 6,000 and 8,000 in Node 24).
    const deep = PAGE_TREE_FLATTEN_DEPTH * 4;
    const doc = await lib.PDFDocument.load(
      rawPdf({ objects: deepPageTreeObjects(deep) }),
    );
    expect(doc.getPageCount()).toBe(1);
  });

  it("a tree at the threshold is left as it is; one level deeper is flattened", async () => {
    const at = await lib.PDFDocument.load(
      rawPdf({ objects: deepPageTreeObjects(PAGE_TREE_FLATTEN_DEPTH) }),
    );
    expect(settlePageTree(lib, at)).toMatchObject({
      ok: true,
      depth: PAGE_TREE_FLATTEN_DEPTH,
      repaired: [],
    });
    const over = await lib.PDFDocument.load(
      rawPdf({ objects: deepPageTreeObjects(PAGE_TREE_FLATTEN_DEPTH + 1) }),
    );
    expect(settlePageTree(lib, over)).toMatchObject({
      ok: true,
      pages: 1,
      repaired: ["depth"],
    });
  });

  it("a page with no /MediaBox anywhere gets pdf.js's US Letter default", async () => {
    const bytes = rawPdf({
      objects: [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R >>",
      ],
    });
    const doc = await loadPdf(bytes);
    const { width, height } = doc.getPage(0).getSize();
    expect([width, height]).toEqual([
      DEFAULT_MEDIA_BOX[2],
      DEFAULT_MEDIA_BOX[3],
    ]);
  });
});

/* ------------------------------------------------------------------ *
 *  Page-structure family
 * ------------------------------------------------------------------ */

describe("page tree: page-structure findings", () => {
  const CAT = "<< /Type /Catalog /Pages 2 0 R >>";
  const PAGE3 = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>";

  it("PS-03: a /Kids cycle is refused in the unreadable-file words, not a RangeError", () => {
    expect(cyclesOf("ps03-two-nodes")).toEqual(cycleRefused());
    expect(cyclesOf("ps03-self-kid")).toEqual(cycleRefused());
  });

  it("PS-03: a page whose /Parent is itself is read, as pdf.js reads it", async () => {
    const parentSelf = rawPdf({
      objects: [
        CAT,
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 3 0 R /MediaBox [0 0 200 200] >>",
      ],
    });
    expect(await getPageRotations(parentSelf)).toEqual([0]);
    expect(await countPagesWithPdfjs(parentSelf, counter)).toBe(1);
  });

  it("PS-05: a /Kids chain 50,000 deep settles (flattened to its one page), in a bounded child", async () => {
    const bound = 90_000;
    for (const entry of ["getPageCount", "count", "probe"]) {
      const r = await runBounded(
        "src/tests/hostile/page-tree-deep.child.ts",
        [entry, "50000"],
        bound,
      );
      expect(r, entry).toMatchObject({ kind: "settled" });
      const value = (r as { value: unknown }).value;
      expect(value, entry).toEqual({
        settled: entry === "count" ? { ok: true, count: 1 } : 1,
      });
    }
  }, 300_000);

  it("PS-06: header-only and a lying object stream are refused in the unreadable-file words", async () => {
    const headerOnly = latin1("%PDF-1.7\n");
    const nLies = xrefStreamPdf({
      objects: ONE_PAGE,
      pack: [1, 2, 3],
      objStmN: "5000",
    });
    for (const bytes of [headerOnly, nLies]) {
      expect(await outcome(() => getPageRotations(bytes))).toEqual(UNREADABLE);
      expect(
        await outcome(async () => (await loadPdf(bytes)).getPageCount()),
      ).toEqual(UNREADABLE);
    }
  });

  it("PS-07: a /CropBox and /Resources that are references to themselves are read as absent", async () => {
    const bytes = rawPdf({
      objects: [
        CAT,
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources 5 0 R /CropBox 6 0 R /Contents 4 0 R >>",
        { dict: "", stream: latin1("0 0 m 100 100 l S") },
        "5 0 R",
        "6 0 R",
      ],
    });
    const nUp = await nUpPdf(bytes, {
      perSheet: 2,
      sheet: "a4",
      orientation: "portrait",
      order: "across",
      margin: "none",
      borders: false,
      rtl: false,
    });
    expect(await countPagesWithPdfjs(nUp.bytes, counter)).toBe(1);
    const halves = await splitPagesInHalf(bytes, {
      direction: "left-right",
      order: "left-first",
    });
    expect(await countPagesWithPdfjs(halves.bytes, counter)).toBe(2);
  });

  it("PS-09: a page pdf-lib could not parse is never zero pages: every gate refuses and names it", async () => {
    for (const box of ["[0 0 1e309 792]", "[-0 . --5 99999999999999999999]"]) {
      const bytes = rawPdf({
        objects: [
          CAT,
          "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
          `<< /Type /Page /Parent 2 0 R /MediaBox ${box} >>`,
        ],
      });
      expect(await outcome(() => getPageCount(bytes))).toEqual(DAMAGED_PAGE_1);
      expect(await outcome(() => getPageRotations(bytes))).toEqual(
        DAMAGED_PAGE_1,
      );
      expect(await outcome(() => setPageRotations(bytes, []))).toEqual(
        DAMAGED_PAGE_1,
      );
      expect(await probePdf(bytes, { maxBytes: MAX_BYTES })).toMatchObject({
        read: "unreadable",
      });
      expect(await countPdfPagesDetailed(bytes, MAX_BYTES)).toEqual({
        ok: false,
        unknown: "unparseable",
      });
    }
  });

  it("l03#48: an empty /Pages (/Kids [] /Count 0) is refused everywhere, never a blank-page success", async () => {
    // Before: pdf-lib loaded it as a 0-page document, and its save adds a
    // blank page, so watermark / page numbers / Bates handed back a 1-page
    // blank "stamped" PDF as a success, the signer said "Choose a page that
    // exists", crop said "Select at least one page" (blaming the user), and
    // probePdf read it as `ok` with 0 pages. pdf.js already refused it.
    const empty = rawPdf({
      objects: [CAT, "<< /Type /Pages /Kids [] /Count 0 >>"],
    });
    for (const run of [loadPdf, getPageCount, getPageRotations]) {
      expect(await outcome(() => run(empty.slice())), run.name).toEqual(
        UNREADABLE,
      );
    }
    expect(await each(STAMPERS, empty)).toEqual(stampersRefuse(UNREADABLE));
    expect(await each(EDITORS, empty)).toEqual(all(EDITORS, UNREADABLE));
    expect(await each(CONVERTERS, empty)).toEqual(all(CONVERTERS, UNREADABLE));
    expect(await probePdf(empty, { maxBytes: MAX_BYTES })).toMatchObject({
      read: "unreadable",
    });
    expect(await readPdfFrames(empty)).toBeNull();
    // Consistent with the pdf.js side, which refuses the same file.
    await expect(countPagesWithPdfjs(empty, counter)).rejects.toThrow();
    // The page counter still reports it as the fact it is, not as damage.
    expect(await countPdfPagesDetailed(empty, MAX_BYTES)).toEqual({
      ok: false,
      unknown: "zero-pages",
    });
    // Positive control: the same file with its one page is read.
    const one = rawPdf({
      objects: [CAT, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", PAGE3],
    });
    expect(await getPageCount(one)).toBe(1);
    expect(await probePdf(one, { maxBytes: MAX_BYTES })).toMatchObject({
      read: "ok",
      pages: 1,
    });
  });

  it("PS-12: rotating a file with a lying /Count writes one pdf.js can open", async () => {
    for (const count of ["-1", "0"]) {
      const bytes = rawPdf({
        objects: [
          CAT,
          `<< /Type /Pages /Kids [3 0 R] /Count ${count} >>`,
          PAGE3,
        ],
      });
      const out = await rotatePages(bytes, [0], 90);
      expect(await countPagesWithPdfjs(out, counter)).toBe(1);
      const inPlace = await setPageRotations(bytes, [90]);
      expect(await countPagesWithPdfjs(inPlace, counter)).toBe(1);
    }
  });
});

/* ------------------------------------------------------------------ *
 *  Stamping family
 * ------------------------------------------------------------------ */

describe("page tree: stamping findings", () => {
  it("STAMP-01: a header-only file is refused by all nine stampers in the unreadable-file words", async () => {
    const results = await each(STAMPERS, await stamping("H03-header-only"));
    expect(results).toEqual(stampersRefuse(UNREADABLE));
  });

  it("STAMP-02: /Kids containing its own node is refused by all nine, never a RangeError", () => {
    expect(cyclesOf("stamp02-kids-contain-self")).toEqual(cycleRefused());
  });

  it("STAMP-03: a page whose /Parent is itself is stamped, and the output opens as one page", async () => {
    const bytes = await stamping("H07-page-parent-self");
    const results = await each(STAMPERS, bytes);
    expect(results).toEqual(all(STAMPERS, { kind: "output" }));
    expect(
      await countPagesWithPdfjs(await addPageNumbers(bytes), counter),
    ).toBe(1);
  });

  it("STAMP-04: a /Contents that is a reference to itself is stamped onto an empty page", async () => {
    const bytes = await stamping("H07-contents-self-ref");
    const results = await each(STAMPERS, bytes);
    expect(results).toEqual({
      ...all(STAMPERS, { kind: "output" }),
      // As the overlay, the page has no content left: an honest refusal.
      "overlay-top": {
        kind: "refused",
        message: "Overlay page 1 is blank, so there is nothing to overlay.",
        unreadable: false,
      },
    });
  });

  it("STAMP-05: a numeric /Pages is refused as unreadable; a numeric /XObject is read as absent", async () => {
    const [pagesNumber, xobjectNumber] = await malformedPdfs();
    expect(await each(STAMPERS, pagesNumber!)).toEqual(
      stampersRefuse(UNREADABLE),
    );
    expect(await each(STAMPERS, xobjectNumber!)).toEqual(
      all(STAMPERS, { kind: "output" }),
    );
  });

  it("STAMP-06: a page pdf-lib could not parse is refused by name, never a zero-page success", async () => {
    for (const id of [
      "H18-mediabox-1e309",
      "H18-mediabox-dot",
      "H18-mediabox-double-minus",
      "H18-rotate-1e309",
    ]) {
      const results = await each(STAMPERS, await stamping(id));
      expect(results, id).toEqual(stampersRefuse(DAMAGED_PAGE_1));
    }
  });

  it("STAMP-07: the refusal blames the damaged page, not the user's settings", async () => {
    const bytes = await stamping("H18-mediabox-dot");
    for (const run of [
      STAMPERS["header-footer"]!,
      STAMPERS["overlay-base"]!,
      STAMPERS["sign-typed"]!,
    ]) {
      const r = await outcome(() => run(bytes));
      expect(r).toEqual(DAMAGED_PAGE_1);
      // The sentences that used to fire on a parse loss.
      expect((r as { message: string }).message).not.toMatch(
        /page settings|Choose a page that exists|has no pages/,
      );
    }
  });

  it("STAMP-11: a stamped file with /Count -1 comes out with a /Count pdf.js can open", async () => {
    const bytes = await stamping("H09-count-negative");
    for (const run of [
      STAMPERS["page-numbers"]!,
      STAMPERS["watermark-text"]!,
      STAMPERS["header-footer"]!,
      STAMPERS["sign-typed"]!,
    ]) {
      const result = (await run(bytes)) as Uint8Array | { bytes: Uint8Array };
      const out = result instanceof Uint8Array ? result : result.bytes;
      expect(await countPagesWithPdfjs(out, counter)).toBe(1);
    }
  });
});

/* ------------------------------------------------------------------ *
 *  Conversion-out family
 * ------------------------------------------------------------------ */

describe("page tree: conversion-out findings", () => {
  it("CO-01: compress never writes a document whose page pdf-lib dropped; images and redact refuse too", async () => {
    for (const build of [
      mediaBoxHugePdf,
      numbersMediaBoxPdf,
      numbersRotatePdf,
    ]) {
      const bytes = build();
      const results = await each(CONVERTERS, bytes);
      expect(results, build.name).toEqual(all(CONVERTERS, DAMAGED_PAGE_1));
    }
  });

  it("CO-09: header-only, a lying object stream, and numeric /Pages are typed refusals", async () => {
    const [pagesNumber] = await malformedPdfs();
    for (const bytes of [
      latin1("%PDF-1.7\n"),
      objectStreamOnlyPdf({ n: 50 }),
      pagesNumber!,
      objectSelfRefPdf(),
    ]) {
      const results = await each(CONVERTERS, bytes);
      for (const [name, r] of Object.entries(results)) {
        // Never the raw TypeError / "Expected instance of" text.
        expect(r.kind, name).not.toBe("raw");
        if (r.kind === "refused") expect(r.unreadable, name).toBe(true);
      }
    }
  });

  it("CO-10: a page-tree cycle is refused, a /Parent cycle is repaired: never a RangeError", async () => {
    expect(cyclesOf("co10-kids-self")).toEqual(cycleRefused());
    const parent = await each(CONVERTERS, parentCyclePdf());
    expect(parent).toEqual({
      ...all(CONVERTERS, { kind: "output" }),
      // The redaction raster is pdf.js reading the ORIGINAL bytes (whose
      // root /Parent points at the page); it refuses in its own typed words.
      redactPdf: {
        kind: "refused",
        message: "No pages could be rendered from this PDF.",
        unreadable: false,
      },
    });
  });
});

/* ------------------------------------------------------------------ *
 *  Editing family
 * ------------------------------------------------------------------ */

describe("page tree: editing findings", () => {
  it("EDIT-01: a /Kids cycle is refused by every editor; a /Parent cycle is edited", async () => {
    expect(cyclesOf("edit01-kids-contains-self")).toEqual(cycleRefused());
    const parent = await each(
      EDITORS,
      await editingInput("H07-page-parent-self"),
    );
    expect(parent).toEqual(all(EDITORS, { kind: "output" }));
    expect(
      await getEditPageSizes(await editingInput("H07-page-parent-self")),
    ).toHaveLength(1);
  });

  it("EDIT-03: header-only and lying object streams are refused in the unreadable-file words", async () => {
    for (const id of [
      "H03-header-only",
      "H23-objstm-n-lies",
      "H23-objstm-first-past-end",
    ]) {
      const results = await each(EDITORS, await editingInput(id));
      expect(results, id).toEqual(all(EDITORS, UNREADABLE));
    }
  });

  it("EDIT-04: /Pages pointing at a reference to itself is refused, remove-all included", async () => {
    const results = await each(
      EDITORS,
      await editingInput("H07-pages-is-self-ref"),
    );
    expect(results).toEqual(all(EDITORS, UNREADABLE));
  });

  it("EDIT-05: a page with an unparseable number is never a zero-page document", async () => {
    for (const id of [
      "H18-mediabox-1e309",
      "H18-mediabox-dot",
      "H18-mediabox-double-minus",
      "H18-rotate-1e309",
      "H18-cropbox-dot-minus",
    ]) {
      const results = await each(EDITORS, await editingInput(id));
      expect(results, id).toEqual(all(EDITORS, DAMAGED_PAGE_1));
    }
  });
});

/* ------------------------------------------------------------------ *
 *  The composed chain: what the upload step shows
 * ------------------------------------------------------------------ */

describe("page tree: the single-PDF upload gate shows the friendly words", () => {
  it("readPageBoard (reader pdf-lib) through errorMessage and failureCode", async () => {
    const cases: [string, Uint8Array, string][] = [
      [
        "header-only",
        await stamping("H03-header-only"),
        UNREADABLE_PDF_MESSAGE,
      ],
      [
        "pages self-ref",
        await editingInput("H07-pages-is-self-ref"),
        UNREADABLE_PDF_MESSAGE,
      ],
      [
        "unparsed page",
        await stamping("H18-mediabox-1e309"),
        damagedPageMessage(1),
      ],
    ];
    for (const [what, bytes, words] of cases) {
      const err = await readPageBoard(bytes, "pdf-lib").then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, what).not.toBeNull();
      expect(errorMessage(err), what).toBe(words);
      expect(failureCode(err), what).toBe("unreadable_input");
    }
    // And the repaired files open with their page.
    expect(
      await readPageBoard(await stamping("H07-page-parent-self"), "pdf-lib"),
    ).toEqual({ pageCount: 1, rotations: [0] });
  });

  it("probePdf and readPdfFrames: never-throws readers answer, and agree with the gate", async () => {
    // (The /Kids cycle is read by these same readers in the cycle child.)
    for (const id of ["H03-header-only", "H18-mediabox-1e309"]) {
      const bytes = await stamping(id);
      expect(await probePdf(bytes, { maxBytes: MAX_BYTES }), id).toMatchObject({
        read: "unreadable",
      });
      expect(await readPdfFrames(bytes), id).toBeNull();
    }
    const repaired = await stamping("H07-page-parent-self");
    expect(await probePdf(repaired, { maxBytes: MAX_BYTES })).toMatchObject({
      read: "ok",
      pages: 1,
    });
    expect((await readPdfFrames(repaired))?.frames).toHaveLength(1);
  });
});

describe("damagedPageMessage", () => {
  it("names the page it is given", () => {
    expect(damagedPageMessage(7)).toContain("Page 7 ");
    expect(damagedPageMessage(1)).not.toBe(damagedPageMessage(2));
  });
});
