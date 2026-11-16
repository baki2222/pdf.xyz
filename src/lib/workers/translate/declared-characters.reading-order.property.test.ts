// @vitest-environment node
/**
 * PROPERTY: reading order never moves the charge, and never sends more than
 * was weighed — over GENERATED documents, not only the author's fixtures.
 *
 * "Never under-declares" and "never sends more than it reserved" are claims
 * about ALL documents. The verbatim poppler pairs are a typed corpus of
 * about seventeen pages chosen by whoever captured them, so this file draws
 * documents from a seeded generator (the seed is in every failure message)
 * and asserts, for each:
 *
 *  1. THE CHARGE DOES NOT MOVE: the reservation priced from what the panel
 *     declares (`characterCount` of the extraction, the browser having no
 *     `send`) is identical whether or not the pages carry flow text;
 *  2. Σ sent page text ≤ Σ walked `-layout` characters ≤ cap.characters;
 *  3. withheld pages, the bound, the chunk page-sets and the oversize set
 *     equal the `-layout`-only run;
 *  4. every chunk's text is no longer than the characters it was weighed at.
 *
 * Plus, through `runTranslate` on every tenth document, the literal count
 * `readingOrder.sentCharacters` equals what the planner sent, and that count
 * LESS its page markers (`pageMap.markerCharacters`) is no larger than the
 * window's `charactersSent` (asserted only with `truncated === false`).
 * `pageMap.markerCharacters` is pinned to the plan: Σ (chunk.text.length −
 * the PAGE_JOIN-joined length) — one unit, two readers.
 *
 * HEALTH, FATAL if missing: at least 50 pages of each flow variant, 20
 * page-count mismatches, 20 capped plans that withheld pages, and 100 pages
 * that actually sent flow. A generator that never reaches a branch reports
 * the strongest possible pass.
 *
 * MUTATIONS (2026-11-16, each on the file with a backup copy, grepped back,
 * restored and diffed empty): weighing by `send` in `planTranslateChunks`
 * turned (3) red; deleting gate (b) in `translatePageBlocks` turned (2) red.
 */
import { describe, expect, it } from "vitest";
import { PAGE_JOIN, type ExtractedPdfText } from "@/lib/pdf/text";
import type { PdfFlowText, PdfFlowTextPage } from "../pdf-text/flow";
import {
  AI_DELIVERY_LIMITS,
  aiReservationGiven,
  type JobDeliveryCap,
} from "@/lib/jobs/delivery-cap";
import { TRANSLATE_MAX_INPUT_CHARS } from "@/lib/jobs/translate-limits";
import type { AiProvider } from "../ai/provider";
import { capPagesToDelivery } from "./chunking";
import { runTranslate } from "./engine";
import {
  composeReadingOrderExtractor,
  translatePageBlocks,
  type TranslateExtracted,
} from "./reading-order";

const SEED = Number(process.env.READING_ORDER_SEED ?? 20261116);
const DOCUMENTS = 600;
const CEILING = TRANSLATE_MAX_INPUT_CHARS;
const NL = String.fromCharCode(10);
const PARA = NL + NL;
/** An Arabic word and a Hebrew word, from code points. */
const RTL_WORDS = [
  String.fromCodePoint(0x0643, 0x062a, 0x0627, 0x0628),
  String.fromCodePoint(0x05e1, 0x05e4, 0x05e8),
];

const VARIANTS = [
  "identical",
  "shorter",
  "longer",
  "dropped",
  "rtl",
  "absent",
] as const;
type Variant = (typeof VARIANTS)[number];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS =
  "the quick brown fox jumps over a lazy dog while seven bright owls watch from old oak branches near quiet water".split(
    " ",
  );

interface Page {
  text: string;
  variant: Variant;
  paragraphs: string[][];
}

function generate(rand: () => number) {
  const int = (lo: number, hi: number) =>
    lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const pageCount = int(1, 40);
  const pages: Page[] = [];
  for (let i = 0; i < pageCount; i += 1) {
    const variant = pick(VARIANTS);
    const kind = rand();
    let paragraphs: string[][];
    if (kind < 0.06) paragraphs = [];
    else if (kind < 0.1) paragraphs = [[" ", "  "]];
    else {
      const target =
        kind < 0.14 ? int(CEILING + 1, CEILING + 3_000) : int(20, 3_200);
      paragraphs = [];
      let size = 0;
      while (size < target) {
        const words = Array.from({ length: int(4, 60) }, () => pick(WORDS));
        if (variant === "rtl" && paragraphs.length === 0)
          words.splice(int(0, words.length), 0, pick(RTL_WORDS));
        paragraphs.push(words);
        size += words.join(" ").length + 2;
      }
    }
    const text =
      paragraphs.length === 1 && paragraphs[0]!.every((w) => w.trim() === "")
        ? paragraphs[0]!.join("")
        : paragraphs.map((p) => p.join(" ")).join(PARA);
    pages.push({ text, variant, paragraphs });
  }
  return { pages, mismatch: rand() < 0.2, extraPage: rand() < 0.5 };
}

/** The page's flow text for its variant, or undefined for `absent`. */
function flowFor(page: Page): string | undefined {
  const paras = page.paragraphs.map((p) => p.join(" "));
  switch (page.variant) {
    case "identical":
    case "rtl":
      return page.text;
    case "shorter":
      return paras.join(NL);
    case "longer":
      return page.paragraphs.map((p) => p.join("  ")).join(PARA);
    case "dropped": {
      const words = page.paragraphs.flat();
      if (words.length === 0) return page.text;
      return [...words.slice(0, -1)].join(" ");
    }
    case "absent":
      return undefined;
  }
}

function documentOf(generated: ReturnType<typeof generate>): {
  layout: ExtractedPdfText;
  flow: PdfFlowText;
} {
  const pages = generated.pages.map((p, i) => ({
    pageNumber: i + 1,
    text: p.text,
    characterCount: p.text.length,
  }));
  const text = pages.map((p) => p.text).join(PARA);
  const flowPages: PdfFlowTextPage[] = [];
  generated.pages.forEach((p, i) => {
    const send = flowFor(p);
    if (send !== undefined)
      flowPages.push({ pageNumber: i + 1, paragraphs: [[send]] });
  });
  const flowCount = generated.mismatch
    ? generated.extraPage || pages.length === 1
      ? pages.length + 1
      : pages.length - 1
    : pages.length;
  return {
    layout: {
      pageCount: pages.length,
      pages,
      text,
      characterCount: text.length,
      hasText: text.trim().length > 0,
    },
    flow: { pageCount: flowCount, pages: flowPages },
  };
}

const shapeOf = (capped: ReturnType<typeof capPagesToDelivery>) => ({
  chunks: capped.plan.chunks.map((c) => c.pages),
  oversize: capped.plan.oversize,
  withheld: capped.withheldPages,
  boundBy: capped.boundBy,
});

const provider: AiProvider = {
  id: "anthropic",
  model: "claude-sonnet-5",
  async complete() {
    return {
      ok: true,
      text: "x",
      model: "claude-sonnet-5",
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  },
};

describe(`reading order over generated documents (seed ${SEED})`, () => {
  it("never moves the charge, never sends more than it weighed, never moves a page", async () => {
    const rand = mulberry32(SEED);
    const health = {
      variants: Object.fromEntries(VARIANTS.map((v) => [v, 0])) as Record<
        Variant,
        number
      >,
      mismatches: 0,
      cappedWithheld: 0,
      flowPages: 0,
      engineRuns: 0,
      markedRuns: 0,
    };
    for (let d = 0; d < DOCUMENTS; d += 1) {
      const at = `seed ${SEED}, document #${d}`;
      const generated = generate(rand);
      for (const p of generated.pages) health.variants[p.variant] += 1;
      if (generated.mismatch) health.mismatches += 1;
      const doc = documentOf(generated);
      const extract = composeReadingOrderExtractor(
        async () => doc.layout,
        async () => doc.flow,
      );
      const composite: TranslateExtracted = await extract(new Uint8Array());
      if (!composite.hasText) continue;

      // 1. The charge: what the panel declares is the extraction's count,
      // and the composite does not change it.
      const factor = [1, 1, 0.5, 0.25, 0.1][d % 5]!;
      const request = (e: ExtractedPdfText) => ({
        declaredCharacters: Math.max(1, Math.round(e.characterCount * factor)),
        ...(d % 7 === 0
          ? { declaredTextPages: Math.max(1, Math.floor(e.pageCount / 2)) }
          : {}),
      });
      const withSend = aiReservationGiven(
        "translate-pdf",
        request(composite),
        AI_DELIVERY_LIMITS,
        false,
      );
      const withoutSend = aiReservationGiven(
        "translate-pdf",
        request(doc.layout),
        AI_DELIVERY_LIMITS,
        false,
      );
      expect(withSend, at).toEqual(withoutSend);
      const cap = withSend.delivery as JobDeliveryCap;

      const { blocks, tally } = translatePageBlocks(composite.pages);
      health.flowPages += tally.flowPages;
      const layoutBlocks = blocks.map(({ pageNumber, text }) => ({
        pageNumber,
        text,
      }));
      const viaFlow = capPagesToDelivery(blocks, CEILING, cap);
      const viaLayout = capPagesToDelivery(layoutBlocks, CEILING, cap);

      // 3. Nothing about WHICH pages moves.
      expect(shapeOf(viaFlow), at).toEqual(shapeOf(viaLayout));
      if (viaFlow.boundBy !== null && viaFlow.withheldPages.length > 0)
        health.cappedWithheld += 1;

      // 2. Sent ≤ walked ≤ cap.
      const byPage = new Map(blocks.map((b) => [b.pageNumber, b]));
      const delivered = viaFlow.plan.chunks.flatMap((c) => c.pages);
      const sent = delivered.reduce((n, p) => {
        const b = byPage.get(p)!;
        return n + (b.send ?? b.text).length;
      }, 0);
      const walked = delivered.reduce(
        (n, p) => n + byPage.get(p)!.text.length,
        0,
      );
      expect(sent, `${at}: sent > walked`).toBeLessThanOrEqual(walked);
      expect(walked, `${at}: walked > cap`).toBeLessThanOrEqual(cap.characters);

      // 4. Every chunk.
      for (const chunk of viaFlow.plan.chunks)
        expect(chunk.text.length, at).toBeLessThanOrEqual(chunk.characters);

      // Through the engine, every tenth document: the literal count.
      if (d % 10 === 0 && viaFlow.plan.chunks.length > 0) {
        const run = await runTranslate(
          new Uint8Array([1]),
          { targetLanguage: "fr", sourceLanguage: "auto" },
          { extract, provider, limits: { delivery: cap } },
        );
        expect(run.ok, at).toBe(true);
        if (run.ok) {
          health.engineRuns += 1;
          expect(run.meta.readingOrder.sentCharacters, at).toBe(
            viaFlow.plan.chunks.reduce((n, c) => n + c.text.length, 0),
          );
          expect(run.meta.window.truncated, at).toBe(false);
          // INVERTED, NOT DELETED. True before translatePageMap (2026-11):
          //   expect(run.meta.readingOrder.sentCharacters, at).toBeLessThanOrEqual(
          //     run.meta.window.charactersSent,
          //   );
          // The markers are literal characters in the -layout unit's place,
          // so the sent count may exceed the window whenever flow ≈ layout.
          // The relation holds for the count LESS the markers it carries.
          expect(
            run.meta.readingOrder.sentCharacters -
              run.meta.pageMap.markerCharacters,
            at,
          ).toBeLessThanOrEqual(run.meta.window.charactersSent);
          // One unit, two readers: the engine's tally equals what the plan's
          // separators add over a PAGE_JOIN join.
          expect(run.meta.pageMap.markerCharacters, at).toBe(
            viaFlow.plan.chunks.reduce(
              (n, c) =>
                n +
                c.text.length -
                c.pages
                  .map((p) => {
                    const b = byPage.get(p)!;
                    return b.send ?? b.text;
                  })
                  .join(PAGE_JOIN).length,
              0,
            ),
          );
          if (run.meta.pageMap.markerCharacters > 0) health.markedRuns += 1;
        }
      }
    }

    const report = JSON.stringify(health);
    for (const v of VARIANTS)
      expect(health.variants[v], `${v}: ${report}`).toBeGreaterThanOrEqual(50);
    expect(health.mismatches, report).toBeGreaterThanOrEqual(20);
    expect(health.cappedWithheld, report).toBeGreaterThanOrEqual(20);
    expect(health.flowPages, report).toBeGreaterThanOrEqual(100);
    expect(health.engineRuns, report).toBeGreaterThanOrEqual(20);
    expect(health.markedRuns, report).toBeGreaterThanOrEqual(10);
  }, 120_000);
});
