// @vitest-environment node
/**
 * Every AI engine's provider request, recorded on main BEFORE chat page
 * retrieval (slice 3, audit #30) touched an engine, and held deep-equal
 * since. The property: retrieval changes a chat request ONLY when it adds a
 * page main's prefix lacks. Every other run — the whole document fits, the
 * run is ungrounded, nothing in the question scores, every matching page is
 * already inside main's prefix — sends main's bytes, and so does every run of
 * summarize, translate and ai-extract, whose callers were not touched.
 *
 * HOW THE FIXTURE WAS MADE. With the four engines byte-identical to
 * origin/main 0985432a (`git diff origin/main -- src/lib/workers` empty, only
 * the new leaf modules of slice 3 part A present), this file ran with
 * `RECORD_AI_REQUESTS=1`, which writes the fixture instead of comparing.
 * Never re-record to make this green: a difference here is a request main
 * would not have sent, and the fixture is the only witness of main left in
 * the tree.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PAGE_JOIN, type ExtractedPdfText } from "@/lib/pdf/text";
import type { AiCompletionRequest, AiProvider } from "./provider";
import { runChatWithPdf } from "../chat-with-pdf/engine";
import { runSummarize } from "../summarize/engine";
import { runTranslate } from "../translate/engine";
import { runAiExtract } from "../ai-extract/engine";
import type { selectPages } from "@/lib/pdf/page-retrieval";
import { provesAiReadCap } from "../processor/read-cap-proof";

const FIXTURE = fileURLToPath(
  new URL("./__fixtures__/requests-at-0985432a.json", import.meta.url),
);

type Recorded = Pick<
  AiCompletionRequest,
  "system" | "messages" | "cacheSystem" | "maxOutputTokens" | "temperature"
>;

const INPUT = new Uint8Array([1, 2, 3, 4]);

const WORDS =
  "alpha bravo cobalt delta ember fjord granite harbor island juniper kestrel lumen meadow nickel orchard pewter quarry russet saffron timber umber velvet willow xenon yarrow zinc".split(
    " ",
  );

/** Seeded filler pages (mulberry32), `plants` adding a word to given pages. */
function pages(
  count: number,
  words: number,
  plants: Record<number, string> = {},
  blanks: readonly number[] = [],
  seed = 7,
): string[] {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, (_, i) => {
    const page = i + 1;
    if (blanks.includes(page)) return "";
    const body = Array.from(
      { length: words },
      () => WORDS[Math.floor(next() * WORDS.length)]!,
    );
    if (plants[page]) body.splice(words >> 1, 0, plants[page]!);
    return body.join(" ");
  });
}

/** An extractor carrying per-page text (grounded) and the joined text. */
function paged(pageTexts: readonly string[]) {
  const joined = pageTexts.filter((t) => t.trim().length > 0).join("\n\n");
  const extracted: ExtractedPdfText = {
    pageCount: pageTexts.length,
    pages: pageTexts.map((text, i) => ({
      pageNumber: i + 1,
      text,
      characterCount: text.length,
    })),
    text: joined,
    characterCount: joined.length,
    hasText: joined.trim().length > 0,
  };
  return async () => extracted;
}

/** An extractor with joined text and NO page metadata (ungrounded). */
function flat(text: string, pageCount = 4) {
  const extracted: ExtractedPdfText = {
    pageCount,
    pages: [],
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
  return async () => extracted;
}

function recorder(): AiProvider & { seen: Recorded[] } {
  const seen: Recorded[] = [];
  return {
    id: "openai",
    model: "gpt-fixture",
    seen,
    async complete(request) {
      seen.push(
        JSON.parse(
          JSON.stringify({
            system: request.system,
            messages: request.messages,
            cacheSystem: request.cacheSystem,
            maxOutputTokens: request.maxOutputTokens,
            temperature: request.temperature,
          }),
        ) as Recorded,
      );
      return {
        ok: true,
        text: "Answer [p.1].",
        model: "gpt-fixture",
        usage: { inputTokens: 10, outputTokens: 2 },
      };
    },
  };
}

const NOW = () => "2026-11-16T00:00:00.000Z";
const LONG = pages(40, 60);
const LONG_BLANKS = pages(40, 60, {}, [2, 5, 6, 19]);

type Case = (
  provider: AiProvider,
  /** Chat cases only: the selector seam (`ChatWithPdfDeps.selectPages`). */
  select?: typeof selectPages,
) => Promise<unknown>;

/** The seam, spread into a chat case's deps only when a test passes one. */
const seam = (select?: typeof selectPages) =>
  select ? { selectPages: select } : {};

/**
 * The matrix. Chat's over-budget cases are the ones retrieval must leave
 * alone: no informative term, ungrounded, a match only inside the prefix
 * window, a cited page inside the prefix window.
 */
const CASES: Record<string, Case> = {
  "chat/fit": (provider, select) =>
    runChatWithPdf(
      INPUT,
      { question: "What does page two say?" },
      { extract: paged(pages(3, 40)), provider, now: NOW, ...seam(select) },
    ),
  "chat/fit-follow-up": (provider, select) =>
    runChatWithPdf(
      INPUT,
      {
        question: "And the second clause?",
        context: [
          { role: "user", content: "What is the first clause?" },
          { role: "assistant", content: "It is on [p.2]." },
        ],
      },
      { extract: paged(pages(3, 40)), provider, now: NOW, ...seam(select) },
    ),
  "chat/prefix-no-match": (provider, select) =>
    runChatWithPdf(
      INPUT,
      { question: "What is the governing currency?" },
      {
        extract: paged(LONG),
        provider,
        now: NOW,
        ...seam(select),
        limits: { maxInputChars: 3_000 },
      },
    ),
  "chat/prefix-common-terms-only": (provider, select) =>
    runChatWithPdf(
      INPUT,
      // Every filler word is on more than half the pages: IDF 0.
      { question: "Where is alpha bravo cobalt?" },
      {
        extract: paged(LONG),
        provider,
        now: NOW,
        ...seam(select),
        limits: { maxInputChars: 3_000 },
      },
    ),
  "chat/prefix-blank-pages": (provider, select) =>
    runChatWithPdf(
      INPUT,
      { question: "What is the governing currency?" },
      {
        extract: paged(LONG_BLANKS),
        provider,
        now: NOW,
        ...seam(select),
        limits: { maxInputChars: 2_500 },
      },
    ),
  "chat/prefix-match-inside-window": (provider, select) =>
    runChatWithPdf(
      INPUT,
      { question: "What does the Zephyrine clause say?" },
      {
        extract: paged(pages(40, 60, { 2: "Zephyrine" })),
        provider,
        now: NOW,
        ...seam(select),
        limits: { maxInputChars: 3_000 },
      },
    ),
  "chat/prefix-cited-inside-window": (provider, select) =>
    runChatWithPdf(
      INPUT,
      {
        question: "And what follows it?",
        context: [
          { role: "user", content: "What is the opening term?" },
          { role: "assistant", content: "See [p.1] and [p.2]." },
        ],
      },
      {
        extract: paged(LONG),
        provider,
        now: NOW,
        ...seam(select),
        limits: { maxInputChars: 3_000 },
      },
    ),
  "chat/prefix-delivery-cap": (provider, select) =>
    runChatWithPdf(
      INPUT,
      { question: "What is the governing currency?" },
      {
        extract: paged(LONG),
        provider,
        now: NOW,
        ...seam(select),
        limits: { delivery: { characters: 2_000 } },
      },
    ),
  "chat/ungrounded-fit": (provider, select) =>
    runChatWithPdf(
      INPUT,
      { question: "What is the total?" },
      {
        extract: flat("The total is 42."),
        provider,
        now: NOW,
        ...seam(select),
      },
    ),
  "chat/ungrounded-over-budget": (provider, select) =>
    runChatWithPdf(
      INPUT,
      { question: "What does the Zephyrine clause say?" },
      {
        extract: flat(LONG.join("\n\n") + " Zephyrine"),
        provider,
        now: NOW,
        ...seam(select),
        limits: { maxInputChars: 3_000 },
      },
    ),
  "summarize/fit": (provider) =>
    runSummarize(
      INPUT,
      { length: "standard", format: "paragraphs" },
      { extract: paged(pages(3, 40)), provider, now: NOW },
    ),
  "summarize/prefix": (provider) =>
    runSummarize(
      INPUT,
      { length: "detailed", format: "bullets" },
      {
        extract: paged(LONG),
        provider,
        now: NOW,
        limits: { maxInputChars: 3_000 },
      },
    ),
  "summarize/prefix-blank-pages": (provider) =>
    runSummarize(
      INPUT,
      { length: "brief", format: "paragraphs" },
      {
        extract: paged(LONG_BLANKS),
        provider,
        now: NOW,
        limits: { maxInputChars: 2_500 },
      },
    ),
  "summarize/ungrounded-prefix": (provider) =>
    runSummarize(
      INPUT,
      { length: "standard", format: "paragraphs" },
      {
        extract: flat(LONG.join("\n\n")),
        provider,
        now: NOW,
        limits: { maxInputChars: 3_000 },
      },
    ),
  "ai-extract/fit": (provider) =>
    runAiExtract(
      INPUT,
      { mode: "prompt", prompt: "Extract the invoice number." },
      { extract: paged(pages(3, 40)), provider, now: NOW },
    ),
  "ai-extract/prefix": (provider) =>
    runAiExtract(
      INPUT,
      {
        mode: "schema",
        schema: [
          { name: "invoice_number", type: "string" },
          { name: "total", type: "number" },
        ],
      },
      {
        extract: paged(LONG_BLANKS),
        provider,
        now: NOW,
        limits: { maxInputChars: 2_500 },
      },
    ),
  "translate/fit": (provider) =>
    runTranslate(
      INPUT,
      { targetLanguage: "fr", sourceLanguage: "auto" },
      { extract: paged(pages(3, 40)), provider, now: NOW },
    ),
  "translate/prefix": (provider) =>
    runTranslate(
      INPUT,
      { targetLanguage: "de", sourceLanguage: "en" },
      {
        extract: paged(LONG_BLANKS),
        provider,
        now: NOW,
        limits: { maxInputChars: 2_500 },
      },
    ),
};

async function recordAll(): Promise<Record<string, Recorded[]>> {
  const out: Record<string, Recorded[]> = {};
  for (const [name, run] of Object.entries(CASES)) {
    const provider = recorder();
    await run(provider);
    out[name] = provider.seen;
  }
  return out;
}

/**
 * Cases whose requests legitimately differ from the fixture, with the change
 * that moved them. Never re-record the fixture to clear one (its docblock);
 * each is held instead by the relation in "a moved case sends main's pages":
 * same system prompt and parameters, and the same pages in the same order
 * across all its segments.
 */
const MOVED_SINCE_FIXTURE: Readonly<Record<string, string>> = {
  "translate/prefix":
    "translatePageMap (2026-11): every page boundary is sized as a page-marker separator, so chunk page-sets move near the ceiling",
};

/** Each request's text between the `---` delimiters, in order. */
function segmentsOf(requests: readonly Recorded[]): string[] {
  return requests.map((request) => {
    const content = String(request.messages[0]!.content);
    const open = content.indexOf("\n---\n");
    const close = content.lastIndexOf("\n---");
    expect(open, "a request without its delimited segment").toBeGreaterThan(0);
    return content.slice(open + 5, close);
  });
}

function loadFixture(): Record<string, Recorded[]> {
  return JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<
    string,
    Recorded[]
  >;
}

describe("AI provider requests are main's bytes wherever retrieval adds no page", () => {
  if (process.env.RECORD_AI_REQUESTS === "1") {
    it("records the fixture (RECORD_AI_REQUESTS=1)", async () => {
      writeFileSync(FIXTURE, JSON.stringify(await recordAll(), null, 2) + "\n");
    });
    return;
  }

  it("health: the fixture holds ≥ 16 cases, every engine, every case a request", () => {
    const fixture = loadFixture();
    const names = Object.keys(fixture);
    expect(names.length).toBeGreaterThanOrEqual(16);
    for (const engine of ["chat", "summarize", "ai-extract", "translate"])
      expect(
        names.filter((n) => n.startsWith(`${engine}/`)),
        engine,
      ).not.toHaveLength(0);
    for (const name of names)
      expect(fixture[name]!.length, name).toBeGreaterThan(0);
    // The matrix and the fixture name the same cases: a case dropped from
    // either side is a comparison that silently stopped happening.
    expect(Object.keys(CASES).sort()).toEqual(names.sort());
    // Some of chat's cases really are over budget, or the "prefix" names lie.
    expect(
      names.filter(
        (n) =>
          n.startsWith("chat/") &&
          fixture[n]!.some((r) => (r.system ?? "").includes("ONLY PART")),
      ).length,
    ).toBeGreaterThanOrEqual(6);
  });

  it("every recorded request is deep-equal to main's", async () => {
    // Until translatePageMap (2026-11) this compared EVERY case:
    //   expect(await recordAll()).toEqual(loadFixture());
    // The cases in MOVED_SINCE_FIXTURE are compared by the relation below
    // instead; the fixture itself is not re-recorded.
    const recorded = await recordAll();
    const fixture = loadFixture();
    for (const name of Object.keys(MOVED_SINCE_FIXTURE)) {
      delete recorded[name];
      delete fixture[name];
    }
    expect(recorded).toEqual(fixture);
  });

  it("a moved case sends main's pages, in main's order, under main's system prompt; only the cut moved", async () => {
    const fixture = loadFixture();
    for (const [name, why] of Object.entries(MOVED_SINCE_FIXTURE)) {
      const provider = recorder();
      await CASES[name]!(provider);
      const seen = provider.seen;
      // The exemption is live: a case that matches main again leaves the
      // list, or this list grows into a place where differences hide.
      expect(seen, `${name} matches main again; drop it (${why})`).not.toEqual(
        fixture[name],
      );
      for (const request of seen) {
        const { messages, ...rest } = request;
        const { messages: mainMessages, ...mainRest } = fixture[name]![0]!;
        expect(rest, name).toEqual(mainRest);
        expect(messages.length, name).toBe(mainMessages.length);
      }
      expect(segmentsOf(seen).join(PAGE_JOIN), name).toBe(
        segmentsOf(fixture[name]!).join(PAGE_JOIN),
      );
      // Health: the relation reads real text, not two empty joins.
      expect(segmentsOf(seen).join("").length, name).toBeGreaterThan(1_000);
    }
  });

  it("a throwing selector sends main's prefix request, and the read-cap proof still holds", async () => {
    // FAIL CLOSED: retrieval is an addition to main, never a dependency of
    // it. A throw from the selector (or the tokenizer / BM25 that feed it)
    // must leave main's exact slice and window — main's request bytes — not
    // fail the question. The same matrix case, through the `selectPages`
    // seam, compared with the request main recorded.
    const fixture = loadFixture();
    const throwing = () => {
      throw new Error("selector exploded");
    };
    for (const name of [
      "chat/prefix-no-match",
      "chat/prefix-blank-pages",
      "chat/prefix-delivery-cap",
    ] as const) {
      const provider = recorder();
      let called = 0;
      const run = await CASES[name]!(provider, () => {
        called += 1;
        return throwing();
      });
      // Health: the seam was reached, or this proves nothing about a throw.
      expect(called, `${name}: the selector was never called`).toBeGreaterThan(
        0,
      );
      expect(run, name).toMatchObject({
        ok: true,
        meta: { selection: "prefix" },
      });
      expect(provider.seen, name).toEqual(fixture[name]);
    }
    // A document whose planted page lies past the prefix WOULD take the
    // relevance branch; thrown, it sends exactly what a selector that chose
    // the prefix sends (main's prefix).
    const planted = pages(40, 60, { 30: "Zephyrine" });
    const question = { question: "What does the Zephyrine clause say?" };
    const limits = { maxInputChars: 3_000 };
    const live = recorder();
    const liveRun = await runChatWithPdf(INPUT, question, {
      extract: paged(planted),
      provider: live,
      now: NOW,
      limits,
    });
    expect(liveRun).toMatchObject({
      ok: true,
      meta: { selection: "relevance" },
    });
    const thrown = recorder();
    const thrownRun = await runChatWithPdf(INPUT, question, {
      extract: paged(planted),
      provider: thrown,
      now: NOW,
      limits,
      selectPages: throwing,
    });
    const prefix = recorder();
    await runChatWithPdf(INPUT, question, {
      extract: paged(planted),
      provider: prefix,
      now: NOW,
      limits,
      selectPages: () => ({ strategy: "prefix", reason: "no-signal" }),
    });
    expect(thrownRun).toMatchObject({
      ok: true,
      meta: { selection: "prefix" },
    });
    expect(thrown.seen).toEqual(prefix.seen);
    expect(thrown.seen[0]!.system).not.toContain("[Page 30]");
    expect(thrown.seen[0]!.system).toMatch(/pages 1-\d+ of 40/);
    expect(thrown.seen[0]!.cacheSystem).toBe(true);
    // The charged read bound is untouched by the fallback.
    expect(await provesAiReadCap()).toBe(true);
  });

  it("positive control: one byte changed in a recorded system prompt is seen", async () => {
    const now = await recordAll();
    const fixture = loadFixture();
    const first = fixture["chat/prefix-no-match"]![0]!;
    const mutated = {
      ...fixture,
      "chat/prefix-no-match": [
        {
          ...first,
          system: (first.system ?? "").replace("[Page 1]", "[Page 7]"),
        },
      ],
    };
    expect(mutated["chat/prefix-no-match"]![0]!.system).not.toBe(first.system);
    expect(now).not.toEqual(mutated);
  });
});
