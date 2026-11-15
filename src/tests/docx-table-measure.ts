/**
 * PDF to Word's Word-table costs (#28 slice 2), measured in a FRESH process:
 * `tsx src/tests/docx-table-measure.ts <mode> [n]`. Prints one line of JSON:
 * numbers only. A process's peak resident set only rises, so each mode warms
 * up, reads the peak, runs, and reads it again.
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
 *    argument list above about 10^5 BEFORE any table cap ran.
 */
import { flowText, type PdfFlowText } from "@/lib/workers/pdf-text/flow";
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

async function main(): Promise<void> {
  const [mode, nArg] = process.argv.slice(2);
  const n = Number(nArg ?? "0");
  const before = peakMb();
  const t0 = performance.now();
  let extra: Record<string, number | boolean> = {};
  if (mode === "grid" || mode === "grid-wide") {
    const perRow = mode === "grid" ? 10 : 63;
    const rows = Array.from({ length: Math.ceil(n / perRow) }, () =>
      Array.from({ length: perRow }, (_, c) => ({
        xMin: c * 40,
        xMax: c * 40 + 10,
      })),
    );
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
  } else if (mode === "engine" || mode === "engine-tabbed" || mode === "over") {
    const rows = Math.ceil(n / 10);
    const flow: PdfFlowText = flowText(
      parseBboxFlow(tablePage(rows, 10, mode === "over" ? -1 : rows / 2)),
    );
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
    };
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
  const ms = performance.now() - t0;
  console.log(
    JSON.stringify({ mode, n, ms, rssDeltaMb: peakMb() - before, ...extra }),
  );
}

void main().catch((error: unknown) => {
  console.log(
    JSON.stringify({ error: (error as Error).message.split("\n")[0] }),
  );
  process.exit(1);
});
