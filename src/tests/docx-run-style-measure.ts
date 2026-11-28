/**
 * PDF to Word's formatting costs, measured in a FRESH process:
 * `tsx src/tests/docx-run-style-measure.ts <mode> [n]`. Prints one line of
 * JSON: numbers only.
 *
 * A process's peak resident set only rises, so it cannot be read inside a
 * test runner that has already done other work. Each mode warms up first,
 * reads the peak, runs, and reads it again.
 *
 * Modes:
 *  - `match <n>`: `runStylesOf` over ONE page of `n` words, each on a run of
 *    its own (the matcher's worst case for its index: as many runs as
 *    words), laid out as lines of 20 words — the per-page cap's cost;
 *  - `match-line <n>`: the same `n` words on ONE line, so every run shares
 *    a bucket;
 *  - `match-wide <n>`: as `match-line`, its first run as wide as the line —
 *    the one shape the bucket search is still linear in per word. Since
 *    2026-11-15 a word inside two runs of different styles whose texts both
 *    hold it is plain (a word drawn over another line), so here the bold
 *    half of the words, each inside the wide regular run, are not matched;
 *  - `match-one <n>`: as `match-line`, every word in ONE style, so the page
 *    reader's runs join into one run of the whole line — the shape whose
 *    TEXT search is bounded by `TEXT_WINDOW`;
 *  - `engine <pages>`: a generated PDF of `pages` pages, each a heading in
 *    bold and four lines mixing regular, bold and italic words, through the
 *    whole PDF to Word engine (real page reader, poppler stood in for) — and
 *    the structural read-back of its .docx, timed on its own.
 *
 * Added 2026-11-22 (ci-flake audit 2026-11-19), so the cap test can hold
 * cost SHAPES instead of only absolute times a runner's speed decides:
 *  - every `match*` mode also reports `capMs` and `refMs`: the same shape
 *    at `n` and at a reference size, alternating, best of 2 and of 3. The
 *    reference is `n / 8` for the near-linear layouts, and the literal
 *    {@link WIDE_REFERENCE} for `match-wide`, the one quadratic shape, so a
 *    raised cap grows its ratio as the cap squared on any runner;
 *  - `engine` reports `structureParses`: how many times the engine's run
 *    opened the very package it delivered through `docx-structure` (its
 *    check before delivery reads the structure AND its problems from ONE
 *    parse, a count no runner's speed changes), beside `packageParses`,
 *    every open of those bytes (the independent `docx-read` reader is the
 *    other); and `fullReadMs` / `smallReadMs`: the read-back at `pages`
 *    against the same engine's output at `pages / 8`.
 * Times are unrounded.
 */
import JSZip from "jszip";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { PDFDocument } from "pdf-lib";
import type { FlowPiece, PdfFlowTextPage } from "@/lib/workers/pdf-text/flow";
import { runStylesOf } from "@/lib/workers/pdf-office-export/docx-run-style";
import {
  docxPageTexts,
  inspectDocxStructure,
} from "@/lib/workers/pdf-office-export/docx-structure";
import {
  PDF_TO_WORD_TOOL,
  runPdfOfficeExport,
} from "@/lib/workers/pdf-office-export/engine";
import { pdfOfficeExportDeps } from "@/lib/workers/pdf-office-export/native";
import type {
  ScannedPage,
  ScannedRun,
  ScannedTextLine,
} from "@/lib/workers/pdf-office-export/page-scan";
import { flowStandIn } from "@/tests/poppler-flow-standin";

const peakMb = () => process.resourceUsage().maxRSS / 1024;

/** `match-wide`'s reference size: a literal, never derived from the cap. */
const WIDE_REFERENCE = 2_000;

/** One time-boxed sample lasts at least this long, so a timer tick is noise. */
const SAMPLE_MS = 100;

/** One time-boxed sample of `fn`: its time per call over SAMPLE_MS or more. */
function perCall(fn: () => unknown): number {
  let calls = 0;
  let spent = 0;
  const t0 = performance.now();
  do {
    fn();
    calls += 1;
    spent = performance.now() - t0;
  } while (spent < SAMPLE_MS);
  return spent / calls;
}

/** The best time of `reps` calls of the async `fn`. */
async function bestOfAsync(
  reps: number,
  fn: () => Promise<unknown>,
): Promise<number> {
  let best = Infinity;
  for (let r = 0; r < reps; r++) {
    const t0 = performance.now();
    await fn();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

function matchPage(
  n: number,
  perLine = 20,
  wideFirst = false,
  oneStyle = false,
): { page: PdfFlowTextPage; scanned: ScannedPage } {
  const pieces: FlowPiece[] = [];
  const items: ScannedTextLine[] = [];
  const run: ScannedRun = {
    text: "word ",
    family: "Helvetica",
    fontClass: "sans",
    bold: false,
    italic: false,
    size: 2,
    color: "000000",
    alpha: 1,
    invisible: false,
    spacing: 0,
  };
  for (let k = 0; k < n; k += perLine) {
    const y = 10 + (k / perLine) * 2.5;
    const runs: ScannedRun[] = [];
    for (let j = 0; j < perLine && k + j < n; j++) {
      const x = 10 + j * 25;
      pieces.push({
        text: pieces.length === 0 ? "word" : " word",
        box: [x, y, x + 20, y + 2] as const,
      });
      runs.push({
        ...run,
        // A run's text is what it draws: the word, or (`match-wide`) the
        // whole line for the run as wide as it.
        text: wideFirst && j === 0 ? "word ".repeat(perLine) : "word ",
        bold: !oneStyle && j % 2 === 1,
        offset: j * 25,
        // `match-wide`: the first run spans the whole line.
        extent: wideFirst && j === 0 ? perLine * 25 : 25,
      });
    }
    items.push({
      kind: "text",
      x: 10,
      y,
      width: runs.length * 25,
      height: 2,
      rotation: 0,
      flipH: false,
      flipV: false,
      baseline: 1.6,
      runs,
    });
  }
  return {
    page: {
      pageNumber: 1,
      paragraphs: [[pieces.map((p) => p.text).join("")]],
      pieces: [[pieces]],
    },
    scanned: {
      pageNumber: 1,
      width: 612,
      height: 792,
      items,
      picturesTooLarge: 0,
      picturesUndecoded: 0,
      picturesUnverified: false,
      flattened: false,
    },
  };
}

async function enginePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await embedDrawingFont(
    doc,
    ["Heading 0123456789 word"],
    "sans",
  );
  const bold = await embedDrawingFont(
    doc,
    ["Heading 0123456789 word"],
    "sans-bold",
  );
  const italic = await embedDrawingFont(
    doc,
    ["Heading 0123456789 word"],
    "sans-oblique",
  );
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Heading ${p + 1}`, { x: 72, y: 720, size: 18, font: bold });
    for (let l = 0; l < 4; l++) {
      let x = 72;
      for (let w = 0; w < 10; w++) {
        const font = w % 3 === 1 ? bold : w % 3 === 2 ? italic : regular;
        const word = `word${w}`;
        page.drawText(word, { x, y: 680 - l * 16, size: 11, font });
        x += font.widthOfTextAtSize(`${word} `, 11);
      }
    }
  }
  return doc.save();
}

async function main() {
  const [mode, arg] = process.argv.slice(2);
  const n = Number(arg ?? "0");
  if (
    mode === "match" ||
    mode === "match-line" ||
    mode === "match-wide" ||
    mode === "match-one"
  ) {
    const warm = matchPage(200);
    runStylesOf(warm.page, warm.scanned);
    // `match-line`: every word on ONE line — every run in one bucket, the
    // matcher's worst case for its search.
    const built = matchPage(
      n,
      mode === "match" ? 20 : n,
      mode === "match-wide",
      mode === "match-one",
    );
    const before = peakMb();
    const t0 = performance.now();
    const got = runStylesOf(built.page, built.scanned);
    const ms = performance.now() - t0;
    const rssDeltaMb = peakMb() - before;
    // The shape, after the peak is read: the same layout at a reference
    // size, alternating with `n` so a load change reaches both sides.
    const refN = mode === "match-wide" ? WIDE_REFERENCE : Math.floor(n / 8);
    const ref = matchPage(
      refN,
      mode === "match" ? 20 : refN,
      mode === "match-wide",
      mode === "match-one",
    );
    // Time-boxed samples, best per call: three of the reference, two of
    // the cap (the first is the fresh run above, a sample of its own).
    let capMs = ms;
    let refMs = Infinity;
    for (let r = 0; r < 3; r++) {
      refMs = Math.min(
        refMs,
        perCall(() => runStylesOf(ref.page, ref.scanned)),
      );
      if (r < 1)
        capMs = Math.min(
          capMs,
          perCall(() => runStylesOf(built.page, built.scanned)),
        );
    }
    console.log(
      JSON.stringify({
        mode,
        n,
        ms,
        rssDeltaMb: Math.round(rssDeltaMb),
        matched: got.matched,
        total: got.total,
        capped: got.capped,
        refN,
        capMs,
        refMs,
      }),
    );
    return;
  }
  if (mode === "engine") {
    const deps = { ...pdfOfficeExportDeps(), extractFlow: flowStandIn };
    await runPdfOfficeExport(PDF_TO_WORD_TOOL, await enginePdf(1), deps);
    const pdf = await enginePdf(n);
    // Every package the engine opens while it runs: the check before
    // delivery is the only reader of the bytes it delivers.
    const opened: { bytes: Uint8Array; structure: boolean }[] = [];
    const loadAsync = JSZip.loadAsync.bind(JSZip);
    JSZip.loadAsync = ((data: unknown, options?: unknown) => {
      if (data instanceof Uint8Array)
        opened.push({
          bytes: data,
          structure: /docx-structure/.test(new Error().stack ?? ""),
        });
      return loadAsync(data as Uint8Array, options as never);
    }) as typeof JSZip.loadAsync;
    const before = peakMb();
    const t0 = performance.now();
    const run = await runPdfOfficeExport(PDF_TO_WORD_TOOL, pdf, deps);
    const ms = performance.now() - t0;
    JSZip.loadAsync = loadAsync;
    if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
    const output = run.output;
    const delivered = opened.filter(
      ({ bytes }) =>
        bytes.byteLength === output.byteLength &&
        Buffer.from(bytes).equals(Buffer.from(output)),
    );
    const packageParses = delivered.length;
    const structureParses = delivered.filter((o) => o.structure).length;
    const t1 = performance.now();
    // What the engine's check before delivery does: one parse, both answers.
    const { structure, problems } = await inspectDocxStructure(output);
    const pagesRead = structure ? docxPageTexts(structure).length : -1;
    const readMs = performance.now() - t1;
    const rssDeltaMb = peakMb() - before;
    // The read-back's shape: the same engine's output at an eighth of the
    // pages, best of 3, against the full one's best of 2 (the first is
    // above). Linear reads about 8.
    const small = await runPdfOfficeExport(
      PDF_TO_WORD_TOOL,
      await enginePdf(Math.ceil(n / 8)),
      deps,
    );
    if (!small.ok) throw new Error(`${small.kind}: ${small.message}`);
    const read = (bytes: Uint8Array) => async () => {
      const got = await inspectDocxStructure(bytes);
      if (got.structure) docxPageTexts(got.structure);
    };
    const smallReadMs = await bestOfAsync(3, read(small.output));
    const fullReadMs = Math.min(readMs, await bestOfAsync(1, read(output)));
    console.log(
      JSON.stringify({
        mode,
        pages: n,
        ms,
        readBackMs: readMs,
        rssDeltaMb: Math.round(rssDeltaMb),
        docxBytes: output.byteLength,
        problems: problems.length,
        pagesRead,
        unformattedPages: run.coverage.formattingMissingPageCount,
        unmatchedWords: run.coverage.unmatchedWords,
        packageParses,
        structureParses,
        packagesOpened: opened.length,
        fullReadMs,
        smallReadMs,
      }),
    );
    return;
  }
  throw new Error(`unknown mode ${mode}`);
}

void main();
