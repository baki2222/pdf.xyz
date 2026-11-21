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
import { deflateSync } from "node:zlib";
import { PDFDocument, PDFName } from "pdf-lib";
import { afterAll, describe, expect, test } from "vitest";
import { DEFAULT_DECODE_BUDGET_BYTES } from "@/lib/pdf/decode-budget";
import { EMBED_TOTAL_BYTES } from "@/lib/pdf/embed-budget";
import { runBounded, type BoundedOutcome } from "./bounded";
import { expectFasterThan, expectRatioBelow } from "../time-bound";
import {
  chainedFlateBombPdf,
  imageBombAtCapPdf,
} from "./conversion-out.fixtures";
import {
  ONE_PAGE,
  concatBytes,
  latin1,
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
  /** The entry's own time, measured in the child (2026-11-15). */
  ms?: number;
  /** Bytes every decodeContents call returned, counted in the child (2026-11-22). */
  decoded: number;
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
  // "bookmarks" (2026-11-10): Edit PDF Bookmarks reads through loadPdf.
  for (const entry of ["load", "watermark", "bookmarks"]) {
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

describe("PS-02: the same content-stream bomb embedded by Booklet", () => {
  // Booklet embeds pages through the same function as n-up
  // (embedSourcePages); this holds the refusal at Booklet's own entry point,
  // so a second embed path added there later cannot skip the budget.
  test("PS-02: booklet refuses the ~3 KB chained [/FlateDecode /FlateDecode] -> 1 GiB page", async () => {
    const r = settled(
      await run(
        "booklet",
        pageWithContent("[/FlateDecode /FlateDecode]", reflate(zeroBomb(1024))),
      ),
    );
    expect(r.error).toBe("PdfDecodeBudgetError");
    expect(r.growthMb).toBeLessThan(REFUSED_BOMB_MB);
  }, 90_000);

  test("PS-02: positive control: booklet lays out a 64 MiB content stream, and the RSS instrument sees it", async () => {
    const r = settled(
      await run("booklet", pageWithContent("/FlateDecode", zeroBomb(64))),
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

/**
 * A one-page PDF whose page names ONE content stream `times` times in its
 * /Contents array. pdf-lib's page embedder decodes every entry, keeps them all
 * and joins them, so a stream under the per-stream budget multiplies.
 */
const repeatedContentPdf = (
  filter: string,
  stream: Uint8Array,
  times: number,
) =>
  rawPdf({
    objects: [
      ONE_PAGE[0]!,
      ONE_PAGE[1]!,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents [${Array(times).fill("4 0 R").join(" ")}] >>`,
      { dict: `/Filter ${filter}`, stream },
    ],
  });

describe("PS-02 / STAMP-13: a /Contents array repeating one stream under the budget", () => {
  // The reviewer's case: one stream that inflates to 200 MiB, under the
  // per-stream budget, named four times. Before the operation ledger, n-up
  // decoded all four (+1,618 MB) and wrote the bomb back out.
  const repeated = () =>
    repeatedContentPdf(
      "[/FlateDecode /FlateDecode]",
      reflate(zeroBomb(200)),
      4,
    );
  test("PS-02: n-up refuses a page whose /Contents names a 200 MiB stream four times", async () => {
    const r = settled(await run("nup", repeated()));
    expect(r.error).toBe("PdfDecodeBudgetError");
    expect(r.growthMb).toBeLessThan(REFUSED_BOMB_MB);
  }, 90_000);

  test("STAMP-13: overlay refuses the same page as its overlay, naming it", async () => {
    const r = settled(await run("overlay", repeated()));
    expect(r.error).toBe("PdfDecodeBudgetError");
    expect(r.message).toMatch(/^Overlay page 1 /);
    expect(r.growthMb).toBeLessThan(REFUSED_BOMB_MB);
  }, 90_000);

  test("PS-02: positive control: two 64 MiB entries (128 MiB in all) still lay out", async () => {
    // Each page has its own ledger at the budget (all its entries are held
    // at once), and an array is legal: half the budget across two entries
    // must pass, and the instrument must see it decoded.
    const r = settled(
      await run("nup", repeatedContentPdf("/FlateDecode", zeroBomb(64), 2)),
    );
    expect(r.ok).toMatchObject({ sheets: 1 });
    expect(r.growthMb).toBeGreaterThan(120);
  }, 90_000);
});

/**
 * A `pages`-page PDF whose every page has /Contents pointing at ONE stream.
 * Each page is its own embed, so a ledger scoped to one page lets the stream
 * multiply by the page count: the reviewer's 7,850-byte file of 60 pages x
 * 250 MiB cost n-up 15 GB of inflate and re-deflate, 125 s on the main thread.
 */
function sharedContentPdf(
  filter: string,
  stream: Uint8Array,
  pages: number,
): Uint8Array {
  const pageNums = Array.from({ length: pages }, (_, k) => k + 3);
  const streamNum = pages + 3;
  return rawPdf({
    objects: [
      ONE_PAGE[0]!,
      `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages} >>`,
      ...pageNums.map(
        () =>
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents ${streamNum} 0 R >>`,
      ),
      { dict: `/Filter ${filter}`, stream },
    ],
  });
}

describe("PS-02 / STAMP-13: many pages sharing one content stream under the budget", () => {
  // 24 pages x 200 MiB: 4.7 GiB of inflate and re-deflate before the
  // destination total (measured: settled "ok" after 43 s for n-up and 50 s
  // for overlay); refused at EMBED_TOTAL_BYTES after, about 5 pages in.
  const shared = () =>
    sharedContentPdf("[/FlateDecode /FlateDecode]", reflate(zeroBomb(200)), 24);
  // l01#20 / l01#13: the destination total fired, so the copy names the
  // pages together at 1,024 MB. It used to blame "Overlay page 5" (or "This
  // PDF") at 256 MB, a limit no single page here reached.
  const TOTAL_COPY: Record<string, string> = {
    nup: "The pages of this PDF together unpack to more than 1,024 MB, which is too large to process safely in your browser.",
    "overlay-cycle":
      "The overlay pages together unpack to more than 1,024 MB, which is too large to process safely in your browser.",
  };

  /**
   * The positive control, run once per entry and shared: 6 pages naming one
   * 64 MiB stream, 384 MiB of legal inflate and re-deflate through the SAME
   * entry. It is the yardstick the refusal's time is held to (below).
   */
  const CONTROL_PAGES = 6;
  const CONTROL_MIB = 64;
  const controls = new Map<string, Promise<BoundedOutcome>>();
  const control = (entry: string) => {
    let c = controls.get(entry);
    if (!c) {
      c = run(
        entry,
        sharedContentPdf("/FlateDecode", zeroBomb(CONTROL_MIB), CONTROL_PAGES),
        120_000,
      );
      controls.set(entry, c);
    }
    return c;
  };
  /**
   * The refusal's time, as a multiple of the control's, both measured inside
   * their child around the entry alone (decode-budget.child.ts `ms`).
   *
   * History (2026-11-15). This bound WAS `Date.now() - started < 30_000`,
   * taken in the parent around the whole test: fixture build, spawn, tsx
   * boot and the entry. The entry is single-threaded JS (pako's deflate is
   * about 62% of it, pdf-lib's inflate about 30%), and CI runs it 3.3x
   * slower than a quiet local box, by however loaded the runner is: across
   * 15 CI runs n-up took 14.4-30.3 s, 9 of them at 28 s or more, and PR
   * #318's run 43650957051 failed at 30,273 ms (n-up) and 30,348 ms
   * (overlay-cycle) with nothing wrong. A constant cannot tell a slow
   * machine from a slow refusal; the same entry on a legal file, in the
   * same run, can.
   *
   * The work ratio is the claim. By bytes, refused at EMBED_TOTAL_BYTES
   * (1 GiB) is 1024 / 384 = 2.7 controls, and the defect this test was
   * written for (no destination total: all 24 pages, 4.7 GiB) is 12.5.
   *
   * 2026-11-22 (CI-flake audit lane 2): the bytes are now counted directly.
   * The child sums what every decodeContents call returned (`decoded`, taken
   * outside the ledger, which reports its own figures and so under-reports
   * exactly when it under-charges), and the test pins it to the whole pages
   * that fit under EMBED_TOTAL_BYTES. That is the primary check: a total
   * that fires four times late, or a ledger that charges a quarter of the
   * growth, decodes about 20 pages (about 4,000 MiB) and is red on any
   * runner. The time ratio stays as the second, independent bound — it alone
   * sees work done OUTSIDE decodeContents (a retry, a second decode path) —
   * loosened from 6 to 7.5: the Windows calibration (1.76-1.88) was not CI's.
   * CI read 2.24-3.60 over 48 samples of 24 runs (max 3.60, run 43696792243
   * nup: 27,439 / 7,613 ms, the control in a quiet window), and 2.22-2.86 on
   * the 11 attempts of 2026-11-21 (44891504062-44924793701; 2.86 is
   * 44924793701's nup, 22,247 / 7,769 ms). 7.5 is 2.08x over 3.60.
   *
   * The lowest-mutant rule (bound <= mutant / 1.5) does NOT hold here, and
   * cannot with 2x over CI: the "four times late" mutant decodes about 20
   * pages, about 4,000 MiB = 10.4 controls by bytes, so the rule wants 6.9
   * or less and 2 x 3.60 wants 7.2 or more. Its time ratio was never
   * measured, because the page count above went red first ("expected 20 to
   * be 5"). So that mutant is the page count's to catch, on any runner, and
   * this ratio is only the backstop for work outside decodeContents.
   */
  const RATIO_TO_CONTROL = 7.5;
  /**
   * Beside the ratio, an absolute ceiling on the entry alone, for the case
   * where the control is itself slow for a reason that would hide a defect.
   * It catches only a slowdown of BOTH control and refusal above about 2x on
   * the slowest runner seen; the decoded-bytes count above is what catches
   * an under-charging ledger on every runner. History: 40,000 until
   * 2026-11-22, when CI's refusal reached 30,250 ms (44346859633
   * overlay-cycle, main) and 29,855 ms (44910288854 nup): 1.32x. The
   * highest CI read is older and on the parent's clock, so an upper bound
   * on the entry's: 30,692 ms (42740976326, "expected 30692 to be less than
   * 30000"; PR #318's 43650957051 read 30,348). Now 64,000, 2.09x over
   * 30,692, under the refusal's 120 s kill.
   */
  const ENTRY_CEILING_MS = 64_000;
  /** Whole pages the destination total admits before it refuses the next. */
  const PAGES_UNDER_TOTAL = Math.floor(EMBED_TOTAL_BYTES / (200 * MiB));

  for (const entry of ["nup", "overlay-cycle"]) {
    test(`PS-02 / STAMP-13: ${entry} refuses 24 pages that all name one 200 MiB stream`, async () => {
      // Control first, then the hostile file, so both see the same machine.
      const c = settled(await control(entry));
      expect(c.ok, `${entry} control`).toBeDefined();
      const r = settled(await run(entry, shared(), 120_000));
      expect(r.error).toBe("PdfDecodeBudgetError");
      expect(r.message).toBe(TOTAL_COPY[entry]);
      const said = `${entry}: refusal ${r.ms} ms, control ${c.ms} ms; decoded ${r.decoded} vs ${c.decoded} bytes; growth ${r.growthMb} vs ${c.growthMb} MB`;
      expect(r.growthMb, said).toBeLessThan(REFUSED_BOMB_MB);
      // Health check: a control that did no work would make any ratio pass
      // vacuously, and the instrument must see its 64 MiB decoded.
      expect(c.growthMb, `${entry} control growth`).toBeGreaterThan(60);
      // The speed-independent check (see RATIO_TO_CONTROL). Positive control
      // first: the counter saw every one of the control's pages, so a
      // counter that missed the embeds (another pdf-lib instance) is red
      // here, not a vacuous 0 below.
      // Pages are counted in whole streams: each page's decodeContents
      // returns its stream plus a few bytes (the joining newline and the
      // decoder's own; measured 7), so a page is its MiB rounded.
      const pagesOf = (bytes: number, mib: number) => ({
        pages: Math.round(bytes / (mib * MiB)),
        extra: bytes - Math.round(bytes / (mib * MiB)) * mib * MiB,
      });
      const controlPages = pagesOf(c.decoded, CONTROL_MIB);
      expect(controlPages.extra, said).toBeLessThan(64 * CONTROL_PAGES);
      expect(controlPages.pages, said).toBe(CONTROL_PAGES);
      const refused = pagesOf(r.decoded, 200);
      expect(refused.extra, said).toBeLessThan(64 * PAGES_UNDER_TOTAL);
      const decodedPages = refused.pages;
      expect(decodedPages, said).toBe(PAGES_UNDER_TOTAL);
      // Printed and recorded on a pass too (src/tests/time-bound.ts): CI
      // logs showed this region only on a failure, so the spread the bound
      // was set from could not be read back. The helper refuses a control
      // of 0 ms, the health check that was spelled out here.
      expectRatioBelow(
        "decode-budget-refusal-vs-control",
        r.ms!,
        c.ms!,
        RATIO_TO_CONTROL,
        { instance: entry, detail: said },
      );
      expectFasterThan(
        "decode-budget-refusal-ceiling",
        r.ms!,
        ENTRY_CEILING_MS,
        { instance: entry, detail: said },
      );
    }, 300_000);
  }

  test("PS-02: positive control: 6 pages sharing one 64 MiB stream (384 MiB in all) still lay out", async () => {
    // Past the per-stream budget in total, so this pins that the operation
    // total is larger than it; under EMBED_TOTAL, so it must pass.
    expect(CONTROL_PAGES * CONTROL_MIB * MiB).toBeGreaterThan(
      DEFAULT_DECODE_BUDGET_BYTES,
    );
    expect(CONTROL_PAGES * CONTROL_MIB * MiB).toBeLessThan(EMBED_TOTAL_BYTES);
    const r = settled(await control("nup"));
    expect(r.ok).toMatchObject({ sheets: 2 });
    expect(r.growthMb).toBeGreaterThan(60);
  }, 150_000);

  test("PS-02 / STAMP-13: positive control: overlay-cycle lays out the same 6 pages", async () => {
    const r = settled(await control("overlay-cycle"));
    expect(r.ok).toMatchObject({ pages: CONTROL_PAGES });
    expect(r.growthMb).toBeGreaterThan(60);
  }, 150_000);
});

/**
 * A one-page PDF followed by `count` object streams, each [/FlateDecode
 * /FlateDecode] and inflating to `mib` MiB (one object, then NUL padding,
 * which is PDF whitespace). Each stays under the per-stream budget; together
 * they are far past it, and pdf-lib inflates every one inside load().
 */
function manyObjStmPdf(count: number, mib: number): Uint8Array {
  const head = "100 0 ";
  const body = concatBytes(
    latin1(`${head}<< /Padding true >>
`),
    new Uint8Array(mib * MiB),
  );
  const stream = reflate(new Uint8Array(deflateSync(body, { level: 9 })));
  const objStm = {
    dict: `/Type /ObjStm /N 1 /First ${head.length} /Filter [/FlateDecode /FlateDecode]`,
    stream,
  };
  return rawPdf({ objects: [...ONE_PAGE, ...Array(count).fill(objStm)] });
}

describe("STAMP-12: many object streams, each under the budget", () => {
  // The reviewer's case, scaled: 20 x 100 MiB. Before the per-load ledger
  // each stream passed its own check and load() inflated 2 GB (1 s per
  // 250 MiB, so a 1 MB file of these froze the tab for ~20 minutes).
  const hostile = () => manyObjStmPdf(20, 100);
  // "bookmarks" (2026-11-10): Edit PDF Bookmarks reads through loadPdf.
  for (const entry of ["load", "watermark", "bookmarks"]) {
    test(`STAMP-12: ${entry} refuses 20 object streams of 100 MiB each (2 GB in all)`, async () => {
      const started = Date.now();
      const r = settled(await run(entry, hostile()));
      expect(r.error).toBe("PdfDecodeBudgetError");
      expect(r.message).toContain(`${BUDGET_MB} MB`);
      expect(r.growthMb).toBeLessThan(REFUSED_BOMB_MB);
      // Refused once 256 MiB in all is inflated: about 1 s of inflate, not 8.
      // Kept raw (review 2026-11-22): the test took up to 4,487 ms on CI over
      // 12 runs of 2026-11-18, 6.7x under 30 s, so it was never flaky, and
      // the refusal's type cannot see an entry that inflates all 2 GB first.
      expect(Date.now() - started).toBeLessThan(30_000);
    }, 90_000);
  }

  // l03#49: the overlay's loader rethrew every refusal but encryption as
  // "The overlay file couldn't be read as a PDF", so a bomb read as damage.
  test("STAMP-12: as the overlay, the refusal is the budget's, naming the overlay PDF", async () => {
    const r = settled(await run("overlay", hostile()));
    expect(r.error).toBe("PdfDecodeBudgetError");
    expect(r.message).toBe(
      `The overlay PDF holds compressed data that unpacks to more than ${BUDGET_MB} MB, which is too large to process safely in your browser.`,
    );
    expect(r.growthMb).toBeLessThan(REFUSED_BOMB_MB);
  }, 90_000);

  test("STAMP-12: positive control: 2 object streams of 100 MiB (200 MiB in all) still load", async () => {
    const r = settled(await run("load", manyObjStmPdf(2, 100)));
    expect(r.ok).toEqual({ pages: 1 });
    expect(r.growthMb).toBeGreaterThan(90);
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

  test("CO-07: the inline-image scan has a total, not only a per-stream cap", async () => {
    // Ten pages, each with its OWN 60 MiB content stream (under the 64 MiB
    // per-stream cap). Before the total, all ten were inflated (600 MiB);
    // the scan now stops after 256 MiB and says which pages it did not check.
    const pages = 10;
    const content = reflate(zeroBomb(60));
    const kids = Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`);
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`,
      ...Array.from(
        { length: pages },
        (_, i) =>
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents ${3 + pages + i} 0 R >>`,
      ),
      ...Array.from({ length: pages }, () => ({
        dict: "/Filter [/FlateDecode /FlateDecode]",
        stream: content,
      })),
    ];
    const started = Date.now();
    const r = settled(await run("extract", rawPdf({ objects })));
    const skipped = (r.ok as { skipped: { page: number; reason: string }[] })
      .skipped;
    const unchecked = skipped.filter((s) =>
      s.reason.startsWith("Too much page content in this PDF"),
    );
    // 256 MiB / 60 MiB: pages 1-4 scanned (the 5th gets the last 16 MiB).
    expect(unchecked.map((s) => s.page)).toEqual([6, 7, 8, 9, 10]);
    // Kept raw (review 2026-11-22): test CI max 3,443 ms over 12 runs of
    // 2026-11-18, 8.7x under 30 s; never flaky.
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 90_000);

  // l01#11 / l01#17: page 5 below gets only the last 16 MiB of the 256 MiB
  // total, and its note said "Page content too large to check for inline
  // images", although its 60 MiB stream is under the 64 MiB per-stream cap.
  // The cap that bit was the file's total; the note now says so.
  test("CO-07: a page cut short by the file's total says so, not that it is too large", async () => {
    const pages = 5;
    const kids = Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`);
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`,
      ...Array.from(
        { length: pages },
        (_, i) =>
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents ${3 + pages + i} 0 R >>`,
      ),
      // Distinct streams (each its own object), 60 MiB decoded each.
      ...Array.from({ length: pages }, () => ({
        dict: "/Filter [/FlateDecode /FlateDecode]",
        stream: reflate(zeroBomb(60)),
      })),
    ];
    const r = settled(await run("extract", rawPdf({ objects })));
    const skipped = (r.ok as { skipped: { page: number; reason: string }[] })
      .skipped;
    expect(skipped).toEqual([
      {
        page: 5,
        filter: "FlateDecode, FlateDecode",
        reason:
          "Partly checked for inline images: earlier pages used this file's 256 MB check allowance",
      },
    ]);
    // Never more than is true: 256 MB (1e6) is within the real total.
    expect(256e6).toBeLessThanOrEqual(4 * 64 * MiB);
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
