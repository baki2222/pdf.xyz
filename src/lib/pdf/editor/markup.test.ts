// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  moveObject,
  resizeObject,
  type HighlightObject,
  type Rect,
} from "./model";
import { quadsBounds, selectTextQuads } from "./markup";
import type { TextRun } from "./runs";

/**
 * Selecting text to mark (audit annotate-pdf#3, 2026-11-08): a press on a
 * word and a drag to another selects the words between, in reading order,
 * one quad per line — what a viewer's own text selection covers.
 */

let n = 0;
function run(str: string, rect: Rect, angle = 0): TextRun {
  n += 1;
  return {
    key: `p0r${n}`,
    page: 0,
    index: n,
    str,
    transform: [1, 0, 0, 1, rect.x, rect.y],
    width: rect.width,
    rect,
    baseX: rect.x,
    baseY: rect.y + rect.height * 0.8,
    size: rect.height / 1.14,
    angle,
  };
}

// Two lines of ten-character runs, each character 10 pt wide.
const L1 = run("alpha beta", { x: 100, y: 100, width: 100, height: 20 });
const L2 = run("gamma delt", { x: 100, y: 130, width: 100, height: 20 });
const RUNS = [L1, L2];

describe("selectTextQuads", () => {
  it("is null when the press is not on text — the drag is a box (health: not a vacuous [])", () => {
    expect(
      selectTextQuads(RUNS, { x: 20, y: 20 }, { x: 150, y: 140 }),
    ).toBeNull();
    expect(
      selectTextQuads([], { x: 120, y: 110 }, { x: 150, y: 140 }),
    ).toBeNull();
  });

  it("a press without a drag selects the whole word under it", () => {
    // "beta" is characters 6..10: x 160..200.
    expect(
      selectTextQuads(RUNS, { x: 172, y: 110 }, { x: 172, y: 110 }),
    ).toEqual([{ x: 160, y: 100, width: 40, height: 20 }]);
  });

  it("a drag across two lines: the rest of the first line from the word pressed, the second up to the word reached", () => {
    const quads = selectTextQuads(RUNS, { x: 165, y: 110 }, { x: 112, y: 140 });
    expect(quads).toEqual([
      { x: 160, y: 100, width: 40, height: 20 },
      { x: 100, y: 130, width: 50, height: 20 },
    ]);
  });

  it("dragging backwards selects the same words", () => {
    expect(
      selectTextQuads(RUNS, { x: 112, y: 140 }, { x: 165, y: 110 }),
    ).toEqual(selectTextQuads(RUNS, { x: 165, y: 110 }, { x: 112, y: 140 }));
  });

  it("a release past the end of the text snaps to the nearest run", () => {
    const quads = selectTextQuads(RUNS, { x: 105, y: 110 }, { x: 400, y: 112 });
    expect(quads).toEqual([{ x: 100, y: 100, width: 100, height: 20 }]);
  });

  it("two runs side by side on one line merge into one quad; a column gutter does not", () => {
    const a = run("left", { x: 100, y: 200, width: 40, height: 20 });
    const b = run("right", { x: 144, y: 200, width: 50, height: 20 });
    const far = run("other", { x: 400, y: 200, width: 50, height: 20 });
    expect(
      selectTextQuads([a, b], { x: 101, y: 210 }, { x: 190, y: 210 }),
    ).toEqual([{ x: 100, y: 200, width: 94, height: 20 }]);
    expect(
      selectTextQuads([a, far], { x: 101, y: 210 }, { x: 440, y: 210 }),
    ).toHaveLength(2);
  });

  it("turned text is not selected", () => {
    const turned = run(
      "sideways",
      { x: 100, y: 100, width: 20, height: 100 },
      90,
    );
    expect(
      selectTextQuads([turned], { x: 110, y: 150 }, { x: 110, y: 180 }),
    ).toBeNull();
  });
});

describe("a selected-text markup moves and resizes with its quads", () => {
  const quads = [
    { x: 160, y: 100, width: 40, height: 20 },
    { x: 100, y: 130, width: 50, height: 20 },
  ];
  const obj: HighlightObject = {
    id: "h",
    kind: "highlight",
    page: 0,
    ...quadsBounds(quads),
    quads,
    markup: "highlight",
    color: "#facc15",
    opacity: 0.4,
  };

  it("the box is the quads' bounds", () => {
    expect(quadsBounds(quads)).toEqual({
      x: 100,
      y: 100,
      width: 100,
      height: 50,
    });
  });

  it("moving shifts every quad", () => {
    const moved = moveObject(obj, 10, 5);
    expect(moved.quads).toEqual([
      { x: 170, y: 105, width: 40, height: 20 },
      { x: 110, y: 135, width: 50, height: 20 },
    ]);
  });

  it("resizing scales every quad with the box", () => {
    const from = { x: 100, y: 100, width: 100, height: 50 };
    const r = resizeObject(obj, from, {
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    });
    expect(r.quads).toEqual([
      { x: 220, y: 100, width: 80, height: 40 },
      { x: 100, y: 160, width: 100, height: 40 },
    ]);
  });
});

describe("the copy that answers 'can I select text to highlight?'", () => {
  // INVERTED 2026-11-08, history kept: both answers began "No." — "A
  // highlight is a see-through rectangle you drag over the words" — true
  // until selectTextQuads shipped (audit annotate-pdf#3).
  it("the Annotate PDF FAQ and the highlight guide say yes, and that a click marks one word", async () => {
    const { default: annotate } =
      await import("@/lib/tools/content/annotate-pdf");
    const { guides } = await import("@/lib/guides/catalog");
    const faq = annotate.faqs.find((f) => /selecting it/.test(f.q));
    const guide = guides
      .find((g) => g.slug === "how-to-highlight-text-in-a-pdf")
      ?.faq.find((f) => /selecting it/.test(f.question));
    for (const answer of [faq?.a, guide?.answer]) {
      expect(answer, "answer not found").toBeTruthy();
      expect(answer).toMatch(/^Yes\./);
      expect(answer).toMatch(/click on (a single|one) word/);
      // A press off text still draws a box — selectTextQuads is null there.
      expect(answer).toMatch(/no selectable text/);
    }
  });
});
