// @native-canvas
/**
 * Slice S4 of the Create Forms field finder (entry boxes and stacked lines),
 * held the house way (CLAUDE.md, "Guards — house style"):
 *
 *  - DETECT_BOXES against a literal table typed from the brief, so a
 *    constant moved by a factor turns red even where a test computes its
 *    boundary from it;
 *  - each threshold at its value and just past it, on hand-built pages;
 *  - the S4 corpus (src/tests/form-detect-boxes-fixtures.ts, joined onto
 *    DETECT_CASES) through the REAL reader, with health checks that
 *    `entry-box` proposes on a positive and `filled-box` decides a
 *    negative here, and that both multiline and one-line proposals occur;
 *  - the composed chain, judged where it is consumed: detect -> proposal
 *    -> the Find fields chunk's own Add (`toAdd`) -> createFormFields ->
 *    pdf.js reading the SAVED PDF: every widget inside the box or stack it
 *    was found on, and its Ff multiline bit (bit 13, 4096) set exactly for
 *    the multiline proposals;
 *  - cost: form-detect-boxes-cost.test.ts (a file of its own, so the
 *    real reader run here cannot inflate one side of a ratio).
 *
 * The rule tables' own sizes and the corpus's case list are in
 * form-detect.test.ts and form-detect.corpus.test.ts; this file holds only
 * what S4 added.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  createFormFields,
  readFormContext,
  validateFormFields,
} from "./create-forms";
import {
  DETECTION_RULES,
  DETECT_BOXES,
  EXCLUSION_RULES,
  classifyPage,
  proposalToDraftFields,
  type CardPage,
  type CardRect,
  type CardSeg,
  type CardText,
  type Box,
  type FieldProposal,
} from "./form-detect";
import { detectFormFields } from "./form-detect-read";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";
import {
  addKeys,
  toAdd,
  type Finder,
} from "@/components/tools/runner/create-forms-detect";
import { BOX_CASES, PRINTED_BOXES } from "@/tests/form-detect-boxes-fixtures";
import {
  decidingAt,
  legacyPdfjs,
  runCase,
  unexplained,
  type CaseRun,
} from "@/tests/form-detect-fixtures";

/* ------------------------------------------------------------------ *
 *  Hand-built pages (card frame = page frame, unturned)
 * ------------------------------------------------------------------ */

const txt = (
  str: string,
  x: number,
  y: number,
  o: Partial<CardText> = {},
): CardText => ({
  str,
  x,
  y,
  width: o.width ?? str.length * 5,
  size: 10,
  upright: true,
  ...o,
});

const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
  o: Partial<CardRect> = {},
): CardRect => ({
  x0: x,
  y0: y,
  x1: x + w,
  y1: y + h,
  width: 0.75,
  stroked: true,
  filled: false,
  lum: 0,
  ...o,
});

const hseg = (x0: number, x1: number, y: number): CardSeg => ({
  x0,
  y0: y,
  x1,
  y1: y,
  width: 0.75,
  stroked: true,
  filled: false,
  lum: 0,
});

const vseg = (x: number, y0: number, y1: number): CardSeg => ({
  ...hseg(x, x, y0),
  y1,
});

const pg = (o: Partial<CardPage> = {}): CardPage => ({
  page: 1,
  width: 612,
  height: 792,
  segs: [],
  rects: [],
  text: [],
  widgets: [],
  imageCover: 0,
  ...o,
});

const props = (p: CardPage) => classifyPage(p).proposals;
const rulesOf = (p: CardPage) =>
  props(p).map((x) => [x.rule, x.multiline === true]);

/** A box at (140, y), w x h, labelled "Ref:" ending 12 pt left of it. */
const labelled = (
  w: number,
  h: number,
  o: { y?: number; size?: number; x?: number; page?: Partial<CardPage> } = {},
): CardPage => {
  const x = o.x ?? 140;
  const y = o.y ?? 600;
  const size = o.size ?? 10;
  return pg({
    rects: [rect(x, y, w, h)],
    text: [txt("Ref:", x - 32, y + 4, { width: 20, size })],
    ...o.page,
  });
};

/** A box captioned "Notes" 4 pt over its top, plus `more`. */
const captioned = (b: CardRect, more: Partial<CardPage> = {}): CardPage =>
  pg({
    ...more,
    rects: [b, ...(more.rects ?? [])],
    text: [txt("Notes", b.x0, b.y1 + 4, { width: 25 }), ...(more.text ?? [])],
  });

/** `n` lines 72..400 from y 600 at `pitch`, captioned 6 pt over the top. */
const stack = (n: number, pitch: number, more: CardText[] = []): CardPage => {
  const ys = Array.from({ length: n }, (_, i) => 600 + pitch * i);
  return pg({
    segs: ys.map((y) => hseg(72, 400, y)),
    text: [
      txt("Comments:", 72, ys[ys.length - 1]! + 6, { width: 48 }),
      ...more,
    ],
  });
};

/* ------------------------------------------------------------------ *
 *  The tables
 * ------------------------------------------------------------------ */

describe("S4 tables", () => {
  // The second, independent bound (CLAUDE.md, guards rule 3): typed from
  // the slice's brief (scope items 1 to 3), not read back from the code.
  // BORDER_EPS and PAINT_CELL are this slice's own (review: decided here),
  // as are IMAGE_BLEED, LINED_SPAN and DOUBLE_GAP (review round 1).
  it("every DETECT_BOXES value is the brief's (a literal table, not a read-back)", () => {
    expect({ ...DETECT_BOXES }).toEqual({
      ENTRY_MIN_W: 40,
      ENTRY_MAX_SPAN: 0.9,
      ENTRY_MIN_H: 12,
      ENTRY_MAX_H: 120,
      MULTILINE_MIN_H: 36,
      MULTILINE_EMS: 2.2,
      STACK_PITCH_MIN: 12,
      STACK_PITCH_MAX: 30,
      BORDER_EPS: 2,
      IMAGE_BLEED: 2,
      LINED_SPAN: 0.8,
      DOUBLE_GAP: 6,
      PAINT_CELL: 50,
    });
  });

  it("entry-box is a detection rule in plain words, and filled-box an exclusion", () => {
    const plain = Object.fromEntries(
      DETECTION_RULES.map((r) => [r.id, r.plain]),
    );
    expect(plain["entry-box"]).toBe("larger empty boxes to write in");
    // The copy lists DETECTION_RULES joined by ", " and " and ": a plain
    // phrase holding either would split into two listed kinds.
    expect(plain["entry-box"]).not.toMatch(/, | and /);
    expect(EXCLUSION_RULES.map((r) => r.id)).toContain("filled-box");
  });
});

/* ------------------------------------------------------------------ *
 *  Each threshold at its value and just past it
 * ------------------------------------------------------------------ */

describe("entry box size bounds", () => {
  it("width: 40 pt is an entry box, 39.9 is a box's bottom line as before", () => {
    expect(rulesOf(labelled(40, 20))).toEqual([["entry-box", false]]);
    expect(rulesOf(labelled(39.9, 20))).toEqual([["labelled-rule", false]]);
  });

  // On a 600 pt page, where 0.9 x the width is exact (540): on Letter,
  // 0.9 x 612 is 550.8000000000001 in floating point, so a box 550.8 wide
  // was inside the bound whether it read <= or < (review round 1, guards
  // LOW: the `<` mutant survived).
  it("width: 0.9 of the page (540 of 600) is an entry box, 540.1 is not", () => {
    expect(0.9 * 600).toBe(540);
    const at = (w: number) =>
      rulesOf(
        pg({
          width: 600,
          rects: [rect(40, 600, w, 20)],
          text: [txt("No", 10, 604, { width: 20 })],
        }),
      );
    expect(at(540)).toEqual([["entry-box", false]]);
    expect(at(540.1)).toEqual([["labelled-rule", false]]);
  });

  it("height: 12 pt is an entry box, 11.9 is not", () => {
    expect(rulesOf(labelled(200, 12))).toEqual([["entry-box", false]]);
    expect(rulesOf(labelled(200, 11.9))).toEqual([["labelled-rule", false]]);
  });

  it("height: 120 pt is an entry box (multiline), 120.1 is not", () => {
    expect(rulesOf(labelled(200, 120))).toEqual([["entry-box", true]]);
    expect(rulesOf(labelled(200, 120.1))).toEqual([["labelled-rule", false]]);
  });

  it("the field fills the box, inset 1 pt", () => {
    expect(props(labelled(200, 50))).toMatchObject([
      { x: 141, y: 601, width: 198, height: 48, label: "Ref" },
    ]);
  });
});

describe("multiline: height >= max(36, 2.2 x the label's size)", () => {
  it("10 pt label: 36 pt is multiline, 35.9 is one line", () => {
    expect(rulesOf(labelled(200, 36))).toEqual([["entry-box", true]]);
    expect(rulesOf(labelled(200, 35.9))).toEqual([["entry-box", false]]);
  });

  it("20 pt label: 44 pt is multiline, 43.9 is one line (the factor, past the floor)", () => {
    expect(rulesOf(labelled(200, 44, { size: 20 }))).toEqual([
      ["entry-box", true],
    ]);
    expect(rulesOf(labelled(200, 43.9, { size: 20 }))).toEqual([
      ["entry-box", false],
    ]);
  });

  it("only a text proposal ever carries multiline, and only as true", () => {
    const all = BOX_CASES.flatMap((c) => RUNS.get(c.id)?.proposals ?? []);
    for (const p of all) {
      if ("multiline" in p) expect(p.multiline, p.key).toBe(true);
      if (p.multiline) expect(p.type, p.key).toBe("text");
    }
  });
});

describe("what counts as inside a box", () => {
  it("text: an item reaching 1 pt past an edge's inset is inside (no entry box); one stopping there is not", () => {
    const at = (x: number) =>
      rulesOf(
        pg({
          rects: [rect(140, 600, 200, 40)],
          text: [
            txt("Ref:", 108, 604, { width: 20 }),
            txt("x", x, 620, { width: 10 }),
          ],
        }),
      );
    // The box's inside runs 141..339: an item from 339 is beside it.
    expect(at(339)).toEqual([["entry-box", true]]);
    expect(at(338.9)).not.toContainEqual(["entry-box", true]);
  });

  it("a line BORDER_EPS (2 pt) inside an edge is inside it; 1.9 pt is the border", () => {
    const at = (x: number) =>
      classifyPage(
        captioned(rect(140, 600, 200, 40), { segs: [vseg(x, 605, 630)] }),
      ).excluded.map((e) => e.rule);
    expect(at(142)).toContain("filled-box");
    expect(at(141.9)).not.toContain("filled-box");
  });

  it("a fill within 2 pt of the box is its fill; one 2.1 pt larger is a panel behind it", () => {
    const at = (pad: number) =>
      classifyPage(
        captioned(rect(140, 600, 200, 40), {
          rects: [
            rect(140 - pad, 600 - pad, 200 + 2 * pad, 40 + 2 * pad, {
              stroked: false,
              filled: true,
              lum: 0.8,
            }),
          ],
        }),
      ).excluded.map((e) => e.rule);
    expect(at(2)).toContain("filled-box");
    expect(at(2.1)).not.toContain("filled-box");
  });

  it("a picture inside the box fills it; a page-sized picture behind the form does not", () => {
    const b = rect(140, 600, 200, 40);
    const inside = classifyPage(
      captioned(b, {
        images: [{ x: 150, y: 605, width: 50, height: 30 }],
      }),
    );
    expect(inside.excluded.map((e) => e.rule)).toContain("filled-box");
    const behind = classifyPage(
      captioned(b, {
        images: [{ x: 0, y: 0, width: 612, height: 792 }],
      }),
    );
    expect(behind.proposals.map((p) => p.rule)).toEqual(["entry-box"]);
  });

  it("a box's own fill makes it a filled box", () => {
    const r = classifyPage(
      captioned(rect(140, 600, 200, 40, { filled: true, lum: 0.85 })),
    );
    expect(r.proposals).toEqual([]);
    expect(r.excluded.map((e) => e.rule)).toContain("filled-box");
  });
});

describe("page band: an entry box is a footer only when all of it is in the band", () => {
  // The band is the outer 8% of 792: under 0.08 x 792 (63.36), computed
  // the way the band is so the boundary is exact in floating point. The
  // box stands on the page's foot, so its top is its height.
  it("top at 63.36 (out of the band) is proposed; top 0.06 lower is page-band", () => {
    const edge = 0.08 * 792;
    const at = (h: number) => classifyPage(captioned(rect(72, 0, 300, h)));
    expect(at(edge).proposals.map((p) => p.rule)).toEqual(["entry-box"]);
    const low = at(edge - 0.06);
    expect(low.proposals).toEqual([]);
    expect(low.excluded.map((e) => e.rule)).toContain("page-band");
  });
});

describe("stacked lines under one label", () => {
  const one = (p: CardPage) =>
    props(p).map((x) => [x.rule, x.label, x.multiline === true]);

  it("count: two lines are no stack, three are one field, five are still one", () => {
    expect(one(stack(2, 20))).toEqual([]);
    expect(one(stack(3, 20))).toEqual([["labelled-rule", "Comments", true]]);
    expect(one(stack(5, 20))).toEqual([["labelled-rule", "Comments", true]]);
  });

  it("pitch: 29.9 is a stack, 30 is not; 12 is a stack, 11.9 (a ruled border) is not", () => {
    expect(one(stack(3, 29.9))).toHaveLength(1);
    expect(one(stack(3, 30))).toEqual([]);
    expect(one(stack(3, 12))).toHaveLength(1);
    expect(one(stack(3, 11.9))).toEqual([]);
  });

  it("spans the stack: from 1 pt over the lowest line to 1 pt under the caption", () => {
    expect(props(stack(3, 20))).toMatchObject([
      { x: 73, y: 601, width: 326, height: 645 - 601 },
    ]);
  });

  it("text between the lines (a figure, no caption) breaks the stack", () => {
    expect(one(stack(3, 20, [txt("1990", 200, 610, { width: 20 })]))).toEqual(
      [],
    );
  });

  it("a label at each line's left keeps one field per line", () => {
    // The heading 14 pt over the top line: a caption the stack search
    // would take (its descent 12 pt over the line), so only the labels at
    // the left keep the lines apart. (At 30 pt over, out of the caption's
    // reach, this test passed with that condition deleted: mutant M13.)
    // The top line's field is cut to 1 pt under the heading: 12 pt.
    const p = pg({
      segs: [600, 620, 640].map((y) => hseg(72, 400, y)),
      text: [
        txt("Comments:", 72, 654, { width: 48 }),
        txt("A:", 40, 600, { width: 20 }),
        txt("B:", 40, 620, { width: 20 }),
        txt("C:", 40, 640, { width: 20 }),
      ],
    });
    expect(one(p)).toEqual([
      ["labelled-rule", "C", false],
      ["labelled-rule", "B", false],
      ["labelled-rule", "A", false],
    ]);
  });
});

/* ------------------------------------------------------------------ *
 *  The S4 corpus through the real reader
 * ------------------------------------------------------------------ */

const RUNS = new Map<string, CaseRun>();
beforeAll(async () => {
  for (const c of BOX_CASES) RUNS.set(c.id, await runCase(c));
}, 120_000);

describe("the S4 corpus, through the real reader", () => {
  it("health: the corpus is the size it was written at, both ways", () => {
    const n = (k: string) => BOX_CASES.filter((c) => c.kind === k).length;
    // 10 and 12 until review round 1 added P70 to P76 and N70 to N78.
    expect(n("positive")).toBe(17);
    expect(n("negative")).toBe(21);
    expect(RUNS.size).toBe(BOX_CASES.length);
  });

  it("health: entry-box proposes on a positive here, and filled-box decides a negative here", () => {
    const pos = BOX_CASES.filter(
      (c) =>
        c.kind === "positive" &&
        RUNS.get(c.id)!.proposals.some((p) => p.rule === "entry-box"),
    );
    expect(pos.map((c) => c.id).length).toBeGreaterThanOrEqual(5);
    const neg = BOX_CASES.filter(
      (c) =>
        c.kind === "negative" &&
        c.at &&
        decidingAt(RUNS.get(c.id)!, c.at)?.rule === "filled-box",
    );
    expect(neg.map((c) => c.id)).toEqual([
      "N62",
      "N63",
      "N64",
      "N65",
      "N70",
      "N71",
      "N72",
      "N73",
      "N74",
    ]);
  });

  it("health: both multiline and one-line proposals occur (each side of the flag is exercised)", () => {
    const all = BOX_CASES.filter((c) => c.kind === "positive").flatMap(
      (c) => RUNS.get(c.id)!.proposals,
    );
    expect(all.filter((p) => p.multiline).length).toBeGreaterThanOrEqual(6);
    expect(all.filter((p) => !p.multiline).length).toBeGreaterThanOrEqual(6);
  });

  for (const c of BOX_CASES)
    it(`${c.id} (${c.kind}): ${c.note}`, () => {
      expect(unexplained(c, RUNS.get(c.id)!)).toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 *  The composed chain, read back from the saved PDF
 * ------------------------------------------------------------------ */

/** Each widget pdf.js reads back from the saved PDF, by name. */
async function savedWidgets(bytes: Uint8Array) {
  const pdfjs =
    (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof import("pdfjs-dist");
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  try {
    const doc = await task.promise;
    const out = new Map<string, { rect: number[]; flags: number }>();
    for (let n = 1; n <= doc.numPages; n++)
      for (const a of await (await doc.getPage(n)).getAnnotations())
        if (a.subtype === "Widget")
          out.set(String(a.fieldName), {
            rect: a.rect as number[],
            flags: Number(a.fieldFlags ?? 0),
          });
    return out;
  } finally {
    await task.destroy();
  }
}

/** Ff bit 13: a multiline text field (PDF 32000-1, table 228). */
const MULTILINE_BIT = 1 << 12;

describe("composed chain: detect -> proposal -> Add -> Create form -> pdf.js reads the saved field", () => {
  // Health: the bit is the one pdf-lib's enableMultiline sets, read through
  // the same reader (a control for the reader, not for the finder).
  it("positive control: pdf-lib's multiline field reads back with bit 4096, a plain one without", async () => {
    const d = await PDFDocument.create();
    const page = d.addPage([612, 792]);
    const form = d.getForm();
    const a = form.createTextField("a");
    a.enableMultiline();
    a.addToPage(page, { x: 72, y: 600, width: 100, height: 40 });
    form
      .createTextField("b")
      .addToPage(page, { x: 72, y: 500, width: 100, height: 20 });
    const w = await savedWidgets(await d.save());
    expect(w.get("a")!.flags & MULTILINE_BIT).toBe(MULTILINE_BIT);
    expect(w.get("b")!.flags & MULTILINE_BIT).toBe(0);
  });

  const ids = Object.keys(PRINTED_BOXES);
  it("health: the chain runs over every printed case, multiline and not", () => {
    expect(ids.sort()).toEqual([
      "P60",
      "P61",
      "P62",
      "P64",
      "P65",
      "P70",
      "P75",
      "P76",
    ]);
  });

  for (const id of ids)
    it(`${id}: each saved widget lies inside its printed box, its multiline bit set exactly as proposed`, async () => {
      const c = BOX_CASES.find((x) => x.id === id)!;
      const bytes = await c.build();
      const report = await detectFormFields(bytes, {
        loadReader: legacyPdfjs,
      });
      const found = report.pages.flatMap((p) =>
        p.outcome === "found" ? p.proposals : [],
      );
      const printed = PRINTED_BOXES[id]!;
      expect(found.length).toBe(printed.length);
      // The Find fields chunk's own Add: named, validated by the builder's
      // validateFormFields, turned into the spec the engine is handed.
      const context = await readFormContext(bytes);
      const { added, dropped } = toAdd(
        found,
        new Set(found.map((p) => p.key)),
        context.existingNames,
        (specs) =>
          validateFormFields(specs, context.pageSizes, context.existingNames),
      );
      expect(dropped).toEqual([]);
      const saved = await savedWidgets(
        (
          await createFormFields(
            bytes,
            added.map((a) => a.spec),
          )
        ).bytes,
      );
      expect(saved.size).toBe(found.length);
      for (const { key, spec } of added) {
        const p = found.find((x) => x.key === key)!;
        const w = saved.get(spec.name);
        expect(w, spec.name).toBeDefined();
        const [x0, y0, x1, y1] = w!.rect;
        const inBox = printed.some(
          (b) =>
            x0! >= b.x0 - 0.5 &&
            x1! <= b.x1 + 0.5 &&
            y0! >= b.y0 - 0.5 &&
            y1! <= b.y1 + 0.5,
        );
        expect(inBox, `${spec.name} ${JSON.stringify(w!.rect)}`).toBe(true);
        expect(
          (w!.flags & MULTILINE_BIT) !== 0,
          `${spec.name}: multiline bit`,
        ).toBe(p.multiline === true);
      }
      // ...and the saved PDF holds as many multiline fields as the case
      // expects: agreement with the proposal alone passed on the code
      // before S4, whose one-line strips agreed with themselves.
      const want = (c.expect as { multiline?: boolean }[]).filter(
        (e) => e.multiline,
      ).length;
      expect(
        [...saved.values()].filter((w) => (w.flags & MULTILINE_BIT) !== 0)
          .length,
        "multiline fields in the saved PDF",
      ).toBe(want);
      expect(saved.size - want, "one-line fields in the saved PDF").toBe(
        (c.expect as unknown[]).length - want,
      );
    }, 60_000);
});

describe("the multiline flag reaches every hand-off", () => {
  const p = (multiline: boolean): FieldProposal => ({
    key: `1:entry-box:72:${multiline ? 600 : 500}`,
    page: 1,
    x: 72,
    y: multiline ? 600 : 500,
    width: 200,
    height: multiline ? 60 : 20,
    type: "text",
    label: multiline ? "Comments" : "Name",
    rule: "entry-box",
    ...(multiline ? { multiline: true as const } : {}),
  });

  it("proposalToDraftFields: multiline exactly where proposed", () => {
    expect(
      proposalToDraftFields([p(true), p(false)]).map((s) =>
        s.type === "text" ? s.multiline : null,
      ),
    ).toEqual([true, false]);
  });

  it("Add (addKeys): the new card has Multiple lines on exactly where proposed", () => {
    type Card = {
      id: string;
      type: string;
      name: string;
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
      multiline: boolean;
    };
    let cards: Card[] = [];
    const list = [p(true), p(false)];
    const f: Finder<Card> = {
      bytes: new Uint8Array(),
      drafts: [],
      setDrafts: (d) => (cards = d),
      untouched: false,
      make: (id) => ({
        id,
        type: "text",
        name: id,
        page: 1,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        multiline: false,
      }),
      context: { existingNames: [], pageSizes: [{ width: 612, height: 792 }] },
      validate: validateFormFields,
      found: { list, note: null },
      setFound: () => {},
      selected: null,
      select: () => {},
    };
    addKeys(
      f,
      list.map((x) => x.key),
    );
    expect(cards.map((c) => [c.name, c.multiline])).toEqual([
      ["comments", true],
      ["name", false],
    ]);
  });
});

/* ------------------------------------------------------------------ *
 *  Review round 1 (three lenses on 4c9078a4): each finding's shape
 * ------------------------------------------------------------------ */

describe("review round 1: shapes the first cut got wrong", () => {
  const brief = (p: CardPage) =>
    props(p).map((x) => [x.rule, x.label, x.multiline === true]);
  const rulesOut = (p: CardPage) => classifyPage(p).excluded.map((e) => e.rule);

  // guards-bytes HIGH / geometry 1: main proposed a field here; the first
  // cut read the writing lines as "something inside" and proposed none.
  it("a lined comment box under a caption is ONE multiline entry box", () => {
    const p = captioned(rect(72, 500, 400, 80), {
      segs: [520, 540, 560].map((y) => ({ ...hseg(80, 464, y), lum: 0.6 })),
    });
    expect(brief(p)).toEqual([["entry-box", "Notes", true]]);
    expect(props(p)).toMatchObject([{ x: 73, y: 501, width: 398, height: 78 }]);
    expect(rulesOut(p)).toEqual([]);
  });

  it("a lined box labelled at its left is ONE multiline entry box, its lines no fields of their own", () => {
    const p = pg({
      rects: [rect(72, 560, 328, 80)],
      segs: [580, 600, 620].map((y) => hseg(72, 400, y)),
      text: [txt("Notes:", 30, 620, { width: 30 })],
    });
    expect(brief(p)).toEqual([["entry-box", "Notes", true]]);
  });

  it("writing lines short of most of the box's width, or in a box too low for several lines, still fill it", () => {
    const part = captioned(rect(72, 500, 400, 80), {
      segs: [hseg(80, 300, 540)],
    });
    expect(rulesOut(part)).toContain("filled-box");
    const low = captioned(rect(72, 500, 400, 30), {
      segs: [hseg(80, 464, 515)],
    });
    expect(rulesOut(low)).toContain("filled-box");
  });

  // guards-bytes MEDIUM: filled-box is for EMPTY boxes; a shaded caption box
  // keeps the field main gave it.
  it("a grey shaded box with its caption inside keeps its field along the bottom", () => {
    const p = pg({
      rects: [rect(140, 600, 200, 30, { filled: true, lum: 0.9 })],
      text: [txt("1 Wages, tips", 143, 621, { size: 7, width: 40 })],
    });
    expect(brief(p)).toEqual([["labelled-rule", "1 Wages, tips", false]]);
  });

  // geometry 2 / false-positives 4: a caption just over a box's top is that
  // box's, even when it is also just under the box above.
  it("stacked captioned boxes each take their own caption, not the next box's", () => {
    const boxes: CardRect[] = [];
    const text: CardText[] = [];
    let top = 700;
    for (const [label, h] of [
      ["First name", 20],
      ["Last name", 20],
      ["Address", 60],
      ["City", 20],
    ] as const) {
      boxes.push(rect(72, top - h, 300, h));
      text.push(txt(label, 72, top + 4, { width: 40 }));
      top = top - h - 12 - 4; // the next caption 12 pt under this foot
    }
    expect(props(pg({ rects: boxes, text })).map((x) => x.label)).toEqual([
      "First name",
      "Last name",
      "Address",
      "City",
    ]);
  });

  it("control: captions printed just UNDER their boxes stay theirs", () => {
    const p = pg({
      rects: [rect(72, 680, 300, 20), rect(72, 630, 300, 20)],
      text: [
        txt("Name", 72, 669, { width: 25 }),
        txt("City", 72, 619, { width: 20 }),
      ],
    });
    expect(props(p).map((x) => x.label)).toEqual(["Name", "City"]);
  });

  it("boxed paragraphs with the next heading just under each box: no field", () => {
    const rects: CardRect[] = [];
    const text: CardText[] = [];
    for (let k = 0; k < 4; k++) {
      const y = 600 - 100 * k;
      text.push(txt(`Clause ${k + 1}`, 72, y + 84, { width: 40 }));
      rects.push(rect(72, y, 468, 80));
      text.push(
        txt("The buyer pays within thirty days.", 80, y + 40, { width: 180 }),
      );
    }
    expect(props(pg({ rects, text }))).toEqual([]);
  });

  it("one boxed paragraph with a short note just under it, no box below: the box holds text, so no field", () => {
    const p = pg({
      rects: [rect(72, 600, 468, 80)],
      text: [
        txt("The buyer pays within thirty days.", 80, 640, { width: 180 }),
        txt("Terms", 72, 589, { width: 30 }),
      ],
    });
    expect(props(p)).toEqual([]);
  });

  it("empty figure frames captioned over their tops: each frame named by its own caption", () => {
    const rects: CardRect[] = [];
    const text: CardText[] = [];
    for (let k = 0; k < 4; k++) {
      const y = 620 - 96 * k;
      text.push(txt(`Figure ${k + 1}`, 72, y + 84, { width: 40 }));
      rects.push(rect(72, y, 468, 80));
    }
    expect(props(pg({ rects, text })).map((x) => x.label)).toEqual([
      "Figure 1",
      "Figure 2",
      "Figure 3",
      "Figure 4",
    ]);
  });

  // false-positives 5: N boxes gave 2N-1 fields, the lower ones misnamed.
  it("left-labelled boxes stacked 20 pt apart: one field per box, each its own label, none in the gap", () => {
    const p = pg({
      rects: [rect(130, 662, 300, 20), rect(130, 622, 300, 20)],
      text: [
        txt("Name", 100, 668, { width: 20 }),
        txt("City", 100, 628, { width: 20 }),
      ],
    });
    expect(brief(p)).toEqual([
      ["entry-box", "Name", false],
      ["entry-box", "City", false],
    ]);
  });

  it("a box whose label is out of reach does not borrow the label of the box above", () => {
    const p = pg({
      rects: [rect(130, 662, 300, 20), rect(130, 622, 300, 20)],
      text: [
        txt("Name", 100, 668, { width: 20 }),
        txt("City", 40, 628, { width: 20 }),
      ],
    });
    expect(brief(p)).toEqual([["entry-box", "Name", false]]);
  });

  // The two ends of the continuation rule's box test, each alone (with
  // both deleted, the tests above went red; with either, green).
  it("a box under a left-labelled line does not continue the line's label", () => {
    // Taller than an entry box, so its top edge is a line of its own (an
    // entry box's goes with it), 20 pt under the labelled line.
    const p = pg({
      segs: [hseg(130, 430, 650)],
      rects: [rect(130, 500, 300, 130)],
      text: [txt("Address:", 82, 650, { width: 40 })],
    });
    expect(brief(p)).toEqual([["labelled-rule", "Address", false]]);
  });

  it("a line under a left-labelled box does not continue the box's label", () => {
    const p = pg({
      rects: [rect(130, 662, 300, 20)],
      segs: [hseg(130, 430, 642)],
      text: [txt("Name", 100, 668, { width: 20 })],
    });
    expect(brief(p)).toEqual([["entry-box", "Name", false]]);
  });

  // false-positives 8.
  it("a double frame (a box drawn 4 pt inside another) is decoration: no field", () => {
    const p = pg({
      rects: [rect(100, 600, 400, 100), rect(104, 604, 392, 92)],
      text: [txt("Certificate of completion", 100, 704, { width: 120 })],
    });
    expect(props(p)).toEqual([]);
  });

  it("DOUBLE_GAP: a box 6 pt inside another is a double frame; 6.5 pt inside, a box in a frame", () => {
    const at = (d: number) =>
      brief(
        pg({
          // Edges clear of the 50 pt lookup cells' borders, so the line
          // 6.5 pt out is in a cell the search reads and only the gap's
          // own test can pass it over (at 100..500 it was not read at all,
          // and the test passed with that test deleted).
          rects: [
            rect(110, 610, 380, 80),
            rect(110 + d, 610 + d, 380 - 2 * d, 80 - 2 * d),
          ],
          text: [txt("Remarks", 110, 694, { width: 40 })],
        }),
      );
    expect(at(6)).toEqual([]);
    expect(at(6.5)).toEqual([["entry-box", "Remarks", true]]);
  });

  // false-positives 7.
  it("a box or lines captioned 'Signatures' are signature areas: no field", () => {
    const box = pg({
      rects: [rect(72, 600, 250, 50)],
      text: [txt("Signatures", 72, 654, { width: 50 })],
    });
    expect(props(box)).toEqual([]);
    expect(rulesOut(box)).toContain("signature");
    const lines = pg({
      segs: [600, 620, 640].map((y) => hseg(72, 300, y)),
      text: [txt("Signatures of witnesses", 72, 646, { width: 110 })],
    });
    expect(props(lines)).toEqual([]);
  });

  // false-positives 3.
  it("column headings over even lines (a ledger) are no caption: no one field across the columns", () => {
    const p = pg({
      segs: Array.from({ length: 6 }, (_, i) => hseg(72, 522, 580 - 20 * i)),
      text: [
        txt("Description", 80, 586, { width: 55 }),
        txt("Qty", 300, 586, { width: 15 }),
        txt("Amount", 420, 586, { width: 35 }),
      ],
    });
    expect(props(p).filter((x) => x.multiline)).toEqual([]);
  });

  // false-positives 1.
  it("a picture bleeding past its frame, or clipped to it, fills the frame (up to IMAGE_BLEED x its size)", () => {
    const b = rect(72, 600, 200, 100);
    const at = (img: Box) =>
      classifyPage(captioned(b, { images: [img] })).excluded.map((e) => e.rule);
    expect(at({ x: 69, y: 597, width: 206, height: 106 })).toContain(
      "filled-box",
    );
    expect(at({ x: 60, y: 590, width: 230, height: 125 })).toContain(
      "filled-box",
    );
    // At twice the frame's size it is the frame's; past that, a picture
    // the form is drawn over.
    expect(at({ x: -28, y: 550, width: 400, height: 200 })).toContain(
      "filled-box",
    );
    expect(at({ x: -28.1, y: 550, width: 400.2, height: 200 })).not.toContain(
      "filled-box",
    );
  });

  // false-positives 2.
  it("curved paint (a logo, a chart line, a seal, a scribble) fills a box; a curve larger than the box does not", () => {
    const b = rect(72, 600, 200, 100);
    const at = (c: Box) =>
      classifyPage(captioned(b, { curves: [c] })).excluded.map((e) => e.rule);
    expect(at({ x: 100, y: 620, width: 30, height: 30 })).toContain(
      "filled-box",
    );
    // A curve as wide as the box and its border each side is in it...
    expect(at({ x: 70, y: 620, width: 204, height: 30 })).toContain(
      "filled-box",
    );
    // ...and a larger one (a flourish round the box) is not.
    expect(at({ x: 70, y: 620, width: 204.1, height: 30 })).not.toContain(
      "filled-box",
    );
    // One that stops short of the box's inside is beside it.
    expect(at({ x: 300, y: 620, width: 30, height: 30 })).not.toContain(
      "filled-box",
    );
  });

  // geometry 3: the box vanished with no reason given.
  it("a box outlined 3 pt thick is still an entry box", () => {
    expect(brief(captioned(rect(72, 500, 400, 80, { width: 3 })))).toEqual([
      ["entry-box", "Notes", true],
    ]);
  });

  // geometry 4: one blank line between the caption and the top line.
  it("a stack's caption may sit up to one pitch over its top line", () => {
    const at = (gap: number) =>
      brief(
        pg({
          segs: [600, 622, 644].map((y) => hseg(72, 540, y)),
          text: [txt("Comments:", 72, 644 + gap, { width: 48 })],
        }),
      );
    expect(at(18)).toEqual([["labelled-rule", "Comments", true]]);
    expect(at(30)).toEqual([]);
  });

  it("past the usual reach only a label small enough for the lines: a 15 pt one over 22 pt lines is not", () => {
    // 1.5 x 14.6 = 21.9 < 22; 1.5 x 14.7 = 22.05 > 22. The descent's gap
    // over the top line stays past CAPTION_MAX (14) at either size.
    const at = (size: number) =>
      brief(
        pg({
          segs: [600, 622, 644].map((y) => hseg(72, 540, y)),
          text: [txt("Comments:", 72, 644 + 20, { width: 48, size })],
        }),
      );
    expect(at(14.6)).toEqual([["labelled-rule", "Comments", true]]);
    expect(at(14.7)).toEqual([]);
  });
});
