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
 *    the one shape the bucket search is still linear in per word;
 *  - `engine <pages>`: a generated PDF of `pages` pages, each a heading in
 *    bold and four lines mixing regular, bold and italic words, through the
 *    whole PDF to Word engine (real page reader, poppler stood in for) — and
 *    the structural read-back of its .docx, timed on its own.
 */
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

function matchPage(
  n: number,
  perLine = 20,
  wideFirst = false,
): { page: PdfFlowTextPage; scanned: ScannedPage } {
  const pieces: FlowPiece[] = [];
  const items: ScannedTextLine[] = [];
  const run: ScannedRun = {
    text: "w",
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
        bold: j % 2 === 1,
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
  if (mode === "match" || mode === "match-line" || mode === "match-wide") {
    const warm = matchPage(200);
    runStylesOf(warm.page, warm.scanned);
    // `match-line`: every word on ONE line — every run in one bucket, the
    // matcher's worst case for its search.
    const built = matchPage(
      n,
      mode === "match" ? 20 : n,
      mode === "match-wide",
    );
    const before = peakMb();
    const t0 = performance.now();
    const got = runStylesOf(built.page, built.scanned);
    const ms = performance.now() - t0;
    console.log(
      JSON.stringify({
        mode,
        n,
        ms: Math.round(ms),
        rssDeltaMb: Math.round(peakMb() - before),
        matched: got.matched,
        total: got.total,
        capped: got.capped,
      }),
    );
    return;
  }
  if (mode === "engine") {
    const deps = { ...pdfOfficeExportDeps(), extractFlow: flowStandIn };
    await runPdfOfficeExport(PDF_TO_WORD_TOOL, await enginePdf(1), deps);
    const pdf = await enginePdf(n);
    const before = peakMb();
    const t0 = performance.now();
    const run = await runPdfOfficeExport(PDF_TO_WORD_TOOL, pdf, deps);
    const ms = performance.now() - t0;
    if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
    const t1 = performance.now();
    // What the engine's check before delivery does: one parse, both answers.
    const { structure, problems } = await inspectDocxStructure(run.output);
    const pagesRead = structure ? docxPageTexts(structure).length : -1;
    const readMs = performance.now() - t1;
    console.log(
      JSON.stringify({
        mode,
        pages: n,
        ms: Math.round(ms),
        readBackMs: Math.round(readMs),
        rssDeltaMb: Math.round(peakMb() - before),
        docxBytes: run.output.byteLength,
        problems: problems.length,
        pagesRead,
        unformattedPages: run.coverage.formattingMissingPageCount,
        unmatchedWords: run.coverage.unmatchedWords,
      }),
    );
    return;
  }
  throw new Error(`unknown mode ${mode}`);
}

void main();
