// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { PDFDocument, degrees } from "pdf-lib";
import {
  A4_POINTS,
  LAST_COLUMN_MARK,
  WIDE_SHEET,
  sheetLayoutProofVerdict,
  wideSheetXlsx,
} from "./sheet-layout-proof";
import { applyXlsxPageSetup } from "./xlsx-page-setup";
import { parseSheetLayout } from "./sheet-layout";

const LANDSCAPE: [number, number] = [A4_POINTS.height, A4_POINTS.width];
const PORTRAIT_LETTER: [number, number] = [612, 792];

async function pdfOf(
  pages: [number, number][],
  rotate = 0,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const size of pages) doc.addPage(size).setRotation(degrees(rotate));
  return doc.save();
}

/** Page texts as fit + landscape lays out 400 rows: 100 rows a page, every row whole. */
function fittedTexts(pages: number, rows: number = WIDE_SHEET.rows): string[] {
  const per = Math.ceil(rows / pages);
  return Array.from({ length: pages }, (_, p) => {
    const cells: string[] = [];
    for (let r = p * per + 1; r <= Math.min(rows, (p + 1) * per); r++)
      cells.push(`${r * 31} 7 14 ${LAST_COLUMN_MARK}${r}`);
    return cells.join(" ");
  });
}

describe("sheetLayoutProofVerdict", () => {
  it("POSITIVE CONTROL: 4 A4 landscape pages, the last column on each, rows 1-400", async () => {
    const v = await sheetLayoutProofVerdict(
      await pdfOf(Array(4).fill(LANDSCAPE)),
      fittedTexts(4),
    );
    expect(v.detail).toMatch(/4 pages/);
    expect(v.ok).toBe(true);
  });

  it("a portrait box turned by /Rotate 90 is shown landscape, and passes", async () => {
    const v = await sheetLayoutProofVerdict(
      await pdfOf(Array(4).fill([A4_POINTS.width, A4_POINTS.height]), 90),
      fittedTexts(4),
    );
    expect(v.ok).toBe(true);
  });

  it("NEGATIVE CONTROL (the defect): the options ignored — 32 portrait pages, the last column on 8", async () => {
    // What a worker older than the options makes of the same sheet: the
    // columns run across 4 pages per band of rows, so only every fourth
    // page carries the last column.
    const texts = Array.from({ length: 32 }, (_, i) => {
      const band = Math.floor(i / 4);
      if (i % 4 !== 3) return `${band} 123 456 789`;
      const cells: string[] = [];
      for (let r = band * 50 + 1; r <= band * 50 + 50; r++)
        cells.push(`${LAST_COLUMN_MARK}${r}`);
      return cells.join(" ");
    });
    const v = await sheetLayoutProofVerdict(
      await pdfOf(Array(32).fill(PORTRAIT_LETTER)),
      texts,
    );
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/not landscape/);
    expect(v.detail).toMatch(/the last column on 8 of them/);
  });

  it("NEGATIVE: landscape alone (no fit) — 33 landscape pages, the last column on 11", async () => {
    const texts = Array.from({ length: 33 }, (_, i) =>
      i % 3 === 2 ? `${LAST_COLUMN_MARK}${i + 1}` : `${i} 1 2 3`,
    );
    texts[32] = `${LAST_COLUMN_MARK}1 ${LAST_COLUMN_MARK}400`;
    const v = await sheetLayoutProofVerdict(
      await pdfOf(Array(33).fill(LANDSCAPE)),
      texts,
    );
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/lack the last column/);
  });

  it("NEGATIVE: landscape Letter is not the A4 the worker writes", async () => {
    const v = await sheetLayoutProofVerdict(
      await pdfOf(Array(4).fill([792, 612])),
      fittedTexts(4),
    );
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/not A4/);
  });

  it("NEGATIVE: the last row cut", async () => {
    const v = await sheetLayoutProofVerdict(
      await pdfOf(Array(4).fill(LANDSCAPE)),
      fittedTexts(4, 399),
    );
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/last row/);
  });

  it("HEALTH: no mark anywhere, a text count that is not the page count, and a non-PDF all fail", async () => {
    const four = await pdfOf(Array(4).fill(LANDSCAPE));
    const blank = await sheetLayoutProofVerdict(four, ["", "", "", ""]);
    expect(blank.ok).toBe(false);
    expect(blank.detail).toMatch(/no "QQ<row>" cell/);
    const joined = await sheetLayoutProofVerdict(four, [
      fittedTexts(4).join(" "),
    ]);
    expect(joined.ok).toBe(false);
    expect(joined.detail).toMatch(/page by page/);
    expect(
      (await sheetLayoutProofVerdict(new TextEncoder().encode("nope"), [""]))
        .ok,
    ).toBe(false);
  });

  it("does not read QQ10 as row 1", async () => {
    const texts = fittedTexts(4);
    texts[0] = texts[0]!.replace(`${LAST_COLUMN_MARK}1 `, "");
    // Rows 10-19 still begin with "QQ1"; the first row must be read as gone.
    const v = await sheetLayoutProofVerdict(
      await pdfOf(Array(4).fill(LANDSCAPE)),
      texts,
    );
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/first row/);
  });
});

describe("wideSheetXlsx — the proof's input", () => {
  it("is deterministic, small, and has no page setup of its own", async () => {
    // Built on two different clocks, five seconds apart (more than a ZIP
    // timestamp's two-second step). Back to back on one clock, a builder
    // that stamped the time passed except when a build crossed a two-second
    // boundary: CI on PR #295 did, 2026-11-08 (JSZip's implicit folder entries
    // took the clock, not the pinned date).
    vi.useFakeTimers({ toFake: ["Date"] });
    let a: Uint8Array;
    let b: Uint8Array;
    try {
      vi.setSystemTime(new Date("2026-03-01T10:00:00Z"));
      a = await wideSheetXlsx();
      vi.setSystemTime(new Date("2026-03-01T10:00:05Z"));
      b = await wideSheetXlsx();
    } finally {
      vi.useRealTimers();
    }
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(a.byteLength).toBeLessThan(200_000);
    const sheet = await (
      await JSZip.loadAsync(a)
    )
      .file("xl/worksheets/sheet1.xml")!
      .async("string");
    expect(sheet).not.toMatch(/pageSetup/);
    expect(sheet).toContain(`<t>${LAST_COLUMN_MARK}${WIDE_SHEET.rows}</t>`);
    expect(sheet.match(/<row /g)).toHaveLength(WIDE_SHEET.rows);
    expect(sheet).toContain(`r="AN${WIDE_SHEET.rows}"`); // column 40
  });

  it("is a workbook the worker's own page-setup rewrite accepts for the bag the proof sends", async () => {
    const bag = { orientation: "landscape", fitColumnsToWidth: true };
    const parsed = parseSheetLayout(bag);
    expect(parsed.ok).toBe(true);
    const applied = await applyXlsxPageSetup(await wideSheetXlsx(), {
      orientation: "landscape",
      fitColumnsToWidth: true,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const sheet = await (
      await JSZip.loadAsync(applied.bytes)
    )
      .file("xl/worksheets/sheet1.xml")!
      .async("string");
    expect(sheet).toMatch(/orientation="landscape"/);
    expect(sheet).toMatch(/fitToWidth="1"/);
  });
});
