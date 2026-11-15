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
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { AiCompletionRequest, AiProvider } from "./provider";
import { runChatWithPdf } from "../chat-with-pdf/engine";
import { runSummarize } from "../summarize/engine";
import { runTranslate } from "../translate/engine";
import { runAiExtract } from "../ai-extract/engine";

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

type Case = (provider: AiProvider) => Promise<unknown>;

/**
 * The matrix. Chat's over-budget cases are the ones retrieval must leave
 * alone: no informative term, ungrounded, a match only inside the prefix
 * window, a cited page inside the prefix window.
 */
const CASES: Record<string, Case> = {
  "chat/fit": (provider) =>
    runChatWithPdf(
      INPUT,
      { question: "What does page two say?" },
      { extract: paged(pages(3, 40)), provider, now: NOW },
    ),
  "chat/fit-follow-up": (provider) =>
    runChatWithPdf(
      INPUT,
      {
        question: "And the second clause?",
        context: [
          { role: "user", content: "What is the first clause?" },
          { role: "assistant", content: "It is on [p.2]." },
        ],
      },
      { extract: paged(pages(3, 40)), provider, now: NOW },
    ),
  "chat/prefix-no-match": (provider) =>
    runChatWithPdf(
      INPUT,
      { question: "What is the governing currency?" },
      {
        extract: paged(LONG),
        provider,
        now: NOW,
        limits: { maxInputChars: 3_000 },
      },
    ),
  "chat/prefix-common-terms-only": (provider) =>
    runChatWithPdf(
      INPUT,
      // Every filler word is on more than half the pages: IDF 0.
      { question: "Where is alpha bravo cobalt?" },
      {
        extract: paged(LONG),
        provider,
        now: NOW,
        limits: { maxInputChars: 3_000 },
      },
    ),
  "chat/prefix-blank-pages": (provider) =>
    runChatWithPdf(
      INPUT,
      { question: "What is the governing currency?" },
      {
        extract: paged(LONG_BLANKS),
        provider,
        now: NOW,
        limits: { maxInputChars: 2_500 },
      },
    ),
  "chat/prefix-match-inside-window": (provider) =>
    runChatWithPdf(
      INPUT,
      { question: "What does the Zephyrine clause say?" },
      {
        extract: paged(pages(40, 60, { 2: "Zephyrine" })),
        provider,
        now: NOW,
        limits: { maxInputChars: 3_000 },
      },
    ),
  "chat/prefix-cited-inside-window": (provider) =>
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
        limits: { maxInputChars: 3_000 },
      },
    ),
  "chat/prefix-delivery-cap": (provider) =>
    runChatWithPdf(
      INPUT,
      { question: "What is the governing currency?" },
      {
        extract: paged(LONG),
        provider,
        now: NOW,
        limits: { delivery: { characters: 2_000 } },
      },
    ),
  "chat/ungrounded-fit": (provider) =>
    runChatWithPdf(
      INPUT,
      { question: "What is the total?" },
      { extract: flat("The total is 42."), provider, now: NOW },
    ),
  "chat/ungrounded-over-budget": (provider) =>
    runChatWithPdf(
      INPUT,
      { question: "What does the Zephyrine clause say?" },
      {
        extract: flat(LONG.join("\n\n") + " Zephyrine"),
        provider,
        now: NOW,
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
    expect(await recordAll()).toEqual(loadFixture());
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
