// Lane l01 of the hostile-input matrix: pdf-lib decoded and parsed with no
// bounds. A 451-byte xref stream hung every pdf-lib entry point forever
// (PS-01), and files of a few KB to 1 MB inflated to GiBs inside object
// streams (STAMP-12), xref streams (SIB-04), embedded content streams (PS-02,
// STAMP-13), the inline-image scan (CO-07) and the XMP packet (EDIT-11).
//
// Every case runs in a child process (runBounded): pdf-lib parses
// synchronously, so an in-process hang would block vitest forever, and a
// memory bomb would take the test runner down with it. The child reports its
// own peak-RSS growth, so a bomb that is "handled" by decoding all of it first
// still fails here.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, PDFName } from "pdf-lib";
import { afterAll, describe, expect, test } from "vitest";
import { DEFAULT_DECODE_BUDGET_BYTES } from "@/lib/pdf/decode-budget";
import { runBounded, type BoundedOutcome } from "./bounded";
import {
  chainedFlateBombPdf,
  imageBombAtCapPdf,
} from "./conversion-out.fixtures";
import {
  ONE_PAGE,
  rawPdf,
  reflate,
  xrefStreamPdf as psXrefStreamPdf,
  zeroBomb,
} from "./page-structure.raw";
import { xrefStreamPdf as sibXrefStreamPdf } from "./security-in-browser.fixtures";
import { STAMPING_INPUTS, objStmBomb } from "./stamping.fixtures";

const CHILD = "src/tests/hostile/decode-budget.child.ts";
const DIR = mkdtempSync(path.join(tmpdir(), "pdfxyz-l01-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

let seq = 0;
async function run(
  entry: string,
  bytes: Uint8Array,
  boundMs = 60_000,
): Promise<BoundedOutcome> {
  const file = path.join(DIR, `${(seq += 1)}-${entry}.pdf`);
  writeFileSync(file, bytes);
  return runBounded(CHILD, [entry, file], boundMs);
}

interface Settled {
  ok?: Record<string, unknown>;
  error?: string;
  message?: string;
  growthMb: number;
}
function settled(r: BoundedOutcome): Settled {
  // A hang, a crash or an OOM is the defect itself; say which.
  expect(r.kind, JSON.stringify(r)).toBe("settled");
  return (r as { value: Settled }).value;
}

const MiB = 1024 * 1024;
const BUDGET_MB = DEFAULT_DECODE_BUDGET_BYTES / MiB;
/**
 * The most a refused bomb may cost. The decode buffer grows by doubling up to
 * the budget, so the old half and the new whole are briefly alive together
 * (1.5 x budget), plus slack for the runtime. Before the fix every case here
 * measured 1,000-2,150 MB, or never finished.
 */
const REFUSED_BOMB_MB = BUDGET_MB * 1.5 + 128;

/** A one-page PDF whose page content is `stream` under `filter`. */
const pageWithContent = (filter: string, stream: Uint8Array) =>
  rawPdf({
    objects: [...ONE_PAGE.slice(0, 3), { dict: `/Filter ${filter}`, stream }],
  });

describe("PS-01: an xref stream /W with a 20-digit width", () => {
  const hostile = psXrefStreamPdf({
    objects: ONE_PAGE,
    w: "[1 99999999999999999999 2]",
  });
  const control = psXrefStreamPdf({ objects: ONE_PAGE });

  // pdf.js reads this file as a 1-page document. pdf-lib never uses the xref
  // stream's entries (it parses objects in file order), so the right answer is
  // the same page, at once.
  for (const entry of ["load", "rotations"]) {
    test(`PS-01: ${entry} recovers the page instead of hanging`, async () => {
      expect(settled(await run(entry, control, 20_000)).ok).toEqual({
        pages: 1,
      });
      expect(settled(await run(entry, hostile, 20_000)).ok).toEqual({
        pages: 1,
      });
    }, 60_000);
  }
  test("PS-01: countPdfPagesDetailed and probePdf (documented never to throw) return", async () => {
    expect(settled(await run("count", hostile, 20_000)).ok).toEqual({
      ok: true,
      count: 1,
    });
    expect(settled(await run("probe", hostile, 20_000)).ok).toMatchObject({
      read: "ok",
      pages: 1,
    });
  }, 60_000);
});

describe("SIB-04: xref streams that declare or inflate far past the file", () => {
  test("SIB-04: a 1 GiB Flate bomb as the xref stream body loads without inflating it", async () => {
    const bomb = sibXrefStreamPdf({
      objects: ONE_PAGE,
      xrefBody: zeroBomb(1024),
      xrefDict: "/Filter /FlateDecode",
    });
    const r = settled(await run("load", bomb));
    expect(r.ok).toEqual({ pages: 1 });
    // Before: +1,111 MiB. The xref rows the parser could use are 35 bytes.
    expect(r.growthMb).toBeLessThan(150);
  }, 90_000);

  test("SIB-04: /W [0 0 0] over 2^31 entries loads, bounded", async () => {
    const r = settled(
      await run(
        "load",
        sibXrefStreamPdf({
          objects: ONE_PAGE,
          w: "[0 0 0]",
          index: "[0 2147483647]",
        }),
        30_000,
      ),
    );
    expect(r.ok).toEqual({ pages: 1 });
    expect(r.growthMb).toBeLessThan(150);
  }, 60_000);

  test("SIB-04: a 20-digit /Size loads, bounded", async () => {
    const r = settled(
      await run(
        "load",
        sibXrefStreamPdf({ objects: ONE_PAGE, size: "99999999999999999999" }),
        30_000,
      ),
    );
    expect(r.ok).toEqual({ pages: 1 });
    expect(r.growthMb).toBeLessThan(150);
  }, 60_000);
});

describe("STAMP-12: a decompression bomb in an object stream", () => {
  // Its objects cannot be read without inflating it, and a document written
  // without them would be missing whatever they held: refuse, typed.
  const bomb = objStmBomb(1 << 30);
  for (const entry of ["load", "watermark"]) {
    test(`STAMP-12: ${entry} refuses a 1 GiB /ObjStm with the decode-budget error`, async () => {
      const r = settled(await run(entry, bomb));
      expect(r.error).toBe("PdfDecodeBudgetError");
      expect(r.message).toContain(`${BUDGET_MB} MB`);
      expect(r.growthMb).toBeLessThan(REFUSED_BOMB_MB);
    }, 90_000);
  }
});

describe("PS-02: a content-stream bomb embedded by n-up", () => {
  test("PS-02: n-up refuses a ~3 KB chained [/FlateDecode /FlateDecode] -> 1 GiB page", async () => {
    const r = settled(
      await run(
        "nup",
        pageWithContent("[/FlateDecode /FlateDecode]", reflate(zeroBomb(1024))),
      ),
    );
    expect(r.error).toBe("PdfDecodeBudgetError");
    expect(r.growthMb).toBeLessThan(REFUSED_BOMB_MB);
  }, 90_000);

  test("PS-02: positive control: a 64 MiB content stream still lays out, and the RSS instrument sees it", async () => {
    // A dense real vector page can be tens of MB decoded; the budget must not
    // refuse it. The growth floor is the instrument's own health check: a
    // reading that cannot see 64 MiB being decoded would pass every bound.
    const r = settled(
      await run("nup", pageWithContent("/FlateDecode", zeroBomb(64))),
    );
    expect(r.ok).toMatchObject({ sheets: 1 });
    expect(r.growthMb).toBeGreaterThan(60);
  }, 90_000);
});

describe("STAMP-13: a content-stream bomb as the overlay", () => {
  test("STAMP-13: overlay refuses the chained 1 GiB overlay page, naming it", async () => {
    const input = STAMPING_INPUTS.find(
      (i) => i.id === "H12-content-bomb-chained-1gb",
    );
    const r = settled(await run("overlay", await input!.build()));
    expect(r.error).toBe("PdfDecodeBudgetError");
    expect(r.message).toMatch(/^Overlay page 1 /);
    expect(r.growthMb).toBeLessThan(REFUSED_BOMB_MB);
  }, 90_000);
});

describe("CO-07: extract-images bounds decoded bytes", () => {
  test("CO-07: the inline-image scan stops past its budget on a chained 1 GiB content stream", async () => {
    const r = settled(await run("extract", await chainedFlateBombPdf()));
    expect(r.ok).toBeDefined();
    // Before: +1,073 MB, and the result said nothing about the unscanned rest.
    expect(r.growthMb).toBeLessThan(200);
    const skipped = (r.ok as { skipped: { reason: string }[] }).skipped;
    expect(skipped.map((s) => s.reason)).toContain(
      "Page content too large to check for inline images",
    );
  }, 90_000);

  test("CO-07: a 100-megapixel image is written as a compressed PNG, not 300 MB stored", async () => {
    const r = settled(await run("extract", await imageBombAtCapPdf(), 120_000));
    const images = (r.ok as { images: { bytes: number; width: number }[] })
      .images;
    expect(images).toHaveLength(1);
    expect(images[0]!.width).toBe(10_000);
    // Before: 300,032,953 bytes (stored deflate). The samples are zeros, which
    // deflate to well under 1% of their size.
    expect(images[0]!.bytes).toBeLessThan(3_000_000);
  }, 150_000);
});

describe("EDIT-11: an XMP packet that inflates to 1 GiB", () => {
  test("EDIT-11: editing metadata treats the oversized packet as absent, bounded", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    // A real 1 GiB zero bomb as the packet's (already deflated) body.
    const bomb = doc.context.stream(zeroBomb(1024), {
      Type: "Metadata",
      Subtype: "XML",
      Filter: "FlateDecode",
    });
    doc.catalog.set(PDFName.of("Metadata"), doc.context.register(bomb));
    const bytes = await doc.save({ useObjectStreams: false });
    const r = settled(await run("metadata-edit", bytes));
    expect(r.ok).toMatchObject({ title: "Hostile" });
    // Before: +1,024 to 2,350 MB.
    expect(r.growthMb).toBeLessThan(150);
  }, 90_000);
});
