// @vitest-environment node
/**
 * Summarize's page range (audit summarize-pdf#5, slice 5) on the ONE window
 * description every AI tool shares.
 *
 * Two properties, one per half of this file:
 *
 *  1. GOLDEN — every window that does NOT carry chosen pages (whole, prefix,
 *     cut mid-page, no table, chat's relevance windows) renders byte for byte
 *     what it rendered before this slice, against a FROZEN copy of the
 *     origin/main 6d18e3ed notice functions kept below. So chat, ai-extract
 *     and translate cannot change through this file.
 *  2. CHOSEN PAGES — a window over pages a person chose names those pages,
 *     by their own page numbers, in the model notice, the user notice and
 *     the selection sentence; truncated, it names the clipped list; and a
 *     table that does not describe the string names none.
 */
import { describe, expect, it } from "vitest";
import { formatSpans } from "@/lib/pdf/page-spans";
import {
  describeSelection,
  describeWindow,
  modelTruncationNotice,
  pageStartsFor,
  userSelectionNotice,
  userTruncationNotice,
  type SelectionNoticeParts,
  type TruncationWindow,
} from "./truncation";

/** Built from code points (house rule): en dash, em dash. */
const EN = String.fromCharCode(0x2013);
const EM = String.fromCharCode(0x2014);

// ---------------------------------------------------------------------------
// FROZEN: origin/main 6d18e3ed, src/lib/workers/ai/truncation.ts. Do not
// edit these to make a test pass — they are the oracle.
// ---------------------------------------------------------------------------
function frozenSelectionSpans(
  window: TruncationWindow,
): readonly (readonly [number, number])[] | null {
  if (window.selection !== "relevance") return null;
  const spans = window.pagesSent;
  return spans && spans.length > 0 ? spans : null;
}
function frozenModelTruncationNotice(
  window: TruncationWindow,
  revocation: (upTo: string) => string,
  selection?: SelectionNoticeParts,
): string {
  if (!window.truncated) return "";
  const spans = frozenSelectionSpans(window);
  if (spans) {
    const covers = `pages ${formatSpans(spans)} of ${window.totalPages}`;
    const last = spans[spans.length - 1]![1];
    const cut = window.cutMidPage
      ? ` The text of page ${last} ends mid-page.`
      : "";
    return [
      "",
      `IMPORTANT ${EM} YOU ARE SEEING ONLY PART OF THIS DOCUMENT.`,
      `The text above covers ${covers}${selection ? `: ${selection.chosenBy}` : ""}; other pages were not sent because of a length limit.${cut}`,
      selection ? selection.revocation : revocation(covers),
    ].join("\n");
  }
  const upTo =
    window.lastCompletePage !== null
      ? `pages 1-${window.lastCompletePage} of ${window.totalPages}`
      : `the first part of ${window.totalPages} pages`;
  const fragment = window.cutMidPage
    ? " The text ends mid-page and may break mid-sentence."
    : "";
  return [
    "",
    `IMPORTANT ${EM} YOU ARE SEEING ONLY PART OF THIS DOCUMENT.`,
    `The text above covers ${upTo}; the rest was not sent because of a length limit.${fragment}`,
    revocation(upTo),
  ].join("\n");
}
function frozenUserTruncationNotice(window: TruncationWindow): string {
  if (!window.truncated) return "";
  if (window.selection === "relevance") {
    const lead = "This document is longer than one question can read, so";
    const spans = frozenSelectionSpans(window);
    if (!spans)
      return `${lead} only some of its ${window.totalPages} pages were read.`;
    const read = spans.reduce((sum, [a, b]) => sum + b - a + 1, 0);
    const single = read === 1;
    const fragment = window.cutMidPage
      ? single
        ? ", cut mid-page"
        : ", the last of them cut mid-page"
      : "";
    return `${lead} ${read} of its ${window.totalPages} pages ${single ? "was" : "were"} read: ${single ? "page" : "pages"} ${formatSpans(spans)}${fragment}. Pages not listed were not sent.`;
  }
  const upTo =
    window.lastCompletePage !== null
      ? `pages 1${EN}${window.lastCompletePage} of ${window.totalPages}`
      : `the first part of this ${window.totalPages}-page document`;
  const fragment = window.cutMidPage ? ", cut mid-page" : "";
  return `Only ${upTo} could be read${fragment} ${EM} this document is longer than the limit, so anything after that was not considered.`;
}
// --------------------------------------------------------------------------

const SEP = "\n\n";
const REVOKE = (upTo: string) => `State that it covers only ${upTo}.`;

/** `n` pages of `size` characters each, page numbers 1..n unless given. */
function chunks(sizes: readonly number[], numbers?: readonly number[]) {
  return sizes.map((size, i) => ({
    pageNumber: numbers?.[i] ?? i + 1,
    text: String.fromCharCode(97 + (i % 26)).repeat(size),
  }));
}
function windowOf(
  sizes: readonly number[],
  totalPages: number,
  maxChars: number,
  numbers?: readonly number[],
  selection?: readonly (readonly [number, number])[],
): TruncationWindow {
  const c = chunks(sizes, numbers);
  const assembled = c.map((x) => x.text).join(SEP);
  return describeWindow(
    assembled,
    pageStartsFor(c, SEP),
    totalPages,
    maxChars,
    selection,
  );
}

describe("GOLDEN: a window without chosen pages renders exactly as before", () => {
  const thirty = Array.from({ length: 300 }, () => 50);
  const rows: [string, TruncationWindow][] = [
    ["whole, 3 pages", windowOf([10, 10, 10], 3, 1_000)],
    ["whole, 1 page", windowOf([10], 1, 1_000)],
    ["cut exactly on a page start", windowOf([10, 10, 10], 3, 24)],
    ["cut one character into page 3", windowOf([10, 10, 10], 3, 25)],
    ["cut inside page 1 (null last page)", windowOf([10, 10, 10], 3, 5)],
    ["cut on a page's last character", windowOf([10, 10, 10], 3, 10)],
    [
      "gap in numbering, cut on page 5",
      windowOf([10, 10, 10], 5, 27, [1, 2, 5]),
    ],
    ["one page, cut mid-page", windowOf([100], 1, 40)],
    ["300 pages, cut mid-page", windowOf(thirty, 300, 4_000)],
    ["300 pages, whole", windowOf(thirty, 300, 1_000_000)],
    [
      "no table describes the string",
      describeWindow("x".repeat(100), [], 9, 50),
    ],
    [
      "table off by one character",
      describeWindow(
        "x".repeat(35),
        pageStartsFor(chunks([10, 10, 10]), SEP),
        3,
        20,
      ),
    ],
    [
      "relevance window",
      describeSelection(9_000, 900, 70, [1, 2, 3, 60], null),
    ],
    [
      "relevance window cut mid-page",
      describeSelection(9_000, 900, 70, [1, 2, 3, 60], 60),
    ],
    [
      "relevance window, one page",
      describeSelection(9_000, 900, 70, [60], null),
    ],
  ];

  it("has a corpus of at least 12 windows, none carrying chosen pages", () => {
    expect(rows.length).toBeGreaterThanOrEqual(12);
    for (const [, w] of rows)
      expect(w.pagesSent === undefined || w.selection === "relevance").toBe(
        true,
      );
    // Both arms of every notice are exercised: some rows disclose, some not.
    const disclosed = rows.filter(([, w]) => userTruncationNotice(w) !== "");
    expect(disclosed.length).toBeGreaterThanOrEqual(8);
    expect(rows.length - disclosed.length).toBeGreaterThanOrEqual(2);
  });

  it.each(rows)("%s", (_name, w) => {
    expect(modelTruncationNotice(w, REVOKE)).toBe(
      frozenModelTruncationNotice(w, REVOKE),
    );
    const parts = { chosenBy: "CHOSEN BY", revocation: "RELEVANCE REVOKE" };
    expect(modelTruncationNotice(w, REVOKE, parts)).toBe(
      frozenModelTruncationNotice(w, REVOKE, parts),
    );
    expect(userTruncationNotice(w)).toBe(frozenUserTruncationNotice(w));
    expect(userSelectionNotice(w)).toBe("");
  });

  it("a window built without a selection carries no pagesSent field at all", () => {
    for (const [name, w] of rows) {
      if (w.selection === "relevance") continue;
      expect(Object.keys(w), name).not.toContain("pagesSent");
    }
  });
});

describe("a window over pages a person chose", () => {
  // Pages 3, 4 and 5 chosen; page 4 is BLANK, so it has no chunk and the
  // chunks are pages 3 and 5 — chunk index + 1 would say pages 1 and 2.
  const SELECTED_SIZES = [10, 10];
  const SELECTED_NUMBERS = [3, 5];
  const SELECTION: [number, number][] = [[3, 5]];

  it("untruncated: pagesSent is the whole selection, blank page included", () => {
    const w = windowOf(SELECTED_SIZES, 40, 1_000, SELECTED_NUMBERS, SELECTION);
    expect(w.truncated).toBe(false);
    expect(w.pagesSent).toEqual([[3, 5]]);
    expect(w.charactersTotal).toBe(22);
  });

  it("untruncated: the model is still told which pages it holds", () => {
    const w = windowOf(SELECTED_SIZES, 40, 1_000, SELECTED_NUMBERS, SELECTION);
    expect(modelTruncationNotice(w, REVOKE)).toBe(
      [
        "",
        `IMPORTANT ${EM} YOU ARE SEEING ONLY PART OF THIS DOCUMENT.`,
        `The text above covers pages 3${EN}5 of 40, the pages the user chose; no other page was sent.`,
        `State that it covers only pages 3${EN}5 of 40.`,
      ].join("\n"),
    );
    expect(userTruncationNotice(w)).toBe("");
    expect(userSelectionNotice(w)).toBe(
      `This summary covers pages 3${EN}5 of 40, the pages you chose.`,
    );
  });

  it("truncated: clipped at the last STARTED page's own number", () => {
    // Cut 3 characters into page 5's chunk (offset 12): page 5 started.
    const w = windowOf(SELECTED_SIZES, 40, 15, SELECTED_NUMBERS, [
      [3, 5],
      [9, 9],
    ]);
    expect(w.truncated).toBe(true);
    expect(w.cutMidPage).toBe(true);
    expect(w.lastCompletePage).toBe(3);
    expect(w.pagesSent).toEqual([[3, 5]]);
    expect(userTruncationNotice(w)).toBe(
      `Only pages 3${EN}5 of the pages you chose could be read, cut mid-page ${EM} they hold more text than the limit, so anything after that was not considered.`,
    );
    expect(userSelectionNotice(w)).toBe(
      `This summary covers pages 3${EN}5 of 40, the pages you chose.`,
    );
    const notice = modelTruncationNotice(w, REVOKE);
    expect(notice).toContain(
      `The text above covers pages 3${EN}5 of 40, the pages the user chose; no other page was sent. The chosen pages hold more text than the length limit, so the text stops early and may break mid-sentence.`,
    );
    expect(notice).not.toMatch(/pages 1-/);
  });

  it("truncated inside the first chosen page: clipped to that page", () => {
    const w = windowOf(SELECTED_SIZES, 40, 4, SELECTED_NUMBERS, SELECTION);
    expect(w.pagesSent).toEqual([[3, 3]]);
    expect(w.lastCompletePage).toBeNull();
    expect(userSelectionNotice(w)).toBe(
      "This summary covers page 3 of 40, the page you chose.",
    );
  });

  it("truncated on a page boundary: the boundary page, not the next", () => {
    const w = windowOf(SELECTED_SIZES, 40, 10, SELECTED_NUMBERS, SELECTION);
    expect(w.cutMidPage).toBe(false);
    expect(w.lastCompletePage).toBe(3);
    expect(w.pagesSent).toEqual([[3, 3]]);
  });

  it("a blank FIRST chosen page stays in the clip (it was chosen and lies before the cut)", () => {
    // Chosen [[2,4]]: page 2 blank, so the chunks are pages 3 and 4.
    const w = windowOf([10, 10], 9, 15, [3, 4], [[2, 4]]);
    expect(w.pagesSent).toEqual([[2, 4]]);
    const early = windowOf([10, 10], 9, 5, [3, 4], [[2, 4]]);
    // Clipped at page 3 — the chunk's own number, never its position (1).
    expect(early.pagesSent).toEqual([[2, 3]]);
  });

  it("a table that does not describe the string names no pages", () => {
    const w = describeWindow(
      "x".repeat(100),
      pageStartsFor(chunks([10, 10], [3, 5]), SEP),
      40,
      50,
      SELECTION,
    );
    expect(w.truncated).toBe(true);
    expect(w).not.toHaveProperty("pagesSent");
    expect(userSelectionNotice(w)).toBe("");
  });

  it("a relevance window is chat's, never read as chosen pages", () => {
    const w = describeSelection(9_000, 900, 70, [60], null);
    expect(userSelectionNotice(w)).toBe("");
  });
});

describe("userSelectionNotice wording", () => {
  const w = (pagesSent: [number, number][], totalPages = 40) =>
    ({
      truncated: false,
      charactersSent: 1,
      charactersTotal: 1,
      totalPages,
      lastCompletePage: totalPages,
      cutMidPage: false,
      pagesSent,
    }) satisfies TruncationWindow;
  it.each<[[number, number][], string]>([
    [[[4, 4]], "This summary covers page 4 of 40, the page you chose."],
    [[[3, 5]], `This summary covers pages 3${EN}5 of 40, the pages you chose.`],
    [
      [
        [3, 5],
        [9, 9],
      ],
      `This summary covers pages 3${EN}5 and 9 of 40, the pages you chose.`,
    ],
    [
      [
        [1, 1],
        [3, 3],
        [5, 6],
      ],
      `This summary covers pages 1, 3 and 5${EN}6 of 40, the pages you chose.`,
    ],
    [[[1, 40]], `This summary covers pages 1${EN}40 of 40, the pages you chose.`],
  ])("%j", (spans, sentence) => {
    expect(userSelectionNotice(w(spans))).toBe(sentence);
  });
  it("an empty list names nothing", () => {
    expect(userSelectionNotice(w([]))).toBe("");
  });
});
