// @vitest-environment node
/**
 * Reading order through `runTranslate`: what the model is SENT changes, and
 * nothing else does.
 *
 * The composite is driven from verbatim poppler pairs (`@/tests/poppler-samples`,
 * discovered by `@/tests/reading-order-pairs`). Each run is compared with the
 * SAME document read as `-layout` only (the composite's pages with `send`
 * stripped — exactly what main sends):
 *
 *  - the recorded prompt carries the flow text, not the interleaved `-layout`;
 *  - the provider is called the same number of times, each call covers the
 *    same pages (decoded from the wire, not from the plan), and the delivery
 *    cap withholds the same pages for the same reason;
 *  - with a provider that returns a constant, the ZIP is BYTE-IDENTICAL, so
 *    nothing else the package says has moved;
 *  - the window's page starts are the starts of the blocks the planner reads:
 *    one unit, two readers.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PAGE_JOIN,
  pageTextChunks,
  type ExtractedPdfText,
} from "@/lib/pdf/text";
import type { AiCompletionRequest, AiProvider } from "../ai/provider";
import { pageStartsFor } from "../ai/truncation";
import type { PdfFlowText } from "../pdf-text/flow";
import {
  concatReadingOrderPairs,
  discoverReadingOrderPairs,
} from "@/tests/reading-order-pairs";
import { TRANSLATE_CHARS_PER_OUTPUT_TOKEN } from "@/lib/jobs/translate-limits";
import { runTranslate, type TranslateDeps } from "./engine";
import {
  composeReadingOrderExtractor,
  translatePageBlocks,
  type TranslateExtracted,
  type TranslateExtractor,
} from "./reading-order";
import { separatorFor } from "./page-markers";

const OPTIONS = { targetLanguage: "fr", sourceLanguage: "auto" } as const;
const INPUT = new Uint8Array([1, 2, 3]);
const NOW = () => "2026-11-16T00:00:00.000Z";
/** The prompt's delimiter line, built from code points (tool-layer safe). */
const NL = String.fromCharCode(10);
const OPEN = `${NL}---${NL}`;
const CLOSE = `${NL}---`;

const PAIRS = discoverReadingOrderPairs();
const TWO_COLUMN = PAIRS.find((p) => p.name === "TWO_COLUMN");

function composite(layout: ExtractedPdfText, flow: PdfFlowText) {
  return composeReadingOrderExtractor(
    async () => layout,
    async () => flow,
  );
}

/** The same extraction with every `send` stripped: main's -layout-only job. */
function layoutOnly(extract: TranslateExtractor): TranslateExtractor {
  return async (bytes, run) => {
    const e = await extract(bytes, run);
    return {
      ...e,
      pages: e.pages.map(({ send: _send, ...page }) => page),
      readingOrder: { source: "not_run" },
    };
  };
}

function constantProvider(): AiProvider & { calls: AiCompletionRequest[] } {
  const calls: AiCompletionRequest[] = [];
  return {
    id: "anthropic",
    model: "claude-sonnet-5",
    calls,
    async complete(request) {
      calls.push(request);
      return {
        ok: true,
        text: "TRADUCTION",
        model: "claude-sonnet-5",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
  };
}

/** The text between the prompt's `---` delimiters: what was literally sent. */
function segmentOf(request: AiCompletionRequest): string {
  const content = request.messages[0]!.content;
  const open = content.indexOf(OPEN);
  const close = content.lastIndexOf(CLOSE);
  if (open < 0 || close <= open) throw new Error("no delimited segment");
  return content.slice(open + OPEN.length, close);
}

/**
 * Decode each call's pages FROM THE WIRE: a segment is the sent text of a
 * run of consecutive pages joined by its separators, so walk the pages in
 * order and consume each segment greedily. Fails loudly if a segment does not
 * decode, so a mismatch cannot pass as an empty page set.
 *
 * INVERTED, NOT DELETED. True before translatePageMap (2026-11): every page
 * after a segment's first was preceded by PAGE_JOIN alone,
 *   const head = covered.length === 0 ? page.sent : PAGE_JOIN + page.sent;
 * A marked chunk now carries `separatorFor(page)` there instead. Both are
 * accepted, and which one was seen is returned, so a caller can compare the
 * marking too.
 */
function pagesOnWire(
  segments: readonly string[],
  pages: readonly { pageNumber: number; sent: string }[],
): number[][] {
  let at = 0;
  return segments.map((segment) => {
    const covered: number[] = [];
    let rest = segment;
    while (at < pages.length) {
      const page = pages[at]!;
      const heads =
        covered.length === 0
          ? [page.sent]
          : [separatorFor(page.pageNumber) + page.sent, PAGE_JOIN + page.sent];
      const head = heads.find((h) => rest.startsWith(h));
      if (head === undefined) break;
      covered.push(page.pageNumber);
      rest = rest.slice(head.length);
      at += 1;
    }
    if (rest.length !== 0 || covered.length === 0)
      throw new Error(`a segment did not decode at page index ${at}`);
    return covered;
  });
}

async function runBoth(
  layout: ExtractedPdfText,
  flow: PdfFlowText,
  limits: TranslateDeps["limits"] = {},
) {
  const extract = composite(layout, flow);
  const flowProvider = constantProvider();
  const layoutProvider = constantProvider();
  const viaFlow = await runTranslate(INPUT, OPTIONS, {
    extract,
    provider: flowProvider,
    now: NOW,
    limits,
  });
  const viaLayout = await runTranslate(INPUT, OPTIONS, {
    extract: layoutOnly(extract),
    provider: layoutProvider,
    now: NOW,
    limits,
  });
  const extracted: TranslateExtracted = await extract(INPUT);
  const { blocks } = translatePageBlocks(extracted.pages);
  return { viaFlow, viaLayout, flowProvider, layoutProvider, blocks };
}

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("runTranslate over the reading-order composite", () => {
  it("health: the TWO_COLUMN pair and at least 12 pairs are discovered", () => {
    expect(TWO_COLUMN, "the TWO_COLUMN pair went missing").toBeDefined();
    expect(PAIRS.length).toBeGreaterThanOrEqual(12);
  });

  it("the recorded prompt carries the flow text, not the interleaved -layout text", async () => {
    const { viaFlow, flowProvider, layoutProvider, blocks } = await runBoth(
      TWO_COLUMN!.layout,
      TWO_COLUMN!.flow,
    );
    expect(viaFlow.ok).toBe(true);
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.send, "health: the gate passed the page").toBeDefined();
    expect(block.send).not.toBe(block.text);
    expect(segmentOf(flowProvider.calls[0]!)).toBe(block.send);
    expect(segmentOf(layoutProvider.calls[0]!)).toBe(block.text);
    if (viaFlow.ok) {
      expect(viaFlow.meta.readingOrder).toEqual({
        source: "flow",
        flowPages: 1,
        layoutPages: 0,
        fellBack: { ink: 0, longer: 0, rtl: 0 },
        sentCharacters: block.send!.length,
      });
    }
  });

  it("every pair as one document, chunked: same calls, same pages per call, byte-identical ZIP", async () => {
    const doc = concatReadingOrderPairs(PAIRS);
    // A small per-call ceiling (~1,000 characters) so the document needs
    // several calls.
    const maxOutputTokens = Math.ceil(1_000 / TRANSLATE_CHARS_PER_OUTPUT_TOKEN);
    const { viaFlow, viaLayout, flowProvider, layoutProvider, blocks } =
      await runBoth(doc.layout, doc.flow, { maxOutputTokens });
    expect(viaFlow.ok && viaLayout.ok).toBe(true);
    if (!viaFlow.ok || !viaLayout.ok) return;
    expect(flowProvider.calls.length, "health: several calls").toBeGreaterThan(
      2,
    );
    expect(flowProvider.calls.length).toBe(layoutProvider.calls.length);
    expect(viaFlow.meta.usage?.calls).toBe(viaLayout.meta.usage?.calls);

    const flowSegments = flowProvider.calls.map(segmentOf);
    const layoutSegments = layoutProvider.calls.map(segmentOf);
    const onWireFlow = pagesOnWire(
      flowSegments,
      blocks.map((b) => ({ pageNumber: b.pageNumber, sent: b.send ?? b.text })),
    );
    const onWireLayout = pagesOnWire(
      layoutSegments,
      blocks.map((b) => ({ pageNumber: b.pageNumber, sent: b.text })),
    );
    expect(onWireFlow).toEqual(onWireLayout);
    expect(flowSegments).not.toEqual(layoutSegments);

    expect(sha(viaFlow.output)).toBe(sha(viaLayout.output));
    expect(viaFlow.meta.readingOrder.flowPages).toBe(PAIRS.length);
    expect(viaFlow.meta.readingOrder.sentCharacters).toBe(
      flowSegments.reduce((n, s) => n + s.length, 0),
    );
    expect(viaFlow.meta.readingOrder.sentCharacters).toBeLessThanOrEqual(
      viaLayout.meta.readingOrder.sentCharacters,
    );
  });

  it("under a delivery cap that binds: the same pages are withheld, for the same reason", async () => {
    const doc = concatReadingOrderPairs(PAIRS);
    const cap = 1_500;
    const { viaFlow, viaLayout, flowProvider, layoutProvider } = await runBoth(
      doc.layout,
      doc.flow,
      { delivery: { characters: cap } },
    );
    expect(viaFlow.ok && viaLayout.ok).toBe(true);
    if (!viaFlow.ok || !viaLayout.ok) return;
    expect(
      viaFlow.meta.delivery,
      "health: the cap withheld pages",
    ).toBeDefined();
    expect(viaFlow.meta.delivery).toEqual(viaLayout.meta.delivery);
    expect(sha(viaFlow.output)).toBe(sha(viaLayout.output));
    expect(flowProvider.calls.length).toBe(layoutProvider.calls.length);
    // Sent ≤ cap, less only the page joins the cap walk does not count.
    const joins =
      (viaFlow.meta.delivery!.deliveredPages - 1) * PAGE_JOIN.length;
    expect(
      viaFlow.meta.readingOrder.sentCharacters - joins,
    ).toBeLessThanOrEqual(cap);
  });

  it("the window's page starts are the starts of the planner's blocks (one unit, two readers)", async () => {
    const docs = [
      ...PAIRS.map((p) => ({ layout: p.layout, flow: p.flow })),
      concatReadingOrderPairs(PAIRS),
    ];
    for (const doc of docs) {
      const extracted = await composite(doc.layout, doc.flow)(INPUT);
      const fromWindow = pageStartsFor(
        pageTextChunks(extracted.pages),
        PAGE_JOIN,
      );
      const fromBlocks = pageStartsFor(
        translatePageBlocks(extracted.pages).blocks,
        PAGE_JOIN,
      );
      expect(fromBlocks).toEqual(fromWindow);
      expect(fromWindow.length).toBeGreaterThan(0);
    }
  });
});
