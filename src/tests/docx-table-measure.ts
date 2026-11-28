/**
 * PDF to Word's Word-table costs (#28 slice 2), measured in a FRESH process:
 * `tsx src/tests/docx-table-measure.ts <mode> [n]`. Prints one line of JSON:
 * numbers only. A process's peak resident set only rises, so each mode reads
 * the peak, runs, and reads it again. (WAS "warms up, reads the peak": no
 * mode ever warmed up, and none may at full size — the warm-up would lift
 * the baseline peak to the run's own working set, and every rssDeltaMb, and
 * so every memory bound, would read about 0. Ci-flake audit 2026-11-19.)
 *
 * Added 2026-11-22 (ci-flake audit 2026-11-19):
 *  - `grid` and `grid-wide` also report `reads` and `readsEighth`: how
 *    many times tableGrid read a cell's x-range at `n` cells and at an
 *    eighth of them (counting getters, after the timed run and the peak):
 *    work, which no runner's speed changes. An insertion sort in place of
 *    the sort reads per pair: its growth for the 8x step is the square;
 *  - every mode reports `msBest`: for the modes an exit bound divides by a
 *    control (engine, engine-tabbed, wrap, wrap-off, wrap-cut), the better
 *    of the fresh run and one more
 *    of the same work in this process (time only: the peak is read once,
 *    around the first), so a ratio of two modes is of two best samples.
 *
 * Modes:
 *  - `grid <n>`: `tableGrid` over one table of `n` cells, 10 to a row;
 *  - `grid-wide <n>`: the same, 63 to a row (Word's widest grid);
 *  - `flow <n>`: `flowText` over a page holding one aligned run of `n`
 *    cells, 10 to a row (the flow's whole table path: bands, isTable, the
 *    grid);
 *  - `engine <n>`: the whole PDF to Word job — layout, writer, and the
 *    engine's check before delivery — on a page of `n` cells in two tables
 *    of `n / 2` (10 to a row, white space between: two grid segments), the
 *    page's slot cap when `n` is `MAX_TABLE_SLOTS_PER_PAGE`;
 *  - `engine-tabbed <n>`: as `engine`, every table handed to the writer as
 *    its tabbed rows — what main delivered for the same page, the control
 *    the exit bound is measured against;
 *  - `over <n>`: as `engine`, ONE table of `n` cells — past
 *    `MAX_TABLE_CELLS` it must come out as tabbed rows, counted;
 *  - `spread <n>`: a page of `n` aligned two-cell bands in ONE block — the
 *    shape whose `Math.max(...)`/`Math.min(...)` spreads (isTable's
 *    heights, sharesAnEdge's edges, measureBlock's widths) overflowed the
 *    argument list above about 10^5 BEFORE any table cap ran;
 *  - `wrap <n>` (#28 slice 3, 2026-11-16): the whole job on ONE table of
 *    `n / 10` rows (Item / Description / Amount, a header and rows under
 *    it), every body row's Description wrapping onto a second line — every
 *    continuation absorbed (`wrapLines` = rows - 1);
 *  - `wrap-off <n>`: as `wrap`, read with absorption off
 *    (`{ absorbWraps: false }`): what slice 2 delivered for the same page,
 *    the control the exit bound is measured against;
 *  - `wrap-cut <n>`: as `wrap`, every other continuation a number, which
 *    rule 7 refuses: the run is cut at every other continuation, the worst
 *    case of the cut-and-rejudge loop;
 *  - `wrap-cell`: a table of 60 rows whose LAST row's Description carries
 *    51 continuation lines — `MAX_WRAP_LINES_PER_CELL` plus one.
 */
import {
  flowText,
  WORD_FLOW_POLICY,
  type PdfFlowText,
} from "@/lib/workers/pdf-text/flow";
import { parseBboxFlow } from "@/lib/workers/pdf-text/parse";
import { tableGrid } from "@/lib/workers/pdf-text/table-grid";
import { docxDocumentOf } from "@/lib/workers/pdf-office-export/docx-layout";
import { docxPackage } from "@/lib/workers/pdf-office-export/docx-package";
import {
  PDF_TO_WORD_TOOL,
  runPdfOfficeExport,
} from "@/lib/workers/pdf-office-export/engine";
import { noPictures } from "@/tests/page-scan-stubs";

const peakMb = () => process.resourceUsage().maxRSS / 1024;
const NO_SCAN = {
  pageCount: 0,
  pages: [],
  undecodedImages: 0,
  tooLargeImages: 0,
};

/** One page of aligned rows of `perRow` short cells; a gap after `splitAt` rows. */
function tablePage(rows: number, perRow: number, splitAt = -1): string {
  const lines: string[] = [];
  let y = 10;
  for (let r = 0; r < rows; r++) {
    if (r === splitAt) y += 40;
    const words: string[] = [];
    for (let c = 0; c < perRow; c++)
      words.push(
        `<word xMin="${c * 40}" yMin="${y}" xMax="${c * 40 + 10}" yMax="${y + 2}">${(r * perRow + c) % 1000}</word>`,
      );
    lines.push(`<line>${words.join("")}</line>`);
    y += 3;
  }
  return `<doc><page width="${perRow * 40 + 40}" height="${y + 10}"><flow><block>${lines.join("")}</block></flow></page></doc>`;
}

/**
 * #28 slice 3: a page of one Item / Description / Amount table of `rows`
 * rows (a header, then body rows), each row and its continuations one
 * poppler block; `wraps(r)` gives row r's continuation lines.
 */
function wrapPage(rows: number, wraps: (r: number) => string[]): string {
  const word = (t: string, x: number, y: number) =>
    `<word xMin="${x}" yMin="${y}" xMax="${x + 6 * t.length}" yMax="${y + 10}">${t}</word>`;
  const blocks: string[] = [];
  let y = 50;
  for (let r = 0; r < rows; r++) {
    const lines = [
      `<line>${word(r ? `A-${r}` : "Item", 50, y)}${word(r ? "item" : "Description", 150, y)}${word(r ? "1.00" : "Amount", 400, y)}</line>`,
    ];
    for (const text of r ? wraps(r) : []) {
      y += 12;
      lines.push(`<line>${word(text, 150, y)}</line>`);
    }
    blocks.push(`<block>${lines.join("")}</block>`);
    y += 18;
  }
  return `<doc><page width="612" height="${y + 50}"><flow>${blocks.join("")}</flow></page></doc>`;
}

/** The modes the cap test divides by a control's time. */
const RATIO_MODES = new Set([
  "engine",
  "engine-tabbed",
  "wrap",
  "wrap-off",
  "wrap-cut",
]);

/** The table of `n` cells, `perRow` to a row; `read` counts x-range reads. */
function gridRows(n: number, perRow: number, read?: () => void) {
  return Array.from({ length: Math.ceil(n / perRow) }, () =>
    Array.from({ length: perRow }, (_, c) =>
      read
        ? {
            get xMin() {
              read();
              return c * 40;
            },
            get xMax() {
              read();
              return c * 40 + 10;
            },
          }
        : { xMin: c * 40, xMax: c * 40 + 10 },
    ),
  );
}

async function main(): Promise<void> {
  const [mode, nArg] = process.argv.slice(2);
  const n = Number(nArg ?? "0");
  const once = await work(mode, n, true);
  // The second sample only where a ratio of two modes is taken (the exit
  // bounds against a control): elsewhere it would be time spent for nothing.
  const again = RATIO_MODES.has(mode ?? "") ? await work(mode, n, false) : once;
  const reads: Record<string, number> = {};
  if (mode === "grid" || mode === "grid-wide") {
    const perRow = mode === "grid" ? 10 : 63;
    for (const [key, size] of [
      ["reads", n],
      ["readsEighth", Math.floor(n / 8)],
    ] as const) {
      let count = 0;
      tableGrid(
        gridRows(size, perRow, () => (count += 1)),
        { cells: Infinity, slots: Infinity },
      );
      reads[key] = count;
    }
  }
  if (mode === "wrap" || mode === "wrap-cut") {
    // Rule 7's judging, counted through the flow's own seam (`onJudge`,
    // told inside the judge): the items judged on the page, every cut's
    // rejudge included. Work, which no runner's speed changes.
    let judged = 0;
    const rows = Math.ceil(n / 10);
    flowText(
      parseBboxFlow(
        mode === "wrap"
          ? wrapPage(rows, () => ["part"])
          : wrapPage(rows, (r) => [r % 2 ? "part" : "12"]),
      ),
      { ...WORD_FLOW_POLICY, onJudge: (k) => (judged += k) },
    );
    reads.judgedItems = judged;
  }
  console.log(
    JSON.stringify({
      ...once,
      msBest: Math.min(once.ms, again.ms),
      ...reads,
    }),
  );
}

/** One run of `mode` at `n`, timed; the peak read around it when `peak`. */
async function work(
  mode: string | undefined,
  n: number,
  peak: boolean,
): Promise<
  { mode?: string; n: number; ms: number; rssDeltaMb: number } & Record<
    string,
    number | boolean | string | undefined
  >
> {
  const before = peak ? peakMb() : 0;
  const t0 = performance.now();
  let extra: Record<string, number | boolean> = {};
  if (mode === "grid" || mode === "grid-wide") {
    const perRow = mode === "grid" ? 10 : 63;
    const rows = gridRows(n, perRow);
    const grid = tableGrid(rows, { cells: Infinity, slots: Infinity });
    extra = {
      columns: typeof grid === "string" ? 0 : grid.spans.length,
      rows: typeof grid === "string" ? 0 : grid.col.length,
    };
  } else if (mode === "flow" || mode === "spread") {
    const xhtml =
      mode === "flow" ? tablePage(Math.ceil(n / 10), 10) : tablePage(n, 2);
    const page = flowText(parseBboxFlow(xhtml)).pages[0]!;
    extra = {
      paragraphs: page.paragraphs.length,
      tableRows: page.tables?.filter(Boolean).length ?? 0,
      tablesAsTabs: page.tablesAsTabs ?? 0,
    };
  } else if (
    mode === "engine" ||
    mode === "engine-tabbed" ||
    mode === "over" ||
    mode?.startsWith("wrap")
  ) {
    const rows = Math.ceil(n / 10);
    const flow: PdfFlowText =
      mode === "wrap" || mode === "wrap-off"
        ? flowText(parseBboxFlow(wrapPage(rows, () => ["part"])), {
            absorbWraps: mode === "wrap",
          })
        : mode === "wrap-cut"
          ? flowText(
              parseBboxFlow(wrapPage(rows, (r) => [r % 2 ? "part" : "12"])),
            )
          : mode === "wrap-cell"
            ? flowText(
                parseBboxFlow(
                  wrapPage(60, (r) =>
                    r === 59 ? Array.from({ length: 51 }, () => "part") : [],
                  ),
                ),
              )
            : flowText(
                parseBboxFlow(
                  tablePage(rows, 10, mode === "over" ? -1 : rows / 2),
                ),
              );
    if (
      mode?.startsWith("wrap") &&
      !["wrap", "wrap-off", "wrap-cut", "wrap-cell"].includes(mode)
    )
      throw new Error(`unknown mode ${mode}`);
    const doc = docxDocumentOf(flow, NO_SCAN);
    const run = await runPdfOfficeExport(
      PDF_TO_WORD_TOOL,
      new Uint8Array([1]),
      {
        extractFlow: async () => flow,
        scanPages: noPictures,
        ...(mode === "engine-tabbed"
          ? {
              writeDocx: (d: Parameters<typeof docxPackage>[0]) =>
                docxPackage({
                  ...d,
                  pages: d.pages.map((blocks) =>
                    blocks.flatMap((b) =>
                      b.kind !== "table"
                        ? [b]
                        : b.rows.map((r) => {
                            const cells = r.slots.flatMap((x) => x ?? []);
                            return {
                              kind: "text" as const,
                              cells: cells.map((runs) =>
                                runs.map((x) => x.text).join(""),
                              ),
                              runs: cells,
                            };
                          }),
                    ),
                  ),
                }),
            }
          : {}),
      },
    );
    if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
    const JSZip = (await import("jszip")).default;
    const xml = await (
      await JSZip.loadAsync(run.output)
    )
      .file("word/document.xml")!
      .async("string");
    extra = {
      tables: (xml.match(/<w:tbl>/g) ?? []).length,
      cells: (xml.match(/<w:tc>/g) ?? []).length,
      asTabs: doc.tables?.asTabs ?? 0,
      bytes: run.output.byteLength,
      wrapLines: flow.pages.reduce((k, p) => k + (p.wrapLines ?? 0), 0),
    };
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
  const ms = performance.now() - t0;
  return {
    mode,
    n,
    ms,
    rssDeltaMb: peak ? peakMb() - before : 0,
    ...extra,
  };
}

void main().catch((error: unknown) => {
  console.log(
    JSON.stringify({ error: (error as Error).message.split("\n")[0] }),
  );
  process.exit(1);
});
