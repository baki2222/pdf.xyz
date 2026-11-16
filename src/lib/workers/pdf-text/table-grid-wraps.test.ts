// @vitest-environment node
/**
 * #28 slice 3 (wraps): the shared predicates rule 7 stands on. `fitsAsCell`
 * is the table detector's rule (detect.ts, where it was born), now one
 * function with two consumers; `figureColumns` is `wordTableDoubt`'s
 * "numbers" leg, now one function `wordTableDoubt` calls.
 */
import { describe, expect, it } from "vitest";
import * as legacy from "@/tests/poppler-samples";
import * as image from "@/tests/poppler-samples-image";
import { detectTablesOnPage } from "../table-extract/detect";
import { flowText } from "./flow";
import { parseBboxFlow } from "./parse";
import {
  figureColumns,
  fitsAsCell,
  insideSlot,
  isNumberCell,
  overlappedSpan,
  SEGMENT_GAP_PITCHES,
  wordTableDoubt,
  WRAP_GAP_PITCHES,
  WRAP_TIGHT_PITCHES,
  type TableGrid,
} from "./table-grid";

/** Three columns with white gaps between, as flow.ts's grid has them. */
const SPANS = [
  [50, 100],
  [150, 300],
  [400, 450],
] as const;

describe("fitsAsCell", () => {
  it("a line in one column past the first fits", () => {
    expect(fitsAsCell(SPANS, 160, 280)).toBe(true);
    expect(fitsAsCell(SPANS, 410, 440)).toBe(true);
  });
  it("a line starting in the first column does not", () => {
    expect(fitsAsCell(SPANS, 50, 90)).toBe(false);
    expect(fitsAsCell(SPANS, 99, 120)).toBe(false);
  });
  it("a line straddling two columns does not", () => {
    expect(fitsAsCell(SPANS, 160, 420)).toBe(false);
  });
  it("a line starting past the last column's end does not", () => {
    expect(fitsAsCell(SPANS, 450, 500)).toBe(false);
    expect(fitsAsCell(SPANS, 460, 500)).toBe(false);
  });
  it("over gapped spans a line wholly in a gap, or wider than its column, still passes — which is why flow adds overlappedSpan (implying insideSlot)", () => {
    expect(fitsAsCell(SPANS, 310, 390)).toBe(true);
    expect(overlappedSpan(SPANS, 310, 390)).toBe(-1);
    expect(fitsAsCell(SPANS, 120, 330)).toBe(true);
    expect(overlappedSpan(SPANS, 120, 330)).toBe(1);
    expect(insideSlot(SPANS, 1, 120, 330)).toBe(true);
    expect(insideSlot(SPANS, 1, 90, 330)).toBe(false);
    expect(insideSlot(SPANS, 1, 120, 410)).toBe(false);
  });
  it("no spans: nothing fits", () => {
    expect(fitsAsCell([], 0, 10)).toBe(false);
  });
});

describe("insideSlot", () => {
  it("is bounded by the neighbouring columns, the page edge for the last", () => {
    expect(insideSlot(SPANS, 2, 300, 9999)).toBe(true);
    expect(insideSlot(SPANS, 2, 299, 9999)).toBe(false);
    expect(insideSlot(SPANS, 0, -10, 150)).toBe(true);
    expect(insideSlot(SPANS, 3, 500, 510)).toBe(false);
  });
});

describe("WRAP_GAP_PITCHES", () => {
  it("is at most SEGMENT_GAP_PITCHES: a line the wrap gap admits is never a gap that splits the table", () => {
    expect(WRAP_GAP_PITCHES).toBeLessThanOrEqual(SEGMENT_GAP_PITCHES);
  });
});

describe("WRAP_TIGHT_PITCHES", () => {
  it("is under 1 row pitch and under WRAP_GAP_PITCHES: a one-line block of its own a row pitch down is a row's spacing, never a cell's", () => {
    expect(WRAP_TIGHT_PITCHES).toBeLessThan(1);
    expect(WRAP_TIGHT_PITCHES).toBeLessThan(WRAP_GAP_PITCHES);
    expect(WRAP_TIGHT_PITCHES).toBeGreaterThan(0);
  });
});

describe("figureColumns is wordTableDoubt's numbers leg", () => {
  /** The leg as it was written inline before slice 3 (table-grid.ts at 0985432a). */
  const oracle = (
    rows: readonly (readonly { text: string }[])[],
    grid: TableGrid,
  ) => {
    const n = grid.spans.length;
    const numbers = Array.from({ length: n }, () => 0);
    const notNumbers = Array.from({ length: n }, () => 0);
    rows.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (r === 0) return;
        const k = grid.col[r]![c]!;
        if (isNumberCell(cell.text)) numbers[k]! += 1;
        else notNumbers[k]! += 1;
      }),
    );
    return [...Array(n).keys()].filter(
      (k) => numbers[k]! >= 2 && notNumbers[k] === 0,
    );
  };

  it("on every Word table of both corpora, and wordTableDoubt is null for each", () => {
    let tables = 0;
    let withFigures = 0;
    for (const [name, xhtml] of [
      ...Object.entries(legacy as Record<string, unknown>),
      ...Object.entries(image as Record<string, unknown>),
    ]) {
      if (!/_BBOX$/.test(name) || typeof xhtml !== "string") continue;
      for (const page of flowText(parseBboxFlow(xhtml)).pages) {
        const byTable = new Map<number, number[]>();
        page.tables?.forEach((r, i) => {
          if (r) byTable.set(r.table, [...(byTable.get(r.table) ?? []), i]);
        });
        for (const rowsAt of byTable.values()) {
          const grid: TableGrid = {
            spans: page.tables![rowsAt[0]!]!.spans,
            col: rowsAt.map((i) => page.tables![i]!.col),
          };
          const rows = rowsAt.map((i) =>
            page.paragraphs[i]!.map((text) => ({ text })),
          );
          const got = [...figureColumns(rows, grid)].sort((a, b) => a - b);
          expect(got, name).toEqual(oracle(rows, grid));
          expect(wordTableDoubt(rows, grid), name).toBeNull();
          tables += 1;
          if (got.length) withFigures += 1;
        }
      }
    }
    expect(tables).toBeGreaterThanOrEqual(30);
    expect(withFigures).toBe(tables);
  });

  it("POSITIVE CONTROL: a column with one word below the header is not a figure column", () => {
    const grid: TableGrid = {
      spans: [
        [0, 10],
        [20, 30],
      ],
      col: [
        [0, 1],
        [0, 1],
        [0, 1],
      ],
    };
    const rows = [
      [{ text: "Name" }, { text: "Qty" }],
      [{ text: "A" }, { text: "2" }],
      [{ text: "B" }, { text: "few" }],
    ];
    expect([...figureColumns(rows, grid)]).toEqual([]);
    expect(wordTableDoubt(rows, grid)).toBe("numbers");
  });
});

describe("the table detector reads the shared fitsAsCell (its verdicts unchanged)", () => {
  const words = (text: string, x: number, y: number) => {
    const out: {
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }[] = [];
    let at = x;
    for (const word of text.split(" ")) {
      out.push({
        text: word,
        x: at,
        y,
        width: word.length * 5.5,
        height: 10.2,
      });
      at += word.length * 5.5 + 3.06;
    }
    return out;
  };
  const rowsOf = (lines: [string, number][][]) =>
    detectTablesOnPage({
      pageNumber: 1,
      width: 612,
      height: 792,
      items: lines.flatMap((cells, r) =>
        cells.flatMap(([t, x]) => (t ? words(t, x, 700 - r * 16) : [])),
      ),
    }).map((t) => t.rows);

  it("a wrapped description row is the table's own row", () => {
    const at = [50, 160, 400];
    const body: [string, number][][] = [
      [
        ["Item", at[0]!],
        ["Description", at[1]!],
        ["Amount", at[2]!],
      ],
      [
        ["A-100", at[0]!],
        ["Pump and housing for", at[1]!],
        ["48.00", at[2]!],
      ],
      [
        ["", 0],
        ["model X", at[1]!],
        ["", 0],
      ],
      [
        ["B-200", at[0]!],
        ["Gasket", at[1]!],
        ["3.25", at[2]!],
      ],
    ];
    expect(rowsOf(body)).toEqual([
      [
        ["Item", "Description", "Amount"],
        ["A-100", "Pump and housing for", "48.00"],
        ["", "model X", ""],
        ["B-200", "Gasket", "3.25"],
      ],
    ]);
  });
});

describe("overlapping exactly one span implies lying inside its slot", () => {
  it("over 20,000 random x-ranges against disjoint spans (the reason flow.ts tests one, INV-4 the other)", () => {
    let seed = 7;
    const rand = () =>
      ((seed = (seed * 48271) % 2147483647) / 2147483647) * 600;
    let one = 0;
    for (let n = 0; n < 20_000; n++) {
      const a = rand();
      const b = rand();
      const [x0, x1] = a < b ? [a, b] : [b, a];
      const k = overlappedSpan(SPANS, x0, x1);
      if (k < 0) continue;
      one += 1;
      expect(insideSlot(SPANS, k, x0, x1), `[${x0}, ${x1}] in ${k}`).toBe(true);
    }
    // Health: the property was exercised, not vacuously true.
    expect(one).toBeGreaterThan(1000);
  });
});
