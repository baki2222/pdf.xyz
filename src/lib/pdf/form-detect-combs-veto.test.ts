// @native-canvas
/**
 * Slice S6's verify round (2026-11-22): the multi-answer veto, read as the
 * page prints it.
 *
 * The verifier found the veto blind in three ways, each a multi-answer
 * list still made ONE radio group (one answer only), the defect class of
 * review round 1's F1:
 *
 *  - it tested each pdf.js text item on its own, so a line drawn one word
 *    per call ("Symptoms" "(tick" "all" "that" "apply)") or wrapped
 *    ("Select one or" / "more.") never matched {@link MULTI_ANSWER};
 *  - it read only text over the squares and their labels, so the words at
 *    the end of the caption's line, past the labels, were missed;
 *  - it read only up to RADIO_VETO_ABOVE over the top square, and nothing
 *    under the stack, so an instruction two lines over the caption, or a
 *    note printed under the stack, was missed.
 *
 * The veto now joins each line's items, left to right, joins the lines of
 * the text over the stack into one passage (walking up from the caption
 * while lines follow at RADIO_VETO_LEADING), reads whole lines, and reads
 * the note under the stack (RADIO_VETO_BELOW). Every page below was a
 * radio group at the verified head (0c03403c), and each has a control
 * that is still a group, so the veto is not merely wider than the page.
 *
 * P107 to P109 run the same three shapes through the real reader and the
 * builder to the saved PDF, read back with pdf.js.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument, PDFRadioGroup } from "pdf-lib";
import {
  createFormFields,
  readFormContext,
  validateFormFields,
} from "./create-forms";
import {
  DETECT_COMBS,
  classifyPage,
  type CardPage,
  type CardRect,
  type CardText,
} from "./form-detect";
import { detectFormFields } from "./form-detect-read";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";
import { toAdd } from "@/components/tools/runner/create-forms-detect";
import {
  COMB_CASES,
  PRINTED,
  S6,
  type Printed,
} from "@/tests/form-detect-combs-fixtures";
import {
  legacyPdfjs,
  runCase,
  type CaseRun,
} from "@/tests/form-detect-fixtures";

/* ------------------------------------------------------------------ *
 *  Hand-built pages (card frame = page frame, unturned)
 * ------------------------------------------------------------------ */

const txt = (str: string, x: number, y: number, width?: number): CardText => ({
  str,
  x,
  y,
  width: width ?? str.length * 5,
  size: 10,
  upright: true,
});

/** `s` as one item per word, 5 pt a character and a space between. */
const perWord = (s: string, x: number, y: number): CardText[] => {
  const out: CardText[] = [];
  let at = x;
  for (const w of s.split(" ")) {
    out.push(txt(w, at, y));
    at += (w.length + 1) * 5;
  }
  return out;
};

const rect = (x: number, y: number, s: number): CardRect => ({
  x0: x,
  y0: y,
  x1: x + s,
  y1: y + s,
  width: 1,
  stroked: true,
  filled: false,
  lum: 0,
});

const FEVER = ["Fever", "Cough", "Headache", "Fatigue"];

/**
 * FEVER's four 12 pt squares at x 100 from a top square at 650 (its top
 * edge 662), 6 pt apart, each labelled on its right, plus `extra` text.
 * The bottom square's bottom edge is 596.
 */
function page(extra: CardText[]): CardPage {
  const rects: CardRect[] = [];
  const text: CardText[] = [...extra];
  FEVER.forEach((label, k) => {
    const y = 650 - 18 * k;
    rects.push(rect(100, y, 12));
    text.push(txt(label, 116, y + 2));
  });
  return {
    page: 1,
    width: 612,
    height: 792,
    segs: [],
    rects,
    text,
    widgets: [],
    imageCover: 0,
  };
}

const kinds = (p: CardPage) =>
  classifyPage(p).proposals.map((x) => [x.type, x.label]);
const CHECKBOXES = FEVER.map((f) => ["checkbox", f]);

describe("the multi-answer veto reads the line as it prints, not item by item", () => {
  it("control: a caption drawn one word per call is one radio group, named from the whole line", () => {
    expect(kinds(page(perWord("Symptoms you have now", 100, 668)))).toEqual([
      ["radio", "Symptoms you have now"],
    ]);
  });

  it('"Symptoms (tick all that apply)" drawn one word per call: four checkboxes', () => {
    expect(
      kinds(page(perWord("Symptoms (tick all that apply)", 100, 668))),
    ).toEqual(CHECKBOXES);
  });

  it('a wrapped question, "Which have you had? Select one or" / "more.": four checkboxes', () => {
    expect(
      kinds(
        page([
          txt("Which have you had? Select one or", 100, 681),
          txt("more.", 100, 668),
        ]),
      ),
    ).toEqual(CHECKBOXES);
  });

  it("control: a wrapped single-answer question is one group, named from both lines", () => {
    expect(
      kinds(
        page([
          txt("Which of these did you", 100, 681),
          txt("have first?", 100, 668),
        ]),
      ),
    ).toEqual([["radio", "Which of these did you have first?"]]);
  });
});

describe("the multi-answer veto reads the caption's whole line", () => {
  it('"(tick all that apply)" at x 200 on the caption\'s line, past the labels: four checkboxes', () => {
    // The longest label, "Headache", ends at 116 + 40 = 156.
    expect(
      kinds(
        page([
          txt("Symptoms", 100, 668),
          txt("(tick all that apply)", 200, 668),
        ]),
      ),
    ).toEqual(CHECKBOXES);
  });

  it("control: other words at x 200 on that line leave one group named from the caption", () => {
    expect(
      kinds(page([txt("Symptoms", 100, 668), txt("(optional)", 200, 668)])),
    ).toEqual([["radio", "Symptoms"]]);
  });
});

describe("the multi-answer veto reads the passage over the stack and the note under it", () => {
  it("the instruction two lines over the caption (rise 30, past RADIO_VETO_ABOVE): four checkboxes", () => {
    // Descent = baseline - 2 (size 10); the top square's top is 662.
    expect(694 - 2 - 662).toBeGreaterThan(DETECT_COMBS.RADIO_VETO_ABOVE);
    expect(
      kinds(
        page([
          txt("Tick all that apply.", 100, 694),
          txt("Think about the last week.", 100, 681),
          txt("Symptoms", 100, 668),
        ]),
      ),
    ).toEqual(CHECKBOXES);
  });

  it("...and with a blank line between it and the caption: four checkboxes", () => {
    expect(
      kinds(
        page([
          txt("Tick all that apply.", 100, 694),
          txt("Symptoms", 100, 668),
        ]),
      ),
    ).toEqual(CHECKBOXES);
  });

  it("control: the same passage asking for one answer is one group, named from the caption", () => {
    expect(
      kinds(
        page([
          txt("Pick the one that started first.", 100, 694),
          txt("Think about the last week.", 100, 681),
          txt("Symptoms", 100, 668),
        ]),
      ),
    ).toEqual([["radio", "Symptoms"]]);
  });

  it("control: the words 30 pt over a stack with no caption still do not veto (the walk starts at a line within RADIO_VETO_ABOVE)", () => {
    expect(kinds(page([txt("Tick all that apply", 100, 694)]))).toEqual([
      ["radio", null],
    ]);
  });

  it("control: words asking for many past the passage (a heading far over it) do not veto", () => {
    expect(
      kinds(
        page([txt("Tick all that apply", 100, 760), txt("Symptoms", 100, 668)]),
      ),
    ).toEqual([["radio", "Symptoms"]]);
  });

  it('"You may tick more than one." printed under the stack: four checkboxes', () => {
    expect(
      kinds(
        page([
          txt("Symptoms", 100, 668),
          txt("You may tick more than one.", 100, 582),
        ]),
      ),
    ).toEqual(CHECKBOXES);
  });

  it("control: a note under the stack asking for one answer leaves the group", () => {
    expect(
      kinds(
        page([
          txt("Symptoms", 100, 668),
          txt("Pick the one you have most.", 100, 582),
        ]),
      ),
    ).toEqual([["radio", "Symptoms"]]);
  });

  it("control: the next question's words far under the stack (past RADIO_VETO_BELOW) do not veto it", () => {
    expect(596 - 540).toBeGreaterThan(DETECT_COMBS.RADIO_VETO_BELOW);
    expect(
      kinds(
        page([txt("Symptoms", 100, 668), txt("Tick all that apply", 100, 540)]),
      ),
    ).toEqual([["radio", "Symptoms"]]);
  });
});

/* ------------------------------------------------------------------ *
 *  P107 to P109: through the reader, to the saved PDF
 * ------------------------------------------------------------------ */

const ROUND = ["P107", "P108", "P109"] as const;
const RUNS = new Map<string, CaseRun>();
beforeAll(async () => {
  for (const id of ROUND)
    RUNS.set(id, await runCase(COMB_CASES.find((c) => c.id === id)!));
}, 120_000);

async function saved(id: string) {
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
  expect(dropped).toEqual([]);
  const out = (
    await createFormFields(
      bytes,
      added.map((a) => a.spec),
    )
  ).bytes;
  const pdfjs =
    (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof import("pdfjs-dist");
  const task = pdfjs.getDocument({
    data: out.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  try {
    const doc = await task.promise;
    const widgets: {
      name: string;
      rect: number[];
      checkBox: boolean;
      radio: boolean;
    }[] = [];
    for (const a of await (await doc.getPage(1)).getAnnotations())
      if (a.subtype === "Widget")
        widgets.push({
          name: String(a.fieldName),
          rect: a.rect as number[],
          checkBox: a.checkBox === true,
          radio: a.radioButton === true,
        });
    return { found, out, widgets };
  } finally {
    await task.destroy();
  }
}

const centreOff = (r: number[], p: Printed) =>
  Math.max(
    Math.abs((r[0]! + r[2]!) / 2 - (p.x0 + p.x1) / 2),
    Math.abs((r[1]! + r[3]!) / 2 - (p.y0 + p.y1) / 2),
  );

describe("P107 to P109 through the reader and to the saved PDF", () => {
  it("health: each case ran and the reader proposed one checkbox a printed square", () => {
    expect(RUNS.size).toBe(ROUND.length);
    for (const id of ROUND) {
      const r = RUNS.get(id)!;
      expect(
        r.proposals.map((p) => p.type),
        id,
      ).toEqual(PRINTED[id]!.map(() => "checkbox"));
      expect(
        r.proposals.map((p) => p.label),
        id,
      ).toEqual([...S6[id].options]);
    }
  });

  it("health: P107's words reach the reader as five items (the case exercises the split, not one joined item)", async () => {
    const bytes = await COMB_CASES.find((c) => c.id === "P107")!.build();
    const pdfjs = await legacyPdfjs();
    const task = pdfjs.getDocument({
      data: bytes.slice(),
      ...PDFJS_DOCUMENT_DEFAULTS,
    });
    try {
      const doc = await task.promise;
      const items = (await (await doc.getPage(1)).getTextContent()).items
        .map((i) => ("str" in i ? i.str.trim() : ""))
        .filter((s) => s !== "");
      expect(items.slice(0, 5)).toEqual(S6.P107.caption.split(" "));
    } finally {
      await task.destroy();
    }
  });

  for (const id of ROUND)
    it(`${id}: saved as independent checkboxes, a widget centred on each printed square, no radio field`, async () => {
      const { widgets, out } = await saved(id);
      const printed = PRINTED[id]!;
      expect(widgets).toHaveLength(printed.length);
      expect(widgets.every((w) => w.checkBox && !w.radio)).toBe(true);
      expect(new Set(widgets.map((w) => w.name)).size).toBe(printed.length);
      for (const p of printed)
        expect(widgets.some((w) => centreOff(w.rect, p) <= 0.5)).toBe(true);
      const fields = (await PDFDocument.load(out)).getForm().getFields();
      expect(fields.some((f) => f instanceof PDFRadioGroup)).toBe(false);
    }, 60_000);
});
