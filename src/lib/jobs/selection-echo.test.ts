// @vitest-environment node
/**
 * The chosen-pages echo, end to end on the record side: the worker writes
 * `truncation.pagesSent`, `sanitizeJobResults` (the one persistence boundary
 * every queue write funnels through) re-bounds it, and the panel's
 * `selectionConfirmed` compares it with what it sent.
 *
 * Asked at the composed seam, not at `boundChosenPages` alone: a field the
 * sanitizer is not taught about is dropped before the browser sees it, and a
 * unit test of the bound would stay green through that.
 */
import { describe, expect, it } from "vitest";
import type { PageSpan } from "@/lib/pdf/page-spans";
import type { AiWindowMeta } from "./ai-results";
import { sanitizeJobResults } from "./results";
import { selectionConfirmed } from "./selection-echo";

const WHOLE: AiWindowMeta = {
  truncated: false,
  charactersSent: 900,
  charactersTotal: 900,
  totalPages: 40,
  lastCompletePage: 40,
  cutMidPage: false,
};

const persisted = (window: Record<string, unknown>) =>
  sanitizeJobResults({ ai: { truncation: window as unknown as AiWindowMeta } })
    ?.ai?.truncation;

describe("sanitizeJobResults keeps a chosen selection's echo", () => {
  it("keeps an untruncated selection exactly", () => {
    const pagesSent = [
      [3, 5],
      [9, 9],
    ];
    expect(persisted({ ...WHOLE, pagesSent })?.pagesSent).toEqual(pagesSent);
  });

  it("keeps a truncated clip that reaches the last complete page", () => {
    const out = persisted({
      ...WHOLE,
      truncated: true,
      charactersSent: 400,
      lastCompletePage: 4,
      cutMidPage: true,
      pagesSent: [[3, 5]],
    });
    expect(out?.pagesSent).toEqual([[3, 5]]);
    expect(out?.selection).toBeUndefined();
  });

  it("drops a clip that ends before the last page read in full", () => {
    const out = persisted({
      ...WHOLE,
      truncated: true,
      charactersSent: 400,
      lastCompletePage: 7,
      pagesSent: [[3, 5]],
    });
    expect(out?.pagesSent).toBeUndefined();
  });

  it.each([
    ["a page past the document", [[39, 41]]],
    [
      "adjacent spans",
      [
        [1, 2],
        [3, 4],
      ],
    ],
    [
      "overlapping spans",
      [
        [1, 3],
        [3, 5],
      ],
    ],
    ["reversed", [[5, 3]]],
    ["page zero", [[0, 2]]],
    ["a fraction", [[1, 1.5]]],
    ["an empty list", []],
    ["not a list", "3-5"],
    ["21 spans", Array.from({ length: 21 }, (_, i) => [1 + i, 1 + i])],
  ])("drops %s whole rather than repairing it", (_name, pagesSent) => {
    const out = persisted({ ...WHOLE, pagesSent });
    // Positive control on the same record: the window itself survives.
    expect(out?.charactersTotal).toBe(900);
    expect(out?.pagesSent).toBeUndefined();
  });

  it("leaves a whole-document window byte-identical: no pagesSent key at all", () => {
    const out = persisted({ ...WHOLE });
    expect(out).toEqual(WHOLE);
    expect(Object.keys(out ?? {})).not.toContain("pagesSent");
  });

  it("does not change chat's relevance windows (their own bound still clamps)", () => {
    const out = persisted({
      ...WHOLE,
      truncated: true,
      charactersSent: 400,
      lastCompletePage: null,
      selection: "relevance",
      // Out of canonical form: chat's bound merges, the chosen bound would drop.
      pagesSent: [
        [1, 2],
        [3, 4],
      ],
      pagesRead: 4,
    });
    expect(out?.selection).toBe("relevance");
    expect(out?.pagesSent).toEqual([[1, 4]]);
  });
});

describe("selectionConfirmed - the rollback check", () => {
  const sent: PageSpan[] = [
    [3, 5],
    [9, 12],
  ];
  const win = (pagesSent: PageSpan[] | undefined, truncated = false) => ({
    truncated,
    ...(pagesSent ? { pagesSent } : {}),
  });

  it.each([
    ["the exact echo", win(sent), true],
    [
      "a clip inside the last span, truncated",
      win(
        [
          [3, 5],
          [9, 10],
        ],
        true,
      ),
      true,
    ],
    ["a clip that dropped later spans, truncated", win([[3, 4]], true), true],
    ["no echo (an image that ignored pages)", win(undefined), false],
    ["no window at all", undefined, false],
    ["a different page list", win([[1, 1]]), false],
    ["a prefix, but untruncated", win([[3, 5]]), false],
    [
      "a clip, but untruncated",
      win([
        [3, 5],
        [9, 10],
      ]),
      false,
    ],
    [
      "a clip that ends late, truncated",
      win(
        [
          [3, 5],
          [9, 13],
        ],
        true,
      ),
      false,
    ],
    ["a clip with a moved start, truncated", win([[4, 5]], true), false],
    [
      "a middle span cut short, truncated",
      win(
        [
          [3, 4],
          [9, 12],
        ],
        true,
      ),
      false,
    ],
    ["more spans than were sent", win([...sent, [20, 20]]), false],
    ["an empty echo", win([]), false],
  ] as const)("%s -> %s", (_name, window, expected) => {
    expect(selectionConfirmed(sent, window)).toBe(expected);
  });

  it("is false when nothing was sent (no selection to confirm)", () => {
    expect(selectionConfirmed([], win(sent))).toBe(false);
  });

  it("composes with the sanitizer: what the worker wrote, persisted, confirms", () => {
    const out = persisted({ ...WHOLE, pagesSent: sent });
    expect(selectionConfirmed(sent, out)).toBe(true);
  });
});
