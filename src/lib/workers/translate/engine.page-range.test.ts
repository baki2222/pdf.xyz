/**
 * Translate a page range (competitor audit #29, slice 6): the engine sends
 * the text of exactly the chosen PHYSICAL pages, marks only the boundaries
 * between them with their real numbers, labels them without naming an
 * unchosen page, and refuses a page past the end before any provider call.
 *
 * A fake extractor (page 1 blank, every other page holding tokens only that
 * page holds, some pages with a `send` flow text so the reading-order gate
 * runs on the selection) and a recording provider. Non-ASCII and control
 * characters are built from code points (house rule).
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { selectExtraction } from "@/lib/pdf/page-selection";
import { joinPageTexts } from "@/lib/pdf/text";
import type { PageSpan } from "@/lib/pdf/page-spans";
import type { TranslateOptions } from "@/lib/jobs/translate-pdf";
import {
  TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS,
  TRANSLATE_NO_TEXT_MESSAGE,
  translateEveryPageTooLongMessage,
  translateMaxInputChars,
} from "@/lib/jobs/translate-limits";
import { NO_TEXT_IN_CHOSEN_PAGES_MESSAGE } from "@/lib/jobs/summarize-pages";
import type {
  AiCompletionRequest,
  AiCompletionResult,
  AiProvider,
} from "../ai/provider";
import { pageMarkerClause, runTranslate, type TranslateDeps } from "./engine";
import { markerFor } from "./page-markers";
import { echoAnswer, stripSeparatorsAnswer } from "./page-map-capability";
import type { ReadingOrderPage, TranslateExtracted } from "./reading-order";
import { pageRangeLabel, type TypesetInput } from "./typeset";

const NL = String.fromCharCode(10);
const EN = String.fromCharCode(0x2013);
const OPEN = `${NL}---${NL}`;
const CLOSE = `${NL}---`;
const INPUT = new Uint8Array([1, 2, 3]);
const NOW = () => "2026-11-16T00:00:00.000Z";
const BASE: TranslateOptions = { targetLanguage: "fr", sourceLanguage: "auto" };
const withPages = (pages: PageSpan[]): TranslateOptions => ({
  ...BASE,
  pages: pages.map(([a, b]) => [a, b] as const),
});

/** Tokens only page n holds (ASCII, no brand, no heading lookalike). */
const token = (n: number) => `Tok${n}x${"QRSTUVWXYZ"[n]}`;
const pageText = (n: number, size = 0) => {
  const line = `${token(n)} sits alone on this sheet number ${n}.`;
  return size > line.length
    ? (line + " " + "w".repeat(size)).slice(0, size)
    : line;
};

/**
 * A `pageCount`-page document: page 1 blank unless `texts[1]` is given; `send`
 * equal to the text on even pages (a flow reading that passes the gate).
 */
function documentOf(
  texts: Record<number, string>,
  pageCount = 6,
): TranslateExtracted {
  const pages: ReadingOrderPage[] = [];
  for (let n = 1; n <= pageCount; n += 1) {
    const text = texts[n] ?? "";
    pages.push({
      pageNumber: n,
      text,
      characterCount: text.length,
      ...(n % 2 === 0 && text ? { send: text } : {}),
    });
  }
  const text = joinPageTexts(pages);
  return {
    pageCount,
    pages,
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
    readingOrder: { source: "flow" },
  };
}

const SIX = documentOf({
  2: pageText(2),
  3: pageText(3),
  4: pageText(4),
  5: pageText(5),
  6: pageText(6),
});

/** The text between the prompt's delimiters. */
const segmentOf = (request: AiCompletionRequest) => {
  const content = request.messages[0]!.content;
  const start = content.indexOf(OPEN) + OPEN.length;
  return content.slice(start, content.lastIndexOf(CLOSE));
};

function recorder(
  answer: (segment: string) => string,
  failOn?: number,
): AiProvider & { calls: AiCompletionRequest[] } {
  const calls: AiCompletionRequest[] = [];
  return {
    id: "anthropic",
    model: "claude-sonnet-5",
    calls,
    async complete(request): Promise<AiCompletionResult> {
      calls.push(request);
      if (failOn === calls.length)
        return {
          ok: false,
          kind: "provider_error",
          message: "upstream failed",
          retryable: false,
        };
      return {
        ok: true,
        text: answer(segmentOf(request)),
        model: "claude-sonnet-5",
        usage: { inputTokens: 10, outputTokens: 10 },
      };
    },
  };
}

function pdfRecorder() {
  const inputs: TypesetInput[] = [];
  return {
    inputs,
    dep: {
      languages: () => new Set(["fr" as const]),
      render: async ({ input }: { input: TypesetInput }) => {
        inputs.push(input);
        return { ok: false as const, reason: "render_failed" as const };
      },
    },
  };
}

async function run(
  options: TranslateOptions,
  {
    doc = SIX,
    answer = echoAnswer,
    limits,
    failOn,
  }: {
    doc?: TranslateExtracted;
    answer?: (segment: string) => string;
    limits?: TranslateDeps["limits"];
    failOn?: number;
  } = {},
) {
  const provider = recorder(answer, failOn);
  const pdf = pdfRecorder();
  const result = await runTranslate(INPUT, options, {
    extract: async () => doc,
    provider,
    pdf: pdf.dep,
    now: NOW,
    ...(limits ? { limits } : {}),
  });
  return { result, provider, pdf };
}

const headings = (input: TypesetInput) =>
  input.parts
    .filter((p) => p.kind === "body")
    .map((p) => pageRangeLabel(p.pages, p.chosen));

async function zipFiles(output: Uint8Array) {
  const zip = await JSZip.loadAsync(output);
  const read = (name: string) => zip.file(name)!.async("string");
  return {
    manifest: JSON.parse(await read("manifest.json")) as {
      source: Record<string, unknown>;
    },
    md: await read("translation.md"),
    txt: await read("translation.txt"),
    readme: await read("README.txt"),
  };
}

describe("chosen pages [2, 4] of six: only those pages reach the model", () => {
  const chosen: PageSpan[] = [
    [2, 2],
    [4, 4],
  ];

  it("one request, P2 and P4 only, one marker for page 4, no notice", async () => {
    const { result, provider } = await run(withPages(chosen));
    const whole = await run(BASE);
    expect(result.ok ? "delivered" : result.kind).toBe("delivered");
    if (!result.ok) return;
    expect(provider.calls).toHaveLength(1);
    const segment = segmentOf(provider.calls[0]!);
    expect(segment).toContain(token(2));
    expect(segment).toContain(token(4));
    for (const n of [3, 5, 6]) expect(segment).not.toContain(token(n));
    // Exactly one marker, page 4's, built from page-markers.
    expect(segment.match(/PDFXYZ/g)).toHaveLength(1);
    expect(segment).toContain(markerFor(4));
    const user = provider.calls[0]!.messages[0]!.content;
    expect(user).toContain(pageMarkerClause(4));
    // D10: the selection is not told to the model; the system prompt is the
    // whole-document job's, byte for byte.
    const system = provider.calls[0]!.system!;
    expect(system).not.toContain("IMPORTANT");
    expect(system).toBe(whole.provider.calls[0]!.system);

    const meta = result.meta;
    expect(meta.window.pagesSent).toEqual(chosen);
    expect(meta.window.totalPages).toBe(6);
    expect(meta.pageCount).toBe(6);
    expect(meta.sourceCharacters).toBe(
      selectExtraction(SIX, chosen).text.trim().length,
    );
    expect(meta.readingOrder.flowPages + meta.readingOrder.layoutPages).toBe(2);
    expect(meta.selectedPages).toBe(2);
    expect(whole.result.ok && whole.result.meta.selectedPages).toBeNull();
  });

  it("the ZIP's manifest (read from its BYTES), translation.md and README name the choice", async () => {
    const { result } = await run(withPages(chosen));
    const whole = await run(BASE);
    if (!result.ok || !whole.result.ok) throw new Error("expected delivery");
    const sentence =
      "You chose pages 2 and 4 of 6. No other page was sent to the AI model.";
    const sel = await zipFiles(result.output);
    expect(sel.manifest.source.pagesSent).toEqual(chosen);
    expect(sel.manifest.source.selectionNotice).toBe(sentence);
    expect(sel.md).toContain(`>${NL}> **${sentence}**`);
    expect(sel.readme).toContain(sentence);
    expect(sel.txt).not.toContain("You chose");

    const doc = await zipFiles(whole.result.output);
    expect(Object.keys(doc.manifest.source)).not.toContain("pagesSent");
    expect(Object.keys(doc.manifest.source)).not.toContain("selectionNotice");
    expect(doc.md).not.toContain("You chose");
    expect(doc.readme).not.toContain("You chose");
  });

  it("markers kept: the PDF is headed Page 2, Page 4", async () => {
    const { pdf } = await run(withPages(chosen));
    expect(pdf.inputs).toHaveLength(1);
    expect(headings(pdf.inputs[0]!)).toEqual(["Page 2", "Page 4"]);
  });

  it("markers stripped: one body headed Pages 2, 4 and no 2-to-4 range anywhere", async () => {
    const { result, pdf } = await run(withPages(chosen), {
      answer: stripSeparatorsAnswer,
    });
    if (!result.ok) throw new Error(result.message);
    expect(headings(pdf.inputs[0]!)).toEqual(["Pages 2, 4"]);
    const files = await zipFiles(result.output);
    const range = `2${EN}4`;
    expect(JSON.stringify(pdf.inputs[0]!.parts)).not.toContain(range);
    expect(files.md).not.toContain(range);
  });
});

describe("numbering from page 5", () => {
  const chosen: PageSpan[] = [[5, 6]];

  it("one marker, page 6's; verified pieces headed Page 5, Page 6", async () => {
    const { result, provider, pdf } = await run(withPages(chosen));
    expect(result.ok ? "delivered" : result.kind).toBe("delivered");
    const segment = segmentOf(provider.calls[0]!);
    expect(segment.match(/PDFXYZ/g)).toHaveLength(1);
    expect(segment).toContain(markerFor(6));
    expect(provider.calls[0]!.messages[0]!.content).toContain(
      pageMarkerClause(6),
    );
    expect(headings(pdf.inputs[0]!)).toEqual(["Page 5", "Page 6"]);
  });

  it("a stripped reply is headed as the range 5 to 6 (both chosen, consecutive)", async () => {
    const { pdf } = await run(withPages(chosen), {
      answer: stripSeparatorsAnswer,
    });
    expect(headings(pdf.inputs[0]!)).toEqual([`Pages 5${EN}6`]);
  });
});

describe("refusals before any provider call", () => {
  it("a page past the end: pages_out_of_range, no spend carried", async () => {
    const { result, provider } = await run(withPages([[7, 7]]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("pages_out_of_range");
    expect(result.retryable).toBe(false);
    expect(result.message).toContain("6 pages");
    expect(result.message).toContain("page 7");
    expect(result.message).toContain("Nothing was sent to the AI model.");
    expect(result.message).not.toMatch(/charged/i);
    expect(provider.calls).toHaveLength(0);
    expect("usage" in result).toBe(false);
    expect("window" in result).toBe(false);
  });

  it("a chosen blank page: the chosen-pages sentence; a document with none: the scan sentence", async () => {
    const blank = await run(withPages([[1, 1]]));
    expect(blank.result.ok).toBe(false);
    if (!blank.result.ok) {
      expect(blank.result.kind).toBe("no_text");
      expect(blank.result.message).toBe(
        NO_TEXT_IN_CHOSEN_PAGES_MESSAGE["translate-pdf"],
      );
    }
    expect(blank.provider.calls).toHaveLength(0);

    const scan = await run(withPages([[1, 2]]), { doc: documentOf({}, 3) });
    expect(scan.result.ok).toBe(false);
    if (!scan.result.ok) {
      expect(scan.result.kind).toBe("no_text");
      expect(scan.result.message).toBe(TRANSLATE_NO_TEXT_MESSAGE);
    }
    expect(scan.provider.calls).toHaveLength(0);
  });
});

describe("ORDER: the selection is applied before the delivery cap", () => {
  const ceiling = translateMaxInputChars(TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS);
  const CAP = Math.ceil(1_000 * 4);
  const BIG = 9_000;
  const doc = documentOf({
    2: pageText(2, BIG),
    3: pageText(3, BIG),
    4: pageText(4),
    5: pageText(5, 500),
    6: pageText(6, 500),
  });

  it("health: the unchosen pages are above the cap and below one pass", () => {
    // Above the cap, so a walk over them stops at once; below the per-pass
    // ceiling, so the walk does not SKIP them as oversize.
    expect(BIG).toBeGreaterThan(CAP);
    expect(BIG).toBeLessThan(ceiling);
    expect(doc.pages[1]!.text.length).toBe(BIG);
  });

  it("chosen [5, 6] under a cap sized for them is delivered whole", async () => {
    const { result, provider } = await run(withPages([[5, 6]]), {
      doc,
      limits: { delivery: { characters: CAP, pages: 2 } },
    });
    // Selected after the cap, this is `over_reservation`.
    expect(result.ok ? "delivered" : result.kind).toBe("delivered");
    if (!result.ok) return;
    expect(result.meta.delivery).toBeUndefined();
    expect(provider.calls).toHaveLength(1);
  });
});

describe("gaps under a selection name only chosen pages", () => {
  it("a withheld tail is the range 5 to 6, never 4 to 6 or 3 to 6", async () => {
    const { result, pdf } = await run(
      withPages([
        [2, 2],
        [4, 6],
      ]),
      { limits: { delivery: { characters: 1_000_000, pages: 2 } } },
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.meta.delivery?.withheldPages).toBe(2);
    const files = await zipFiles(result.output);
    expect(files.md).toContain(`**Pages 5${EN}6 are not translated.**`);
    expect(files.md).toContain(
      "The pages you chose were submitted as 2 pages of text and hold more than that.",
    );
    const gaps = pdf.inputs[0]!.parts.filter((p) => p.kind === "gap");
    expect(gaps.map((g) => g.pages)).toEqual([[5, 6]]);
  });

  it("a withheld non-consecutive tail: Pages 4, 6 in the ZIP and the PDF parts", async () => {
    const chosen: PageSpan[] = [
      [2, 2],
      [4, 4],
      [6, 6],
    ];
    const { result, pdf } = await run(withPages(chosen), {
      limits: { delivery: { characters: 1_000_000, pages: 1 } },
    });
    if (!result.ok) throw new Error(result.message);
    const files = await zipFiles(result.output);
    // The ZIP's own assembly call (zipParts), separate from the PDF's.
    expect(files.md).toContain("**Pages 4, 6 are not translated.**");
    expect(files.md).toContain(
      "The pages you chose were submitted as 1 pages of text and hold more than that.",
    );
    expect(files.md).not.toContain(`4${EN}6`);
    // The PDF's assembly call.
    const gap = pdf.inputs[0]!.parts.find((p) => p.kind === "gap");
    expect(gap?.chosen).toEqual(chosen);
  });

  it("interrupted at call 2 of [2], [4], [6]: Pages 4, 6 could not be translated", async () => {
    const maxOutputTokens = 300;
    const ceiling = translateMaxInputChars(maxOutputTokens);
    const size = Math.floor(ceiling * 0.6);
    // Health: one page fits a pass, two do not, so each call is one page.
    expect(size).toBeLessThan(ceiling);
    expect(2 * size + 2).toBeGreaterThan(ceiling);
    const doc = documentOf({
      2: pageText(2, size),
      3: pageText(3, size),
      4: pageText(4, size),
      5: pageText(5, size),
      6: pageText(6, size),
    });
    const { result, provider } = await run(
      withPages([
        [2, 2],
        [4, 4],
        [6, 6],
      ]),
      { doc, limits: { maxOutputTokens }, failOn: 2 },
    );
    if (!result.ok) throw new Error(result.message);
    expect(provider.calls).toHaveLength(2);
    const files = await zipFiles(result.output);
    expect(files.md).toContain("**Pages 4, 6 could not be translated.**");
    expect(files.md).not.toContain(`4${EN}6`);
  });
});

describe("every chosen page oversize: the sentence names the chosen pages", () => {
  const maxOutputTokens = 300;
  const ceiling = translateMaxInputChars(maxOutputTokens);
  const over = ceiling + 50;

  it("chosen [2], [4] both oversize: Every page you chose ...", async () => {
    const doc = documentOf({
      2: pageText(2, over),
      3: pageText(3),
      4: pageText(4, over + 1),
    });
    const { result, provider } = await run(
      withPages([
        [2, 2],
        [4, 4],
      ]),
      { doc, limits: { maxOutputTokens } },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("too_much_text");
    expect(result.message).toBe(
      translateEveryPageTooLongMessage(
        [
          { pageNumber: 2, characters: over },
          { pageNumber: 4, characters: over + 1 },
        ],
        ceiling,
        "chosen",
      ),
    );
    expect(result.message).toMatch(/^Every page you chose that has text/);
    expect(provider.calls).toHaveLength(0);
  });

  it("a whole document all oversize keeps today's sentence, byte for byte", async () => {
    const doc = documentOf({ 2: pageText(2, over), 4: pageText(4, over + 1) });
    const { result } = await run(BASE, { doc, limits: { maxOutputTokens } });
    if (result.ok) throw new Error("expected a refusal");
    expect(result.message).toMatch(
      /^Every page with text in this document holds more/,
    );
    expect(result.message).toBe(
      translateEveryPageTooLongMessage(
        [
          { pageNumber: 2, characters: over },
          { pageNumber: 4, characters: over + 1 },
        ],
        ceiling,
        "document",
      ),
    );
  });
});
