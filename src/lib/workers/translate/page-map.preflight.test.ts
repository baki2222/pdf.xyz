// @vitest-environment node
/**
 * P4: ONE PLAN IN TWO PLACES. The browser preflight's chunk page-sets equal
 * the page-sets the worker ACTUALLY SENT for the same pages.
 *
 * `translatePreflight` (preflight.ts) calls `planTranslateChunks` with the
 * default marker budget (Infinity), and the panel's wait budget for a job the
 * user has already paid for is `translateJobPoll(plan.chunks.length)`. The
 * worker plans through `capPagesToDelivery`, with a capped marker budget. If
 * sizing ever depended on the budget, the two would cut different chunks and
 * the wait budget would be wrong for exactly the jobs near the ceiling.
 *
 * Both sides read the SAME text (the pdfjs-shaped twin is the worker's
 * extraction too, with no `send`), so only the planner is under test. The
 * worker's page-sets are decoded FROM THE RECORDED REQUESTS, never from its
 * plan.
 *
 * HEALTH, FATAL if missing: at least 20 documents whose chunk count differs
 * from a PAGE_JOIN-only reference planner (otherwise separator sizing is
 * never exercised), and at least 20 engine runs with `fellBack.budget > 0`
 * whose page-sets were compared (otherwise the budget case is an empty
 * comparison).
 */
import { describe, expect, it } from "vitest";
import { PAGE_JOIN, type ExtractedPdfText } from "@/lib/pdf/text";
import type { AiCompletionRequest, AiProvider } from "../ai/provider";
import { discoverReadingOrderPairs } from "@/tests/reading-order-pairs";
import {
  TRANSLATE_CHARS_PER_OUTPUT_TOKEN,
  TRANSLATE_MAX_INPUT_CHARS,
  translateMaxInputChars,
} from "@/lib/jobs/translate-limits";
import { runTranslate } from "./engine";
import { separatorFor } from "./page-markers";
import { translatePreflight } from "./preflight";
import { translatePageBlocks } from "./reading-order";

const SEED = Number(process.env.PAGE_MAP_PREFLIGHT_SEED ?? 20261116);
const DOCUMENTS = 320;
const NL = String.fromCharCode(10);
const OPEN = `${NL}---${NL}`;
const CLOSE = `${NL}---`;
const OPTIONS = { targetLanguage: "fr", sourceLanguage: "auto" } as const;

/** A small per-call ceiling, so generated pages stay small and many. */
const SMALL_TOKENS = Math.ceil(1_000 / TRANSLATE_CHARS_PER_OUTPUT_TOKEN);
const SMALL = translateMaxInputChars(SMALL_TOKENS);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function echo(): AiProvider & { calls: AiCompletionRequest[] } {
  const calls: AiCompletionRequest[] = [];
  return {
    id: "anthropic",
    model: "claude-sonnet-5",
    calls,
    async complete(request) {
      calls.push(request);
      const content = request.messages[0]!.content;
      return {
        ok: true,
        text: content.slice(
          content.indexOf(OPEN) + OPEN.length,
          content.lastIndexOf(CLOSE),
        ),
        model: "claude-sonnet-5",
      };
    },
  };
}

/**
 * Each call's pages, decoded from its segment: consecutive pages joined by
 * PAGE_JOIN or by their separator. Fails loudly when a segment does not
 * decode, so a mismatch cannot pass as an empty set.
 */
function pagesOnWire(
  calls: readonly AiCompletionRequest[],
  pages: readonly { pageNumber: number; text: string }[],
): number[][] {
  let at = 0;
  return calls.map((call) => {
    const content = call.messages[0]!.content;
    let rest = content.slice(
      content.indexOf(OPEN) + OPEN.length,
      content.lastIndexOf(CLOSE),
    );
    const covered: number[] = [];
    while (at < pages.length) {
      const page = pages[at]!;
      const heads =
        covered.length === 0
          ? [page.text]
          : [separatorFor(page.pageNumber) + page.text, PAGE_JOIN + page.text];
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

/** main's planner before markers: PAGE_JOIN per boundary. Chunk count only. */
function referenceChunkCount(
  pages: readonly { text: string }[],
  ceiling: number,
): number {
  let count = 0;
  let pending = 0;
  let chars = 0;
  for (const page of pages) {
    const size = page.text.length;
    if (size > ceiling) {
      if (pending > 0) count += 1;
      pending = 0;
      chars = 0;
      continue;
    }
    const joined = pending === 0 ? size : chars + PAGE_JOIN.length + size;
    if (joined > ceiling) {
      count += 1;
      pending = 0;
      chars = 0;
    }
    chars = pending === 0 ? size : chars + PAGE_JOIN.length + size;
    pending += 1;
  }
  return count + (pending > 0 ? 1 : 0);
}

function twinOf(texts: readonly string[]): ExtractedPdfText {
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
}

/** A page of about `size` characters, its words unique to page `n`. */
function pageText(n: number, size: number): string {
  if (size <= 0) return "";
  let out = "";
  for (let k = 0; out.length < size; k += 1)
    out += `${out ? " " : ""}p${n}w${k}`;
  return out.slice(0, size).trimEnd();
}

async function compare(
  label: string,
  twin: ExtractedPdfText,
  ceiling: number,
  maxOutputTokens: number | undefined,
  slack: number | null,
) {
  const preflight = translatePreflight(twin, ceiling);
  const { blocks } = translatePageBlocks(twin.pages);
  const sendable = blocks.filter((b) => b.text.length <= ceiling);
  const total = sendable.reduce((n, b) => n + b.text.length, 0);
  const provider = echo();
  const run = await runTranslate(new Uint8Array([1]), OPTIONS, {
    extract: async () => twin,
    provider,
    limits: {
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      // A cap that delivers every page (nothing is withheld, so the two
      // page lists are comparable) and leaves `slack` for the markers.
      ...(slack !== null ? { delivery: { characters: total + slack } } : {}),
    },
  });
  if (preflight.plan.chunks.length === 0) {
    expect(run.ok, label).toBe(false);
    return null;
  }
  expect(run.ok, `${label}: ${run.ok ? "" : run.message}`).toBe(true);
  if (!run.ok) return null;
  expect(run.meta.delivery, label).toBeUndefined();
  const sent = pagesOnWire(provider.calls, sendable);
  expect(sent, label).toEqual(preflight.plan.chunks.map((c) => c.pages));
  return { preflight, run };
}

describe("P4: the preflight's page-sets are the page-sets the worker sent", () => {
  it("the S3 reading-order fixtures, each pair and all together", async () => {
    const pairs = discoverReadingOrderPairs();
    expect(pairs.length).toBeGreaterThanOrEqual(12);
    const all = pairs.flatMap((p) => p.layout.pages.map((page) => page.text));
    const twins = [
      ...pairs.map((p) => ({ name: p.name, twin: p.layout })),
      { name: "all pairs", twin: twinOf(all) },
    ];
    let compared = 0;
    for (const { name, twin } of twins)
      for (const [ceiling, tokens] of [
        [TRANSLATE_MAX_INPUT_CHARS, undefined],
        [SMALL, SMALL_TOKENS],
      ] as const)
        for (const slack of [null, 0, 25, 100]) {
          const r = await compare(
            `${name} @${ceiling} slack ${slack}`,
            twin,
            ceiling,
            tokens,
            slack,
          );
          if (r) compared += 1;
        }
    expect(compared).toBeGreaterThanOrEqual(pairs.length * 8);
  });

  it(`over ${DOCUMENTS} generated documents (seed ${SEED}), capped and uncapped`, async () => {
    const rand = mulberry32(SEED);
    const health = { countDiffers: 0, budgetCompared: 0, compared: 0 };
    for (let d = 0; d < DOCUMENTS; d += 1) {
      const label = `seed ${SEED}, document #${d}`;
      const pageCount = 1 + Math.floor(rand() * 40);
      // Sizes around SMALL/k, so separators decide how many pages fit;
      // plus empty, tiny and oversize pages.
      const k = 2 + Math.floor(rand() * 4);
      const texts = Array.from({ length: pageCount }, (_, i) => {
        const r = rand();
        const size =
          r < 0.05
            ? 0
            : r < 0.12
              ? 1 + Math.floor(rand() * 12)
              : r < 0.15
                ? SMALL + 1 + Math.floor(rand() * 200)
                : Math.floor(SMALL / k - 40 + rand() * 60);
        return pageText(i + 1, size);
      });
      const twin = twinOf(texts);
      if (!twin.hasText) continue;
      const { blocks } = translatePageBlocks(twin.pages);
      if (
        referenceChunkCount(blocks, SMALL) !==
        translatePreflight(twin, SMALL).plan.chunks.length
      )
        health.countDiffers += 1;
      const slack =
        d % 4 === 0 ? null : Math.floor(rand() ** 2 * 30 * pageCount);
      const r = await compare(label, twin, SMALL, SMALL_TOKENS, slack);
      if (!r) continue;
      health.compared += 1;
      if (r.run.meta.pageMap.fellBack.budget > 0) health.budgetCompared += 1;
    }
    const report = JSON.stringify(health);
    expect(health.compared, report).toBeGreaterThanOrEqual(250);
    expect(health.countDiffers, report).toBeGreaterThanOrEqual(20);
    expect(health.budgetCompared, report).toBeGreaterThanOrEqual(20);
  }, 120_000);
});
