// @native-canvas
/**
 * Slice S6 of the Create Forms field finder (combs and radio clusters),
 * held the house way (CLAUDE.md, "Guards — house style"):
 *
 *  - DETECT_COMBS against a literal table typed from the brief, its copy of
 *    the builder's radio gap held EQUAL to field-boxes.ts' (one value, two
 *    places, a relationship pinned), and the two new rule ids;
 *  - each decision on hand-built pages, at its boundary and just past it:
 *    4 cells against 3, cells a gap apart, groups a cell apart, a lettered
 *    word between groups, a caption against per-box heads, graph paper; a
 *    radio stack at gaps 4, 5, 6, 7, 8 and 12, two squares against three,
 *    repeated or missing labels, labels on the left, a horizontal row;
 *  - the S6 corpus (src/tests/form-detect-combs-fixtures.ts, joined onto
 *    DETECT_CASES) through the REAL reader, with health checks that
 *    `comb-boxes` and `radio-stack` each propose on positives here, `comb`
 *    still decides the negatives here, and every radio-shaped negative
 *    proposes checkboxes and no radio group;
 *  - the composed chain, judged where it is consumed: detect -> proposal ->
 *    the Find fields chunk's own Add (`toAdd`, and `addKeys` for the card)
 *    -> createFormFields -> pdf.js reading the SAVED PDF: a comb's widget
 *    spans its printed run with /MaxLen its box count, a radio group has a
 *    kid inside each printed square with the labels as its choices, and a
 *    checklist stays checkboxes;
 *  - copy: what the FAQ says about combs and radio groups, bound to what
 *    the reader does on the corpus.
 *
 * The corpus's case list and size bounds are in form-detect.corpus.test.ts;
 * this file holds only what S6 added.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRadioGroup,
  PDFTextField,
} from "pdf-lib";
import {
  createFormFields,
  readFormContext,
  validateFormFields,
} from "./create-forms";
import { RADIO_STACK_GAP, fieldBoxes } from "./field-boxes";
import {
  DETECTION_RULES,
  DETECT_COMBS,
  classifyPage,
  type CardPage,
  type CardRect,
  type CardText,
} from "./form-detect";
import { detectFormFields } from "./form-detect-read";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";
import {
  addKeys,
  onPage,
  toAdd,
  type DraftLike,
  type Finder,
  type Found,
} from "@/components/tools/runner/create-forms-detect";
import {
  COMB_CASES,
  PRINTED,
  S6,
  type Printed,
} from "@/tests/form-detect-combs-fixtures";
import {
  DETECT_CASES,
  decidingAt,
  legacyPdfjs,
  runCase,
  unexplained,
  type CaseRun,
} from "@/tests/form-detect-fixtures";
import { createFormsCorpus } from "@/tests/create-forms-copy-corpus";

/* ------------------------------------------------------------------ *
 *  The table, typed from the brief
 * ------------------------------------------------------------------ */

describe("DETECT_COMBS: the values the brief set, and the builder's gap", () => {
  it("is exactly this table", () => {
    expect(DETECT_COMBS).toEqual({
      COMB_FIELD_MIN: 4,
      COMB_GROUP_GAP_CELLS: 1,
      COMB_CAPTION_ABOVE: 14,
      // Review round 1 (2026-11-22): a left label's reach, a scale's heads
      // and its stack, the multi-answer window and the drift bound.
      COMB_LABEL_GAP: 180,
      COMB_SCALE_ABOVE: 40,
      COMB_STACK_GAP_CELLS: 2,
      RADIO_MIN: 3,
      RADIO_STACK_GAP: 6,
      RADIO_GAP_EPS: 1,
      RADIO_CAPTION_ABOVE: 14,
      RADIO_VETO_ABOVE: 28,
      // The verify round (2026-11-22): the veto reads lines, on past
      // RADIO_VETO_ABOVE through the passage, and the note under the stack.
      RADIO_VETO_LEADING: 3,
      RADIO_VETO_REACH: 72,
      RADIO_VETO_BELOW: 20,
      WORD_GAP_EMS: 0.1,
      RADIO_PHRASE_GAP_EMS: 1,
      RADIO_CENTRE_EPS: 1,
    });
  });

  // ONE value in two places: the finder may not import field-boxes.ts (a
  // first-load module; a second importer breaks its concatenation), so it
  // carries a copy, and this is the relationship that keeps it the same.
  it("its radio gap IS the builder's (field-boxes.ts RADIO_STACK_GAP)", () => {
    expect(DETECT_COMBS.RADIO_STACK_GAP).toBe(RADIO_STACK_GAP);
    // ...and the builder stacks at it (positive control on the reader of it).
    const boxes = fieldBoxes({
      type: "radio",
      x: 0,
      y: 100,
      width: 10,
      height: 10,
      options: ["a", "b"],
    });
    expect(boxes[0]!.y - boxes[1]!.y - 10).toBe(RADIO_STACK_GAP);
  });

  it("the two new shapes are detection rules, with plain words", () => {
    const ids = DETECTION_RULES.map((r) => r.id);
    expect(ids).toContain("comb-boxes");
    expect(ids).toContain("radio-stack");
    for (const r of DETECTION_RULES) expect(r.plain).not.toMatch(/,| and /); // the listing splits on these
  });
});

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

const rect = (x: number, y: number, w: number, h = w): CardRect => ({
  x0: x,
  y0: y,
  x1: x + w,
  y1: y + h,
  width: 1,
  stroked: true,
  filled: false,
  lum: 0,
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

const run = (p: CardPage) => classifyPage(p);
const rules = (p: CardPage) => run(p).proposals.map((x) => x.rule);

/** A labelled row of `n` cells of side 14 from x 150 (gap `gap` between). */
const combRow = (n: number, gap = 0, label: string | null = "Account") =>
  pg({
    rects: Array.from({ length: n }, (_, k) =>
      rect(150 + k * (14 + gap), 400, 14),
    ),
    text: label ? [txt(label, 100, 403, { width: 40 })] : [],
  });

describe("combs: a labelled run of four or more equal boxes is ONE text field", () => {
  it("4 cells: one field over the run, limited to 4; never checkboxes", () => {
    const res = run(combRow(4));
    expect(res.proposals).toEqual([
      expect.objectContaining({
        rule: "comb-boxes",
        type: "text",
        label: "Account",
        x: 150,
        y: 400,
        width: 56,
        height: 14,
        maxLength: 4,
      }),
    ]);
    expect(res.proposals.some((p) => p.type === "checkbox")).toBe(false);
  });

  it("8 cells: limited to 8", () => {
    const [p] = run(combRow(8)).proposals;
    expect(p).toMatchObject({ rule: "comb-boxes", width: 112, maxLength: 8 });
  });

  it("3 cells (COMB_FIELD_MIN - 1): no field, each box `comb`, as before S6", () => {
    const res = run(combRow(3));
    expect(res.proposals).toEqual([]);
    expect(res.excluded.map((e) => e.rule)).toEqual(Array(3).fill("comb"));
  });

  it("no label: no field, each box `comb`", () => {
    const res = run(combRow(6, 0, null));
    expect(res.proposals).toEqual([]);
    expect(res.excluded.map((e) => e.rule)).toEqual(Array(6).fill("comb"));
  });

  it("cells 1 pt apart (COMB_EPS) are one run; 1.1 pt apart are not a comb at all", () => {
    expect(run(combRow(4, 1)).proposals).toEqual([
      expect.objectContaining({ rule: "comb-boxes", maxLength: 4 }),
    ]);
    expect(rules(combRow(4, 1.1))).not.toContain("comb-boxes");
  });

  it("a filled box in the run: no comb field", () => {
    const p = combRow(4);
    p.rects[2] = { ...p.rects[2]!, filled: true };
    expect(rules(p)).not.toContain("comb-boxes");
  });

  it("unequal cells (12 and 14 pt alternately): no comb field", () => {
    const rects = [
      rect(150, 400, 12),
      rect(162, 400, 14),
      rect(176, 400, 12),
      rect(188, 400, 14),
    ];
    expect(
      rules(pg({ rects, text: [txt("Code", 100, 403, { width: 40 })] })),
    ).not.toContain("comb-boxes");
  });
});

describe("comb groups: DD MM YYYY a cell apart are one row, a field per group", () => {
  const groups = (gap: number, between: string | null = "/") => {
    const xs = [150, 164, 178 + gap, 192 + gap, 206 + 2 * gap, 220 + 2 * gap];
    return pg({
      rects: xs.map((x) => rect(x, 400, 14)),
      text: [
        txt("Date", 100, 403, { width: 40 }),
        ...(between
          ? [
              txt(between, 178 + gap / 2 - 2, 403, { width: 4 }),
              txt(between, 206 + gap * 1.5 - 2, 403, { width: 4 }),
            ]
          : []),
      ],
    });
  };

  it("groups of 2 + 2 + 2, 14 pt apart (one cell): three fields, 2 characters each, all named from the label", () => {
    const res = run(groups(14));
    expect(
      res.proposals.map((p) => [p.rule, p.x, p.maxLength, p.label]),
    ).toEqual([
      ["comb-boxes", 150, 2, "Date"],
      ["comb-boxes", 192, 2, "Date"],
      ["comb-boxes", 234, 2, "Date"],
    ]);
  });

  it("14.5 pt apart (over a cell): three separate pairs, each too short, each box `comb`", () => {
    const res = run(groups(14.5));
    expect(res.proposals).toEqual([]);
    expect(res.excluded.every((e) => e.rule === "comb")).toBe(true);
  });

  it("a lettered word between the groups splits the row", () => {
    expect(run(groups(14, "or")).proposals).toEqual([]);
  });

  it("nothing between them: still one row", () => {
    expect(run(groups(8, null)).proposals).toHaveLength(3);
  });
});

describe("comb labels: left on its row, else a caption over it", () => {
  const cells = Array.from({ length: 5 }, (_, k) =>
    rect(300 + 14 * k, 600, 14),
  );

  it("a caption wider than one box, 4 pt over the row: it labels the field", () => {
    const res = run(
      pg({
        rects: cells,
        text: [txt("Postcode", 300, 618, { width: 37, size: 9 })],
      }),
    );
    expect(res.proposals).toEqual([
      expect.objectContaining({ label: "Postcode", maxLength: 5 }),
    ]);
  });

  it("COMB_CAPTION_ABOVE: a caption's baseline 14 pt over the top labels it; 15 pt does not", () => {
    const at = (dy: number) =>
      run(
        pg({
          rects: cells,
          text: [txt("Postcode", 300, 614 + dy, { width: 37 })],
        }),
      ).proposals;
    expect(at(14)).toHaveLength(1);
    expect(at(15)).toEqual([]);
  });

  it("a head over each box (D D M M Y): no caption, so no field", () => {
    const heads = ["D", "D", "M", "M", "Y"].map((h, k) =>
      txt(h, 304 + 14 * k, 618, { width: 6, size: 8 }),
    );
    expect(run(pg({ rects: cells, text: heads })).proposals).toEqual([]);
  });

  // CHANGED by review round 1 (2026-11-22): this read "a row label far to
  // the left (the gap is no limit on its own row)", and pinned the defect:
  // with no limit, "Name ____" in a form's left column named a comb 260 pt
  // away (captioned "PIN"), and "Office use only" one 430 pt away. The
  // same label 163 pt away still names it; past COMB_LABEL_GAP it does not.
  it("a row label far to the left names the row within COMB_LABEL_GAP (180 pt), not past it", () => {
    const at = (gap: number) =>
      run(
        pg({
          rects: cells,
          text: [txt("Membership no", 300 - gap - 65, 603, { width: 65 })],
        }),
      ).proposals;
    expect(at(163)).toEqual([
      expect.objectContaining({ label: "Membership no" }),
    ]);
    expect(at(180)).toEqual([
      expect.objectContaining({ label: "Membership no" }),
    ]);
    expect(at(181)).toEqual([]);
  });
});

describe("graph paper: boxes edge to edge in rows AND columns are no comb", () => {
  it("6 x 10 squares, a label left of the top row: no field, every box `comb`", () => {
    const rects: CardRect[] = [];
    for (let r = 0; r < 6; r++)
      for (let k = 0; k < 10; k++)
        rects.push(rect(150 + 12 * k, 600 - 12 * r, 12));
    const res = run(
      pg({ rects, text: [txt("Sketch", 100, 603, { width: 30 })] }),
    );
    expect(res.proposals).toEqual([]);
    expect(res.excluded).toHaveLength(60);
    expect(res.excluded.every((e) => e.rule === "comb")).toBe(true);
  });

  it("control: the same top row alone IS a comb field", () => {
    const rects = Array.from({ length: 10 }, (_, k) =>
      rect(150 + 12 * k, 600, 12),
    );
    expect(
      rules(pg({ rects, text: [txt("Sketch", 100, 603, { width: 30 })] })),
    ).toEqual(["comb-boxes"]);
  });
});

/** A column of `n` 12 pt squares from y 650 down, `gap` apart, labelled right. */
const stack = (
  gap: number,
  n = 3,
  labels: (string | null)[] = ["Email", "Phone", "Post", "Fax", "None"],
  o: { side?: "right" | "left"; caption?: string } = {},
) => {
  const rects: CardRect[] = [];
  const text: CardText[] = [];
  for (let k = 0; k < n; k++) {
    const y = 650 - k * (12 + gap);
    rects.push(rect(100, y, 12));
    const s = labels[k];
    if (s)
      text.push(
        o.side === "left"
          ? txt(s, 100 - 4 - 30, y + 2, { width: 30 })
          : txt(s, 116, y + 2, { width: 30 }),
      );
  }
  if (o.caption) text.push(txt(o.caption, 100, 668, { width: 80 }));
  return pg({ rects, text });
};

describe("radio stacks: three or more equal squares at the builder's gap +- 1", () => {
  for (const gap of [5, 6, 7])
    it(`gap ${gap}: ONE radio group, a choice per square from its label, buttons sized so the builder's ${RADIO_STACK_GAP} pt stack lands on the printed pitch`, () => {
      const res = run(stack(gap));
      expect(res.proposals).toHaveLength(1);
      const p = res.proposals[0]!;
      const s = 12 + gap - RADIO_STACK_GAP;
      expect(p).toMatchObject({
        rule: "radio-stack",
        type: "radio",
        label: null,
        options: ["Email", "Phone", "Post"],
        width: s,
        height: s,
      });
      // Each builder button's centre within 0.5 pt of its printed square's.
      const boxes = fieldBoxes({ ...p, type: "radio", options: p.options });
      expect(boxes).toHaveLength(3);
      for (const [k, b] of boxes.entries()) {
        const cy = 656 - k * (12 + gap);
        expect(Math.abs(b.y + b.height / 2 - cy)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(b.x + b.width / 2 - 106)).toBeLessThanOrEqual(0.5);
      }
    });

  for (const gap of [4, 8, 12])
    it(`gap ${gap}: three checkboxes, no radio group`, () => {
      expect(rules(stack(gap))).toEqual(Array(3).fill("square-checkbox"));
    });

  it("five at gap 6: one group of five", () => {
    expect(run(stack(6, 5)).proposals.map((p) => p.options)).toEqual([
      ["Email", "Phone", "Post", "Fax", "None"],
    ]);
  });

  it("RADIO_MIN: two squares at gap 6 are two checkboxes", () => {
    expect(rules(stack(6, 2))).toEqual(Array(2).fill("square-checkbox"));
  });

  it("the same label twice: checkboxes (a group's choices are distinct)", () => {
    expect(rules(stack(6, 3, ["Yes", "Yes", "No"]))).not.toContain(
      "radio-stack",
    );
  });

  it("one square without a label: no group", () => {
    expect(rules(stack(6, 3, ["Email", null, "Post"]))).not.toContain(
      "radio-stack",
    );
  });

  it("labels on the LEFT: checkboxes (a group's choices are named from the right)", () => {
    expect(rules(stack(6, 3, undefined, { side: "left" }))).toEqual(
      Array(3).fill("square-checkbox"),
    );
  });

  it("text on BOTH sides, the left nearer: the square rules read the left, so checkboxes, no group", () => {
    const p = stack(6);
    for (const [k, s] of ["A1", "B2", "C3"].entries())
      p.text.push(txt(s, 100 - 2 - 10, 650 - k * 18 + 2, { width: 10 }));
    // Right labels at 4 pt; move them out to 10 pt so the left is nearer.
    p.text = p.text.map((t) => (t.x === 116 ? { ...t, x: 122 } : t));
    const res = run(p);
    expect(res.proposals.map((x) => [x.rule, x.label])).toEqual([
      ["square-checkbox", "A1"],
      ["square-checkbox", "B2"],
      ["square-checkbox", "C3"],
    ]);
  });

  it("a caption over the top square names the group; RADIO_CAPTION_ABOVE bounds it", () => {
    expect(
      run(stack(6, 3, undefined, { caption: "Contact by" })).proposals[0]!
        .label,
    ).toBe("Contact by");
    // Descent (baseline - 2) 14 pt over the top at 662: a label; 15: none.
    const at = (base: number) => {
      const p = stack(6);
      p.text.push(txt("Contact by", 100, base, { width: 50 }));
      return run(p).proposals[0]!.label;
    };
    expect(at(662 + 14 + 2)).toBe("Contact by");
    expect(at(662 + 15 + 2)).toBeNull();
  });

  it("a horizontal row of option squares: checkboxes, never a radio group", () => {
    const rects = [72, 140, 208].map((x) => rect(x, 200, 12));
    const text = ["Yes", "No", "Maybe"].map((s, k) =>
      txt(s, [88, 156, 224][k]!, 202, { width: 20 }),
    );
    expect(rules(pg({ rects, text }))).toEqual(
      Array(3).fill("square-checkbox"),
    );
  });

  it("squares of 14, 12 and 10 pt stacked: checkboxes", () => {
    const rects = [rect(100, 650, 14), rect(100, 632, 12), rect(100, 616, 10)];
    const text = ["S", "M", "L"].map((s, k) =>
      txt(s, 120, [652, 634, 618][k]!, { width: 8 }),
    );
    expect(rules(pg({ rects, text }))).not.toContain("radio-stack");
  });

  it("a radio stack's squares are never ALSO proposed as checkboxes", () => {
    const res = run(stack(6));
    expect(res.proposals.filter((p) => p.type === "checkbox")).toEqual([]);
  });

  it("an existing field over the stack: no group, counted as already a field", () => {
    const p = stack(6);
    p.widgets.push({ x: 100, y: 650, width: 12, height: 12 });
    const res = run(p);
    expect(res.proposals).toEqual([]);
    expect(res.counts.alreadyFields).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 *  The S6 corpus through the real reader
 * ------------------------------------------------------------------ */

const RUNS = new Map<string, CaseRun>();
beforeAll(async () => {
  for (const c of COMB_CASES) RUNS.set(c.id, await runCase(c));
}, 120_000);

/** Radio-shaped cases that must stay checkboxes (each a decision, pinned). */
const NOT_RADIO = [
  "P97",
  "P98",
  "P99",
  "P100",
  "P101",
  // Review round 1 (2026-11-22): a multi-answer caption, a consent stack,
  // a fractional pitch the builder's stack would drift off.
  "P102",
  "P103",
  "P105",
];

describe("the S6 corpus (health first)", () => {
  it("is exactly these cases, every one in DETECT_CASES, every one run", () => {
    expect(COMB_CASES.map((c) => c.id)).toEqual([
      ...Array.from({ length: 12 }, (_, i) => `P${90 + i}`),
      "N91",
      "N92",
      "N93",
      "N94",
      // Review round 1 (2026-11-22).
      // P107-P109: the verify round (2026-11-22).
      ...Array.from({ length: 8 }, (_, i) => `P${102 + i}`),
      "N95",
    ]);
    for (const c of COMB_CASES) expect(DETECT_CASES).toContain(c);
    expect(RUNS.size).toBe(COMB_CASES.length);
  });

  it("health: comb-boxes and radio-stack each propose on positives HERE", () => {
    const got = (rule: string) =>
      COMB_CASES.filter((c) =>
        RUNS.get(c.id)!.proposals.some((p) => p.rule === rule),
      ).map((c) => c.id);
    expect(got("comb-boxes")).toEqual(["P90", "P91", "P92", "P96", "P106"]);
    expect(got("radio-stack")).toEqual(["P93", "P94", "P95", "P104"]);
  });

  it("health: `comb` still decides negatives here (the exclusion lives on for short and unlabelled runs, and graph paper)", () => {
    const decided = COMB_CASES.filter(
      (c) =>
        c.kind === "negative" &&
        c.at &&
        decidingAt(RUNS.get(c.id)!, c.at)?.rule === "comb",
    ).map((c) => c.id);
    expect(decided).toEqual(["N91", "N92", "N94", "N95"]);
  });

  it("every radio-shaped negative proposes checkboxes and no radio group", () => {
    for (const id of NOT_RADIO) {
      const ps = RUNS.get(id)!.proposals;
      expect(ps.length, id).toBeGreaterThanOrEqual(2);
      expect(
        ps.map((p) => p.type),
        id,
      ).toEqual(ps.map(() => "checkbox"));
    }
  });

  for (const c of COMB_CASES)
    it(`${c.id} (${c.kind}): ${c.note}`, () => {
      expect(unexplained(c, RUNS.get(c.id)!)).toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 *  The composed chain, read back from the saved PDF
 * ------------------------------------------------------------------ */

interface SavedWidget {
  name: string;
  rect: number[];
  fieldType: string;
  checkBox: boolean;
  radioButton: boolean;
  maxLen: number;
  comb: boolean;
  fieldFlags: number;
  buttonValue: unknown;
}

async function savedWidgets(bytes: Uint8Array): Promise<SavedWidget[]> {
  const pdfjs =
    (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof import("pdfjs-dist");
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  try {
    const doc = await task.promise;
    const out: SavedWidget[] = [];
    for (const a of await (await doc.getPage(1)).getAnnotations())
      if (a.subtype === "Widget")
        out.push({
          name: String(a.fieldName),
          rect: a.rect as number[],
          fieldType: String(a.fieldType),
          checkBox: a.checkBox === true,
          radioButton: a.radioButton === true,
          maxLen: Number(a.maxLen ?? 0),
          comb: a.comb === true,
          fieldFlags: Number(a.fieldFlags ?? 0),
          buttonValue: a.buttonValue,
        });
    return out;
  } finally {
    await task.destroy();
  }
}

/** The case through the reader, Add (every suggestion) and Create form. */
async function chain(id: string) {
  const c = COMB_CASES.find((x) => x.id === id)!;
  const bytes = await c.build();
  const report = await detectFormFields(bytes, { loadReader: legacyPdfjs });
  const found = report.pages.flatMap((p) =>
    p.outcome === "found" ? p.proposals : [],
  );
  const context = await readFormContext(bytes);
  const { added, dropped } = toAdd(
    found,
    new Set(found.map((p) => p.key)),
    context.existingNames,
    (specs) =>
      validateFormFields(specs, context.pageSizes, context.existingNames),
  );
  const out = (
    await createFormFields(
      bytes,
      added.map((a) => a.spec),
    )
  ).bytes;
  return { found, added, dropped, out, saved: await savedWidgets(out) };
}

const inside = (r: number[], p: Printed, eps: number) =>
  r[0]! >= p.x0 - eps &&
  r[2]! <= p.x1 + eps &&
  r[1]! >= p.y0 - eps &&
  r[3]! <= p.y1 + eps;

/** Ff bit 25 (1-based): a text field's comb flag. */
const COMB_FLAG = 1 << 24;

describe("composed chain: detect -> Add -> Create form -> pdf.js reads the saved fields", () => {
  it("health: the chain runs over every printed case", () => {
    // P102-P106 (review round 1) run through the same chain in
    // form-detect-combs-review.test.ts; P107-P109 (the verify round) in
    // form-detect-combs-veto.test.ts.
    expect(Object.keys(PRINTED).sort()).toEqual(
      [
        "P90",
        "P91",
        "P92",
        "P93",
        "P94",
        "P95",
        "P97",
        "P102",
        "P103",
        "P104",
        "P105",
        "P106",
        "P107",
        "P108",
        "P109",
      ].sort(),
    );
  });

  for (const id of ["P90", "P91", "P92"])
    it(`${id}: each comb's saved widget spans its printed run, /MaxLen = its box count, no comb flag`, async () => {
      const { dropped, saved, found } = await chain(id);
      expect(dropped).toEqual([]);
      const groups =
        id === "P91"
          ? S6.P91.groups
          : [id === "P90" ? S6.P90.cells : S6.P92.cells];
      expect(saved).toHaveLength(groups.length);
      expect(found).toHaveLength(groups.length);
      for (const g of groups) {
        const first = g[0]!;
        const last = g[g.length - 1]!;
        const w = saved.find((s) => Math.abs(s.rect[0]! - first.x0) <= 0.5);
        expect(w, `no widget starts at ${first.x0}`).toBeDefined();
        expect(w!.fieldType).toBe("Tx");
        expect(Math.abs(w!.rect[2]! - last.x1)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(w!.rect[1]! - first.y0)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(w!.rect[3]! - first.y1)).toBeLessThanOrEqual(0.5);
        expect(w!.maxLen).toBe(g.length);
        // DECIDED (S6): the builder has no comb option, so the flag is
        // never set; the day it is, this inverts (and the field already
        // spans its run edge to edge, so the cells line up).
        expect(w!.fieldFlags & COMB_FLAG).toBe(0);
        expect(w!.comb).toBe(false);
      }
      expect(new Set(saved.map((s) => s.name)).size).toBe(saved.length);
    }, 60_000);

  for (const id of ["P93", "P94", "P95"] as const)
    it(`${id}: ONE radio field, a kid inside each printed square, the labels its choices`, async () => {
      const { dropped, saved, out } = await chain(id);
      expect(dropped).toEqual([]);
      const printed = PRINTED[id]!;
      const options = [...S6[id].options];
      expect(saved).toHaveLength(printed.length);
      expect(new Set(saved.map((s) => s.name)).size).toBe(1);
      expect(saved.every((s) => s.radioButton && !s.checkBox)).toBe(true);
      // Inside: pdf.js reads each saved rect 0.5 pt wider a side than the
      // box handed to the builder, so within 0.5 pt at a gap of 5 or 6. At
      // 7 the button is 13 pt over a 12 pt square (the builder's 6 pt stack
      // has to land on a 19 pt pitch) and its centre falls on a half point,
      // so it may hang 1.5 pt past one edge; its centre stays within 0.5 pt
      // of the square's (below).
      const eps = id === "P95" ? 1.5 : 0.5;
      const used = new Set<number>();
      for (const w of saved) {
        const i = printed.findIndex((p) => inside(w.rect, p, eps));
        expect(i, JSON.stringify(w.rect)).toBeGreaterThanOrEqual(0);
        expect(used.has(i)).toBe(false);
        used.add(i);
        const p = printed[i]!;
        const cx = (w.rect[0]! + w.rect[2]!) / 2;
        const cy = (w.rect[1]! + w.rect[3]!) / 2;
        expect(Math.abs(cx - (p.x0 + p.x1) / 2)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(cy - (p.y0 + p.y1) / 2)).toBeLessThanOrEqual(0.5);
      }
      // The choices, as the saved file holds them (pdf-lib reads /Opt).
      const doc = await PDFDocument.load(out);
      const fields = doc.getForm().getFields();
      expect(fields).toHaveLength(1);
      expect(fields[0]).toBeInstanceOf(PDFRadioGroup);
      expect((fields[0] as PDFRadioGroup).getOptions()).toEqual(options);
      // Top to bottom: the kid in the top square carries the first choice.
      const byTop = [...saved].sort((a, b) => b.rect[1]! - a.rect[1]!);
      const values = byTop.map((s) => String(s.buttonValue));
      expect(new Set(values).size).toBe(options.length);
    }, 60_000);

  it("P93: the group is named from its caption", async () => {
    const { saved } = await chain("P93");
    expect(saved[0]!.name).toBe("preferred_contact");
  });

  it("P97: a checklist stays checkboxes, a widget inside each printed square", async () => {
    const { saved } = await chain("P97");
    expect(saved).toHaveLength(3);
    expect(saved.every((s) => s.checkBox && !s.radioButton)).toBe(true);
    for (const w of saved)
      expect(PRINTED.P97!.some((p) => inside(w.rect, p, 0))).toBe(true);
  });

  it("P90's saved /MaxLen is on the field dictionary pdf-lib reads too (an independent reader)", async () => {
    const { out } = await chain("P90");
    const doc = await PDFDocument.load(out);
    const [f] = doc.getForm().getFields();
    expect(f).toBeInstanceOf(PDFTextField);
    expect((f as PDFTextField).getMaxLength()).toBe(8);
    const ff = f!.acroField.dict.lookup(PDFName.of("Ff"));
    expect(
      ff === undefined ? 0 : (ff as PDFNumber).asNumber() & COMB_FLAG,
    ).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 *  The card Add makes (the chunk's own addKeys)
 * ------------------------------------------------------------------ */

describe("Add makes the builder's card: a comb's Max length, a radio group's choices", () => {
  type Card = DraftLike & { maxLength: string; optionsText: string };
  const make = (id: string): Card => ({
    id,
    type: "text",
    name: "x",
    page: 1,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    multiline: false,
    maxLength: "",
    optionsText: "",
  });

  async function added(id: string): Promise<Card[]> {
    const c = COMB_CASES.find((x) => x.id === id)!;
    const bytes = await c.build();
    const report = await detectFormFields(bytes, { loadReader: legacyPdfjs });
    const list = report.pages.flatMap((p) =>
      p.outcome === "found" ? p.proposals : [],
    );
    const context = await readFormContext(bytes);
    let drafts: Card[] = [];
    let found: Found = { list, note: null };
    const f: Finder<Card> = {
      bytes,
      drafts,
      setDrafts: (d) => (drafts = d),
      untouched: true,
      make,
      context,
      validate: validateFormFields,
      found,
      setFound: (u) => (found = typeof u === "function" ? u(found) : u),
      selected: null,
      select: () => {},
    };
    addKeys(
      f,
      list.map((p) => p.key),
    );
    expect(found.list).toEqual([]);
    return drafts;
  }

  it("P90: a text card with Max length 8", async () => {
    const cards = await added("P90");
    expect(cards.map((d) => [d.type, d.maxLength, d.optionsText])).toEqual([
      ["text", "8", ""],
    ]);
  });

  it("P93: a radio card, its choices one per line, at the top button", async () => {
    const cards = await added("P93");
    expect(cards.map((d) => [d.type, d.optionsText, d.maxLength])).toEqual([
      ["radio", "Email\nPhone\nPost", ""],
    ]);
    expect(cards[0]).toMatchObject({ x: 72, y: 650, width: 12, height: 12 });
  });

  it("the preview's dotted box for a radio group covers its whole stack", async () => {
    const c = COMB_CASES.find((x) => x.id === "P93")!;
    const report = await detectFormFields(await c.build(), {
      loadReader: legacyPdfjs,
    });
    const list = report.pages.flatMap((p) =>
      p.outcome === "found" ? p.proposals : [],
    );
    const [shown] = onPage(list, 1);
    expect(shown).toMatchObject({
      kind: "Radio group",
      x: 72,
      y: 614,
      width: 12,
      height: 48,
    });
  });
});

/* ------------------------------------------------------------------ *
 *  Copy, bound to behaviour
 * ------------------------------------------------------------------ */

describe("what the page says about combs and radio groups is what the reader does", () => {
  const served = () =>
    createFormsCorpus()
      .map((s) => s.text)
      .join("\n");

  it("no served sentence says a row of character boxes is always passed over (P90 proposes one)", () => {
    expect(RUNS.get("P90")!.proposals.map((p) => p.rule)).toEqual([
      "comb-boxes",
    ]);
    expect(served()).not.toMatch(/a row of boxes for one letter each,/);
  });

  it("the FAQ's radio sentence is served while the reader proposes a radio group on P93, and says to check it", () => {
    expect(RUNS.get("P93")!.proposals.map((p) => p.type)).toEqual(["radio"]);
    const s = served();
    const sentence = s
      .split(/(?<=[.!?])\s+/)
      .find((x) => /\bstacked\b/.test(x) && /radio group/i.test(x));
    expect(
      sentence,
      "no sentence says stacked boxes are suggested as a radio group",
    ).toBeDefined();
    expect(sentence).toMatch(/\bsuggested\b/);
    expect(sentence).toMatch(/\bcheck\b/i);
    // ...and the comb half of the same sentence, bound to P90 above.
    // (Review round 1, 2026-11-22: "for one character each" became "for
    // single characters", and the sentence now names the multi-answer
    // exception, held to the reader in form-detect-combs-review.test.ts.)
    expect(sentence).toMatch(/four or more boxes for single characters/);
  });
});
