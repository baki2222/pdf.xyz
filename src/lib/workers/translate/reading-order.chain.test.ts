// @vitest-environment node
/**
 * Reading order through the planner: the composite's pages, the gate, then
 * `planTranslateChunks` / `capPagesToDelivery` — the composed chain, not the
 * units.
 *
 * Two properties, each written as a test so the next slice inherits a red
 * rather than a paragraph:
 *
 *  1. WEIGHT INVARIANCE. Sending flow text changes WHAT is sent, never what a
 *     page WEIGHS. So over every fixture the chunk page-sets, the oversize
 *     set, the withheld pages and the bound are exactly those of the
 *     `-layout`-only pages — the unit every published figure is calibrated in.
 *  2. SENT ≤ WEIGHED. No chunk sends more characters than it was weighed at,
 *     and a capped plan sends no more than its limit, less ONLY the page joins
 *     `capPagesToDelivery` is documented not to count.
 *
 * The fixtures are DISCOVERED: every `X_LAYOUT` / `X_BBOX` pair exported by
 * `@/tests/poppler-samples` (verbatim poppler output), plus a synthetic
 * packing fixture and generated page sets.
 */
import { describe, expect, it } from "vitest";
import {
  PAGE_JOIN,
  pageTextChunks,
  type ExtractedPdfText,
} from "@/lib/pdf/text";
import type { PdfFlowText } from "../pdf-text/flow";
import { discoverReadingOrderPairs } from "@/tests/reading-order-pairs";
import { TRANSLATE_MAX_INPUT_CHARS } from "@/lib/jobs/translate-limits";
import {
  capPagesToDelivery,
  planTranslateChunks,
  type DeliveryLimit,
  type PlannedPage,
  type TranslatePlan,
} from "./chunking";
import {
  composeReadingOrderExtractor,
  sameInk,
  translatePageBlocks,
  type ReadingOrderPage,
  type TranslateExtracted,
} from "./reading-order";
import { separatorFor, separatorOverhead } from "./page-markers";

/**
 * The two characters per page boundary `capPagesToDelivery` does not count
 * (its docblock, "EVERY SENT CHARACTER IS WEIGHED, WITH ONE RECORDED
 * EXCEPTION"). The ONLY term subtracted below. A later term added to the
 * sent text — page markers, say — must NOT be added here: it must be counted
 * in `planTranslateChunks`, in `capPagesToDelivery` and in the browser
 * preflight, or this file goes red.
 */
const UNCOUNTED_JOIN_PER_BOUNDARY = PAGE_JOIN.length;

const CEILING = TRANSLATE_MAX_INPUT_CHARS;

/**
 * The pairs present when this file was written (2026-11-16). Discovery is
 * the source of truth; this list exists so a pair that DISAPPEARS is named.
 */
const KNOWN_PAIRS = [
  "AUTO_SIZED_TABLE",
  "HEADINGS",
  "HIGHLIGHTS",
  "LETTER",
  "LISTS",
  "LONE_TOTAL_INVOICE",
  "NEWSLETTER",
  "REPORT_TABLES",
  "SIDEBAR",
  "SKU_TABLE",
  "SPANNING_TABLE",
  "STACKED_TABLES",
  "STATEMENT",
  "SURROUNDED_INVOICE",
  "TABLE",
  "TITLED_TABLE",
  "TWO_COLUMN",
] as const;

const PAIRS = discoverReadingOrderPairs();

async function compose(
  layout: ExtractedPdfText,
  flow: PdfFlowText,
): Promise<TranslateExtracted> {
  return composeReadingOrderExtractor(
    async () => layout,
    async () => flow,
  )(new Uint8Array([1]));
}

/** Renumber pages 1..n across several documents, as one document. */
function concatPages(
  docs: readonly (readonly ReadingOrderPage[])[],
): ReadingOrderPage[] {
  let n = 0;
  return docs.flatMap((pages) =>
    pages.map((page) => ({ ...page, pageNumber: (n += 1) })),
  );
}

const shape = (plan: TranslatePlan) => ({
  chunks: plan.chunks.map((c) => c.pages),
  oversize: plan.oversize,
  pages: plan.pages,
});

/** Ink-preserving filler of an exact length (letters and single spaces). */
function filler(length: number, word = "lorem"): string {
  let out = "";
  while (out.length < length) out += out.length === 0 ? word : ` ${word}`;
  return out.slice(0, length).replace(/ $/, "x");
}

/**
 * (ii) The packing fixture: page 1 weighs 6,000 and sends 5,000 of equal ink;
 * page 2 weighs and sends 4,300. On -layout, 6,000 + 2 + 4,300 exceeds the
 * ceiling (two chunks); weighed by `send` it would be one.
 */
function packingPages(): ReadingOrderPage[] {
  const words = Array.from({ length: 1_000 }, (_, i) =>
    i === 0 ? "aaaaa" : "abcd",
  );
  const send = words.join(" ");
  // The same words, two spaces apart, one gap of three: 6,000 exactly.
  const text = words.join("  ").replace("  ", "   ");
  const page2 = filler(4_300);
  return [
    { pageNumber: 1, text, characterCount: text.length, send },
    { pageNumber: 2, text: page2, characterCount: page2.length, send: page2 },
  ];
}

describe("the fixtures are what they claim (health checks)", () => {
  it("discovers at least 12 verbatim pairs, and names any that went missing", () => {
    expect(PAIRS.length).toBeGreaterThan(0); // FATAL at 0: the walk is broken
    const missing = KNOWN_PAIRS.filter(
      (name) => !PAIRS.some((p) => p.name === name),
    );
    expect(missing).toEqual([]);
    expect(PAIRS.length).toBeGreaterThanOrEqual(12);
  });

  it("every pair agrees on its page count and most of them actually send flow", async () => {
    let flowPages = 0;
    for (const pair of PAIRS) {
      const out = await compose(pair.layout, pair.flow);
      expect(out.readingOrder, pair.name).toEqual({ source: "flow" });
      flowPages += translatePageBlocks(out.pages).tally.flowPages;
    }
    // Without flow pages, the invariance below compares -layout with itself.
    expect(flowPages).toBeGreaterThanOrEqual(Math.ceil(PAIRS.length / 2));
  });

  it("the two-column pair really interleaves on -layout and not in flow", async () => {
    const pair = PAIRS.find((p) => p.name === "TWO_COLUMN")!;
    const out = await compose(pair.layout, pair.flow);
    const [block] = translatePageBlocks(out.pages).blocks;
    expect(block!.send).toBeDefined();
    expect(block!.text).toMatch(/revenue +Risks include/);
    expect(block!.send).toMatch(/quarter\.\nRisks include/);
  });

  it("the packing fixture has the lengths and the equal ink it claims", () => {
    const [p1, p2] = packingPages();
    expect([p1!.text.length, p1!.send!.length]).toEqual([6_000, 5_000]);
    expect([p2!.text.length, p2!.send!.length]).toEqual([4_300, 4_300]);
    expect(sameInk(p1!.text, p1!.send!)).toBe(true);
    expect(6_000 + PAGE_JOIN.length + 4_300).toBeGreaterThan(CEILING);
    expect(5_000 + PAGE_JOIN.length + 4_300).toBeLessThanOrEqual(CEILING);
    const { tally } = translatePageBlocks(packingPages());
    expect(tally.flowPages).toBe(2);
  });
});

/** The ceilings and limits every fixture is planned under. */
const CEILINGS = [CEILING, 3_000, 900, 400, 150];
const limitsFor = (total: number): DeliveryLimit[] => [
  { characters: Number.POSITIVE_INFINITY },
  { characters: total },
  { characters: Math.floor(total / 2) },
  { characters: Math.floor(total / 3), pages: 4 },
  { characters: 200 },
  { characters: Number.POSITIVE_INFINITY, pages: 2 },
];

/** Every (blocks, ceiling, limit) combination the two properties are checked over. */
async function fixturePlans(): Promise<
  { label: string; withSend: PlannedPage[]; layoutOnly: PlannedPage[] }[]
> {
  const composed = await Promise.all(
    PAIRS.map(async (pair) => ({
      name: pair.name,
      layout: pair.layout.pages,
      pages: (await compose(pair.layout, pair.flow)).pages,
    })),
  );
  const sets = [
    ...composed.map((c) => ({
      label: c.name,
      layout: c.layout,
      pages: c.pages,
    })),
    {
      label: "every pair as one document",
      layout: concatPages(composed.map((c) => c.layout)),
      pages: concatPages(composed.map((c) => c.pages)),
    },
    { label: "packing", layout: packingPages(), pages: packingPages() },
  ];
  return sets.map((set) => ({
    label: set.label,
    withSend: translatePageBlocks(set.pages).blocks,
    layoutOnly: pageTextChunks(set.layout),
  }));
}

describe("weight invariance: flow changes what is sent, never what is weighed", () => {
  it("chunk page-sets, oversize, withheld pages and bound equal the -layout-only plan", async () => {
    let compared = 0;
    for (const { label, withSend, layoutOnly } of await fixturePlans()) {
      // The gate kept exactly pageTextChunks' pages, with the same text.
      expect(
        withSend.map(({ pageNumber, text }) => ({ pageNumber, text })),
        label,
      ).toEqual(layoutOnly);
      const total = layoutOnly.reduce((sum, p) => sum + p.text.length, 0);
      for (const ceiling of CEILINGS) {
        expect(
          shape(planTranslateChunks(withSend, ceiling)),
          `${label} @${ceiling}`,
        ).toEqual(shape(planTranslateChunks(layoutOnly, ceiling)));
        for (const limit of limitsFor(total)) {
          const a = capPagesToDelivery(withSend, ceiling, limit);
          const b = capPagesToDelivery(layoutOnly, ceiling, limit);
          expect(
            {
              plan: shape(a.plan),
              withheld: a.withheldPages,
              boundBy: a.boundBy,
            },
            `${label} @${ceiling} ${JSON.stringify(limit)}`,
          ).toEqual({
            plan: shape(b.plan),
            withheld: b.withheldPages,
            boundBy: b.boundBy,
          });
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThanOrEqual(PAIRS.length * CEILINGS.length);
  });

  it("the packing fixture is TWO chunks at the shipped ceiling, as on -layout", () => {
    const { blocks } = translatePageBlocks(packingPages());
    const plan = planTranslateChunks(blocks, CEILING);
    expect(plan.chunks.map((c) => c.pages)).toEqual([[1], [2]]);
  });

  it("a chunk SENDS each page's send (else its text), joined by its separators, and weighs the text", async () => {
    const composed = concatPages(
      await Promise.all(
        PAIRS.map(async (p) => (await compose(p.layout, p.flow)).pages),
      ),
    );
    const { blocks } = translatePageBlocks(composed);
    const plan = planTranslateChunks(blocks, CEILING);
    expect(plan.chunks.length).toBeGreaterThan(0);
    let sentFlow = 0;
    let marked = 0;
    for (const chunk of plan.chunks) {
      const members = chunk.pages.map((n) =>
        blocks.find((b) => b.pageNumber === n)!,
      );
      // INVERTED, NOT DELETED. True before translatePageMap (2026-11), when
      // the test was named "... joined by PAGE_JOIN, and weighs the text":
      //   expect(chunk.text).toBe(
      //     members.map((b) => b.send ?? b.text).join(PAGE_JOIN),
      //   );
      // A marked chunk now carries separatorFor(page) before each page after
      // the first; an unmarked one is still joined by PAGE_JOIN.
      expect(chunk.text).toBe(
        chunk.marked
          ? members
              .map((b, i) =>
                i === 0
                  ? (b.send ?? b.text)
                  : separatorFor(b.pageNumber) + (b.send ?? b.text),
              )
              .join("")
          : members.map((b) => b.send ?? b.text).join(PAGE_JOIN),
      );
      marked += chunk.marked ? 1 : 0;
      // Until translatePageMap (2026-11) a boundary weighed PAGE_JOIN:
      //   members.reduce((sum, b) => sum + b.text.length, 0) +
      //     (members.length - 1) * PAGE_JOIN.length
      // It now weighs a page-marker separator whether or not one is sent.
      expect(chunk.characters).toBe(
        members.reduce((sum, b) => sum + b.text.length, 0) +
          members
            .slice(1)
            .reduce((sum, b) => sum + separatorFor(b.pageNumber).length, 0),
      );
      sentFlow += members.filter((b) => b.send !== undefined).length;
    }
    expect(sentFlow).toBeGreaterThan(0);
    expect(marked, "health: a marked chunk was planned").toBeGreaterThan(0);
  });
});

// ── generated page sets ─────────────────────────────────────────────────────

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const VOCAB = [
  "the",
  "quarterly",
  "results",
  "show",
  "revenue",
  "grew",
  "risk",
  "segment",
  "exam-",
  "ple",
  "1,200",
  "North",
];

/** A random page: -layout text plus one flow variant (or none). */
function randomPage(
  random: () => number,
  pageNumber: number,
): ReadingOrderPage {
  const count = Math.floor(random() ** 3 * 2_400);
  const words = Array.from(
    { length: count },
    () => VOCAB[Math.floor(random() * VOCAB.length)]!,
  );
  // -layout: words two spaces apart, a line break now and then.
  const text = words
    .map((w, i) => (i > 0 && i % 9 === 0 ? `\n${w}` : w))
    .join("  ");
  const variant = Math.floor(random() * 5);
  const send =
    variant === 0
      ? text // identical
      : variant === 1
        ? words.join(" ") // shorter, equal ink
        : variant === 2
          ? words.join(" \t ") // LONGER, equal ink — the gate refuses it
          : variant === 3
            ? words.slice(1).join(" ") // one word dropped — refused
            : undefined; // no flow text
  return {
    pageNumber,
    text,
    characterCount: text.length,
    ...(send === undefined ? {} : { send }),
  };
}

describe("sent ≤ weighed (the next slice's page markers inherit this)", () => {
  it("holds for every chunk, and for every capped plan less only the uncounted joins", async () => {
    let chunks = 0;
    let equalWithSend = 0;
    let capped = 0;
    // Added with translatePageMap (2026-11); assertions (1) and (2) are
    // untouched. The health checks below them were written before markers
    // existed and cannot tell whether a marked chunk was ever planned under
    // a binding budget, so these count exactly that.
    let cappedMarked = 0;
    let cappedTight = 0;
    let cappedBudget = 0;

    const check = (
      label: string,
      blocks: PlannedPage[],
      ceiling: number,
      limit: DeliveryLimit,
    ) => {
      const { plan } = capPagesToDelivery(blocks, ceiling, limit);
      for (const chunk of plan.chunks) {
        chunks += 1;
        // (1) A chunk never sends more than it weighs.
        expect(chunk.text.length, label).toBeLessThanOrEqual(chunk.characters);
        const sends = chunk.pages.some(
          (n) => blocks.find((b) => b.pageNumber === n)?.send !== undefined,
        );
        if (sends && chunk.text.length === chunk.characters) equalWithSend += 1;
      }
      if (Number.isFinite(limit.characters)) {
        capped += 1;
        const sent = plan.chunks.reduce((sum, c) => sum + c.text.length, 0);
        const joins = plan.chunks.reduce(
          (sum, c) => sum + (c.pages.length - 1) * UNCOUNTED_JOIN_PER_BOUNDARY,
          0,
        );
        // (2) A capped plan sends no more than its limit, less the joins.
        expect(sent - joins, label).toBeLessThanOrEqual(limit.characters);
        if (plan.chunks.some((c) => c.marked)) cappedMarked += 1;
        if (plan.chunks.some((c) => c.markerFallback === "budget"))
          cappedBudget += 1;
        // Spent to within one separator: the cheapest marked boundary
        // (separatorOverhead(1) = 21) no longer fits what is left.
        if (
          plan.chunks.some((c) => c.marked) &&
          limit.characters - (sent - joins) < separatorOverhead(1)
        )
          cappedTight += 1;
      }
    };

    for (const { label, withSend, layoutOnly } of await fixturePlans()) {
      const total = layoutOnly.reduce((sum, p) => sum + p.text.length, 0);
      for (const ceiling of CEILINGS)
        for (const limit of limitsFor(total))
          check(label, withSend, ceiling, limit);
    }

    const random = lcg(20261116);
    for (let doc = 0; doc < 300; doc += 1) {
      const pageCount = 1 + Math.floor(random() * 30);
      const pages = Array.from({ length: pageCount }, (_, i) =>
        randomPage(random, i + 1),
      );
      const { blocks } = translatePageBlocks(pages);
      const total = blocks.reduce((sum, b) => sum + b.text.length, 0);
      const ceiling = [CEILING, 4_000, 1_500][doc % 3]!;
      const limit: DeliveryLimit = {
        characters:
          doc % 4 === 0
            ? Number.POSITIVE_INFINITY
            : Math.floor(total * random()),
        ...(doc % 5 === 0
          ? { pages: 1 + Math.floor(random() * pageCount) }
          : {}),
      };
      check(`generated #${doc}`, blocks, ceiling, limit);
    }

    // TIGHT BUDGETS (added with translatePageMap, 2026-11; the generator, not
    // the assertions). The reservation's slack is set to exactly what the
    // first j marked chunks of the unbounded plan cost, plus under one
    // separator: so the budget is spent to within a separator, and any later
    // multi-page chunk falls back for budget. Pages send their own text (or
    // nothing), so no flow shortfall loosens the bound.
    const tight = lcg(20261117);
    for (let doc = 0; doc < 120; doc += 1) {
      const pageCount = 2 + Math.floor(tight() * 29);
      const pages = Array.from({ length: pageCount }, (_, i) => {
        const words = Array.from(
          { length: Math.floor(tight() ** 2 * 300) },
          () => VOCAB[Math.floor(tight() * VOCAB.length)]!,
        );
        const text = words.join("  ");
        return {
          pageNumber: i + 1,
          text,
          characterCount: text.length,
          ...(tight() < 0.5 ? { send: text } : {}),
        };
      });
      const { blocks } = translatePageBlocks(pages);
      const total = blocks.reduce((sum, b) => sum + b.text.length, 0);
      const ceiling = [CEILING, 4_000, 1_500][doc % 3]!;
      const overheads = planTranslateChunks(blocks, ceiling)
        .chunks.filter((c) => c.marked)
        .map((c) =>
          c.pages.slice(1).reduce((sum, n) => sum + separatorOverhead(n), 0),
        );
      // At least one chunk paid for when there is one to pay for.
      const j = Math.min(
        overheads.length,
        1 + Math.floor(tight() * overheads.length),
      );
      const slack =
        overheads.slice(0, j).reduce((sum, o) => sum + o, 0) +
        Math.floor(tight() * separatorOverhead(1));
      check(`tight #${doc}`, blocks, ceiling, { characters: total + slack });
    }

    // Health: enough chunks to mean something, capped plans present, and at
    // least one chunk that SENDS flow at exactly its weight — the only kind
    // of chunk a one-character overspend in the join can turn red.
    expect(chunks).toBeGreaterThanOrEqual(20);
    expect(capped).toBeGreaterThanOrEqual(20);
    expect(equalWithSend).toBeGreaterThanOrEqual(1);
    // Page markers under a binding budget (translatePageMap, 2026-11):
    // marked boundaries planned under a cap, a budget spent to within one
    // separator, and chunks that fell back for budget.
    expect(
      cappedMarked,
      "capped plans with a marked chunk",
    ).toBeGreaterThanOrEqual(20);
    expect(
      cappedTight,
      "capped plans spent to within a separator",
    ).toBeGreaterThanOrEqual(20);
    expect(
      cappedBudget,
      "capped plans with a budget fallback",
    ).toBeGreaterThanOrEqual(20);
  });
});

describe("the text-page set cannot change", () => {
  const layout = (texts: string[]): ExtractedPdfText => {
    const pages = texts.map((text, i) => ({
      pageNumber: i + 1,
      text,
      characterCount: text.length,
    }));
    const text = texts.join(PAGE_JOIN);
    return {
      pageCount: pages.length,
      pages,
      text,
      characterCount: text.length,
      hasText: text.trim().length > 0,
    };
  };
  const flow = (pages: string[][][]): PdfFlowText => ({
    pageCount: pages.length,
    pages: pages.map((paragraphs, i) => ({ pageNumber: i + 1, paragraphs })),
  });

  it("blank, whitespace-only, image-only and invisible-OCR pages: same pages as -layout", async () => {
    const OCR = "Scanned invoice 4471 total due 1,200";
    const lay = layout([
      "", // blank
      "   \n \n  ", // whitespace only
      "", // image only: no text in either reading
      OCR, // an invisible OCR text layer: text in both readings
      "Body text on a real page.",
    ]);
    const flowed = flow([
      [],
      [["  "]],
      [],
      [["Scanned invoice 4471"], ["total due", "1,200"]],
      [["Body text on a real page."]],
    ]);
    const out = await compose(lay, flowed);
    expect(out.readingOrder).toEqual({ source: "flow" });
    const { blocks, tally } = translatePageBlocks(out.pages);
    expect(
      blocks.map(({ pageNumber, text }) => ({ pageNumber, text })),
    ).toEqual(pageTextChunks(lay.pages));
    expect(blocks.map((b) => b.pageNumber)).toEqual([4, 5]);
    expect(pageTextChunks(out.pages)).toEqual(pageTextChunks(lay.pages));
    expect(tally.flowPages).toBe(2);
  });
});
