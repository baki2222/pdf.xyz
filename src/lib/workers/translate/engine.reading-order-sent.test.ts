// @vitest-environment node
/**
 * `results.ai.readingOrder.flowPages` / `layoutPages` / `fellBack` count the
 * pages SENT, not every text page (S3 review, 2026-11-16).
 *
 * The defect: the counts were taken from `translatePageBlocks`' tally, which
 * runs over every text page BEFORE the delivery cap and before any call — so
 * a withheld page, an oversize page and every page after an interruption were
 * recorded as "sent as flow" or "sent as -layout". `sentCharacters` beside
 * them was already literal; the page counts now follow the same rule (a page
 * counts once its segment is on the wire, the failing call included).
 *
 * The expected counts are DECODED FROM THE WIRE: every page carries a unique
 * tag in both its `-layout` text and its flow text, so which pages a call
 * carried is read from the recorded prompts, never from the plan. Each case
 * also asserts its own health: the cap or interruption really did keep text
 * pages off the wire, so "all pages" and "sent pages" differ and the
 * all-pages count goes red here.
 */
import { describe, expect, it } from "vitest";
import type { AiCompletionResult, AiProvider } from "../ai/provider";
import { TRANSLATE_CHARS_PER_OUTPUT_TOKEN } from "@/lib/jobs/translate-limits";
import { runTranslate } from "./engine";
import {
  tallySentPages,
  translatePageBlocks,
  type ReadingOrderPage,
  type TranslateExtractor,
} from "./reading-order";

const NL = String.fromCharCode(10);
const OPEN = `${NL}---${NL}`;
const CLOSE = `${NL}---`;
const OPTIONS = { targetLanguage: "fr", sourceLanguage: "auto" } as const;

const tag = (n: number) => `PGTAG${String(n).padStart(2, "0")}Z`;
const words = (n: number, count: number) =>
  Array.from({ length: count }, (_, i) => `w${n}x${i}`);

type Kind = "flow" | "layout" | "rtl" | "oversize";
/**
 * Twelve pages: flow pages (send = the same words reversed: same ink, same
 * length), a page with no flow text, an RTL page (gate falls back) and an
 * oversize page (never sent). ~300 characters each against a ~1,000
 * character call ceiling, so the job needs several calls.
 */
const KINDS: Kind[] = [
  "flow",
  "flow",
  "layout",
  "oversize",
  "rtl",
  "flow",
  "flow",
  "layout",
  "flow",
  "flow",
  "rtl",
  "flow",
];

function page(n: number, kind: Kind): ReadingOrderPage {
  const body = words(n, kind === "oversize" ? 260 : 40);
  if (kind === "rtl") body.push("مرحبا");
  const text = [tag(n), ...body].join(" ");
  const base = { pageNumber: n, text, characterCount: text.length };
  if (kind === "layout") return base;
  return { ...base, send: [...body].reverse().concat(tag(n)).join(" ") };
}

const PAGES = KINDS.map((k, i) => page(i + 1, k));
const TEXT = PAGES.map((p) => p.text).join("\n\n");
const extract: TranslateExtractor = async () => ({
  pageCount: PAGES.length,
  pages: PAGES,
  text: TEXT,
  characterCount: TEXT.length,
  hasText: true,
  readingOrder: { source: "flow" },
});

const CHUNKED = {
  maxOutputTokens: Math.ceil(1_000 / TRANSLATE_CHARS_PER_OUTPUT_TOKEN),
};

const OK: AiCompletionResult = {
  ok: true,
  text: "Traduction.",
  model: "claude-sonnet-5",
  usage: { inputTokens: 50, outputTokens: 10 },
};
const LIMITED: AiCompletionResult = {
  ok: false,
  kind: "rate_limited",
  retryable: true,
  message: "slow down",
  usage: { inputTokens: 40, outputTokens: 0 },
};

function scripted(script: AiCompletionResult[]) {
  const segments: string[] = [];
  const provider: AiProvider = {
    id: "anthropic",
    model: "claude-sonnet-5",
    async complete(request) {
      const content = request.messages[0]!.content;
      segments.push(
        content.slice(
          content.indexOf(OPEN) + OPEN.length,
          content.lastIndexOf(CLOSE),
        ),
      );
      return script[Math.min(segments.length - 1, script.length - 1)]!;
    },
  };
  return { provider, segments };
}

/** The page numbers the recorded calls carried, read from their tags. */
function pagesOnWire(segments: readonly string[]): number[] {
  const seen = new Set<number>();
  for (const s of segments)
    for (const p of PAGES)
      if (s.includes(tag(p.pageNumber))) seen.add(p.pageNumber);
  return [...seen].sort((a, b) => a - b);
}

function expectedFor(sent: readonly number[]) {
  const t = { flow: 0, layout: 0, rtl: 0 };
  for (const n of sent) {
    const k = KINDS[n - 1]!;
    if (k === "flow") t.flow += 1;
    else if (k === "layout") t.layout += 1;
    else if (k === "rtl") {
      t.layout += 1;
      t.rtl += 1;
    }
  }
  return {
    flowPages: t.flow,
    layoutPages: t.layout,
    fellBack: { ink: 0, longer: 0, rtl: t.rtl },
  };
}

const TEXT_PAGES = translatePageBlocks(PAGES).tally;

describe("readingOrder page counts are over the pages SENT", () => {
  it("health: the gate sees every kind, and the oversize page exists", () => {
    expect(TEXT_PAGES).toEqual({
      // The oversize page has flow text and passes the gate: the gate's
      // tally counts it as flow although it can never be sent.
      flowPages: 8,
      layoutPages: 4,
      fellBack: { ink: 0, longer: 0, rtl: 2 },
    });
  });

  it("a capped job counts neither withheld nor oversize pages", async () => {
    const { provider, segments } = scripted([OK]);
    const run = await runTranslate(new Uint8Array([1]), OPTIONS, {
      extract,
      provider,
      limits: { ...CHUNKED, delivery: { characters: 1_600 } },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const sent = pagesOnWire(segments);
    // Health: the cap withheld text pages, and the oversize page was not sent.
    expect(run.meta.delivery?.withheldPages ?? 0).toBeGreaterThan(0);
    expect(sent).not.toContain(4);
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.length).toBeLessThan(PAGES.length - 1);
    const order = run.meta.readingOrder;
    expect({
      flowPages: order.flowPages,
      layoutPages: order.layoutPages,
      fellBack: order.fellBack,
    }).toEqual(expectedFor(sent));
    expect(order.flowPages + order.layoutPages).toBeLessThan(
      TEXT_PAGES.flowPages + TEXT_PAGES.layoutPages,
    );
  });

  it("an interrupted job counts the failing call's pages, not the pages after it", async () => {
    const { provider, segments } = scripted([OK, LIMITED, OK]);
    const run = await runTranslate(new Uint8Array([1]), OPTIONS, {
      extract,
      provider,
      limits: CHUNKED,
    });
    // Earlier parts succeeded, so the job delivers what it has.
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(segments).toHaveLength(2);
    const sent = pagesOnWire(segments);
    // Health: pages after the interruption exist and were never sent.
    expect(Math.max(...sent)).toBeLessThan(PAGES.length);
    const order = run.meta.readingOrder;
    expect({
      flowPages: order.flowPages,
      layoutPages: order.layoutPages,
      fellBack: order.fellBack,
    }).toEqual(expectedFor(sent));
    expect(order.flowPages + order.layoutPages).toBeLessThan(
      TEXT_PAGES.flowPages + TEXT_PAGES.layoutPages,
    );
  });

  it("an uncapped, uninterrupted job counts every text page but the oversize one", async () => {
    const { provider, segments } = scripted([OK]);
    const run = await runTranslate(new Uint8Array([1]), OPTIONS, {
      extract,
      provider,
      limits: CHUNKED,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const sent = pagesOnWire(segments);
    expect(sent).toEqual(PAGES.map((p) => p.pageNumber).filter((n) => n !== 4));
    expect({
      flowPages: run.meta.readingOrder.flowPages,
      layoutPages: run.meta.readingOrder.layoutPages,
      fellBack: run.meta.readingOrder.fellBack,
    }).toEqual(expectedFor(sent));
  });
});

describe("tallySentPages", () => {
  const { outcomes } = translatePageBlocks(PAGES);
  it("counts each sent page once, and ignores pages with no outcome", () => {
    expect(tallySentPages(outcomes, [1, 1, 3, 5, 99])).toEqual({
      flowPages: 1,
      layoutPages: 2,
      fellBack: { ink: 0, longer: 0, rtl: 1 },
    });
  });
  it("over every text page it equals the gate's own tally (positive control)", () => {
    expect(tallySentPages(outcomes, outcomes.keys())).toEqual(TEXT_PAGES);
  });
});
