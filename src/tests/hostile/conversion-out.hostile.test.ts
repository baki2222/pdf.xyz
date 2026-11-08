// @vitest-environment node
/**
 * HOSTILE-INPUT MATRIX — family "conversion-out": the tools that READ a PDF
 * and hand back something else (text, Markdown, a text diff, the embedded
 * images, a lossless repack, page images, a grayscale or redacted rebuild).
 *
 * Every entry point below runs against every hostile class (H01–H24 of the
 * survey, plus the repo's own damaged/encrypted fixtures), and each cell's
 * OUTCOME is judged:
 *
 *  - refused with a user-facing message — a `PdfEngineError` (the runner's
 *    `errorMessage` shows it as is) or one of the product's own sentences;
 *  - produced output — then it is CHECKED: page count against the fixture's
 *    truth, the marker text read back, the raster not blank, the redaction
 *    page size agreeing between the two libraries that place and paint it;
 *  - threw an internal error — a raw message the runner would show the user;
 *  - hung past its bound, or crashed the process (heap).
 *
 * A cell whose outcome is acceptable is a test that PASSES. A cell that shows
 * a problem is `test.fails` with its finding id in the name — the file is
 * green while the finding stands, and turns RED the day the finding is fixed
 * (then move the id out of `FINDINGS`: the inverted test becomes a guard).
 *
 * Each cell runs in a CHILD PROCESS (`conversion-out.cell.ts`): pdf-lib's
 * decoders and pdf.js's parser are synchronous, so no in-process timeout can
 * stop a runaway loop — the parent kills the child at the bound and records a
 * hang. Raster engines also get an AbortSignal 3 s inside the bound; a cell
 * that returns with that signal fired is a hang too (partial output).
 *
 * Health: the positive control must pass EVERY engine; the corpus size is
 * bounded from both sides; the outcomes must not all look alike (a child
 * that cannot start would fail every cell the same way, for the wrong
 * reason); and each fixture's own shape is checked before anything trusts it.
 *
 * Run: npx vitest run src/tests/hostile/conversion-out.hostile.test.ts --no-file-parallelism
 * Set HOSTILE_MATRIX_OUT=<file.json> to write the observed matrix.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spliceStartxrefPastEnd } from "@/tests/damaged-xref";
import {
  encryptedPdf,
  ownerOnlyEncryptedPdf,
  ownerOnlyObjectStreamPdf,
  unknownHandlerObjectStreamPdf,
  userPasswordEncryptedPdf,
  userPasswordObjectStreamPdf,
} from "@/tests/encrypted-pdf-fixture";
import { BROKEN_CJK_SUBSET_PDF_BASE64 } from "@/tests/fixtures-broken-subset";
import { malformedPdfs } from "@/tests/malformed-pdf-fixtures";
import {
  recoverablyDamagedPdf,
  unrecoverablePdf,
} from "@/tests/repair-proof-fixtures";
import {
  FIXTURE_PAGE_TEXT,
  readRestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";
import { unsupportedEncryptionPdf } from "@/tests/unsupported-encryption";
import * as F from "./conversion-out.fixtures";
import {
  ENGINES,
  RASTER_ENGINES,
  type CellRecord,
  type EngineId,
} from "./conversion-out.cell";

/* ------------------------------------------------------------------ *
 *  The corpus: every fixture with the TRUTH its outcomes are held to
 * ------------------------------------------------------------------ */

type Truth =
  /** Not a PDF: every engine must refuse; output of any kind is wrong. */
  | { kind: "not-pdf" }
  /**
   * A document with `pages` pages as a conforming reader sees it. Output must
   * agree (counts, `text` read back); a typed refusal is acceptable unless
   * `mustRead` (the file opens in every viewer and the tool claims it).
   */
  | {
      kind: "pages";
      pages: number;
      text?: string;
      mustRead?: boolean;
      /** Displayed page size (pt) the raster must come out at. */
      size?: { w: number; h: number };
      /** Signatures the compress/analyze receipts must count. */
      signatures?: number;
    }
  /** Damaged with no single right answer: refusal or sane output. */
  | { kind: "damaged" }
  /** No reachable page: refusal, or an output that says zero pages. */
  | { kind: "no-pages" }
  /** Needs a password to open: a typed `encrypted` refusal everywhere. */
  | { kind: "user-password" }
  /**
   * Opens with no password (owner-only / permissions encryption). pdf.js
   * readers must READ it (the code's own claim, `pdfjs.ts`); pdf-lib writers
   * must refuse with the typed `encrypted` error.
   */
  | { kind: "owner-only"; pages: number; text?: string }
  /** An unknown security handler: a typed refusal; never a raw throw. */
  | { kind: "unknown-handler" };

interface Fixture {
  id: string;
  cls: string;
  build: () => Uint8Array | Promise<Uint8Array>;
  truth: Truth;
  /**
   * Known-slow builder or engine run (bombs, 2,000 pages): the child is
   * killed at {@link SLOW_BOUND_MS} instead of {@link BOUND_MS}, so a slow
   * cell is MEASURED rather than cut off — and then held to `budgetMs`.
   */
  slow?: boolean;
  /** What a cell may take before it is a finding (default {@link BUDGET_MS}). */
  budgetMs?: number;
  /**
   * The page legitimately renders without visible ink at 72 dpi (a page so
   * large the 5,000 px cap shrinks its text below a pixel, or a font that is
   * itself broken): the raster is not held to "not blank".
   */
  inkless?: boolean;
}

/** The kill bound of a normal cell. */
const BOUND_MS = 30_000;
/** The kill bound of a cell marked `slow`. */
const SLOW_BOUND_MS = 120_000;
/** What a one-page job may take in a browser tab before it is a hang. */
const BUDGET_MS = 30_000;
/**
 * What an engine may add to the child's peak resident set over the same
 * engine on the control (~500 MB of tsx + pdf.js baseline) before it is a
 * memory finding — a browser tab has far less headroom than this process.
 */
const MEMORY_BUDGET_MB = 900;
const M = F.MARKER;
const one = (text: string | null = M, extra: Partial<Truth> = {}) =>
  ({ kind: "pages", pages: 1, text: text ?? undefined, ...extra }) as Truth;

/** pdf.js / pdf-lib read through pdf-lib only: tools that write with pdf-lib. */
const PDF_LIB_ENGINES: readonly EngineId[] = [
  "extract-images",
  "compress",
  "analyze",
  "redact-sizes",
  "redact",
];

const FIXTURES: Fixture[] = [
  {
    id: "control",
    cls: "control",
    build: F.CONTROL,
    truth: one(M, { mustRead: true, size: { w: 300, h: 200 } }),
  },
  // H01–H03
  {
    id: "H01-zero-byte",
    cls: "H01",
    build: F.zeroBytePdf,
    truth: { kind: "not-pdf" },
  },
  {
    id: "H02-png-magic",
    cls: "H02",
    build: F.pngMagicPdf,
    truth: { kind: "not-pdf" },
  },
  {
    id: "H02-zip-magic",
    cls: "H02",
    build: F.zipMagicPdf,
    truth: { kind: "not-pdf" },
  },
  {
    id: "H02-random-4k",
    cls: "H02",
    build: F.random4kPdf,
    truth: { kind: "not-pdf" },
  },
  { id: "H02-html", cls: "H02", build: F.htmlPdf, truth: { kind: "not-pdf" } },
  {
    id: "H03-header-only",
    cls: "H03",
    build: F.headerOnlyPdf,
    truth: { kind: "not-pdf" },
  },
  // H04
  {
    id: "H04-truncated-half",
    cls: "H04",
    build: F.truncatedHalfPdf,
    truth: { kind: "damaged" },
  },
  {
    id: "H04-truncated-at-endobj",
    cls: "H04",
    build: F.truncatedAtEndobjPdf,
    truth: one(),
  },
  {
    id: "H04-repair-recoverable",
    cls: "H04",
    build: recoverablyDamagedPdf,
    truth: { kind: "pages", pages: 4, text: "pdf.xyz repair proof" },
  },
  {
    id: "H04-repair-unrecoverable",
    cls: "H04",
    build: unrecoverablePdf,
    truth: { kind: "damaged" },
  },
  // H05
  {
    id: "H05-xref-offsets-wrong",
    cls: "H05",
    build: F.xrefOffsetsWrongPdf,
    truth: one(),
  },
  {
    id: "H05-startxref-past-eof",
    cls: "H05",
    build: () => spliceStartxrefPastEnd(F.CONTROL()),
    truth: one(),
  },
  { id: "H05-xref-garbage", cls: "H05", build: F.xrefGarbagePdf, truth: one() },
  // H06
  { id: "H06-prev-self", cls: "H06", build: F.prevSelfPdf, truth: one() },
  {
    id: "H06-prev-self-xref-stream",
    cls: "H06",
    build: F.prevSelfXrefStreamPdf,
    truth: one(),
  },
  {
    id: "H06-prev-cycle",
    cls: "H06",
    build: F.prevCyclePdf,
    truth: one("UPDATED " + M),
  },
  // H07
  { id: "H07-parent-cycle", cls: "H07", build: F.parentCyclePdf, truth: one() },
  {
    id: "H07-kids-contain-self",
    cls: "H07",
    build: F.kidsSelfPdf,
    truth: one(),
  },
  {
    id: "H07-object-is-ref-to-itself",
    cls: "H07",
    build: F.objectSelfRefPdf,
    truth: { kind: "no-pages" },
  },
  // H08
  {
    id: "H08-kids-depth-2000",
    cls: "H08",
    build: () => F.deepKidsPdf(2000),
    truth: one(),
  },
  {
    id: "H08-forms-depth-2000",
    cls: "H08",
    build: () => F.nestedFormsPdf(2000),
    // The text is drawn 2,000 forms down; a reader may stop earlier.
    truth: one(null),
  },
  {
    id: "H08-form-does-itself",
    cls: "H08",
    build: F.formSelfDoPdf,
    truth: one(),
  },
  // H09
  {
    id: "H09-count-2147483647",
    cls: "H09",
    build: F.countHugePdf,
    truth: one(),
  },
  {
    id: "H09-count-negative",
    cls: "H09",
    build: F.countNegativePdf,
    truth: one(),
  },
  {
    id: "H09-count-non-integer",
    cls: "H09",
    build: F.countNonIntegerPdf,
    truth: one(),
  },
  // H10
  {
    id: "H10-mediabox-1e9",
    cls: "H10",
    build: F.mediaBoxHugePdf,
    truth: one(),
    inkless: true,
  },
  {
    id: "H10-mediabox-1000000000",
    cls: "H10",
    build: F.mediaBoxHugePlainPdf,
    truth: one(),
    inkless: true,
  },
  {
    id: "H10-mediabox-zero",
    cls: "H10",
    build: F.mediaBoxZeroPdf,
    truth: one(null),
  },
  {
    id: "H10-mediabox-inverted",
    cls: "H10",
    build: F.mediaBoxInvertedPdf,
    truth: one(),
  },
  {
    id: "H10-userunit-1000",
    cls: "H10",
    build: F.userUnitHugePdf,
    truth: one(),
    inkless: true,
  },
  // H11–H12
  {
    id: "H11-image-100000x100000",
    cls: "H11",
    build: F.imageHugeDimsPdf,
    truth: one(),
  },
  {
    id: "H12-flate-bomb-100MiB",
    cls: "H12",
    build: F.flateBombPdf,
    truth: one(),
    slow: true,
  },
  {
    id: "H12-chained-flate-bomb-1GiB",
    cls: "H12",
    build: F.chainedFlateBombPdf,
    truth: one(),
    slow: true,
  },
  {
    id: "H12-image-bomb-100MP",
    cls: "H12",
    build: F.imageBombAtCapPdf,
    truth: one(),
    slow: true,
  },
  // H13
  {
    id: "H13-fontfile2-truncated",
    cls: "H13",
    build: F.truncatedFontFile2Pdf,
    truth: one(),
  },
  {
    id: "H13-fontfile2-bogus-loca",
    cls: "H13",
    build: F.bogusLocaPdf,
    truth: one(),
    inkless: true,
  },
  {
    id: "H13-type3-recursive",
    cls: "H13",
    build: F.type3RecursivePdf,
    truth: one(),
  },
  {
    id: "H13-broken-cjk-subset",
    cls: "H13",
    build: () =>
      new Uint8Array(Buffer.from(BROKEN_CJK_SUBSET_PDF_BASE64, "base64")),
    truth: { kind: "pages", pages: 1 },
  },
  // H14
  {
    id: "H14-user-password",
    cls: "H14",
    build: userPasswordEncryptedPdf,
    truth: { kind: "user-password" },
  },
  {
    id: "H14-user-password-objstm",
    cls: "H14",
    build: userPasswordObjectStreamPdf,
    truth: { kind: "user-password" },
  },
  {
    id: "H14-pypdf-open-password",
    cls: "H14",
    build: () => readRestrictedFixture("pypdf-r3-open-password.pdf"),
    truth: { kind: "user-password" },
  },
  // H15
  {
    id: "H15-owner-only-rc4",
    cls: "H15",
    build: ownerOnlyEncryptedPdf,
    truth: { kind: "owner-only", pages: 1 },
  },
  {
    id: "H15-owner-only-objstm",
    cls: "H15",
    build: ownerOnlyObjectStreamPdf,
    truth: { kind: "owner-only", pages: 1 },
  },
  ...(
    [
      "qpdf-r2-rc4-40.pdf",
      "qpdf-r3-rc4-128.pdf",
      "qpdf-r4-aes128.pdf",
      "qpdf-r6-aes256.pdf",
      "pypdf-r6-aes256.pdf",
    ] as const
  ).map((file): Fixture => ({
    id: `H15-${file.replace(/\.pdf$/, "")}`,
    cls: "H15",
    build: () => readRestrictedFixture(file),
    truth: { kind: "owner-only", pages: 1, text: FIXTURE_PAGE_TEXT },
  })),
  {
    id: "H15-unknown-handler-objstm",
    cls: "H15",
    build: unknownHandlerObjectStreamPdf,
    truth: { kind: "unknown-handler" },
  },
  {
    id: "H15-pubsec-handler",
    cls: "H15",
    build: unsupportedEncryptionPdf,
    truth: { kind: "unknown-handler" },
  },
  // H16
  {
    id: "H16-javascript-openaction-aa",
    cls: "H16",
    build: F.jsOpenActionPdf,
    truth: one(),
  },
  {
    id: "H16-launch-action",
    cls: "H16",
    build: F.launchActionPdf,
    truth: one(),
  },
  {
    id: "H16-javascript-uri-link",
    cls: "H16",
    build: F.javascriptUriPdf,
    truth: one(),
  },
  {
    id: "H16-embedded-files",
    cls: "H16",
    build: F.embeddedFilesPdf,
    truth: one(),
  },
  // H17
  {
    id: "H17-signed-then-updated",
    cls: "H17",
    build: F.signedThenUpdatedPdf,
    truth: one("UPDATED AFTER SIGNING", { signatures: 1 }),
  },
  // H18
  {
    id: "H18-mediabox-1e309",
    cls: "H18",
    build: F.numbersMediaBoxPdf,
    truth: one(),
  },
  {
    id: "H18-rotate-double-minus",
    cls: "H18",
    build: F.numbersRotatePdf,
    truth: one(),
  },
  {
    id: "H18-matrix-nan-tokens",
    cls: "H18",
    build: F.numbersMatrixPdf,
    truth: one(),
  },
  // H19
  {
    id: "H19-duplicate-id-xref-first",
    cls: "H19",
    build: () => F.duplicateObjectPdf("first"),
    truth: one(M, { size: { w: 300, h: 200 } }),
  },
  {
    id: "H19-duplicate-id-xref-second",
    cls: "H19",
    build: () => F.duplicateObjectPdf("second"),
    truth: one("SECOND DEFINITION", { size: { w: 400, h: 400 } }),
  },
  // H20
  {
    id: "H20-pdf20-objstm-only",
    cls: "H20",
    build: () => F.objectStreamOnlyPdf(),
    truth: one(),
  },
  // H21
  {
    id: "H21-2000-pages",
    cls: "H21",
    build: () => F.manyPagesPdf(2000),
    truth: { kind: "pages", pages: 2000, text: M },
    slow: true,
    // 2,000 pages at 72 dpi: ~15 ms a page is fine; the budget says so.
    budgetMs: 90_000,
  },
  // H22
  { id: "H22-rotate-45", cls: "H22", build: F.rotate45Pdf, truth: one() },
  { id: "H22-rotate-1e9", cls: "H22", build: F.rotateHugePdf, truth: one() },
  {
    id: "H22-rotate-inherited-90",
    cls: "H22",
    build: F.rotateInheritedPdf,
    truth: one(M, { size: { w: 200, h: 300 } }),
  },
  // H23
  {
    id: "H23-objstm-n-lies",
    cls: "H23",
    build: () => F.objectStreamOnlyPdf({ n: 50 }),
    truth: one(),
  },
  {
    id: "H23-objstm-first-beyond",
    cls: "H23",
    build: () => F.objectStreamOnlyPdf({ first: 99999 }),
    truth: { kind: "damaged" },
  },
  // H24
  {
    id: "H24-unbalanced-q-100k",
    cls: "H24",
    build: F.unbalancedQPdf,
    truth: one(),
  },
  {
    id: "H24-unbalanced-Q-100k",
    cls: "H24",
    build: F.unbalancedCloseQPdf,
    truth: one(),
  },
  {
    id: "H24-inline-image-100000x100000",
    cls: "H24",
    build: F.inlineImageHugePdf,
    truth: one(),
  },
  // The repo's own malformed fixtures (pdf-lib loads both).
  {
    id: "repo-catalog-pages-is-number",
    cls: "H07",
    build: async () => (await malformedPdfs())[0]!,
    truth: { kind: "no-pages" },
  },
  {
    id: "repo-xobject-resources-is-number",
    cls: "H07",
    build: async () => (await malformedPdfs())[1]!,
    truth: { kind: "pages", pages: 1 },
  },
];

/* ------------------------------------------------------------------ *
 *  Findings: cells whose outcome is a defect. Each is `test.fails`.
 * ------------------------------------------------------------------ */

/**
 * Finding id → the cells that show it, as `fixture.id: engines`. Observed on
 * 2026-11-08 at 3d118978 (the matrix run with HOSTILE_MATRIX_OUT). Each id
 * is one defect; the repro is the fixture's generator through the engine.
 */
const FINDING_CELLS: Record<string, Record<string, readonly EngineId[]>> = {
  // pdf-lib cannot parse an exponent (`1e9`, `1e309`) or `--5`: the whole
  // page object becomes a PDFInvalidObject. getPages() is then [] while
  // getPageCount() (the /Count) still says 1. Compress writes the invalid
  // object back verbatim — a file pdf.js reads as 2 blank pages, text gone —
  // under a receipt (analyze) that says 1 page; Extract Images scans 0
  // pages; Redact refuses "page 1 is out of range (1–0)".
  "CO-01": {
    "H10-mediabox-1e9": [
      "compress",
      "extract-images",
      "redact-sizes",
      "redact",
    ],
    "H18-mediabox-1e309": [
      "compress",
      "extract-images",
      "redact-sizes",
      "redact",
    ],
    "H18-rotate-double-minus": [
      "compress",
      "extract-images",
      "redact-sizes",
      "redact",
    ],
  },
  // A duplicated object id: pdf-lib keeps the LAST definition in the file,
  // whatever the xref says; pdf.js (and viewers) follow the xref. Compress
  // swaps the page for the other definition; Redact validates boxes against
  // a 400x400 page and paints them on the 300x200 one a viewer shows.
  "CO-02": {
    "H19-duplicate-id-xref-first": ["compress", "redact-sizes", "redact"],
  },
  // /Count -1 with one real page: pdf.js's numPages is -1 and every page loop
  // runs zero times. Text tools report -1 pages and "no selectable text"
  // (sending the user to OCR a text PDF); PDF to JPG/PNG returns nothing and
  // names no failed page; Compress keeps the lie.
  "CO-03": {
    "H09-count-negative": [
      "text",
      "text-items",
      "lines",
      "markdown",
      "compare",
      "has-text",
      "compress",
      "to-jpg",
      "to-png",
    ],
  },
  // /UserUnit: pdf.js renders the page 1,000x larger than pdf-lib measures
  // it, so a redaction box placed on the UI's page lands at 1/1000 scale —
  // the area the user marked is NOT covered.
  "CO-04": { "H10-userunit-1000": ["redact"] },
  // An inverted or zero MediaBox (viewers normalise / fall back): Redact's
  // sizes are -300x-200 or 0x0 and it refuses every box "outside the
  // -300×-200 pt page".
  "CO-05": {
    "H10-mediabox-inverted": ["redact-sizes", "redact"],
    "H10-mediabox-zero": ["redact-sizes", "redact"],
  },
  // A 2.5 KB [/FlateDecode /FlateDecode] content stream: pdf.js inflates the
  // whole 1 GiB, 2.6–3.6 GB peak and ~20 s in every pdf.js path.
  "CO-06": {
    "H12-chained-flate-bomb-1GiB": [
      "text",
      "text-items",
      "lines",
      "has-text",
      "markdown",
      "compare",
      "grayscale",
      "redact",
      "to-jpg",
      "to-png",
    ],
  },
  // Extract Images decodes without a byte bound: the inline-image scan
  // inflates the 1 GiB content stream (decodePDFRawStream, line 188), and a
  // 100 MP image inside MAX_PIXELS becomes a 300 MB STORED (uncompressed)
  // PNG from a 293 KB file, 2.1 GB peak.
  "CO-07": {
    "H12-chained-flate-bomb-1GiB": ["extract-images"],
    "H12-image-bomb-100MP": ["extract-images"],
  },
  // The same 100 MP image through the raster tools: 45–66 s for ONE page.
  "CO-08": {
    "H12-image-bomb-100MP": ["grayscale", "redact", "to-jpg", "to-png"],
  },
  // pdf-lib engines throw raw TypeErrors / "Expected instance of PDFDict"
  // on files pdf-lib "loads": header only, lying object streams, a /Pages
  // that is a number or a ref to itself, /XObject that is a number.
  "CO-09": {
    "H03-header-only": [
      "compress",
      "analyze",
      "extract-images",
      "redact-sizes",
      "redact",
    ],
    "H23-objstm-n-lies": [
      "compress",
      "analyze",
      "extract-images",
      "redact-sizes",
      "redact",
    ],
    "H23-objstm-first-beyond": [
      "compress",
      "analyze",
      "extract-images",
      "redact-sizes",
      "redact",
    ],
    "H07-object-is-ref-to-itself": [
      "compress",
      "analyze",
      "extract-images",
      "redact-sizes",
      "redact",
    ],
    "repo-catalog-pages-is-number": [
      "compress",
      "analyze",
      "extract-images",
      "redact-sizes",
      "redact",
    ],
    "repo-xobject-resources-is-number": ["extract-images"],
  },
  // A page-tree cycle: pdf-lib recurses until "Maximum call stack size
  // exceeded" (a RangeError — the class the raster loop treats as OUT OF
  // MEMORY and a batch halts on).
  "CO-10": {
    "H07-kids-contain-self": [
      "compress",
      "analyze",
      "extract-images",
      "redact-sizes",
      "redact",
    ],
    "H07-parent-cycle": ["extract-images", "redact-sizes", "redact"],
  },
  // The same cycle in pdf.js: "Pages tree contains circular reference." as
  // an UnknownErrorException from getPage — untyped, past awaitPdfjsDocument.
  "CO-11": {
    "H07-kids-contain-self": [
      "text",
      "text-items",
      "lines",
      "markdown",
      "compare",
      "has-text",
    ],
  },
  // An unknown security handler: pdf.js's "unknown encryption method" is not
  // mapped to PdfEncryptedError (pdf-lib engines refuse it typed).
  "CO-12": Object.fromEntries(
    ["H15-pubsec-handler", "H15-unknown-handler-objstm"].map((id) => [
      id,
      [
        "text",
        "text-items",
        "lines",
        "markdown",
        "compare",
        "has-text",
        "grayscale",
        "to-jpg",
        "to-png",
      ] as const,
    ]),
  ),
};

/** `${fixture.id}·${engine}` → finding id. */
const FINDINGS: Record<string, string> = Object.fromEntries(
  Object.entries(FINDING_CELLS).flatMap(([id, byFixture]) =>
    Object.entries(byFixture).flatMap(([fixture, engines]) =>
      engines.map((engine) => [`${fixture}·${engine}`, id] as const),
    ),
  ),
);

/* ------------------------------------------------------------------ *
 *  Judging a cell
 * ------------------------------------------------------------------ */

type Outcome =
  "output" | "refused" | "internal-error" | "hang" | "crash" | "no-record";

interface Cell {
  fixture: Fixture;
  engine: EngineId;
  outcome: Outcome;
  record?: CellRecord;
  stderrTail?: string;
  wallMs: number;
}

/**
 * Sentences the product throws as plain `Error`s on purpose: user-facing
 * copy, shown verbatim by the runner. Anything else that is not a
 * `PdfEngineError` is an internal message reaching the user.
 */
const PRODUCT_COPY: readonly RegExp[] = [
  /^No pages could be rendered from this PDF\.$/,
  /^Page \d+ could not be rendered\.$/,
  /^Page \d+ could not be encoded\.$/,
];

function classify(rec: CellRecord | undefined, killed: boolean): Outcome {
  if (killed) return "hang";
  if (!rec) return "no-record";
  if (rec.ok) return rec.aborted ? "hang" : "output";
  const e = rec.error!;
  if (e.engineError || PRODUCT_COPY.some((r) => r.test(e.message)))
    return "refused";
  return "internal-error";
}

interface Verdict {
  acceptable: boolean;
  why: string;
}

const isEncryptedRefusal = (rec?: CellRecord) =>
  !!rec?.error && rec.error.engineError && rec.error.kind === "encrypted";

/** The page count an engine's output reports, where it reports one. */
function reportedPages(engine: EngineId, out: Record<string, unknown>) {
  switch (engine) {
    case "text":
    case "text-items":
    case "lines":
    case "markdown":
    case "extract-images":
    case "analyze":
    case "redact":
    case "grayscale":
      return out.pageCount as number;
    case "compare":
      return out.leftPageCount as number;
    case "redact-sizes":
      return out.count as number;
    case "to-jpg":
    case "to-png":
      return out.pages as number;
    case "compress":
      return (out.readBack as { pages?: number }).pages;
    case "has-text":
      return undefined;
  }
}

/** Whether the engine's output shows `text` (only engines that read text). */
function showsText(
  engine: EngineId,
  out: Record<string, unknown>,
  text: string,
): boolean | undefined {
  const sample = (out.sample as string | undefined) ?? "";
  switch (engine) {
    case "text":
      return text === M ? (out.marker as boolean) : sample.includes(text);
    case "text-items":
    case "lines":
      return text === M ? (out.marker as boolean) : undefined;
    case "markdown":
      return text === M ? (out.marker as boolean) : sample.includes(text);
    case "has-text":
      return out.hasText as boolean;
    case "compress": {
      const rb = out.readBack as { marker?: boolean; sample?: string };
      return text === M ? rb.marker : (rb.sample ?? "").includes(text);
    }
    case "compare":
      return out.hasComparableText as boolean;
    default:
      return undefined;
  }
}

function judge(cell: Cell): Verdict {
  const { fixture, engine, outcome, record: rec } = cell;
  const t = fixture.truth;
  const msg = rec?.error ? `${rec.error.name}: ${rec.error.message}` : "";
  if (outcome === "hang")
    return { acceptable: false, why: `hung past ${boundOf(fixture)} ms` };
  if (outcome === "crash" || outcome === "no-record")
    return {
      acceptable: false,
      why: `child died without a record: ${cell.stderrTail ?? ""}`,
    };
  if (outcome === "internal-error")
    return {
      acceptable: false,
      why: `raw internal error reaches the user: ${msg}`,
    };
  const cost = costVerdict(cell);
  if (cost) return cost;
  // A page size, or a page count, no viewer shows, quoted back to the user
  // as the reason for the refusal.
  if (
    outcome === "refused" &&
    /-\d+(?:\.\d+)?×|(?:^|[^\d.])0×0|\(1–0\)/.test(msg)
  )
    return {
      acceptable: false,
      why: `refusal quotes a page geometry no viewer shows: ${msg}`,
    };
  // PDF to JPG/PNG naming every page it could not render is the runner's
  // refusal ("Page 1 could not be rendered."), not a silent empty result.
  const namedPageFailures =
    outcome === "output" &&
    (engine === "to-jpg" || engine === "to-png") &&
    rec!.out!.pages === 0 &&
    (rec!.out!.failureCount as number) > 0;

  if (t.kind === "user-password") {
    if (isEncryptedRefusal(rec)) return { acceptable: true, why: msg };
    return {
      acceptable: false,
      why:
        outcome === "output"
          ? "produced output from a file that needs a password"
          : `refused, but not as a password-protected file: ${msg}`,
    };
  }
  if (t.kind === "owner-only") {
    const pdfLib = PDF_LIB_ENGINES.includes(engine);
    if (pdfLib)
      return isEncryptedRefusal(rec)
        ? { acceptable: true, why: msg }
        : outcome === "output"
          ? checkOutput(cell, { kind: "pages", pages: t.pages, text: t.text })
          : { acceptable: false, why: `refused, not as encrypted: ${msg}` };
    if (outcome !== "output")
      return {
        acceptable: false,
        why: `a pdf.js reader refused a file that opens with no password: ${msg}`,
      };
    return checkOutput(cell, { kind: "pages", pages: t.pages, text: t.text });
  }
  if (outcome === "refused" || namedPageFailures) {
    if (t.kind === "pages" && t.mustRead)
      return { acceptable: false, why: `refused a readable file: ${msg}` };
    return { acceptable: true, why: msg };
  }
  // output
  if (t.kind === "not-pdf")
    return {
      acceptable: false,
      why: `produced output from bytes that are not a PDF: ${JSON.stringify(rec!.out).slice(0, 200)}`,
    };
  if (t.kind === "no-pages") {
    const n = reportedPages(engine, rec!.out!);
    return n === undefined || n === 0
      ? { acceptable: true, why: "zero pages" }
      : { acceptable: false, why: `reported ${n} page(s) of a tree with none` };
  }
  if (t.kind === "damaged" || t.kind === "unknown-handler") return sanity(cell);
  return checkOutput(cell, t);
}

/** The control cell's peak RSS for the same engine: the child's baseline. */
function baselineRssMb(engine: EngineId): number {
  const control = cells.get(keyOf(FIXTURES[0]!, engine));
  return control?.record?.rssMb ?? 600;
}

/** Time and memory: a result that costs too much is a finding too. */
function costVerdict(cell: Cell): Verdict | null {
  const rec = cell.record;
  if (!rec) return null;
  const budget = cell.fixture.budgetMs ?? BUDGET_MS;
  if (rec.ms > budget)
    return {
      acceptable: false,
      why: `took ${rec.ms} ms (budget ${budget} ms) — the tab is frozen that long`,
    };
  const engineRss = (rec.out?.engineRssMb as number | undefined) ?? rec.rssMb;
  const added = engineRss - baselineRssMb(cell.engine);
  if (added > MEMORY_BUDGET_MB)
    return {
      acceptable: false,
      why: `peak memory ${engineRss} MB, ${added} MB over the control (budget ${MEMORY_BUDGET_MB} MB) for a ${inputBytes(cell)}-byte file`,
    };
  if (cell.engine === "extract-images" && rec.out) {
    const out = rec.out.imageBytes as number;
    if (out > 50_000_000 && out > 100 * inputBytes(cell))
      return {
        acceptable: false,
        why: `hands back ${out} bytes of images from a ${inputBytes(cell)}-byte file`,
      };
  }
  return null;
}

const inputBytes = (cell: Cell) => built.get(cell.fixture.id)?.length ?? 0;

/** Output that is at least internally sane (no absurd sizes or counts). */
function sanity(cell: Cell): Verdict {
  const out = cell.record!.out!;
  const n = reportedPages(cell.engine, out);
  if (n !== undefined && (n < 0 || n > 10_000))
    return { acceptable: false, why: `absurd page count ${n}` };
  return rasterSane(cell) ?? { acceptable: true, why: "sane output" };
}

function rasterSane(cell: Cell): Verdict | null {
  const out = cell.record!.out!;
  if (cell.engine === "to-jpg" || cell.engine === "to-png") {
    const first = out.first as { w: number; h: number } | null;
    if (
      first &&
      !(first.w > 0 && first.h > 0 && first.w <= 5000 && first.h <= 5000)
    )
      return {
        acceptable: false,
        why: `raster ${first.w}x${first.h} outside 1..5000`,
      };
  }
  return null;
}

function checkOutput(
  cell: Cell,
  t: Extract<Truth, { kind: "pages" }>,
): Verdict {
  const { engine } = cell;
  const out = cell.record!.out!;
  const n = reportedPages(engine, out);
  if (n !== undefined && n !== t.pages)
    return {
      acceptable: false,
      why: `reported ${n} page(s); the file has ${t.pages}`,
    };
  if (engine === "compress" || engine === "redact" || engine === "grayscale") {
    const outPages = out.outPdfLibPages;
    const expected =
      engine === "compress" ? t.pages : (out.pageCount as number);
    if (outPages !== expected)
      return {
        acceptable: false,
        why: `output re-opens as ${String(outPages)} (expected ${expected})`,
      };
  }
  if (t.text) {
    const shown = showsText(engine, out, t.text);
    if (shown === false)
      return { acceptable: false, why: `output does not show "${t.text}"` };
  }
  if (engine === "markdown" && out.javascriptLink)
    return { acceptable: false, why: "Markdown carries a javascript: link" };
  if (
    t.signatures !== undefined &&
    (engine === "compress" || engine === "analyze")
  ) {
    if (out.signatureCount !== t.signatures)
      return {
        acceptable: false,
        why: `receipt counts ${String(out.signatureCount)} signature(s); the file has ${t.signatures}`,
      };
  }
  if (engine === "redact") {
    const a = out.pdfLibSize as { width: number; height: number } | undefined;
    const b = out.pdfjsSize as { w: number; h: number } | null;
    if (a && b && (Math.abs(a.width - b.w) > 1 || Math.abs(a.height - b.h) > 1))
      return {
        acceptable: false,
        why: `boxes are placed on a ${a.width}x${a.height} page and painted on a ${b.w}x${b.h} render`,
      };
  }
  if (engine === "to-jpg" || engine === "to-png") {
    const first = out.first as {
      ink: number | string;
      pageW: number;
      pageH: number;
    } | null;
    const failures = out.failureCount as number;
    if (failures > 0)
      return { acceptable: false, why: `${failures} page(s) failed to render` };
    const sane = rasterSane(cell);
    if (sane) return sane;
    if (
      t.text &&
      !cell.fixture.inkless &&
      first &&
      !(typeof first.ink === "number" && first.ink > 0)
    )
      return {
        acceptable: false,
        why: `page 1 renders blank (ink ${first.ink})`,
      };
    if (
      t.size &&
      first &&
      (Math.abs(first.pageW - t.size.w) > 1 ||
        Math.abs(first.pageH - t.size.h) > 1)
    )
      return {
        acceptable: false,
        why: `rendered a ${first.pageW}x${first.pageH} page; a viewer shows ${t.size.w}x${t.size.h}`,
      };
  }
  if (engine === "redact-sizes" && out.allFinitePositive === false)
    return {
      acceptable: false,
      why: `page size not finite/positive: ${JSON.stringify(out.first)}`,
    };
  if (engine === "redact-sizes" && t.size) {
    const s = out.first as { width: number; height: number };
    if (Math.abs(s.width - t.size.w) > 1 || Math.abs(s.height - t.size.h) > 1)
      return {
        acceptable: false,
        why: `reports ${s.width}x${s.height}; a viewer shows ${t.size.w}x${t.size.h}`,
      };
  }
  return { acceptable: true, why: "output checks out" };
}

/* ------------------------------------------------------------------ *
 *  Running cells in children
 * ------------------------------------------------------------------ */

const CELL_SCRIPT = path.join(__dirname, "conversion-out.cell.ts");
const boundOf = (f: Fixture) => (f.slow ? SLOW_BOUND_MS : BOUND_MS);
const HEAP_MB = 4096;

function runChild(
  engine: EngineId,
  input: string,
  control: string,
  bound: number,
): Promise<Omit<Cell, "fixture" | "engine">> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${HEAP_MB}`,
        "--import",
        "tsx",
        CELL_SCRIPT,
        engine,
        input,
        control,
        String(bound),
      ],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString("utf8")).slice(-4000);
    });
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, bound);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const line = stdout.split("\n").find((l) => l.startsWith("@@CELL "));
      const record = line
        ? (JSON.parse(line.slice("@@CELL ".length)) as CellRecord)
        : undefined;
      let outcome = classify(record, killed && !record);
      if (!record && !killed) outcome = "crash";
      resolve({
        outcome,
        record,
        wallMs: Date.now() - started,
        stderrTail: record
          ? undefined
          : `exit ${code ?? signal}: ${stderr
              .split("\n")
              .filter((l) => /error|memory|fatal|abort/i.test(l))
              .slice(-3)
              .join(" | ")
              .slice(0, 400)}`,
      });
    });
  });
}

async function pool<T>(
  jobs: (() => Promise<T>)[],
  width: number,
): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (next < jobs.length) {
        const i = next++;
        results[i] = await jobs[i]!();
      }
    }),
  );
  return results;
}

/* ------------------------------------------------------------------ *
 *  The run
 * ------------------------------------------------------------------ */

const cells = new Map<string, Cell>();
const built = new Map<string, Uint8Array>();
const keyOf = (f: Fixture, e: EngineId) => `${f.id}·${e}`;
let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hostile-conversion-out-"));
  for (const f of FIXTURES) built.set(f.id, await f.build());
  for (const [id, bytes] of built)
    writeFileSync(path.join(dir, `${id}.pdf`), bytes);
  const control = path.join(dir, "control.pdf");
  const jobs = FIXTURES.flatMap((f) =>
    ENGINES.map((engine) => async () => {
      const result = await runChild(
        engine,
        path.join(dir, `${f.id}.pdf`),
        control,
        boundOf(f),
      );
      cells.set(keyOf(f, engine), { fixture: f, engine, ...result });
    }),
  );
  // Slow cells first, so the long tail overlaps the short cells.
  const order = [...jobs.keys()].sort(
    (a, b) =>
      Number(!!FIXTURES[Math.floor(b / ENGINES.length)]!.slow) -
      Number(!!FIXTURES[Math.floor(a / ENGINES.length)]!.slow),
  );
  await pool(
    order.map((i) => jobs[i]!),
    Math.max(2, Math.min(10, Math.floor(cpus().length / 2))),
  );
  const out = process.env.HOSTILE_MATRIX_OUT;
  if (out) {
    const rows = [...cells.values()].map((c) => {
      const v = judge(c);
      return {
        cell: keyOf(c.fixture, c.engine),
        cls: c.fixture.cls,
        outcome: c.outcome,
        acceptable: v.acceptable,
        finding: FINDINGS[keyOf(c.fixture, c.engine)] ?? null,
        why: v.why,
        ms: c.record?.ms ?? c.wallMs,
        rssMb: c.record?.rssMb ?? null,
        out: c.record?.out ?? null,
        error: c.record?.error ?? null,
        stderr: c.stderrTail ?? null,
      };
    });
    rows.sort((a, b) => a.cell.localeCompare(b.cell));
    writeFileSync(out, `${JSON.stringify(rows, null, 1)}\n`);
  }
}, 30 * 60_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ *
 *  Health: the instrument before the readings
 * ------------------------------------------------------------------ */

describe("conversion-out matrix · health", () => {
  test("the corpus is the size it claims, from both sides", () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(70);
    expect(new Set(FIXTURES.map((f) => f.id)).size).toBe(FIXTURES.length);
    expect(ENGINES.length).toBe(14);
    expect(cells.size).toBe(FIXTURES.length * ENGINES.length);
    // Every survey class is represented.
    const classes = new Set(FIXTURES.map((f) => f.cls));
    for (let i = 1; i <= 24; i++)
      expect(classes, `H${String(i).padStart(2, "0")}`).toContain(
        `H${String(i).padStart(2, "0")}`,
      );
  });

  test("every recorded finding names a real cell, and none is the control", () => {
    const real = new Set(
      FIXTURES.flatMap((f) => ENGINES.map((e) => keyOf(f, e))),
    );
    const keys = Object.keys(FINDINGS);
    expect(keys.length).toBeGreaterThan(80);
    for (const key of keys) expect(real, key).toContain(key);
    expect(keys.some((k) => k.startsWith("control·"))).toBe(false);
  });

  test("positive control: the valid PDF passes every engine", () => {
    const control = FIXTURES[0]!;
    for (const engine of ENGINES) {
      const cell = cells.get(keyOf(control, engine))!;
      expect(cell.outcome, `${engine}: ${JSON.stringify(cell.record)}`).toBe(
        "output",
      );
      expect(judge(cell).acceptable, `${engine}: ${judge(cell).why}`).toBe(
        true,
      );
    }
  });

  test("negative control: the judge rejects a non-PDF that 'produced output'", () => {
    const fake: Cell = {
      fixture: FIXTURES.find((f) => f.id === "H01-zero-byte")!,
      engine: "text",
      outcome: "output",
      record: {
        engine: "text",
        ok: true,
        ms: 0,
        rssMb: 0,
        out: { pageCount: 0 },
      },
      wallMs: 0,
    };
    expect(judge(fake).acceptable).toBe(false);
    const raw: Cell = {
      ...fake,
      outcome: classify(
        {
          engine: "text",
          ok: false,
          ms: 0,
          rssMb: 0,
          error: {
            name: "TypeError",
            engineError: false,
            message: "x is undefined",
          },
        },
        false,
      ),
    };
    expect(raw.outcome).toBe("internal-error");
    expect(judge(raw).acceptable).toBe(false);
  });

  test("the outcomes are not all alike (a broken child fails every cell the same way)", () => {
    const outcomes = new Set([...cells.values()].map((c) => c.outcome));
    expect(outcomes).toContain("output");
    expect(outcomes).toContain("refused");
    const raster = [...cells.values()].filter(
      (c) => RASTER_ENGINES.includes(c.engine) && c.outcome === "output",
    );
    expect(raster.length).toBeGreaterThan(40);
  });

  test("every fixture is hostile in the way its name says", async () => {
    const text = (id: string) => Buffer.from(built.get(id)!).toString("latin1");
    expect(built.get("H01-zero-byte")!.length).toBe(0);
    expect(text("H03-header-only")).toBe("%PDF-1.7\n");
    expect(text("H04-truncated-at-endobj")).not.toContain("xref");
    expect(text("H04-truncated-at-endobj").trimEnd().endsWith("endobj")).toBe(
      true,
    );
    // H06: the two /Prev values name each other's xref offsets.
    const cyc = text("H06-prev-cycle");
    const xrefs = [...cyc.matchAll(/startxref\n(\d+)/g)].map((m) =>
      Number(m[1]),
    );
    const prevs = [...cyc.matchAll(/\/Prev (\d+)/g)].map((m) => Number(m[1]));
    expect(xrefs).toHaveLength(2);
    expect(prevs.sort()).toEqual([...xrefs].sort());
    const self = text("H06-prev-self");
    expect(Number(/\/Prev (\d+)/.exec(self)![1])).toBe(
      Number(/startxref\n(\d+)/.exec(self)![1]),
    );
    expect(text("H08-kids-depth-2000").match(/\/Type \/Pages/g)).toHaveLength(
      2000,
    );
    expect(
      text("H08-forms-depth-2000").match(/\/Subtype \/Form/g),
    ).toHaveLength(2000);
    // H12: small on disk, large inflated.
    expect(built.get("H12-flate-bomb-100MiB")!.length).toBeLessThan(200_000);
    expect(built.get("H12-chained-flate-bomb-1GiB")!.length).toBeLessThan(
      10_000,
    );
    expect(built.get("H12-image-bomb-100MP")!.length).toBeLessThan(600_000);
    // H19: object 3 is defined twice; the xref picks the one named.
    expect(
      text("H19-duplicate-id-xref-first").match(/\n3 0 obj/g),
    ).toHaveLength(2);
    // H20: PDF 2.0, no classic xref table, catalog inside the object stream.
    const p20 = text("H20-pdf20-objstm-only");
    expect(p20.startsWith("%PDF-2.0")).toBe(true);
    expect(p20).not.toMatch(/\nxref\n/);
    expect(p20).not.toMatch(/\n1 0 obj/);
    expect(text("H21-2000-pages").match(/\/Type \/Page /g)).toHaveLength(2000);
    // H17: the ByteRange covers revision 1 up to its own %%EOF.
    const signed = text("H17-signed-then-updated");
    const br = /\/ByteRange \[0 (\d+) (\d+) (\d+)\]/.exec(signed)!;
    const firstEof = signed.indexOf("%%EOF") + "%%EOF\n".length;
    expect(Number(br[2]) + Number(br[3])).toBe(firstEof);
    expect(signed.slice(Number(br[1]), Number(br[2]))).toMatch(/^<0+>$/);
    // The fixtures meant to be well-formed apart from their one lie load in
    // pdf-lib, so their cells are about that lie and not an accident.
    for (const id of [
      "control",
      "H09-count-2147483647",
      "H10-mediabox-zero",
      "H16-javascript-uri-link",
      "H17-signed-then-updated",
      "H22-rotate-inherited-90",
    ]) {
      const doc = await PDFDocument.load(built.get(id)!, {
        updateMetadata: false,
      });
      expect(doc.getPageCount(), id).toBeGreaterThan(0);
    }
    // The open-password fixture really needs one; the owner-only one does not.
    expect(text("H14-user-password")).toContain("/Encrypt");
    expect(
      Buffer.from(encryptedPdf({ userPassword: "", ownerPassword: "o" }))
        .length,
    ).toBeGreaterThan(0);
    expect(readFileSync(path.join(dir, "control.pdf")).length).toBeGreaterThan(
      0,
    );
  });
});

/* ------------------------------------------------------------------ *
 *  The matrix
 * ------------------------------------------------------------------ */

for (const fixture of FIXTURES) {
  describe(`${fixture.cls} · ${fixture.id}${fixture.slow ? " [SLOW]" : ""}`, () => {
    for (const engine of ENGINES) {
      const key = keyOf(fixture, engine);
      const finding = FINDINGS[key];
      const run = finding ? test.fails : test;
      run(finding ? `${finding} ${engine}` : engine, () => {
        const cell = cells.get(key);
        expect(cell, "cell never ran").toBeDefined();
        const verdict = judge(cell!);
        expect(verdict.acceptable, `${cell!.outcome}: ${verdict.why}`).toBe(
          true,
        );
      });
    }
  });
}
