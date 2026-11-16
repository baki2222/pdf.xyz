// @vitest-environment node
/**
 * The send gate, page by page (`./reading-order`, `translatePageBlocks`), and
 * the composite's pairing rules (`composeReadingOrderExtractor`).
 *
 * Every string with a non-ASCII or control character is built from code
 * points, never typed as an escape: the tool layer that writes these files has
 * turned escapes into raw characters before.
 */
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { PdfFlowText } from "../pdf-text/flow";
import {
  composeReadingOrderExtractor,
  hasTranslatableText,
  isStrongRtl,
  sameInk,
  translatePageBlocks,
  type ReadingOrderPage,
  type TranslateExtractor,
} from "./reading-order";
import {
  hasTranslatableText as engineHasTranslatableText,
  type PdfTextExtractor,
} from "./engine";

const cp = (...points: number[]) => String.fromCodePoint(...points);
const SOFT_HYPHEN = cp(0xad);
const TAB = cp(0x09);

/** Pages of `-layout` text, numbered from 1. */
function layoutDoc(texts: string[]): ExtractedPdfText {
  const pages = texts.map((text, i) => ({
    pageNumber: i + 1,
    text,
    characterCount: text.length,
  }));
  const text = texts.join("\n\n");
  return {
    pageCount: pages.length,
    pages,
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
}

/** A flow document whose page N reads as `paragraphs[N-1]`, one paragraph per line. */
function flowDoc(
  pages: (string[] | null)[],
  pageCount = pages.length,
): PdfFlowText {
  return {
    pageCount,
    pages: pages.flatMap((paragraphs, i) =>
      paragraphs === null
        ? []
        : [{ pageNumber: i + 1, paragraphs: paragraphs.map((p) => [p]) }],
    ),
  };
}

const page = (
  pageNumber: number,
  text: string,
  send?: string,
): ReadingOrderPage => ({
  pageNumber,
  text,
  characterCount: text.length,
  ...(send === undefined ? {} : { send }),
});

const LEFT = "The quarterly results show that revenue grew by twelve percent.";
const RIGHT = "Risks include currency exposure in the European segment.";
/** Two columns read straight across, as `-layout` (collapsed) gives them. */
const INTERLEAVED =
  "The quarterly results show that Risks include currency exposure\nrevenue grew by twelve percent. in the European segment.";
const FLOWED = `${LEFT}\n${RIGHT}`;

describe("sameInk", () => {
  it("is equal for the same words in another order and spacing", () => {
    expect(sameInk(INTERLEAVED, FLOWED)).toBe(true);
  });

  it("is NOT equal when one word is missing (positive control)", () => {
    expect(sameInk(INTERLEAVED, FLOWED.replace(" twelve", ""))).toBe(false);
  });

  it("counts, rather than merely collects, the code points", () => {
    expect(sameInk("aab", "abb")).toBe(false);
    expect(sameInk("ab ab", "aabb")).toBe(true);
  });

  it("treats a line-end hyphen kept across the join as equal", () => {
    // Flow mends "exam-\nple" by keeping the hyphen: "exam-ple".
    expect(sameInk("a good exam-\nple here", "a good exam-ple here")).toBe(
      true,
    );
  });

  it("treats a soft hyphen as absent on both sides", () => {
    expect(sameInk(`hyphen${SOFT_HYPHEN}\nation`, "hyphenation")).toBe(true);
    expect(sameInk("hyphenation", `hyphen${SOFT_HYPHEN}ation`)).toBe(true);
  });

  it("treats a tab-joined table row as equal to the padded row", () => {
    expect(
      sameInk(
        "North 1200 1350 1410",
        ["North", "1200", "1350", "1410"].join(TAB),
      ),
    ).toBe(true);
  });
});

describe("isStrongRtl", () => {
  it.each([
    ["Arabic", 0x0627],
    ["Hebrew", 0x05d0],
    ["pointed Hebrew presentation form", 0xfb2a],
    ["Syriac", 0x0710],
    ["Thaana", 0x0780],
    ["NKo", 0x07c0],
    ["Samaritan", 0x0800],
    ["Mandaic", 0x0840],
    ["Arabic Extended-B", 0x0870],
    ["Adlam (astral)", 0x1e900],
  ])("sees %s", (_name, point) => {
    expect(isStrongRtl(`abc ${cp(point)} def`)).toBe(true);
  });

  it.each([
    ["Latin", "plain English"],
    ["CJK", cp(0x4e2d, 0x6587)],
    ["Bengali", cp(0x09ac, 0x09be, 0x0982, 0x09b2, 0x09be)],
    ["a bare RLM", cp(0x200f)],
  ])("does not see %s (positive control)", (_name, text) => {
    expect(isStrongRtl(text)).toBe(false);
  });
});

describe("translatePageBlocks — the send gate", () => {
  it("an identical page sends flow", () => {
    const { blocks, tally } = translatePageBlocks([page(1, FLOWED, FLOWED)]);
    expect(blocks).toEqual([{ pageNumber: 1, text: FLOWED, send: FLOWED }]);
    expect(tally).toEqual({
      flowPages: 1,
      layoutPages: 0,
      fellBack: { ink: 0, longer: 0, rtl: 0 },
    });
  });

  it("a two-column page sends its flow reading", () => {
    const { blocks } = translatePageBlocks([page(1, INTERLEAVED, FLOWED)]);
    expect(blocks[0]!.send).toBe(FLOWED);
    expect(blocks[0]!.text).toBe(INTERLEAVED);
  });

  it("a flow page missing one word sends -layout (fellBack.ink)", () => {
    const { blocks, tally } = translatePageBlocks([
      page(1, INTERLEAVED, FLOWED.replace(" twelve", "")),
    ]);
    expect(blocks).toEqual([{ pageNumber: 1, text: INTERLEAVED }]);
    expect(tally.fellBack).toEqual({ ink: 1, longer: 0, rtl: 0 });
    expect(tally).toMatchObject({ flowPages: 0, layoutPages: 1 });
  });

  it("a hyphenated line pair, a soft hyphen and a tab-joined row each send flow", () => {
    const { blocks, tally } = translatePageBlocks([
      page(1, "a good exam-\nple here", "a good exam-ple here"),
      page(2, `hyphen${SOFT_HYPHEN}\nation`, "hyphenation"),
      page(3, "North 1200 1350", ["North", "1200", "1350"].join(TAB)),
    ]);
    expect(blocks.map((b) => b.send !== undefined)).toEqual([true, true, true]);
    expect(tally.flowPages).toBe(3);
  });

  it("a flow page LONGER than its -layout page falls back (fellBack.longer)", () => {
    // Equal ink, more whitespace: flow's paragraphs are longer than -layout's.
    const { blocks, tally } = translatePageBlocks([
      page(1, "one two", "one\n\n\ttwo"),
    ]);
    expect(sameInk("one two", "one\n\n\ttwo")).toBe(true);
    expect(blocks).toEqual([{ pageNumber: 1, text: "one two" }]);
    expect(tally.fellBack).toEqual({ ink: 0, longer: 1, rtl: 0 });
  });

  it.each([
    ["Arabic", cp(0x0645, 0x0631, 0x062d, 0x0628, 0x0627)],
    ["Hebrew", cp(0x05e9, 0x05dc, 0x05d5, 0x05dd)],
    ["pointed Hebrew (presentation forms)", cp(0xfb2a, 0xfb35, 0xfb4b)],
    ["Syriac", cp(0x0710, 0x0712, 0x0713)],
  ])("a %s-bearing page falls back (fellBack.rtl)", (_name, word) => {
    const text = `Intro ${word} end`;
    const { blocks, tally } = translatePageBlocks([page(1, text, text)]);
    expect(blocks).toEqual([{ pageNumber: 1, text }]);
    expect(tally.fellBack).toEqual({ ink: 0, longer: 0, rtl: 1 });
  });

  it("a page with no flow text keeps -layout and counts as a layout page", () => {
    const { blocks, tally } = translatePageBlocks([page(1, INTERLEAVED)]);
    expect(blocks).toEqual([{ pageNumber: 1, text: INTERLEAVED }]);
    expect(tally).toEqual({
      flowPages: 0,
      layoutPages: 1,
      fellBack: { ink: 0, longer: 0, rtl: 0 },
    });
  });

  it("judges the NORMALISED texts: trailing blanks do not make flow 'longer'", () => {
    const { blocks } = translatePageBlocks([
      page(1, "one two", "one two   \n\n\n\n"),
    ]);
    expect(blocks[0]!.send).toBe("one two");
  });

  it("never adds a page: a blank -layout page with flow text stays dropped", () => {
    const { blocks, tally } = translatePageBlocks([
      page(1, "   \n  ", "ghost"),
      page(2, FLOWED, FLOWED),
    ]);
    expect(blocks.map((b) => b.pageNumber)).toEqual([2]);
    expect(tally.flowPages + tally.layoutPages).toBe(1);
  });
});

describe("composeReadingOrderExtractor — pairing", () => {
  const bytes = new Uint8Array([1]);

  it("attaches the RAW flow text to each page, ungated", async () => {
    const extract = composeReadingOrderExtractor(
      async () => layoutDoc([INTERLEAVED, "p2"]),
      async () => flowDoc([[LEFT, RIGHT], ["p2 changed"]]),
    );
    const out = await extract(bytes);
    expect(out.readingOrder).toEqual({ source: "flow" });
    expect(out.pages.map((p) => p.send)).toEqual([FLOWED, "p2 changed"]);
    // The -layout reading is untouched: it is what everything weighs.
    expect(out.text).toBe(layoutDoc([INTERLEAVED, "p2"]).text);
    expect(out.pages.map((p) => p.text)).toEqual([INTERLEAVED, "p2"]);
  });

  it("a page-count mismatch gives no send anywhere", async () => {
    const extract = composeReadingOrderExtractor(
      async () => layoutDoc([FLOWED, FLOWED]),
      async () => flowDoc([[LEFT, RIGHT], [LEFT, RIGHT], ["extra"]]),
    );
    const out = await extract(bytes);
    expect(out.readingOrder).toEqual({ source: "page_count" });
    expect(out.pages.every((p) => p.send === undefined)).toBe(true);
    expect(translatePageBlocks(out.pages).tally.flowPages).toBe(0);
  });

  it("a page whose flow is absent keeps -layout", async () => {
    const extract = composeReadingOrderExtractor(
      async () => layoutDoc([FLOWED, INTERLEAVED]),
      async () => flowDoc([[LEFT, RIGHT], null]),
    );
    const out = await extract(bytes);
    expect(out.pages.map((p) => p.send)).toEqual([FLOWED, undefined]);
    const { blocks, tally } = translatePageBlocks(out.pages);
    expect(blocks[1]).toEqual({ pageNumber: 2, text: INTERLEAVED });
    expect(tally).toMatchObject({ flowPages: 1, layoutPages: 1 });
  });

  it("does not make the second run for a document with no text", async () => {
    let flowRuns = 0;
    const extract = composeReadingOrderExtractor(
      async () => layoutDoc(["", "  "]),
      async () => {
        flowRuns += 1;
        return flowDoc([[], []]);
      },
    );
    const out = await extract(bytes);
    expect(flowRuns).toBe(0);
    expect(out.readingOrder).toEqual({ source: "not_run" });
  });

  it("a throwing second run sends -layout (bbox_failed)", async () => {
    const extract = composeReadingOrderExtractor(
      async () => layoutDoc([INTERLEAVED]),
      async () => {
        throw Object.assign(new Error("stdout maxBuffer length exceeded"), {
          code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        });
      },
    );
    const out = await extract(bytes);
    expect(out.readingOrder).toEqual({ source: "bbox_failed" });
    expect(out.pages[0]!.send).toBeUndefined();
  });

  it("an attempt abort in the second run still aborts", async () => {
    const extract = composeReadingOrderExtractor(
      async () => layoutDoc([INTERLEAVED]),
      async () => {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      },
    );
    await expect(extract(bytes)).rejects.toMatchObject({
      code: "attempt_aborted",
    });
  });

  it("a plain extractor is still a TranslateExtractor (every existing stub fits)", async () => {
    // Checked by tsc: this line stops compiling if the type narrows.
    const plain: PdfTextExtractor = async () => layoutDoc([FLOWED]);
    const asTranslate: TranslateExtractor = plain;
    const out = await asTranslate(bytes);
    expect(out.readingOrder).toBeUndefined();
    expect(translatePageBlocks(out.pages).tally.layoutPages).toBe(1);
  });

  it("the engine's predicate IS this module's (one definition)", () => {
    expect(engineHasTranslatableText).toBe(hasTranslatableText);
  });
});
