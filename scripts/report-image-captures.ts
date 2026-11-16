/**
 * #28 slice 3 (wraps): the capture session's report (brief §1.6), read from
 * the COMMITTED captures (`src/tests/poppler-samples-image.ts`) so anyone can
 * re-print it without the worker image:
 *
 *  1. the image's poppler version and digest;
 *  2. per wrap capture (S1–S14, S16): the bands poppler's lines form, each
 *     candidate continuation (a one-cell band directly under an aligned band
 *     or under another candidate) with its poppler-block membership — is the
 *     line above it, in its own poppler block, a line of the band above? —
 *     and today's (slice 2) outcome: Word tables and their row counts;
 *  3. S15: for each of the 17 re-captures, whether `flowText` gives the same
 *     paragraphs and the same tables on the image capture as on the 25.07
 *     capture (`src/tests/poppler-samples.ts`);
 *  4. S9: OCR'd word gaps and cell gaps in line heights, against the
 *     drawn layout of S3 (which item each OCR word's centre falls in);
 *  5. S1's geometry: row pitch, line pitch, and whether rule 4 is reached.
 *
 * Bands are grouped here by flow.ts's own rule (`bands`, flow.ts:302-320:
 * centres within half the smaller line height), restated because flow.ts
 * does not export it; cells by `CELL_GAP_EMS`, which it does.
 *
 *   npx tsx scripts/report-image-captures.ts
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { CELL_GAP_EMS, flowText } from "@/lib/workers/pdf-text/flow";
import {
  parseBboxFlow,
  type FlowLine,
  type FlowPage,
} from "@/lib/workers/pdf-text/parse";
import * as image from "@/tests/poppler-samples-image";
import * as legacy from "@/tests/poppler-samples";
import { wrappedInvoiceItems } from "@/tests/word-wrap-fixtures";

interface Placed {
  line: FlowLine;
  block: number;
  prev: FlowLine | null;
  next: FlowLine | null;
  cells: number;
  yCenter: number;
  height: number;
  text: string;
}

const textOf = (l: FlowLine) => l.words.map((w) => w.text).join(" ");

function cellsOf(line: FlowLine): number {
  const h = Math.max(1, line.yMax - line.yMin);
  const words = [...line.words].sort((a, b) => a.xMin - b.xMin);
  let n = words.length ? 1 : 0;
  for (let k = 1; k < words.length; k++)
    if (words[k]!.xMin - words[k - 1]!.xMax > CELL_GAP_EMS * h) n++;
  return n;
}

function placedLines(page: FlowPage): Placed[] {
  const out: Placed[] = [];
  page.blocks.forEach((block, b) =>
    block.lines.forEach((line, i) =>
      out.push({
        line,
        block: b,
        prev: block.lines[i - 1] ?? null,
        next: block.lines[i + 1] ?? null,
        cells: cellsOf(line),
        yCenter: (line.yMin + line.yMax) / 2,
        height: Math.max(1, line.yMax - line.yMin),
        text: textOf(line),
      }),
    ),
  );
  return out;
}

/** flow.ts `bands`, restated. */
function bands(lines: Placed[]): Placed[][] {
  const sorted = [...lines].sort((a, b) => a.yCenter - b.yCenter);
  const out: Placed[][] = [];
  for (const l of sorted) {
    const band = out[out.length - 1];
    const anchor = band?.[0];
    if (
      anchor &&
      Math.abs(l.yCenter - anchor.yCenter) <=
        0.5 * Math.min(l.height, anchor.height)
    )
      band!.push(l);
    else out.push([l]);
  }
  return out;
}

const aligned = (band: Placed[]) => band.reduce((n, l) => n + l.cells, 0) >= 2;
const f1 = (n: number) => n.toFixed(1);

function outcome(xhtml: string): string {
  const flow = flowText(parseBboxFlow(xhtml));
  return flow.pages
    .map((page) => {
      const rows = new Map<number, number>();
      for (const t of page.tables ?? [])
        if (t) rows.set(t.table, (rows.get(t.table) ?? 0) + 1);
      const tables = [...rows.values()];
      return `p${page.pageNumber}: ${tables.length} table(s)${tables.length ? ` [rows ${tables.join(", ")}]` : ""}${page.tablesAsTabs ? `, ${page.tablesAsTabs} kept as tabs` : ""}, ${page.paragraphs.length} paragraph(s)`;
    })
    .join("; ");
}

function bandReport(name: string, xhtml: string): void {
  console.log(`\n### ${name}`);
  console.log(`slice-2 outcome: ${outcome(xhtml)}`);
  for (const page of parseBboxFlow(xhtml).pages) {
    const bs = bands(placedLines(page));
    let inRun = false;
    let above: Placed[] = [];
    let leftmost = Infinity;
    for (const band of bs) {
      const isAligned = aligned(band);
      const label = band
        .map((l) => `${JSON.stringify(l.text)}{b${l.block},c${l.cells}}`)
        .join(" | ");
      if (isAligned) {
        console.log(
          `  p${page.pageNumber} y=${f1(band[0]!.yCenter)} ALIGNED  ${label}`,
        );
        if (!inRun) leftmost = Infinity;
        for (const l of band) leftmost = Math.min(leftmost, l.line.xMin);
        inRun = true;
        above = band;
        continue;
      }
      // Brief §2.3: a pending continuation is a non-aligned band right after
      // an aligned band (or a pending one) whose every line starts right of
      // the run's leftmost cell; any other band closes the run.
      if (inRun && band.every((l) => l.line.xMin > leftmost + 0.5)) {
        // A candidate continuation: membership of each of its lines.
        const lines = new Set(above.map((l) => l.line));
        const notes = band.map((l) => {
          const member = l.prev !== null && lines.has(l.prev);
          const upper = l.prev ? JSON.stringify(textOf(l.prev)) : "none";
          return `${member ? "IN" : "NOT in"} the block of the line above (prev=${upper}${l.prev ? `, ${l.prev.words.length} words` : ""})`;
        });
        console.log(
          `  p${page.pageNumber} y=${f1(band[0]!.yCenter)} CONT?    ${label} — ${notes.join("; ")}`,
        );
        above = [...above, ...band];
        continue;
      }
      inRun = false;
      console.log(
        `  p${page.pageNumber} y=${f1(band[0]!.yCenter)} single   ${label}`,
      );
    }
  }
}

function tableShape(xhtml: string): string {
  return JSON.stringify(
    flowText(parseBboxFlow(xhtml)).pages.map((p) =>
      (p.tables ?? []).map((t) => (t ? [t.table, t.col] : null)),
    ),
  );
}

function s15(): void {
  console.log("\n## S15: image (22.12) vs 25.07 captures, flowText");
  const names = Object.keys(legacy).filter((k) => k.endsWith("_BBOX"));
  let differ = 0;
  for (const key of names) {
    const old = String((legacy as Record<string, unknown>)[key]);
    const now = String((image as Record<string, unknown>)[`IMAGE_${key}`]);
    const a = flowText(parseBboxFlow(old));
    const b = flowText(parseBboxFlow(now));
    const paras =
      JSON.stringify(a.pages.map((p) => p.paragraphs)) ===
      JSON.stringify(b.pages.map((p) => p.paragraphs));
    const tables = tableShape(old) === tableShape(now);
    const tabs =
      JSON.stringify(a.pages.map((p) => p.tablesAsTabs ?? 0)) ===
      JSON.stringify(b.pages.map((p) => p.tablesAsTabs ?? 0));
    const blocks = (x: string) =>
      parseBboxFlow(x).pages.map((p) =>
        p.blocks.map((bl) => bl.lines.length).join(","),
      );
    const sameBlocks =
      JSON.stringify(blocks(old)) === JSON.stringify(blocks(now));
    if (!paras || !tables || !tabs) differ++;
    console.log(
      `  ${key}: paragraphs ${paras ? "same" : "DIFFER"}, tables ${tables ? "same" : "DIFFER"}, tabs ${tabs ? "same" : "DIFFER"}; poppler blocks ${sameBlocks ? "same" : `differ (25.07 ${JSON.stringify(blocks(old))} vs 22.12 ${JSON.stringify(blocks(now))})`}`,
    );
    if (!paras) {
      const pa = a.pages.flatMap((p) => p.paragraphs.map((c) => c.join(" ⇥ ")));
      const pb = b.pages.flatMap((p) => p.paragraphs.map((c) => c.join(" ⇥ ")));
      console.log(`    25.07: ${JSON.stringify(pa)}`);
      console.log(`    22.12: ${JSON.stringify(pb)}`);
    }
    if (!tables) {
      console.log(`    25.07 tables: ${tableShape(old)}`);
      console.log(`    22.12 tables: ${tableShape(now)}`);
    }
  }
  console.log(`  ${differ} of ${names.length} differ in flowText`);
}

async function s9(): Promise<void> {
  console.log("\n## S9: OCR'd S3 — gaps in line heights");
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // The drawn items as boxes in poppler's frame (top-left origin): x range
  // from the face's widths, y from the baseline down to 0.25 em below and up
  // to 0.75 em above.
  const items = wrappedInvoiceItems().map((d, k) => {
    const size = d.size ?? 10;
    const w = (d.bold ? bold : regular).widthOfTextAtSize(d.text, size);
    const x0 =
      d.align === "right" ? d.x - w : d.align === "centre" ? d.x - w / 2 : d.x;
    return {
      k,
      text: d.text,
      x0,
      x1: x0 + w,
      top: 792 - d.y - 0.75 * size,
      bottom: 792 - d.y + 0.25 * size,
    };
  });
  const page = parseBboxFlow(image.IMAGE_OCR_WRAPPED_INVOICE_BBOX).pages[0]!;
  const word: { gap: number; pair: string }[] = [];
  const cell: { gap: number; pair: string }[] = [];
  let unmatched = 0;
  for (const block of page.blocks)
    for (const line of block.lines) {
      const h = Math.max(1, line.yMax - line.yMin);
      const ws = [...line.words].sort((a, b) => a.xMin - b.xMin);
      const owner = ws.map((w) => {
        const cx = (w.xMin + w.xMax) / 2;
        const cy = (w.yMin + w.yMax) / 2;
        const hit = items.find(
          (it) =>
            cx >= it.x0 - 1 &&
            cx <= it.x1 + 1 &&
            cy >= it.top - 2 &&
            cy <= it.bottom + 2,
        );
        if (!hit) unmatched++;
        return hit?.k ?? -1;
      });
      for (let i = 1; i < ws.length; i++) {
        if (owner[i]! < 0 || owner[i - 1]! < 0) continue;
        const gap = (ws[i]!.xMin - ws[i - 1]!.xMax) / h;
        const pair = `${ws[i - 1]!.text}|${ws[i]!.text} (h=${f1(h)})`;
        (owner[i] === owner[i - 1] ? word : cell).push({ gap, pair });
      }
    }
  // Tesseract's layer puts each cell on a poppler line of its own, so the
  // cell gaps are between LINES of one band: neighbours left to right.
  const restored = (w: { text: string; xMin: number; xMax: number }) => {
    const n = Array.from(w.text.trim()).length;
    return n ? w.xMin + ((w.xMax - w.xMin) * (n + 1)) / n : w.xMax;
  };
  const across: { gap: number; widened: number; pair: string }[] = [];
  for (const band of bands(placedLines(page))) {
    const row = [...band].sort((a, b) => a.line.xMin - b.line.xMin);
    for (let i = 1; i < row.length; i++) {
      const a = row[i - 1]!;
      const b = row[i]!;
      const h = Math.max(a.height, b.height);
      const last = a.line.words[a.line.words.length - 1]!;
      across.push({
        gap: (b.line.xMin - a.line.xMax) / h,
        widened: (b.line.xMin - restored(last)) / h,
        pair: `${a.text}|${b.text} (h=${f1(h)})`,
      });
    }
  }
  across.sort((x, y) => x.gap - y.gap);
  console.log(
    `  cell gaps between lines of one band: ${across.length}; smallest: ${across
      .slice(0, 5)
      .map(
        (g) =>
          `${g.gap.toFixed(2)} h (${g.widened.toFixed(2)} h with restoreTesseractWordWidths) ${g.pair}`,
      )
      .join("; ")}`,
  );
  console.log(`  CELL_GAP_EMS = ${CELL_GAP_EMS} h`);
  word.sort((a, b) => b.gap - a.gap);
  cell.sort((a, b) => a.gap - b.gap);
  const ocrWords = page.blocks.flatMap((b) =>
    b.lines.flatMap((l) => l.words.map((w) => w.text)),
  );
  console.log(`  OCR words (${ocrWords.length}): ${JSON.stringify(ocrWords)}`);
  console.log(`  words matched to no drawn item: ${unmatched}`);
  console.log(
    `  word gaps measured: ${word.length}; largest: ${word
      .slice(0, 5)
      .map((g) => `${g.gap.toFixed(2)} h ${g.pair}`)
      .join("; ")}`,
  );
  console.log(
    `  cell gaps measured (same OCR line): ${cell.length}; smallest: ${cell
      .slice(0, 5)
      .map((g) => `${g.gap.toFixed(2)} h ${g.pair}`)
      .join("; ")}`,
  );
  console.log(
    `  slice-2 outcome on the OCR capture: ${outcome(image.IMAGE_OCR_WRAPPED_INVOICE_BBOX)}`,
  );
  bandReport(
    "OCR_WRAPPED_INVOICE (bands)",
    image.IMAGE_OCR_WRAPPED_INVOICE_BBOX,
  );
}

function s1Geometry(): void {
  console.log("\n## S1 geometry (from the capture)");
  const page = parseBboxFlow(image.IMAGE_DOCX_TABLE_WRAPS_PROBE_BBOX).pages[0]!;
  const lines = placedLines(page);
  const bs = bands(lines);
  const centres = bs.map((b) => b[0]!.yCenter);
  console.log(`  band centres: ${centres.map(f1).join(", ")}`);
  console.log(
    `  centre-to-centre: ${centres
      .slice(1)
      .map((c, k) => f1(c - centres[k]!))
      .join(", ")}`,
  );
  const heights = lines.map((l) => l.height);
  console.log(`  line heights: ${[...new Set(heights.map(f1))].join(", ")}`);
  const cont = lines.find((l) => l.text === "assembly for model X");
  const upper = cont?.prev ? textOf(cont.prev) : null;
  console.log(
    `  "assembly for model X": prev in its block = ${JSON.stringify(upper)} (${cont?.prev?.words.length ?? 0} words) → rule 4 ${upper === "Replacement pump and housing" ? "REACHED" : "NOT reached"}`,
  );
}

async function main(): Promise<void> {
  const s = image.IMAGE_CAPTURE_SESSION;
  console.log("## Version and image");
  console.log(
    `  ${s.poppler.split("\n")[0]}; ${s.image}; captured ${s.captured}; ocrmypdf ${s.ocrmypdf}, ${s.tesseract}`,
  );
  s1Geometry();
  console.log(
    "\n## S1–S14, S16: bands, continuation membership, slice-2 outcome",
  );
  const legacyNames = new Set(
    Object.keys(legacy)
      .filter((k) => k.endsWith("_BBOX"))
      .map((k) => `IMAGE_${k}`),
  );
  for (const [key, value] of Object.entries(image as Record<string, unknown>)) {
    if (
      !/^IMAGE_\w+_BBOX$/.test(key) ||
      legacyNames.has(key) ||
      key === "IMAGE_OCR_WRAPPED_INVOICE_BBOX"
    )
      continue;
    bandReport(key, String(value));
  }
  s15();
  await s9();
}

void main();
