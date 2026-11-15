// @vitest-environment node
/**
 * #28 slice 3 (wraps): a wrapped table cell keeps its continuation lines
 * (flow.ts rule 7). Every pin here is MEASURED on the production worker
 * image's poppler (22.12.0, `src/tests/poppler-samples-image.ts`), not the
 * stand-in and not the Windows 25.07 build: slice 2's stand-in predicted one
 * table of 3 rows per wrapped fixture and the image printed 0 and 1.
 *
 * The invariants are the specification (brief §2.3), each a test with a
 * health check and a positive control:
 *  - INV-0: absorption OFF equals slice 2 — a FILE written by slice 2's own
 *    code (`src/tests/flow-slice2-golden.json`), not the branch's off path;
 *  - INV-1: on every page where nothing is absorbed, ON equals OFF in every
 *    field (the digest in flow.test.ts hashes only three of them);
 *  - INV-2 / INV-2b: no poppler word box and no character is lost or
 *    doubled (pieces, and `flowPageText`, which pieces cannot see);
 *  - INV-3 / INV-4: where an absorbed line may go, and the placement
 *    predicate extended to the column's SLOT (`insideSlot`, the bound rule 7
 *    itself uses);
 *  - INV-5: order — absorbed words in their row, after the cell's own text.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as legacy from "@/tests/poppler-samples";
import * as image from "@/tests/poppler-samples-image";
import {
  flowPageText,
  flowText,
  WORD_FLOW_POLICY,
  type FlowBox,
  type FlowPiece,
  type PdfFlowTextPage,
} from "./flow";
import { parseBboxFlow, type FlowPage } from "./parse";
import { figureColumns, insideSlot } from "./table-grid";

const OFF = { absorbWraps: false };
type Page = PdfFlowTextPage;

const exportsOf = (module: string, m: Record<string, unknown>) =>
  Object.entries(m)
    .filter(
      (e): e is [string, string] =>
        /_BBOX$/.test(e[0]) && typeof e[1] === "string",
    )
    .map(([name, xhtml]) => ({ key: `${module}:${name}`, name, xhtml }));

/** Both corpora, discovered: every `_BBOX` export of each module. */
const LEGACY = exportsOf("poppler-samples", legacy);
const IMAGE = exportsOf("poppler-samples-image", image);
const CORPUS = [...LEGACY, ...IMAGE];

const on = (xhtml: string) => flowText(parseBboxFlow(xhtml)).pages;
const off = (xhtml: string) => flowText(parseBboxFlow(xhtml), OFF).pages;
const pageOn = (page: FlowPage) =>
  flowText({ pageCount: 1, pages: [page] }).pages[0]!;
const pageOff = (page: FlowPage) =>
  flowText({ pageCount: 1, pages: [page] }, OFF).pages[0]!;

const centre = (b: FlowBox) => (b[1] + b[3]) / 2;
const height = (b: FlowBox) => Math.max(1, b[3] - b[1]);

/**
 * A table cell's pieces grouped into the poppler lines they came from: the
 * cell's own line first, then each absorbed line (a piece whose centre is
 * more than half a line from the line before's).
 */
function linesOfCell(pieces: readonly FlowPiece[]): FlowPiece[][] {
  const out: FlowPiece[][] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    const anchor = last?.[0];
    if (
      anchor &&
      Math.abs(centre(p.box) - centre(anchor.box)) <=
        0.5 * Math.min(height(p.box), height(anchor.box))
    )
      last!.push(p);
    else out.push([p]);
  }
  return out;
}

/** Every absorbed line on a page, where it went. */
interface Absorbed {
  row: number;
  cell: number;
  /** 1 for the first continuation of its cell, 2 for the next, … */
  rank: number;
  pieces: FlowPiece[];
}
function absorbedOn(page: Page): Absorbed[] {
  const out: Absorbed[] = [];
  page.paragraphs.forEach((cells, i) => {
    if (!page.tables?.[i]) return;
    cells.forEach((_, c) =>
      linesOfCell(page.pieces![i]![c]!).forEach((pieces, rank) => {
        if (rank > 0) out.push({ row: i, cell: c, rank, pieces });
      }),
    );
  });
  return out;
}

const keyOf = (p: FlowPiece) => p.box.join(",");
const pieceSeq = (page: Page) =>
  (page.pieces ?? []).flatMap((cells) => cells.flatMap((c) => c));

/** INV-2: the multiset difference of word boxes, as `+key` / `-key`. */
function boxDifference(a: Page, b: Page): string[] {
  const count = new Map<string, number>();
  for (const p of pieceSeq(a))
    count.set(keyOf(p), (count.get(keyOf(p)) ?? 0) + 1);
  for (const p of pieceSeq(b))
    count.set(keyOf(p), (count.get(keyOf(p)) ?? 0) - 1);
  return [...count]
    .filter(([, n]) => n !== 0)
    .map(([k, n]) => `${n > 0 ? "+" : "-"}${k}`);
}

/** INV-2b: `flowPageText` with whitespace and U+00AD removed, sorted. */
const charBag = (page: Page) =>
  [...flowPageText(page).replace(/[\s­]/gu, "")].sort().join("");

/** INV-5: the problems with where and in what order absorbed words sit. */
function orderProblems(onPage: Page, offPage: Page): string[] {
  const problems: string[] = [];
  const absorbed = absorbedOn(onPage);
  // (a) The brief's "remove the absorbed words and the sequences are
  // identical" is FALSE where absorption makes a table of rows slice 2 read
  // in poppler's column-by-column order (the probe: slice 2 had no table).
  // So: every word of a table that absorbs is set aside, and the rest of the
  // page must be in the same order; inside such a table the words not
  // absorbed read row by row, top to bottom (each row's cells are held left
  // to right by INV-4's columns).
  const absorbing = new Set(absorbed.map((a) => onPage.tables![a.row]!.table));
  const inAbsorbing = new Set<string>();
  onPage.paragraphs.forEach((_, i) => {
    const r = onPage.tables?.[i];
    if (r && absorbing.has(r.table))
      for (const cell of onPage.pieces![i]!)
        for (const p of cell) inAbsorbing.add(keyOf(p));
  });
  const rest = (p: Page) =>
    pieceSeq(p)
      .map(keyOf)
      .filter((k) => !inAbsorbing.has(k));
  if (rest(onPage).join("|") !== rest(offPage).join("|"))
    problems.push("(a) the words outside the absorbing tables changed order");
  let lastTop = -Infinity;
  let lastTable = -1;
  onPage.paragraphs.forEach((_, i) => {
    const r = onPage.tables?.[i];
    if (!r || !absorbing.has(r.table)) return;
    const top = centre(onPage.pieces![i]![0]![0]!.box);
    if (r.table === lastTable && top <= lastTop)
      problems.push(`(a) row ${i} reads before the row above it`);
    lastTop = top;
    lastTable = r.table;
  });
  // (b) each cell: its own line, then continuations top to bottom, each left
  // to right.
  onPage.paragraphs.forEach((cells, i) => {
    if (!onPage.tables?.[i]) return;
    cells.forEach((_, c) => {
      const lines = linesOfCell(onPage.pieces![i]![c]!);
      lines.forEach((line, k) => {
        if (k > 0 && centre(line[0]!.box) <= centre(lines[k - 1]![0]!.box))
          problems.push(
            `(b) row ${i} cell ${c}: line ${k} above the one before`,
          );
        line.forEach((p, j) => {
          if (j > 0 && p.box[0] < line[j - 1]!.box[0])
            problems.push(`(b) row ${i} cell ${c}: words out of order`);
        });
      });
    });
  });
  // (c) the target row is the nearest table row above the line.
  const tops = onPage.paragraphs.map((_, i) =>
    onPage.tables?.[i] ? centre(onPage.pieces![i]![0]![0]!.box) : null,
  );
  for (const a of absorbed) {
    const y = centre(a.pieces[0]!.box);
    let nearest = -1;
    tops.forEach((t, i) => {
      if (t !== null && t < y && (nearest < 0 || t > tops[nearest]!))
        nearest = i;
    });
    if (nearest !== a.row)
      problems.push(`(c) a line at ${y} is in row ${a.row}, not ${nearest}`);
  }
  return problems;
}

/** INV-3 and INV-4: where an absorbed line may sit, and every cell's column. */
function placeProblems(page: Page): string[] {
  const problems: string[] = [];
  const firstRowOf = new Map<number, number>();
  page.tables?.forEach((r, i) => {
    if (r && !firstRowOf.has(r.table)) firstRowOf.set(r.table, i);
  });
  // Each table's figure columns, over its cells' OWN lines (as rule 7 saw).
  const figures = new Map<number, ReadonlySet<number>>();
  for (const [t, first] of firstRowOf) {
    const rows: { text: string }[][] = [];
    const col: number[][] = [];
    page.tables!.forEach((r, i) => {
      if (r?.table !== t) return;
      rows.push(
        page.pieces![i]!.map((cell) => ({
          text: linesOfCell(cell)[0]!
            .map((p) => p.text)
            .join("")
            .trim(),
        })),
      );
      col.push([...r.col]);
    });
    figures.set(
      t,
      figureColumns(rows, { spans: page.tables![first]!.spans, col }),
    );
  }
  page.paragraphs.forEach((cells, i) => {
    const row = page.tables?.[i];
    if (!row) return;
    row.col.forEach((k, c) => {
      if (c > 0 && k < row.col[c - 1]!)
        problems.push(`INV-4 row ${i}: column ${k} after ${row.col[c - 1]}`);
      const pieces = page.pieces![i]![c]!;
      if (pieces.map((p) => p.text).join("") !== cells[c])
        problems.push(`INV-3 row ${i} cell ${c}: pieces are not its text`);
      const [own, ...tails] = linesOfCell(pieces);
      const span = row.spans[k];
      for (const p of own!)
        if (!span || p.box[0] < span[0] || p.box[2] > span[1])
          problems.push(`INV-4 row ${i} cell ${c}: outside column ${k}`);
      if (tails.length === 0) return;
      if (k === 0) problems.push(`INV-3 row ${i}: absorbed into column 0`);
      if (row.col.filter((x) => x === k).length !== 1)
        problems.push(`INV-3 row ${i}: absorbed into a combined slot`);
      if (i !== firstRowOf.get(row.table) && figures.get(row.table)!.has(k))
        problems.push(`INV-3 row ${i}: absorbed under a figure column`);
      for (const line of tails) {
        let x1 = -Infinity;
        for (const p of line) if (p.box[2] > x1) x1 = p.box[2];
        if (!insideSlot(row.spans, k, line[0]!.box[0], x1))
          problems.push(`INV-4 row ${i} cell ${c}: a line outside slot ${k}`);
      }
    });
  });
  return problems;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/* ------------------------------------------------------------------ */

describe("flow rule 7 — the corpus (both captures) and its bounds", () => {
  it("is discovered, at least 40 samples, and at least the five named ones absorb", () => {
    // A corpus under the bound is the CORPUS failing, not the code (rule 4).
    expect(
      CORPUS.length,
      `implausibly small corpus: ${CORPUS.map((c) => c.key).join(", ")}`,
    ).toBeGreaterThanOrEqual(40);
    const absorbing = CORPUS.filter(({ xhtml }) =>
      on(xhtml).some((p) => (p.wrapLines ?? 0) > 0),
    ).map((c) => c.name);
    console.log(
      `rule 7 corpus: ${CORPUS.length}; absorbing: ${absorbing.join(", ")}`,
    );
    expect(absorbing.length).toBeGreaterThanOrEqual(5);
    expect(absorbing).toEqual(
      expect.arrayContaining([
        "IMAGE_DOCX_TABLE_WRAPS_PROBE_BBOX",
        "IMAGE_WRAPPED_LONG_BBOX",
        "IMAGE_WRAPPED_SHORT_BBOX",
        "IMAGE_WRAPPED_INVOICE_BBOX",
        "IMAGE_BANK_STATEMENT_BBOX",
      ]),
    );
  });

  /**
   * Printed AND asserted. Every `poppler-samples.ts` sample absorbs nothing,
   * which is why flow.test.ts's digest stays unedited.
   */
  it("the absorbed-line count of every sample", () => {
    const counts = Object.fromEntries(
      CORPUS.map(({ key, xhtml }) => [
        key,
        on(xhtml).reduce((n, p) => n + (p.wrapLines ?? 0), 0),
      ]),
    );
    console.log(JSON.stringify(counts, null, 1));
    for (const { key } of LEGACY) expect(counts[key], key).toBe(0);
    const absorbing = Object.fromEntries(
      Object.entries(counts).filter(([, n]) => n > 0),
    );
    expect(absorbing).toEqual({
      "poppler-samples-image:IMAGE_DOCX_TABLE_WRAPS_PROBE_BBOX": 3,
      "poppler-samples-image:IMAGE_WRAPPED_LONG_BBOX": 1,
      "poppler-samples-image:IMAGE_WRAPPED_SHORT_BBOX": 1,
      "poppler-samples-image:IMAGE_WRAPPED_INVOICE_BBOX": 5,
      "poppler-samples-image:IMAGE_WRAPPED_INVOICE_STRAY_NUMBER_BBOX": 5,
      "poppler-samples-image:IMAGE_WRAPPED_INVOICE_AMOUNT_NOTE_BBOX": 4,
      "poppler-samples-image:IMAGE_WRAPPED_INVOICE_EMBEDDED_BBOX": 5,
      "poppler-samples-image:IMAGE_BANK_STATEMENT_BBOX": 4,
      "poppler-samples-image:IMAGE_ACADEMIC_HEADER_WRAP_BBOX": 1,
      "poppler-samples-image:IMAGE_ACADEMIC_HEADER_WRAP_FIGURE_BBOX": 1,
      "poppler-samples-image:IMAGE_OCR_WRAPPED_INVOICE_BBOX": 5,
      "poppler-samples-image:IMAGE_WRAPPED_BENGALI_TABLE_BBOX": 2,
    });
  });
});

describe("INV-0: absorption off equals slice 2's frozen output", () => {
  const golden = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL("../../../tests/flow-slice2-golden.json", import.meta.url),
      ),
      "utf8",
    ),
  ) as {
    header: { commit: string; blobs: Record<string, string>; count: number };
    samples: { key: string; input: string; output: string }[];
  };
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  /** The generator's own projection (scripts/write-flow-slice2-golden.ts). */
  const project = (pages: Page[]) =>
    pages.map((p) => ({
      pageNumber: p.pageNumber,
      paragraphs: p.paragraphs,
      boxes: p.boxes ?? null,
      pieces: p.pieces ?? null,
      tables: p.tables ?? null,
      tablesAsTabs: p.tablesAsTabs ?? 0,
    }));

  it("health: the file is slice 2's (0985432a, its three modules' blobs), and covers the whole discovered corpus", () => {
    expect(golden.header.commit).toBe("0985432a");
    expect(Object.keys(golden.header.blobs).sort()).toEqual([
      "src/lib/workers/pdf-text/flow.ts",
      "src/lib/workers/pdf-text/parse.ts",
      "src/lib/workers/pdf-text/table-grid.ts",
    ]);
    console.log(
      `INV-0: golden ${golden.samples.length}, corpus ${CORPUS.length}`,
    );
    expect(golden.samples.length).toBe(golden.header.count);
    expect(golden.samples.map((s) => s.key).sort()).toEqual(
      CORPUS.map((c) => c.key).sort(),
    );
  });

  it("every sample: the same input, and OFF gives exactly slice 2's paragraphs, boxes, pieces, tables and tablesAsTabs", () => {
    const byKey = new Map(golden.samples.map((s) => [s.key, s]));
    for (const { key, xhtml } of CORPUS) {
      const g = byKey.get(key)!;
      expect(sha(xhtml), `${key} input`).toBe(g.input);
      expect(sha(JSON.stringify(project(off(xhtml)))), key).toBe(g.output);
    }
  });

  it("POSITIVE CONTROL: one changed piece in one sample fails the comparison", () => {
    const sample = CORPUS.find((c) => c.name === "IMAGE_TABLE_BBOX")!;
    const g = golden.samples.find((s) => s.key === sample.key)!;
    const pages = off(sample.xhtml);
    expect(sha(JSON.stringify(project(pages)))).toBe(g.output);
    const first = pages[0]!.pieces![0]![0]![0]!;
    pages[0]!.pieces![0]![0]![0] = { ...first, text: `${first.text}x` };
    expect(sha(JSON.stringify(project(pages)))).not.toBe(g.output);
  });
});

describe("INV-1 to INV-5 over every page of both corpora", () => {
  const pages = CORPUS.flatMap(({ key, xhtml }) => {
    const a = on(xhtml);
    const b = off(xhtml);
    return a.map((p, i) => ({
      key: `${key}#${p.pageNumber}`,
      on: p,
      off: b[i]!,
    }));
  });

  it("INV-1: every page with nothing absorbed is identical on and off in every field; the pages skipped are exactly those that absorb", () => {
    const checked: string[] = [];
    const skipped: string[] = [];
    for (const p of pages) {
      if ((p.on.wrapLines ?? 0) > 0) {
        skipped.push(p.key);
        continue;
      }
      expect(p.on, p.key).toEqual(p.off);
      checked.push(p.key);
    }
    console.log(
      `INV-1 checked ${checked.length} pages, skipped ${skipped.length}: ${skipped.join(", ")}`,
    );
    // Bound: every legacy page at least, so a counter reporting "absorbed"
    // everywhere cannot make INV-1 vacuous.
    const legacyPages = LEGACY.reduce((n, c) => n + on(c.xhtml).length, 0);
    expect(checked.filter((k) => k.startsWith("poppler-samples:")).length).toBe(
      legacyPages,
    );
    expect(checked.length).toBeGreaterThanOrEqual(legacyPages);
    expect(skipped.sort()).toEqual(
      pages
        .filter((p) => absorbedOn(p.on).length > 0)
        .map((p) => p.key)
        .sort(),
    );
  });

  it("INV-2: the multiset of poppler word boxes is the same on and off, on every page", () => {
    let boxes = 0;
    for (const p of pages) {
      expect(boxDifference(p.on, p.off), p.key).toEqual([]);
      boxes += pieceSeq(p.on).length;
    }
    expect(boxes).toBeGreaterThanOrEqual(1000);
  });

  it("INV-2b: flowPageText's characters (whitespace and U+00AD aside) are the same multiset on and off", () => {
    for (const p of pages) expect(charBag(p.on), p.key).toBe(charBag(p.off));
  });

  it("INV-3 and INV-4: absorbed lines only in a text column past the first, one cell per slot, inside the slot; every cell in its column", () => {
    let absorbed = 0;
    for (const p of pages) {
      expect(placeProblems(p.on), p.key).toEqual([]);
      absorbed += absorbedOn(p.on).length;
    }
    expect(absorbed).toBeGreaterThanOrEqual(30);
  });

  it("INV-5: order kept — the rest unmoved, each continuation after its cell's text, in the nearest row above", () => {
    for (const p of pages)
      expect(orderProblems(p.on, p.off), p.key).toEqual([]);
  });

  describe("POSITIVE CONTROLS (on the probe's capture)", () => {
    const base = on(image.IMAGE_DOCX_TABLE_WRAPS_PROBE_BBOX)[0]!;
    const baseOff = off(image.IMAGE_DOCX_TABLE_WRAPS_PROBE_BBOX)[0]!;
    /** The C-300 row: its description holds two continuations. */
    const row = base.paragraphs.findIndex((p) => p[0] === "C-300");

    it("health: the unmodified page passes every check", () => {
      expect(row).toBeGreaterThan(0);
      expect(placeProblems(base)).toEqual([]);
      expect(orderProblems(base, baseOff)).toEqual([]);
      expect(boxDifference(base, baseOff)).toEqual([]);
    });

    it("a continuation moved into column 0 fails INV-3", () => {
      const page = clone(base);
      const [own, ...tails] = linesOfCell(page.pieces![row]![1]!);
      page.pieces![row]![1] = own!;
      page.pieces![row]![0] = [...page.pieces![row]![0]!, ...tails.flat()];
      page.paragraphs[row] = page.pieces![row]!.map((c) =>
        c.map((p) => p.text).join(""),
      );
      expect(placeProblems(page).some((s) => s.includes("column 0"))).toBe(
        true,
      );
    });

    it("a hand-shifted column fails INV-4", () => {
      const page = clone(base);
      page.tables![row] = { ...page.tables![row]!, col: [0, 2, 2] };
      expect(placeProblems(page).some((s) => s.startsWith("INV-4"))).toBe(true);
    });

    it("deleting one piece fails INV-2", () => {
      const page = clone(base);
      page.pieces![row]![1]!.pop();
      expect(boxDifference(page, baseOff)).toHaveLength(1);
    });

    it("two continuation words swapped fails INV-5 (b)", () => {
      const page = clone(base);
      const cell = page.pieces![row]![1]!;
      const n = cell.length;
      [cell[n - 1], cell[n - 2]] = [cell[n - 2]!, cell[n - 1]!];
      expect(
        orderProblems(page, baseOff).some((s) => s.startsWith("(b)")),
      ).toBe(true);
    });

    it("a continuation absorbed into the row below fails INV-5 (c)", () => {
      const page = clone(base);
      const [own, ...tails] = linesOfCell(page.pieces![row]![1]!);
      page.pieces![row]![1] = own!;
      page.pieces![row + 1]![1] = [
        ...page.pieces![row + 1]![1]!,
        ...tails.flat(),
      ];
      expect(
        orderProblems(page, baseOff).some((s) => s.startsWith("(c)")),
      ).toBe(true);
    });
  });
});

/* ------------------------------------------------------------------ */

/** A page's Word tables: each table's rows, as their cells. */
const tablesOf = (page: Page) => {
  const out = new Map<number, string[][]>();
  page.paragraphs.forEach((cells, i) => {
    const r = page.tables?.[i];
    if (r) out.set(r.table, [...(out.get(r.table) ?? []), [...cells]]);
  });
  return [...out.values()];
};
/** The paragraphs that are not rows of a Word table. */
const outside = (page: Page) =>
  page.paragraphs.filter((_, i) => !page.tables?.[i]).map((p) => p.join("\t"));

describe("flow rule 7 — pinned outcomes, measured on the image's poppler (§10.2)", () => {
  it("S1 the probe: one table of 5 rows, two absorbed cells, the total outside it", () => {
    const page = on(image.IMAGE_DOCX_TABLE_WRAPS_PROBE_BBOX)[0]!;
    expect(tablesOf(page)).toEqual([
      [
        ["Item", "Description", "Amount"],
        ["A-100", "Filter cartridge", "12.50"],
        ["B-200", "Replacement pump and housing assembly for model X", "48.00"],
        [
          "C-300",
          "Service visit Labour and parts Callout fee included",
          "95.00",
        ],
        ["D-400", "Gasket", "3.25"],
      ],
    ]);
    expect(outside(page)).toContain("158.75");
    expect(page.wrapLines).toBe(3);
    // Slice 2 on the same capture: no Word table, one kept as tabs.
    const before = off(image.IMAGE_DOCX_TABLE_WRAPS_PROBE_BBOX)[0]!;
    expect(tablesOf(before)).toEqual([]);
    expect(before.tablesAsTabs).toBe(1);
  });

  it("S2 long and short: one table of 5 rows each (slice 2 printed 0 and 1)", () => {
    const long = on(image.IMAGE_WRAPPED_LONG_BBOX)[0]!;
    expect(tablesOf(long)).toEqual([
      [
        ["Item", "Note", "Qty"],
        ["A-1", "short", "1"],
        ["B-2", "this note is long and continues here", "2"],
        ["C-3", "ok", "3"],
        ["D-4", "fine", "4"],
      ],
    ]);
    const short = on(image.IMAGE_WRAPPED_SHORT_BBOX)[0]!;
    expect(tablesOf(short)).toEqual([
      [
        ["Office", "City", "Staff"],
        ["North", "Leeds", "1"],
        ["East", "New York City", "2"],
        ["South", "Hull", "3"],
        ["West", "Bath", "4"],
      ],
    ]);
    expect(tablesOf(off(image.IMAGE_WRAPPED_LONG_BBOX)[0]!)).toHaveLength(0);
    expect(
      tablesOf(off(image.IMAGE_WRAPPED_SHORT_BBOX)[0]!).map((t) => t.length),
    ).toEqual([3]);
  });

  it("S3 invoice: the item table whole; stain-less kept; the totals their own table; the amount-only total outside", () => {
    const page = on(image.IMAGE_WRAPPED_INVOICE_BBOX)[0]!;
    const [items, totals] = tablesOf(page);
    expect(items!.map((r) => r[1])).toEqual([
      "Description",
      "Insulated stainless steel bottle with a bamboo lid",
      "Cotton tote bag Natural colour Recycled fabric",
      "Coffee dripper, stain-less steel, two cups",
      // Measured: the image's poppler prints the drawn U+00AD of a Standard
      // 14 font as "-" (U+002D), so it joins as a letter hyphen and stays.
      "Water filter car-tridges for jugs",
      "Gasket",
    ]);
    expect(totals).toEqual([
      ["Subtotal", "109.10"],
      ["VAT 20%", "21.82"],
      ["Total", "130.92"],
    ]);
    expect(outside(page)).toContain("130.92");
  });

  it("S3 with an embedded font: poppler drops the soft hyphen, and the join is a space (measured)", () => {
    const [items] = tablesOf(on(image.IMAGE_WRAPPED_INVOICE_EMBEDDED_BBOX)[0]!);
    expect(items![4]![1]).toBe("Water filter car tridges for jugs");
  });

  it("S3 with a stray number under Description, between two rows: never absorbed (rule 7's number exclusion; M2's fixture)", () => {
    const page = on(image.IMAGE_WRAPPED_INVOICE_STRAY_NUMBER_BBOX)[0]!;
    expect(tablesOf(page)[0]!.map((r) => r[1])).not.toContain("Gasket 12");
    expect(outside(page)).toContain("12");
  });

  it("S3 with 'incl. VAT' beside a wrap: two cells on one baseline form a row of their own (the stated limit), measured", () => {
    const [items] = tablesOf(
      on(image.IMAGE_WRAPPED_INVOICE_AMOUNT_NOTE_BBOX)[0]!,
    );
    expect(items).toContainEqual([
      "Natural colour Recycled fabric",
      "incl. VAT",
    ]);
    expect(items).toContainEqual([
      "P-102",
      "Cotton tote bag",
      "5",
      "6.50",
      "32.50",
    ]);
  });

  it("S4 every row wraps to 3 lines: the share cap absorbs nothing, as slice 2", () => {
    const x = image.IMAGE_WRAPPED_INVOICE_EVERY_ROW_BBOX;
    expect(on(x)).toEqual(off(x));
    expect(on(x)[0]!.wrapLines).toBeUndefined();
  });

  it("S5 bank statement: the references absorbed; the empty Debit/Credit slots stay empty", () => {
    const page = on(image.IMAGE_BANK_STATEMENT_BBOX)[0]!;
    const [t] = tablesOf(page);
    expect(t!.map((r) => r[1])).toEqual([
      "Description",
      "Card payment Tesco Stores REF 88231 CARD 4421",
      "Salary ACME Ltd REF 10045 BACS",
      "Direct debit Council Tax REF 55120 DD",
      "Transfer to savings",
      "Refund Amazon Marketplace REF 77310 CARD 4421",
    ]);
    const cols = page.tables!.filter(Boolean).map((r) => r!.col);
    expect(cols).toEqual([
      [0, 1, 2, 3, 4],
      [0, 1, 2, 4],
      [0, 1, 3, 4],
      [0, 1, 2, 4],
      [0, 1, 2, 4],
      [0, 1, 3, 4],
    ]);
  });

  it("S6 a first-column wrap ends the table: as slice 2, the continuation in no cell", () => {
    const x = image.IMAGE_ACADEMIC_LABEL_WRAP_BBOX;
    expect(on(x)).toEqual(off(x));
    expect(outside(on(x)[0]!)).toContain("time (ms)");
  });

  it("S7 header wraps: in the header cell, a figure column's header included; two at once and bottom-aligned as slice 2", () => {
    expect(
      tablesOf(on(image.IMAGE_ACADEMIC_HEADER_WRAP_BBOX)[0]!)[0]![0],
    ).toEqual(["Term", "Treasury yield (%)", "Spread", "Volume"]);
    expect(
      tablesOf(on(image.IMAGE_ACADEMIC_HEADER_WRAP_FIGURE_BBOX)[0]!)[0]![0],
    ).toEqual(["Term", "Treasury rate", "Spread", "Amount (USD)"]);
    const pair = image.IMAGE_ACADEMIC_HEADER_WRAP_PAIR_BBOX;
    expect(on(pair)).toEqual(off(pair));
    expect(tablesOf(on(pair)[0]!)[0]![1]).toEqual(["yield (%)", "(USD)"]);
    const bottom = image.IMAGE_ACADEMIC_HEADER_BOTTOM_BBOX;
    expect(on(bottom)).toEqual(off(bottom));
    expect(outside(on(bottom)[0]!)).toContain("Treasury");
  });

  it("S8 form, S10 and S11 prose, S12 two-column page: no Word table, nothing absorbed", () => {
    for (const x of [
      image.IMAGE_FORM_TABLE_BBOX,
      image.IMAGE_TWO_COLUMN_SHORT_LINES_BBOX,
      image.IMAGE_FIGURES_SIDEBAR_BBOX,
      image.IMAGE_WRAPPED_TWO_COLUMN_PAGE_BBOX,
    ]) {
      expect(on(x)).toEqual(off(x));
      expect(tablesOf(on(x)[0]!)).toEqual([]);
    }
  });

  it("S13 a wrap across a page break: no join, page 2's line is its own paragraph", () => {
    const x = image.IMAGE_WRAP_ACROSS_PAGES_BBOX;
    expect(on(x)).toEqual(off(x));
    expect(on(x)[1]!.paragraphs[0]).toEqual(["assembly for model X"]);
  });

  it("S14 Bengali: absorbed by geometry alone", () => {
    const [t] = tablesOf(on(image.IMAGE_WRAPPED_BENGALI_TABLE_BBOX)[0]!);
    expect(t).toHaveLength(5);
    expect(t!.filter((r) => r[1]!.includes(" ")).length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("S9 OCR'd invoice: the same tables as the drawn one", () => {
    const ocr = tablesOf(on(image.IMAGE_OCR_WRAPPED_INVOICE_BBOX)[0]!);
    expect(ocr.map((t) => t.length)).toEqual([6, 3]);
  });

  it("S16 a note at 1.0 and 1.5 row pitches, and the next table's centred caption: none absorbed", () => {
    for (const x of [
      image.IMAGE_TABLE_NOTE_1_0_BBOX,
      image.IMAGE_TABLE_NOTE_1_5_BBOX,
      image.IMAGE_TABLE_NOTE_CAPTION_BBOX,
    ])
      expect(on(x)).toEqual(off(x));
    expect(outside(on(image.IMAGE_TABLE_NOTE_1_0_BBOX)[0]!)).toContain(
      "Prices exclude VAT",
    );
  });

  it("S16 FLIP: the same note put in the last cell's poppler block IS absorbed — the block condition is what refuses it", () => {
    const page = parseBboxFlow(image.IMAGE_TABLE_NOTE_1_0_BBOX).pages[0]!;
    const text = (l: FlowPage["blocks"][number]["lines"][number]) =>
      l.words.map((w) => w.text).join(" ");
    const note = page.blocks.find(
      (b) => text(b.lines[0]!) === "Prices exclude VAT",
    )!;
    const gasket = page.blocks.find((b) => text(b.lines[0]!) === "Gasket")!;
    const moved: FlowPage = {
      ...page,
      blocks: page.blocks
        .filter((b) => b !== note)
        .map((b) =>
          b === gasket ? { ...b, lines: [...b.lines, ...note.lines] } : b,
        ),
    };
    expect(tablesOf(pageOn(moved))[0]!.at(-1)).toEqual([
      "C-300",
      "Gasket Prices exclude VAT",
      "3.25",
    ]);
  });

  it("LONE_TOTAL_INVOICE, SURROUNDED_INVOICE, REPORT_TABLES (both corpora): unchanged from slice 2", () => {
    for (const x of [
      legacy.LONE_TOTAL_INVOICE_BBOX,
      legacy.SURROUNDED_INVOICE_BBOX,
      legacy.REPORT_TABLES_BBOX,
      image.IMAGE_LONE_TOTAL_INVOICE_BBOX,
      image.IMAGE_SURROUNDED_INVOICE_BBOX,
      image.IMAGE_REPORT_TABLES_BBOX,
    ])
      expect(on(x)).toEqual(off(x));
  });
});

describe("flow rule 7 — the relax and the joins are only for absorbed lines", () => {
  const longPage = () => parseBboxFlow(image.IMAGE_WRAPPED_LONG_BBOX).pages[0]!;
  const lineNamed = (page: FlowPage, text: string) =>
    page.blocks
      .flatMap((b) => b.lines)
      .find((l) => l.words.map((w) => w.text).join(" ") === text)!;

  it("a continuation that fails (stretched across two columns) is not absorbed, and rule 4 then applies to the line above it: slice 2's output exactly", () => {
    const page = longPage();
    const cont = lineNamed(page, "and continues here");
    const last = cont.words[cont.words.length - 1]!;
    last.xMax += 400;
    cont.xMax = last.xMax;
    expect(pageOn(page)).toEqual(pageOff(page));
    expect(pageOn(page).wrapLines).toBeUndefined();
  });

  it("health: unstretched, the same page absorbs it", () => {
    expect(pageOn(longPage()).wrapLines).toBe(1);
  });

  it("a figure-column continuation alone on its baseline, below the header, is refused (M15's fixture, hand-built)", () => {
    const page = parseBboxFlow(image.IMAGE_DOCX_TABLE_WRAPS_PROBE_BBOX)
      .pages[0]!;
    const value = lineNamed(page, "12.50");
    const w = value.words[0]!;
    const dy = 12;
    // Under A-100's amount, one line pitch down, on a baseline nothing else
    // uses: every other condition of rule 7 holds, so only the figure-column
    // exclusion refuses it.
    const note = {
      words: [
        {
          text: "incl.",
          xMin: w.xMin,
          yMin: w.yMin + dy,
          xMax: w.xMin + 14,
          yMax: w.yMax + dy,
        },
        {
          text: "VAT",
          xMin: w.xMin + 16,
          yMin: w.yMin + dy,
          xMax: w.xMax,
          yMax: w.yMax + dy,
        },
      ],
      xMin: w.xMin,
      yMin: w.yMin + dy,
      xMax: w.xMax,
      yMax: w.yMax + dy,
    };
    const block = page.blocks.find((b) => b.lines.includes(value))!;
    block.lines.splice(block.lines.indexOf(value) + 1, 0, note);
    const out = pageOn(page);
    expect(
      out.paragraphs.some((p) => p.join("\t").includes("12.50 incl. VAT")),
    ).toBe(false);
    expect(outside(out)).toContain("incl. VAT");
  });
});

describe("flow rule 7 — the per-cell cap (MAX_WRAP_LINES_PER_CELL)", () => {
  /**
   * 60 rows; row 55's description wraps onto `tails` lines — late enough
   * that the part above a cut still has more rows than continuations (the
   * share cap would otherwise refuse it whole).
   */
  const page = (tails: number) => {
    const word = (t: string, x: number, y: number) =>
      `<word xMin="${x}" yMin="${y}" xMax="${x + 6 * t.length}" yMax="${y + 10}">${t}</word>`;
    const line = (ws: string[]) => `<line>${ws.join("")}</line>`;
    const out: string[] = [];
    let y = 50;
    for (let r = 0; r < 60; r++) {
      // Row 55's continuations share its block, as a wrap does: after a cut
      // that row is the part above's last, where rule 7 asks for the block.
      const block = [
        line([
          word(r === 0 ? "Item" : `A-${r}`, 50, y),
          word(r === 0 ? "Description" : "item", 150, y),
          word(r === 0 ? "Amount" : "1.00", 400, y),
        ]),
      ];
      if (r === 55)
        for (let k = 0; k < tails; k++) {
          y += 12;
          block.push(line([word("Part", 150, y), word("more", 180, y)]));
        }
      out.push(`<block>${block.join("")}</block>`);
      y += 18;
    }
    return parseBboxFlow(
      `<doc><page width="612" height="${y + 50}"><flow>${out.join("")}</flow></page></doc>`,
    ).pages[0]!;
  };

  it("50 continuations in one cell are absorbed; the 51st cuts the run there and stays a line of its own", async () => {
    const { MAX_WRAP_LINES_PER_CELL } = await import("./table-grid");
    expect(MAX_WRAP_LINES_PER_CELL).toBe(50);
    expect(pageOn(page(50)).wrapLines).toBe(50);
    const over = pageOn(page(51));
    expect(over.wrapLines).toBe(50);
    expect(outside(over)).toContain("Part more");
  });
});

describe("flow rule 7 — an indented first-column wrap (fitsAsCell's first clause)", () => {
  /** S6 with "time (ms)" indented 12 pt: held under the row, then refused. */
  const indented = () => {
    const page = parseBboxFlow(image.IMAGE_ACADEMIC_LABEL_WRAP_BBOX).pages[0]!;
    const line = page.blocks
      .flatMap((b) => b.lines)
      .find((l) => l.words.map((w) => w.text).join(" ") === "time (ms)")!;
    for (const w of line.words) {
      w.xMin += 12;
      w.xMax += 12;
    }
    line.xMin += 12;
    line.xMax += 12;
    return page;
  };
  it("is not absorbed into column 0: as slice 2", () => {
    expect(pageOn(indented())).toEqual(pageOff(indented()));
    expect(outside(pageOn(indented()))).toContain("time (ms)");
  });
});
