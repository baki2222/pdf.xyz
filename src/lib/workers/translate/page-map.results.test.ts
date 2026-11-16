// @vitest-environment node
/**
 * `results.ai.pageMap` REACHES THE JOB RECORD — read where the reader reads
 * it, not where the engine wrote it.
 *
 * The processor's results pass through `sanitizeJobResults` (the worker's
 * queue calls it), which runs `buildAiResultMeta`, a WHITELIST. A field the
 * processor sets and the persister drops is a correct value that reaches
 * nobody (CLAUDE.md rule 5), so every case asserts on the SANITISED record:
 *
 *  - a success persists `pageMap`, with both invariants holding;
 *  - a failure after the first call carries it, counting that call;
 *  - a failure before any call carries none;
 *  - a record without it (an older worker: deploy skew) stays without it,
 *    with the positive control that it survives when present;
 *  - a malformed block is dropped whole or clamped, never repaired into a
 *    default.
 */
import { describe, expect, it } from "vitest";
import { sanitizeJobResults } from "@/lib/jobs/results";
import { buildAiResultMeta, type AiPageMapMeta } from "@/lib/jobs/ai-results";
import { PAGE_JOIN } from "@/lib/pdf/text";
import type { AiCompletionResult, AiProvider } from "../ai/provider";
import type { ProcessorInput } from "../processor/types";
import { aiResultsFromFailure } from "../processor/types";
import { createTranslateProcessor } from "../processor/translate";
import { TRANSLATE_CHARS_PER_OUTPUT_TOKEN } from "@/lib/jobs/translate-limits";
import { markerFor, separatorOverhead } from "./page-markers";
import type { TranslateExtractor } from "./reading-order";

const NL = String.fromCharCode(10);
const OPEN = `${NL}---${NL}`;
const CLOSE = `${NL}---`;

/** Nine short pages: three marked chunks under a ~1,000-character ceiling. */
const TEXTS = Array.from({ length: 9 }, (_, i) =>
  `Page ${i + 1} words `.repeat(20).trim(),
);
const extract: TranslateExtractor = async () => {
  const pages = TEXTS.map((text, i) => ({
    pageNumber: i + 1,
    text,
    characterCount: text.length,
  }));
  const text = TEXTS.join(PAGE_JOIN);
  return {
    pageCount: pages.length,
    pages,
    text,
    characterCount: text.length,
    hasText: true,
  };
};
const CHUNKED = {
  maxOutputTokens: Math.ceil(1_000 / TRANSLATE_CHARS_PER_OUTPUT_TOKEN),
};

const input: ProcessorInput = {
  tool: "translate-pdf",
  options: { targetLanguage: "fr" },
  inputs: [
    {
      fileId: "f1",
      filename: "paper.pdf",
      contentType: "application/pdf",
      bytes: new Uint8Array([1]),
    },
  ],
};

const LIMITED: AiCompletionResult = {
  ok: false,
  kind: "rate_limited",
  retryable: true,
  message: "slow down",
  usage: { inputTokens: 40, outputTokens: 0 },
};

/** Echoes call i's segment, or answers with `script[i]` when one is given. */
function scripted(script: (AiCompletionResult | "echo")[]) {
  const segments: string[] = [];
  const provider: AiProvider = {
    id: "anthropic",
    model: "claude-sonnet-5",
    async complete(request) {
      const content = request.messages[0]!.content;
      const segment = content.slice(
        content.indexOf(OPEN) + OPEN.length,
        content.lastIndexOf(CLOSE),
      );
      segments.push(segment);
      const step = script[Math.min(segments.length - 1, script.length - 1)]!;
      return step === "echo"
        ? {
            ok: true,
            text: segment,
            model: "claude-sonnet-5",
            usage: { inputTokens: 50, outputTokens: 10 },
          }
        : step;
    },
  };
  return { provider, segments };
}

function invariants(map: AiPageMapMeta) {
  const f = map.fellBack;
  expect(map.marked + f.collision + f.budget).toBe(map.multiPageChunks);
  expect(map.verified + f.missing + f.order + f.empty + map.unanswered).toBe(
    map.marked,
  );
}

/** Σ separatorOverhead over the markers literally present in a segment. */
function overheadIn(segment: string): number {
  let n = 0;
  for (let page = 2; page <= TEXTS.length; page += 1)
    if (segment.includes(markerFor(page))) n += separatorOverhead(page);
  return n;
}

describe("results.ai.pageMap on the persisted job record", () => {
  it("a success persists it, counted over the calls made, and both invariants hold", async () => {
    const { provider, segments } = scripted(["echo"]);
    const result = await createTranslateProcessor({
      extract,
      provider,
      limits: CHUNKED,
    }).process(input);
    expect(result.ok).toBe(true);
    const map = sanitizeJobResults(result.results)?.ai?.pageMap;
    expect(map, "the persister dropped pageMap").toBeDefined();
    expect(segments.length, "health: several calls").toBeGreaterThan(2);
    expect(map).toEqual({
      multiPageChunks: segments.length,
      marked: segments.length,
      verified: segments.length,
      unanswered: 0,
      fellBack: { collision: 0, budget: 0, missing: 0, order: 0, empty: 0 },
      markerCharacters: segments.reduce((n, s) => n + overheadIn(s), 0),
    });
    invariants(map!);
    expect(map!.markerCharacters).toBeGreaterThan(0);
  });

  it("a failure after the first call carries it, counting that call as unanswered", async () => {
    const { provider, segments } = scripted([LIMITED]);
    const result = await createTranslateProcessor({
      extract,
      provider,
      limits: CHUNKED,
    }).process(input);
    expect(result.ok).toBe(false);
    const map = sanitizeJobResults(result.results)?.ai?.pageMap;
    expect(map, "a post-spend failure dropped pageMap").toBeDefined();
    expect(segments).toHaveLength(1);
    expect(map).toEqual({
      multiPageChunks: 1,
      marked: 1,
      verified: 0,
      unanswered: 1,
      fellBack: { collision: 0, budget: 0, missing: 0, order: 0, empty: 0 },
      markerCharacters: overheadIn(segments[0]!),
    });
  });

  it("an interruption mid-document counts the failing call, not the segments after it", async () => {
    const { provider, segments } = scripted(["echo", LIMITED, "echo"]);
    const result = await createTranslateProcessor({
      extract,
      provider,
      limits: CHUNKED,
    }).process(input);
    expect(result.ok).toBe(true);
    expect(segments).toHaveLength(2);
    const map = sanitizeJobResults(result.results)?.ai?.pageMap;
    expect(map).toMatchObject({
      multiPageChunks: 2,
      marked: 2,
      verified: 1,
      unanswered: 1,
    });
    invariants(map!);
  });

  it("a failure before any call carries no page map", async () => {
    const { provider, segments } = scripted(["echo"]);
    const empty: TranslateExtractor = async () => ({
      pageCount: 1,
      pages: [{ pageNumber: 1, text: "", characterCount: 0 }],
      text: "",
      characterCount: 0,
      hasText: false,
    });
    const result = await createTranslateProcessor({
      extract: empty,
      provider,
    }).process(input);
    expect(result.ok).toBe(false);
    expect(segments).toHaveLength(0);
    expect(result.results?.ai?.pageMap).toBeUndefined();
  });
});

const WINDOW = {
  truncated: false,
  charactersSent: 100,
  charactersTotal: 100,
  totalPages: 3,
  lastCompletePage: 3,
  cutMidPage: false,
};
const GOOD: AiPageMapMeta = {
  multiPageChunks: 3,
  marked: 2,
  verified: 1,
  unanswered: 0,
  fellBack: { collision: 1, budget: 0, missing: 1, order: 0, empty: 0 },
  markerCharacters: 63,
};

describe("the persister's bound on pageMap", () => {
  it("deploy skew: a record without it stays without it, never defaulted", () => {
    const clean = sanitizeJobResults({ ai: { truncation: WINDOW } });
    expect(clean?.ai).toBeDefined();
    expect("pageMap" in clean!.ai!).toBe(false);
    // The failure carrier, from an old worker's run shape: none either.
    const failed = aiResultsFromFailure({ window: WINDOW });
    expect("pageMap" in failed!.ai!).toBe(false);
  });

  it("positive control: present, it survives exactly", () => {
    const clean = sanitizeJobResults({
      ai: { truncation: WINDOW, pageMap: GOOD },
    });
    expect(clean?.ai?.pageMap).toEqual(GOOD);
    expect(
      aiResultsFromFailure({ window: WINDOW, pageMap: GOOD })?.ai?.pageMap,
    ).toEqual(GOOD);
  });

  it("a malformed block is dropped whole or clamped, never repaired into a default", () => {
    const meta = (pageMap: unknown) =>
      buildAiResultMeta({
        truncation: WINDOW,
        pageMap: pageMap as AiPageMapMeta,
      }).pageMap;
    // Not an object, or no fellBack object: dropped.
    expect(meta("verified")).toBeUndefined();
    expect(meta({ ...GOOD, fellBack: undefined })).toBeUndefined();
    // A missing or non-numeric count: dropped, never read as 0.
    const { verified: _verified, ...noVerified } = GOOD;
    expect(meta(noVerified)).toBeUndefined();
    expect(meta({ ...GOOD, marked: "2" })).toBeUndefined();
    expect(
      meta({ ...GOOD, fellBack: { ...GOOD.fellBack, empty: null } }),
    ).toBeUndefined();
    // An unknown key shape (a renamed field): dropped.
    const { fellBack, ...rest } = GOOD;
    expect(
      meta({ ...rest, fellback: fellBack }),
      "a renamed fellBack",
    ).toBeUndefined();
    // Fractions are clamped to integers, and stay when the invariants hold.
    expect(meta({ ...GOOD, markerCharacters: 63.9 })).toEqual(GOOD);
    // A negative count is clamped to 0; the counts then no longer add up,
    // so the block is dropped rather than published as a false claim.
    expect(meta({ ...GOOD, verified: -1 })).toBeUndefined();
    // Both invariants are enforced.
    expect(meta({ ...GOOD, multiPageChunks: 4 })).toBeUndefined();
    expect(meta({ ...GOOD, unanswered: 1 })).toBeUndefined();
    // Positive control for this helper: the good block passes.
    expect(meta(GOOD)).toEqual(GOOD);
  });
});
