// @native-canvas
import { beforeAll, describe, expect, it } from "vitest";
import { DETECTION_RULES, EXCLUSION_RULES } from "./form-detect";
import { scanPaths, type OpsLike } from "./form-detect-paths";
import {
  DETECT_CASES,
  P48,
  decidingAt,
  runCase,
  textWidth,
  unexplained,
  type CaseRun,
  type DetectCase,
} from "@/tests/form-detect-fixtures";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";

/**
 * The field finder's corpus, run BOTH ways (CLAUDE.md, guards rule 1):
 *
 *  - every rule is exercised: each detection rule produces a proposal on at
 *    least one positive, and each exclusion rule is the deciding reason on at
 *    least one negative, read from what the real reader returned (not from
 *    the table's own claims);
 *  - every case is explained: positives found exactly, negatives decided by
 *    the rule they name, outcomes as stated.
 *
 * The rule ids are DERIVED from DETECTION_RULES and EXCLUSION_RULES, so a new
 * rule with no case turns this red. The corpus's own size is bounded both
 * ways, because `[] is a subset of X` passes for an empty corpus and a
 * collapsed one fails every assertion for the wrong reason.
 *
 * The walker's positive controls (H1-H3) read REAL operator lists: they pin
 * the pdf.js 6 layout form-detect-paths.ts depends on.
 */

const RUNS = new Map<string, CaseRun>();
const kind = (k: DetectCase["kind"]) =>
  DETECT_CASES.filter((c) => c.kind === k);

beforeAll(async () => {
  for (const c of DETECT_CASES) RUNS.set(c.id, await runCase(c));
}, 180_000);

const runOf = (c: DetectCase) => {
  const r = RUNS.get(c.id);
  if (!r) throw new Error(`case ${c.id} did not run`);
  return r;
};

describe("corpus health (FATAL when it fails)", () => {
  it("the corpus is not empty, and not implausibly small", () => {
    expect(DETECT_CASES.length, "corpus implausibly small").toBeGreaterThan(0);
    // Raised in review round 5 fixes (finding 9) from 14 / 15 / 6, which
    // let rounds 4 and 5 drop their cases with every test green.
    expect(
      kind("positive").length,
      "corpus implausibly small",
    ).toBeGreaterThanOrEqual(54);
    expect(
      kind("negative").length,
      "corpus implausibly small",
    ).toBeGreaterThanOrEqual(45);
    expect(
      kind("outcome").length,
      "corpus implausibly small",
    ).toBeGreaterThanOrEqual(9);
  });

  // The case ids, literally (review round 5 fixes, finding 9): a dropped,
  // renamed or duplicated case turns this red, which a count cannot see
  // when one case is swapped for another. A new case is added here too.
  it("the corpus is exactly these cases", () => {
    const range = (k: string, a: number, b: number) =>
      Array.from({ length: b - a + 1 }, (_, i) => `${k}${a + i}`);
    const expected = [
      "P1a",
      "P1b",
      "P1c",
      ...range("P", 2, 52),
      ...range("N", 1, 51),
      // Slice S3 (2026-11-19): rows of dots and box symbols, from
      // src/tests/form-detect-precision-fixtures.ts.
      ...range("P", 53, 59),
      ...range("N", 52, 57),
      // Slice S4 (2026-11-21): entry boxes and stacked lines, from
      // src/tests/form-detect-boxes-fixtures.ts.
      ...range("P", 60, 69),
      ...range("N", 58, 69),
      // Its review round 1 (2026-11-21), same file.
      ...range("P", 70, 76),
      // Its review round 2 (2026-11-22): a swoosh larger than its box.
      "P77",
      ...range("N", 70, 78),
      // Slice S5 (2026-11-22): tables, from
      // src/tests/form-detect-tables-fixtures.ts (N39 and N45 were
      // inverted in place, keeping their ids).
      ...range("P", 78, 85),
      ...range("N", 79, 85),
      // Its review round 1 (2026-11-22): paint in cells, filled tables,
      // headerless data, boxes 1 pt apart, heavy fractional rules.
      ...range("P", 86, 89),
      ...range("N", 86, 90),
      // Slice S6 (2026-11-22): combs and radio clusters, from
      // src/tests/form-detect-combs-fixtures.ts (N5, N33 and N47 were
      // inverted in place to positives, keeping their ids).
      // P102-P106 and N95 added by S6's review round 1 (2026-11-22).
      ...range("P", 90, 106),
      ...range("N", 91, 95),
      // O8 and O9 added in review round 7 (2026-11-19): a page the reader
      // sees sideways, and a scan with an OCR text layer.
      ...range("O", 1, 9),
    ];
    expect(expected).toHaveLength(212);
    expect([...DETECT_CASES.map((c) => c.id)].sort()).toEqual(expected.sort());
    for (const [k, n] of [
      ["positive", 116],
      ["negative", 87],
      ["outcome", 9],
    ] as const)
      expect(kind(k).length, k).toBe(n);
  });

  // Raised deliberately in review round 4 (was 80 cases / 120 proposals,
  // which round 4's cases passed): headroom for the next round, still a
  // bound a runaway generator or a duplicated case list would cross.
  // Raised again in review round 5 fixes (was 110 / 160; P49's 12
  // checkboxes took the proposals to 165). Raised by slice S4 (was 130
  // cases and 200 proposals; S4 added 22 cases and 21 proposals, taking
  // them to 149 and 215). Raised by S4's review round 1 (was 160 cases;
  // it added 16 cases and 11 proposals, taking them to 165 and 226).
  // Raised by slice S5 (was 185 cases and 240 proposals; S5 added 15 cases
  // and, with N39 and N45 inverted to positives, 77 proposals, taking them
  // to 181 and 303: tables propose a field a cell). S5's review round 1
  // added 9 cases and 17 proposals (190 and 320), inside both bounds.
  // Raised by slice S6 (was 200 cases and 330 proposals; S6 added 16
  // cases and, with N5, N33 and N47 inverted to positives, 30
  // proposals, taking them to 206 and 350). S6's review round 1 added 6
  // cases and 15 proposals (212 and 365), inside both bounds.
  it("the corpus is not implausibly large", () => {
    expect(DETECT_CASES.length, "corpus implausibly large").toBeLessThanOrEqual(
      220,
    );
    const proposals = kind("positive").reduce(
      (s, c) => s + runOf(c).proposals.length,
      0,
    );
    expect(proposals, "corpus implausibly large").toBeLessThanOrEqual(370);
  });

  // P27 is the label-column case only while two of its labels end beyond the
  // lone-line gap and one within it; measured with pdf-lib's own widths, so
  // a font or layout change cannot quietly turn it into a 36 pt case.
  it("P27's geometry: Email and City end over 36 pt from the tab stop, Name / Date of birth / Telephone within", () => {
    const gap = (s: string) => 140 - (72 + textWidth("sans", s, 11));
    expect(gap("Email:")).toBeGreaterThan(36);
    expect(gap("City:")).toBeGreaterThan(36);
    for (const s of ["Name:", "Date of birth:", "Telephone:"])
      expect(gap(s)).toBeLessThanOrEqual(36);
    expect(Math.max(gap("Email:"), gap("City:"))).toBeLessThanOrEqual(144);
  });

  // P48 is the two-row column case only while each column's long label
  // ends within the lone-line gap and its short one beyond it (pdf-lib's
  // widths, Helvetica 10).
  it("P48's geometry: in each column the first label ends within 36 pt of its line, the second beyond", () => {
    for (const c of P48.columns) {
      const gap = (s: string) => c.tab - (c.x + textWidth("sans", s, 10));
      expect(gap(c.labels[0]!)).toBeGreaterThan(0);
      expect(gap(c.labels[0]!)).toBeLessThanOrEqual(36);
      expect(gap(c.labels[1]!)).toBeGreaterThan(36);
    }
  });

  // P28 tests the nearer side only while, in each row, a box's own label is
  // nearer than the word on its other side (pdf-lib's widths, Helvetica 10).
  it("P28's geometry: each box's own label is nearer than the word across it", () => {
    const end = (s: string, x: number) => x + textWidth("sans", s, 10);
    // Label left: "Yes" ends before the box at 402; "No" starts at 430.
    expect(402 - end("Yes", 380)).toBeLessThan(430 - 412);
    expect(402 - end("Yes", 380)).toBeGreaterThan(0);
    // Label right: "No" starts 4 pt after the box at 430; "Yes" ends before it.
    expect(444 - 440).toBeLessThan(430 - end("Yes", 394));
  });

  // N40 is the footnote case, and P34 its control, only while the 108 pt
  // rule is at most a third of the text column (pdf-lib's widths).
  it("N40's geometry: the rule is at most a third of the text column", () => {
    const widest = Math.max(
      ...[
        "Body text runs across the whole width of the text column, line after line,",
        "as an annual report or a letter would set it, in one size from margin to",
        "margin, so that the size most of the page is set in is easy to read off.",
      ].map((s) => textWidth("sans", s, 11)),
    );
    expect(180 - 72).toBeLessThanOrEqual(widest / 3);
  });

  it("case ids are unique and every case ran", () => {
    expect(new Set(DETECT_CASES.map((c) => c.id)).size).toBe(
      DETECT_CASES.length,
    );
    expect(RUNS.size).toBe(DETECT_CASES.length);
  });
});

describe("every rule is exercised by the corpus", () => {
  for (const { id } of DETECTION_RULES) {
    it(`detection "${id}" produces a proposal on at least one positive`, () => {
      const hits = kind("positive").filter((c) =>
        runOf(c).proposals.some((p) => p.rule === id),
      );
      expect(
        hits.map((c) => c.id),
        `no positive produces ${id}`,
      ).not.toEqual([]);
    });
  }

  for (const { id } of EXCLUSION_RULES) {
    it(`exclusion "${id}" is the deciding reason on at least one negative`, () => {
      const hits = kind("negative").filter(
        (c) => c.at && decidingAt(runOf(c), c.at)?.rule === id,
      );
      expect(
        hits.map((c) => c.id),
        `no negative is decided by ${id}`,
      ).not.toEqual([]);
    });
  }
});

describe("every case is explained", () => {
  for (const c of DETECT_CASES) {
    it(`${c.id} (${c.kind}): ${c.note}`, () => {
      expect(unexplained(c, runOf(c))).toEqual([]);
    });
  }

  // Review round 3, finding 3: a checkbox squashed to 14 x 2 by text inside
  // its square passed the builder's validation. Over every case's run, not
  // only the positives: a negative that leaks a proposal is read here too.
  it("every checkbox the corpus proposes is square within 1 pt (and it proposes some)", () => {
    const boxes = DETECT_CASES.flatMap((c) => runOf(c).proposals).filter(
      (p) => p.type === "checkbox",
    );
    expect(
      boxes.length,
      "no checkbox proposed: the check is vacuous",
    ).toBeGreaterThanOrEqual(10);
    for (const p of boxes)
      expect(Math.abs(p.width - p.height), p.key).toBeLessThanOrEqual(1);
  });

  it("positives: proposals found equal proposals expected, none missing, none extra", () => {
    const want = kind("positive").reduce(
      (s, c) => s + (c.expect === "none" ? 0 : c.expect.length),
      0,
    );
    const got = kind("positive").reduce(
      (s, c) => s + runOf(c).proposals.length,
      0,
    );
    expect(want).toBeGreaterThan(0);
    expect(got).toBe(want);
  });
});

describe("seams: turning off the deciding rule lets the shape through", () => {
  // The permanent half of the mutation controls. A seam that did not land
  // leaves the rule in `excluded`, which reads red.
  for (const c of kind("negative").filter((x) => x.decidedBy)) {
    it(`${c.id}: with "${c.decidedBy}" off, a proposal appears where it decided`, async () => {
      const off = [c.decidedBy!, ...(c.seamAlsoDisable ?? [])];
      const run = await runCase(c, off);
      expect(run.excluded.map((e) => e.rule)).not.toContain(c.decidedBy);
      const at = c.at!;
      const hit = run.proposals.some(
        (p) =>
          p.page === at.page &&
          at.x >= p.x - 1 &&
          at.x <= p.x + p.width + 1 &&
          at.y >= p.y - 1 &&
          at.y <= p.y + p.height + 1,
      );
      expect(hit, `nothing proposed at ${JSON.stringify(at)}`).toBe(true);
    }, 60_000);
  }
});

/* ------------------------------------------------------------------ *
 *  Walker positive controls on REAL operator lists
 * ------------------------------------------------------------------ */

async function opList(c: DetectCase) {
  const pdfjs =
    (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof import("pdfjs-dist");
  const task = pdfjs.getDocument({
    data: (await c.build()).slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  try {
    const page = await (await task.promise).getPage(1);
    const ops = await page.getOperatorList({
      annotationMode: pdfjs.AnnotationMode.DISABLE,
    });
    const OPS = pdfjs.OPS as unknown as OpsLike;
    return {
      ops,
      OPS,
      paths: Array.from(ops.fnArray).filter((f) => f === OPS.constructPath)
        .length,
    };
  } finally {
    await task.destroy();
  }
}

const caseById = (id: string) => DETECT_CASES.find((c) => c.id === id)!;

describe("walker controls on pdf.js's own operator lists", () => {
  it("H1: P4's stroked two-point line comes out of scanPaths as a segment", async () => {
    const { ops, OPS, paths } = await opList(caseById("P4"));
    expect(paths, "P4 painted no path at all").toBeGreaterThan(0);
    const scan = scanPaths(ops.fnArray, ops.argsArray, OPS);
    expect(
      scan.segs.length,
      "pdf.js path layout changed: no segment read",
    ).toBeGreaterThanOrEqual(1);
  });

  it("H2: P8's one paint operator gives exactly three Rects (the pdf.js 6 layout pin)", async () => {
    const { ops, OPS, paths } = await opList(caseById("P8"));
    expect(paths, "P8 should paint its three squares in one operator").toBe(1);
    const scan = scanPaths(ops.fnArray, ops.argsArray, OPS);
    expect(
      scan.rects.length,
      "pdf.js path layout changed: wrong Rect count",
    ).toBe(3);
  });

  it("H3: N15's white line is in the operator list and not in the walker's output", async () => {
    const { ops, OPS, paths } = await opList(caseById("N15"));
    expect(
      paths,
      "N15 drew no path: the control would be blind",
    ).toBeGreaterThan(0);
    const scan = scanPaths(ops.fnArray, ops.argsArray, OPS);
    expect(scan.painted).toBeGreaterThan(0);
    expect(scan.segs).toEqual([]);
    expect(scan.rects).toEqual([]);
  });

  it("H4: N22's form begin carries its /BBox and N23 has a clip op; both lines are in the list and clipped out", async () => {
    // Pins where pdf.js 6 puts what the walker clips with: a move would read
    // every clipped line as visible again (or, worse, every line as hidden;
    // P16 is the control for that).
    const form = await opList(caseById("N22"));
    const begin = Array.from(form.ops.fnArray).indexOf(
      form.OPS.paintFormXObjectBegin,
    );
    expect(begin, "N22 drew no form XObject").toBeGreaterThanOrEqual(0);
    expect(
      Array.from(form.ops.argsArray[begin][1] as ArrayLike<number>),
    ).toEqual([0, 0, 10, 10]);
    const clip = await opList(caseById("N23"));
    expect(Array.from(clip.ops.fnArray)).toContain(clip.OPS.clip);
    for (const { ops, OPS, paths } of [form, clip]) {
      expect(paths, "the line is not in the operator list").toBeGreaterThan(0);
      const scan = scanPaths(ops.fnArray, ops.argsArray, OPS);
      expect(scan.painted).toBeGreaterThan(0);
      expect(scan.segs).toEqual([]);
    }
  });
});
