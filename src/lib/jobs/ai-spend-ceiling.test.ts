// @vitest-environment node
/**
 * The two ceilings, compared — which is the thing nobody had done.
 *
 * Ours is a token bound; OpenAI's is a dollar bound. Each was correct at its own
 * layer and they had never been put side by side, so **we could not say which
 * trips first.** That matters entirely: if the provider's cap binds first, ours
 * never fires — the balance runs out, calls fail as generic provider errors, and
 * the honest 503 in `AI_CEILING_REACHED_MESSAGE` never renders. A guard that
 * cannot fire, arriving through the FIGURE rather than the wiring.
 *
 * The blended price is unmeasured, so these tests do not assert which one wins.
 * They assert the things that ARE true today: the threshold is derived rather
 * than guessed, the unmeasured price is recorded as unmeasured, and nothing
 * claims ours binds first without evidence.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import {
  AI_BLENDED_PRICE_USD_PER_MTOK,
  AI_CEILING_BREAKEVEN_USD_PER_MTOK,
  AI_SPEND_CEILING,
  AI_SPEND_DAILY_TOKEN_CEILING,
  AI_SPEND_EXTERNAL_BOUND,
  AI_CEILING_MONTHLY_COST_USD,
  AI_PRICE_SOURCE,
  AI_CEILING_REACHED_MESSAGE,
  aiCeilingBindsFirst,
} from "./ai-spend-ceiling";
import { SUMMARY_LENGTHS } from "./summarize-pdf";
import { LENGTH_PLAN, runSummarize } from "@/lib/workers/summarize/engine";
import {
  DEFAULT_MAX_OUTPUT_TOKENS as CHAT_DEFAULT_MAX_OUTPUT_TOKENS,
  runChatWithPdf,
} from "@/lib/workers/chat-with-pdf/engine";
import {
  DEFAULT_MAX_OUTPUT_TOKENS as EXTRACT_DEFAULT_MAX_OUTPUT_TOKENS,
  runAiExtract,
} from "@/lib/workers/ai-extract/engine";
import { runTranslate } from "@/lib/workers/translate/engine";
import { TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS } from "./translate-limits";
import type {
  AiCompletionRequest,
  AiProvider,
} from "@/lib/workers/ai/provider";
import {
  ACCOUNT_CLAIMS,
  PERSONAL_CONDUCT_CLAIMS,
} from "@/tests/identity-claims";

describe("the token ceiling and the dollar cap are comparable", () => {
  it("derives the breakeven price from both bounds rather than stating one", () => {
    // $100 / (2,000,000 tokens/day × 30 days) = $1.667 per million tokens.
    // Below that price ours binds first; above it, OpenAI's does.
    const monthlyMtok = (AI_SPEND_DAILY_TOKEN_CEILING * 30) / 1_000_000;
    expect(AI_CEILING_BREAKEVEN_USD_PER_MTOK).toBeCloseTo(
      AI_SPEND_EXTERNAL_BOUND.monthlyCapUsd / monthlyMtok,
      10,
    );
    expect(AI_CEILING_BREAKEVEN_USD_PER_MTOK).toBeCloseTo(1.6667, 3);
  });

  it("answers YES from a measured price, not from an assumption", () => {
    // It answered "unknown" until the rate card was read on 2026-08-11. The
    // verdict is evidence now; the machinery that refuses to guess is unchanged
    // and is what makes the answer worth anything.
    expect(AI_BLENDED_PRICE_USD_PER_MTOK).toBe(1.2);
    expect(aiCeilingBindsFirst()).toBe("yes");
  });

  it("SELF-CHECKS that our ceiling costs less than the provider's cap", () => {
    // THE SECOND, INDEPENDENT BOUND, made executable. A constant has no
    // relationships for a structural defence to constrain, so the only thing
    // that can see a wrong number is a comparison against something outside it.
    //
    // This goes red — rather than the ceiling quietly becoming decoration — if
    // anyone raises `fullRunsPerDay`, if OpenAI's cap drops, or if the price
    // moves. Those are the three ways this feature silently stops bounding
    // anything, and none of them is visible in a diff.
    expect(
      AI_CEILING_MONTHLY_COST_USD,
      `our ceiling would cost $${AI_CEILING_MONTHLY_COST_USD}/month at ` +
        `$${AI_BLENDED_PRICE_USD_PER_MTOK}/Mtok, against OpenAI's ` +
        `$${AI_SPEND_EXTERNAL_BOUND.monthlyCapUsd} cap. The provider's bound ` +
        "would trip first, so the honest 503 would never render and the " +
        "balance would simply run out as generic provider errors.",
    ).toBeLessThan(AI_SPEND_EXTERNAL_BOUND.monthlyCapUsd);
    // $72 against $100 today — stated so the margin is visible, not just the pass.
    expect(AI_CEILING_MONTHLY_COST_USD).toBeCloseTo(72, 6);
  });

  it("records why the long-context rate is excluded", () => {
    // The question a future reader gets wrong: $1.80 exists on the rate card and
    // is not used. A blend can only reach it with 100% output at long-context
    // pricing, and long context is entered by a large INPUT priced well below
    // output — so the rate always arrives attached to what drags the blend down.
    expect(AI_PRICE_SOURCE.usedRateUsdPerMTok).toBe(1.2);
    expect(AI_PRICE_SOURCE.excludedRateUsdPerMTok).toBe(1.8);
    expect(AI_PRICE_SOURCE.excludedBecause.length).toBeGreaterThan(40);
    expect(AI_PRICE_SOURCE.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(AI_PRICE_SOURCE.model).toBe("gpt-5.6-luna");
  });

  it("resolves in both directions once a price exists", () => {
    // Proven with hypothetical inputs so the derivation is exercised without
    // inventing the real number. When the measurement lands, setting one
    // constant answers the question — no new logic.
    const decide = (price: number) =>
      price < AI_CEILING_BREAKEVEN_USD_PER_MTOK ? "yes" : "no";
    expect(decide(0.5)).toBe("yes");
    expect(decide(5)).toBe("no");
    // And the boundary is not silently inclusive.
    expect(decide(AI_CEILING_BREAKEVEN_USD_PER_MTOK)).toBe("no");
  });

  it("records the external bound with its provenance and a re-check route", () => {
    // It cannot be verified by any test — it lives in a billing console. So the
    // discipline is `densityMeasuredOn`'s: date it, name the source, and make
    // the staleness visible rather than implicit.
    expect(AI_SPEND_EXTERNAL_BOUND.monthlyCapUsd).toBeGreaterThan(0);
    expect(AI_SPEND_EXTERNAL_BOUND.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(AI_SPEND_EXTERNAL_BOUND.source.toLowerCase()).toContain("openai");
  });

  it("keeps the ceiling's own figure labelled provisional", () => {
    // Unchanged by this work, and it must stay labelled: the run count is still
    // the one invented factor, and the dollar comparison does not measure it.
    expect(AI_SPEND_CEILING.measuredOn).toBe("provisional");
  });
});

/**
 * The message a visitor reads when the GLOBAL ceiling is spent makes no claim
 * about who they are.
 *
 * This module is outside the copy walk (copy-surface.test.ts records why), so
 * account-honesty and allowance-copy never read it — and its wording was wrong
 * twice in the same family. Both ban lists run here, over the constant every
 * route returns, from the one shared definition. Each earlier wording is a
 * positive control: the check must catch the defect it exists for, or a
 * passing result says nothing.
 */
describe("the ceiling message makes no identity claim", () => {
  // Shipped until 2026-10-09: an account, on a product with no accounts.
  const HAD_AN_ACCOUNT =
    "AI features are temporarily unavailable — the service has reached its daily processing limit. This is a limit on our side, not on your file or your account. Please try again tomorrow; every other PDF tool is unaffected.";
  // Its first fix, the same day: an allowance the reader owns, when the
  // limiter counts a connection.
  const OWNED_THE_ALLOWANCE =
    "AI features are temporarily unavailable — the service has reached its daily processing limit. This is a limit on our side, not a problem with your file or your own allowance. Please try again tomorrow; every other PDF tool is unaffected.";

  const accountClaims = (text: string) =>
    ACCOUNT_CLAIMS.filter(({ pattern }) => pattern.test(text)).map(
      ({ label }) => label,
    );
  const conductClaims = (text: string) =>
    PERSONAL_CONDUCT_CLAIMS.filter(({ pattern }) => pattern.test(text)).map(
      ({ name }) => name,
    );

  it("positive controls: each earlier wording is caught by its list", () => {
    expect(accountClaims(HAD_AN_ACCOUNT)).toEqual([
      "a claim that the visitor has an account",
    ]);
    expect(conductClaims(OWNED_THE_ALLOWANCE)).toEqual([
      "a possessive over the allowance itself — whose runs these are",
    ]);
  });

  it("the shipped message carries neither", () => {
    expect(accountClaims(AI_CEILING_REACHED_MESSAGE)).toEqual([]);
    expect(conductClaims(AI_CEILING_REACHED_MESSAGE)).toEqual([]);
    // Still says what the docblock requires: whose limit it is, that it is
    // temporary, and that the file is fine.
    expect(AI_CEILING_REACHED_MESSAGE).toContain("a limit on our side");
    expect(AI_CEILING_REACHED_MESSAGE).toContain("try again tomorrow");
    expect(AI_CEILING_REACHED_MESSAGE).toContain(
      "not a problem with your file",
    );
  });
});

/**
 * `outputTokensPerFullRun` is described as "the most output tokens a single
 * run can produce", and the daily ceiling is derived from it. That sentence
 * is only true while no engine asks for more. Summarize's Detailed length
 * sends this figure since 2026-11-15 (audit summarize-pdf#2), so every
 * summarize length is bounded here, beside the definition it must not exceed.
 *
 * Chat (2,000) and extract (4,000) have their own fixed defaults and are not
 * covered by this test; they are below the figure today.
 */
describe("no summarize length asks for more than the per-run output figure", () => {
  it("bounds every summarize length's output budget by outputTokensPerFullRun", () => {
    // Health check: the set is DERIVED from the options the route accepts, and
    // must be the three lengths, so `[] <= X` cannot pass vacuously.
    expect([...SUMMARY_LENGTHS].sort()).toEqual(
      Object.keys(LENGTH_PLAN).sort(),
    );
    expect(SUMMARY_LENGTHS.length).toBe(3);
    for (const length of SUMMARY_LENGTHS) {
      expect(
        LENGTH_PLAN[length].tokens,
        `summarize ${length} asks for more output tokens than one run is allowed`,
      ).toBeLessThanOrEqual(AI_SPEND_CEILING.outputTokensPerFullRun);
    }
    // Positive control: the bound is tight, not merely satisfied by small
    // numbers. Detailed sits exactly on it, so a lower figure fails here.
    expect(LENGTH_PLAN.detailed.tokens).toBe(
      AI_SPEND_CEILING.outputTokensPerFullRun,
    );
  });
});

/**
 * The same sentence, made true for EVERY engine rather than for one.
 *
 * Summarize clamps its budget to the operator's `limits.maxOutputTokens`; until
 * 2026-11-16 chat, extract and translate sent `override ?? DEFAULT`, so a
 * raised override went straight to the provider, while each engine's own
 * docblock said the override "can only lower (never raise)" the default.
 * Nothing in production sets the override today, so it was a latent defect
 * plus three false comments. This runs each engine's REAL entry point with a
 * recording provider and an override far above every figure.
 *
 * The engines are DISCOVERED, not typed: every non-test file under
 * `src/lib/workers` that calls `<anything>.complete(` must be in `ENGINES`,
 * so a fifth AI engine fails here until it is run through the same check.
 * The receiver's NAME is not trusted (review, 2026-11-16: an engine calling
 * `deps.llm.complete(` walked past a scan keyed on `provider`). Any receiver
 * counts unless that exact file and receiver are on `NOT_A_MODEL_CALL`, with
 * the reason written down, so an unknown receiver fails loudly.
 */
describe("every AI engine sends at most the per-run output figure", () => {
  const WORKERS_ROOT = path.join(process.cwd(), "src", "lib", "workers");
  const COMPLETE_CALL = /([A-Za-z_$][\w$]*)\s*\.\s*complete\s*\(/g;
  /** `file:receiver` pairs whose `.complete(` is not a model call. */
  const NOT_A_MODEL_CALL: Record<string, string> = {
    "executor/executor.ts:queue": "the job queue marking a job done",
  };
  const TEXT = "Plenty of real document text here for the model to work on.";
  const INPUT = new Uint8Array([1, 2, 3, 4]);
  const RAISED = 1_000_000;

  /** The files among `files` that call a provider. Pure, so it can be fed. */
  function providerCallSites(
    files: readonly { path: string; text: string }[],
  ): string[] {
    // Comments are stripped first: a docblock that NAMES the call (as
    // `../ai/output-budget.ts` does) is not an engine. The first run of this
    // guard found exactly that file.
    const code = (text: string) =>
      text.replace(/\/\*[\s\S]*?\*\/|(^|[^:\\])\/\/[^\n]*/g, "$1");
    return files
      .filter((file) =>
        [...code(file.text).matchAll(COMPLETE_CALL)].some(
          (m) => !(`${file.path}:${m[1]}` in NOT_A_MODEL_CALL),
        ),
      )
      .map((file) => file.path)
      .sort();
  }

  function walkSources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walkSources(full);
      const isSource =
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".d.ts");
      return isSource ? [full] : [];
    });
  }

  /** Every engine file, relative to `src/lib/workers`, with `/` separators. */
  function discoverEngineFiles(): string[] {
    // A broken scan is FATAL, never an empty set: `[] ⊆ ENGINES` would pass.
    if (!existsSync(WORKERS_ROOT))
      throw new Error(`scan root is missing: ${WORKERS_ROOT}`);
    const sources = walkSources(WORKERS_ROOT);
    if (sources.length < 50)
      throw new Error(
        `scanned only ${sources.length} worker sources; the walk is broken`,
      );
    return providerCallSites(
      sources.map((full) => ({
        path: path.relative(WORKERS_ROOT, full).split(path.sep).join("/"),
        text: readFileSync(full, "utf8"),
      })),
    );
  }

  function recordingProvider(text: string) {
    const calls: AiCompletionRequest[] = [];
    const provider: AiProvider = {
      id: "anthropic",
      model: "claude-sonnet-5",
      async complete(request) {
        calls.push(request);
        return {
          ok: true,
          text,
          model: "claude-sonnet-5",
          usage: { inputTokens: 100, outputTokens: 20 },
        };
      },
    };
    return { calls, provider };
  }

  function extractor(): () => Promise<ExtractedPdfText> {
    return async () => ({
      pageCount: 2,
      pages: [],
      text: TEXT,
      characterCount: TEXT.length,
      hasText: true,
    });
  }

  type Limits = { maxOutputTokens?: number };
  interface EngineCase {
    label: string;
    /** The engine's own definition of its default: imported, never typed. */
    defaultTokens: number;
    run: (limits: Limits) => Promise<AiCompletionRequest[]>;
  }

  /** Keyed by the file `discoverEngineFiles` must find. */
  const ENGINES: Record<string, EngineCase[]> = {
    "ai-extract/engine.ts": [
      {
        label: "ai-extract",
        defaultTokens: EXTRACT_DEFAULT_MAX_OUTPUT_TOKENS,
        run: async (limits) => {
          const { calls, provider } = recordingProvider('{"total": 1}');
          await runAiExtract(
            INPUT,
            { mode: "prompt", prompt: "Extract the total." },
            { extract: extractor(), provider, limits },
          );
          return calls;
        },
      },
    ],
    "chat-with-pdf/engine.ts": [
      {
        label: "chat-with-pdf",
        defaultTokens: CHAT_DEFAULT_MAX_OUTPUT_TOKENS,
        run: async (limits) => {
          const { calls, provider } = recordingProvider("Answer.");
          await runChatWithPdf(
            INPUT,
            { question: "What is the total?" },
            { extract: extractor(), provider, limits },
          );
          return calls;
        },
      },
    ],
    "summarize/engine.ts": SUMMARY_LENGTHS.map((length) => ({
      label: `summarize ${length}`,
      defaultTokens: LENGTH_PLAN[length].tokens,
      run: async (limits: Limits) => {
        const { calls, provider } = recordingProvider("A summary.");
        await runSummarize(
          INPUT,
          { length, format: "paragraphs" },
          { extract: extractor(), provider, limits },
        );
        return calls;
      },
    })),
    "translate/engine.ts": [
      {
        label: "translate",
        defaultTokens: TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS,
        run: async (limits) => {
          const { calls, provider } = recordingProvider("Une traduction.");
          await runTranslate(
            INPUT,
            { targetLanguage: "fr", sourceLanguage: "auto" },
            { extract: extractor(), provider, limits },
          );
          return calls;
        },
      },
    ],
  };
  const CASES = Object.values(ENGINES).flat();

  it("positive and negative controls: the scan sees a provider call, and only a provider call", () => {
    expect(
      providerCallSites([
        { path: "fake/engine.ts", text: "await provider.complete({ x });" },
        { path: "fake/spaced.ts", text: "provider\n  .complete(request)" },
        { path: "fake/renamed.ts", text: "return deps.llm.complete({ x });" },
        {
          path: "executor/executor.ts",
          text: "await queue.complete(job.id);",
        },
        // The exemption is per FILE: the same receiver elsewhere counts.
        { path: "elsewhere.ts", text: "await queue.complete(job.id);" },
        { path: "other.ts", text: "const myprovider = 1; complete();" },
        { path: "doc.ts", text: "/** calls `provider.complete(` */ x();" },
        { path: "line.ts", text: "// provider.complete(request)\nx();" },
      ]),
    ).toEqual([
      "elsewhere.ts",
      "fake/engine.ts",
      "fake/renamed.ts",
      "fake/spaced.ts",
    ]);
  });

  it("discovers a plausible set of engines, and runs every one of them", () => {
    const discovered = discoverEngineFiles();
    // Health check: neither a collapsed nor an exploded scan passes.
    expect(discovered.length).toBeGreaterThanOrEqual(3);
    expect(discovered.length).toBeLessThanOrEqual(10);
    const notRun = discovered.filter((file) => !(file in ENGINES));
    expect(
      notRun,
      "a file the ceiling test does not run calls .complete( on a receiver " +
        "that is not on NOT_A_MODEL_CALL; add it to ENGINES so its output " +
        "budget is bounded, or exempt it there with the reason",
    ).toEqual([]);
    const stale = Object.keys(ENGINES).filter(
      (file) => !discovered.includes(file),
    );
    expect(
      stale,
      "ENGINES names a file that no longer calls a provider",
    ).toEqual([]);
  });

  it("every default is at most the per-run figure, and the figures are unchanged", () => {
    for (const engine of CASES) {
      expect(engine.defaultTokens, engine.label).toBeLessThanOrEqual(
        AI_SPEND_CEILING.outputTokensPerFullRun,
      );
    }
    // Translate's default IS the figure (the figure is defined from it).
    expect(TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS).toBe(
      AI_SPEND_CEILING.outputTokensPerFullRun,
    );
    // This change clamps; it does not move a default.
    expect(CHAT_DEFAULT_MAX_OUTPUT_TOKENS).toBe(2000);
    expect(EXTRACT_DEFAULT_MAX_OUTPUT_TOKENS).toBe(4000);
    expect(TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS).toBe(8000);
  });

  it("a raised override is ignored: each engine sends its default, never more than the figure", async () => {
    expect(CASES.length).toBeGreaterThanOrEqual(Object.keys(ENGINES).length);
    for (const engine of CASES) {
      const calls = await engine.run({ maxOutputTokens: RAISED });
      expect(
        calls.length,
        `${engine.label} never reached the provider`,
      ).toBeGreaterThan(0);
      for (const call of calls) {
        expect(
          call.maxOutputTokens,
          `${engine.label} sent more output tokens than one run is allowed`,
        ).toBeLessThanOrEqual(AI_SPEND_CEILING.outputTokensPerFullRun);
        expect(call.maxOutputTokens, engine.label).toBe(engine.defaultTokens);
      }
    }
  });

  it("a lower override still lowers what each engine sends", async () => {
    for (const engine of CASES) {
      const lower = Math.floor(engine.defaultTokens / 2);
      const calls = await engine.run({ maxOutputTokens: lower });
      expect(
        calls.length,
        `${engine.label} never reached the provider`,
      ).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.maxOutputTokens, engine.label).toBe(lower);
      }
    }
  });
});
