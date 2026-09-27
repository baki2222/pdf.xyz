// @vitest-environment node
/**
 * Translate's ceiling and the other three tools' input cap must stay apart.
 *
 * They were the same number until 2026-08-11, and that de-duplication was right
 * for three tools and wrong for the fourth. `AI_INPUT_LIMITS.maxInputCharacters`
 * caps READING: summarize, chat and extract take a lot in and give a short answer
 * back, so it binds them. **Translate's output is as long as its input**, so what
 * stops it is how much the model may WRITE — and nothing distinguished the two,
 * because the shared constant's name is about reading.
 *
 * Measured on production: translate advertised 500,000 characters and failed at
 * 135,280 after 49 seconds and one of three daily AI runs.
 *
 * Every failure message here names WHICH TOOL and WHICH QUANTITY, because
 * "a number is wrong" is not something the next person can act on.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AI_INPUT_LIMITS } from "@/lib/jobs/types";
import {
  TRANSLATE_CALIBRATION,
  TRANSLATE_CHARS_PER_OUTPUT_TOKEN,
  TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS,
  TRANSLATE_MAX_INPUT_CHARS,
  translateMaxInputChars,
} from "@/lib/jobs/translate-limits";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const PANEL = "src/components/tools/translate-worker-panel.tsx";
/**
 * INVERTED 2026-09-27 for the chat panel, history kept: it was listed here and
 * this file demanded it state the shared 500,000 reading cap "which is correct
 * for it" — while each chat question was charged 41,032 and read up to twelve
 * times that. Bounding chat's read to its charge turned this red; chat's panel
 * now has its own assertion below, and `ai-ceiling-surfaces.test.ts` derives
 * the relationship for every AI panel.
 */
const SHARED_CAP_PANELS = [
  "src/components/tools/summarize-worker-panel.tsx",
  "src/components/tools/ai-extract-worker-panel.tsx",
];
const CHAT_PANEL = "src/components/tools/chat-with-pdf-worker-panel.tsx";

describe("translate's ceiling is derived, not typed", () => {
  it("is a function of the output budget, so raising the budget raises it", () => {
    // A frozen constant would become the same lie one notch over the moment
    // anyone changed the budget.
    expect(TRANSLATE_MAX_INPUT_CHARS).toBe(
      translateMaxInputChars(TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS),
    );
    // Scales with the budget. Asserted as a property rather than a literal:
    // the exact value depends on where the floor lands, and pinning that would
    // be pinning a rounding artifact instead of the relationship that matters.
    const doubled = translateMaxInputChars(
      TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS * 2,
    );
    expect(doubled).toBeGreaterThanOrEqual(TRANSLATE_MAX_INPUT_CHARS * 2 - 1);
    expect(doubled).toBeLessThanOrEqual(TRANSLATE_MAX_INPUT_CHARS * 2 + 1);
  });

  it("refuses to produce a ceiling from a nonsense budget", () => {
    expect(translateMaxInputChars(0)).toBe(0);
    expect(translateMaxInputChars(-1)).toBe(0);
    expect(translateMaxInputChars(Number.NaN)).toBe(0);
  });

  it.each([["3 pages", 10_258, "completed in 36s"]])(
    "accepts %s / %i chars, which %s on production",
    (_pp, chars) => {
      // A ceiling below this refuses work we have WATCHED succeed.
      expect(TRANSLATE_MAX_INPUT_CHARS).toBeGreaterThanOrEqual(chars);
    },
  );

  // DRAWN characters — the fixture generator's own accumulator, NOT extracted.
  // Deliberately left in that unit rather than half-converted: only the 4-page
  // case was ever extracted (13,678), and converting one row would rebuild the
  // mixed-unit table this whole exercise came from. It is safe here because the
  // assertion is one-sided and extraction only ADDS: ceiling < drawn implies
  // ceiling < extracted, so every row holds a fortiori in either unit. The
  // bracket test below is the one that needs a single unit, and it has one.
  it.each([
    ["4 pages", 13_528, "45s"],
    ["5 pages", 16_910, "54s"],
    ["6 pages", 20_292, "61s"],
    ["40 pages", 135_280, "49s"],
  ])(
    "refuses %s / %i drawn chars, which failed in %s on production",
    (_pp, chars) => {
      // Every one of these reached the provider, was billed, and came back
      // "reached its output limit". The 4-page case is the near boundary: the
      // first published ceiling (21,538) would have admitted three of these four.
      expect(TRANSLATE_MAX_INPUT_CHARS).toBeLessThan(chars);
    },
  );

  it("sits inside the measured bracket, in ONE unit", () => {
    // The true boundary is somewhere in (10,258, 13,678). Any ceiling in that
    // gap is defensible; anything outside it contradicts an observation.
    //
    // Both ends are WORKER-EXTRACTED characters, and that is load-bearing: they
    // used to be recorded from different sources (the success from the product's
    // truncation block, the failure from the fixture generator) in the same
    // table. A bracket whose ends are in different units is not a bracket.
    expect(TRANSLATE_MAX_INPUT_CHARS).toBeGreaterThanOrEqual(
      TRANSLATE_CALIBRATION.largestSuccessChars,
    );
    expect(TRANSLATE_MAX_INPUT_CHARS).toBeLessThan(
      TRANSLATE_CALIBRATION.smallestFailureChars,
    );
  });

  it("records the language and date it was calibrated on", () => {
    // A factor whose calibration language is unrecorded is the same defect as an
    // uncalibrated one: the next person cannot tell whether it still holds. The
    // rate is a property of the TARGET language, and this one is Spanish.
    expect(TRANSLATE_CALIBRATION.targetLanguage).toBe("es");
    expect(TRANSLATE_CALIBRATION.measuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(TRANSLATE_CALIBRATION.model.length).toBeGreaterThan(0);
  });

  it("is the measurement, not two factors multiplied together", () => {
    // The first published ceiling multiplied ~3.5 chars/token by ~1.3 expansion
    // and got 2.69 where the truth is 1.28 — two defensible guesses compounding
    // into a number 1.8x too generous. One end-to-end rate cannot compound.
    expect(TRANSLATE_CHARS_PER_OUTPUT_TOKEN).toBeCloseTo(
      TRANSLATE_CALIBRATION.largestSuccessChars /
        TRANSLATE_CALIBRATION.outputTokenBudget,
      10,
    );
    expect(TRANSLATE_CHARS_PER_OUTPUT_TOKEN).toBeLessThan(3.5 / 1.3);
  });
});

describe("the two numbers cannot drift back together", () => {
  it("translate's ceiling is NOT the shared AI input cap", () => {
    expect(
      TRANSLATE_MAX_INPUT_CHARS,
      "Translate PDF's ceiling is bounded by the model's OUTPUT budget, not by " +
        "AI_INPUT_LIMITS.maxInputCharacters. If these are equal again, translate " +
        "is advertising a reading cap it cannot honour — that cost a user 49 " +
        "seconds and one of three daily AI runs on 2026-08-11.",
    ).not.toBe(AI_INPUT_LIMITS.maxInputCharacters);
    expect(TRANSLATE_MAX_INPUT_CHARS).toBeLessThan(
      AI_INPUT_LIMITS.maxInputCharacters,
    );
  });

  it("the translate panel states TRANSLATE's number and not the shared one", () => {
    const source = read(PANEL);
    expect(
      source,
      `${PANEL} must state TRANSLATE_MAX_INPUT_CHARS in its Limit row — the ` +
        "quantity translate is bounded by is characters TRANSLATED, not characters read.",
    ).toContain("TRANSLATE_MAX_INPUT_CHARS");
    expect(
      source,
      `${PANEL} must not state AI_INPUT_LIMITS.maxInputCharacters: that is the ` +
        "READING cap the other three AI tools are bounded by, and it is ~23x " +
        "translate's real capacity.",
    ).not.toContain("AI_INPUT_LIMITS");
  });

  it.each(SHARED_CAP_PANELS)(
    "%s still states the shared reading cap, which is correct for it",
    (panel) => {
      const source = read(panel);
      expect(
        source,
        `${panel} is bounded by READING, so AI_INPUT_LIMITS.maxInputCharacters ` +
          "is its true limit and must stay.",
      ).toContain("AI_INPUT_LIMITS.maxInputCharacters");
      expect(
        source,
        `${panel} must not borrow translate's OUTPUT-derived ceiling.`,
      ).not.toContain("TRANSLATE_MAX_INPUT_CHARS");
    },
  );

  it("the chat panel states CHAT's per-question number and neither of the others", () => {
    const source = read(CHAT_PANEL);
    expect(source).toContain("CHAT_MAX_CHARACTERS_PER_QUESTION");
    expect(
      source,
      `${CHAT_PANEL} states the shared reading cap again — chat reads no more ` +
        "than one question is charged",
    ).not.toContain("AI_INPUT_LIMITS");
    expect(source).not.toContain("TRANSLATE_MAX_INPUT_CHARS");
  });

  it("the engine sends the budget the ceiling was derived from", () => {
    // If the engine's default and the published ceiling stop sharing a source,
    // the advertised number stops describing the request that is actually made.
    const engine = read("src/lib/workers/translate/engine.ts");
    expect(
      engine,
      "translate/engine.ts must take its output budget from " +
        "TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS, or the advertised ceiling and the " +
        "request it describes can diverge.",
    ).toContain("TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS");
  });
});

/*
 * ── After chunking: the ceiling bounds a PASS, not a document ────────────────
 *
 * `TRANSLATE_MAX_INPUT_CHARS` used to be the largest document the tool would
 * accept, and every surface said so. It is now the largest amount ONE provider
 * call may be asked to write; a longer document is split at page boundaries and
 * reassembled. Two things can go wrong with that, and neither is visible in a
 * diff:
 *
 *  1. **A surface still says a long document is refused.** That was true and is
 *     now a false claim about the product — the same stale-sentence family this
 *     file already guards the NUMBER against, one level up at the sentence.
 *  2. **The browser panel refuses what the worker would accept.** The panel
 *     checks before uploading, so a stricter panel makes the worker's chunking
 *     unreachable — a capability that exists everywhere except where a user can
 *     get to it. Both sides therefore run the SAME planner.
 */
describe("the published ceiling describes a pass, not a document", () => {
  it("no surface claims a long document is refused outright", () => {
    // The old sentence: "A longer document is refused ... rather than
    // translated in part; split it into smaller files and run them one at a
    // time." Every word of that was accurate before chunking.
    const surfaces = [
      "src/lib/tools/tool-facts.ts",
      "src/components/tools/translate-worker-panel.tsx",
    ];
    for (const file of surfaces) {
      const source = read(file);
      for (const claim of [
        /longer document is refused/i,
        /rather than translated in part/i,
      ]) {
        expect(
          claim.test(source),
          `${file} still tells the reader a long document is refused. It is now ` +
            "split at page boundaries and translated a few pages at a time; the " +
            "only thing refused is a SINGLE page over the ceiling.",
        ).toBe(false);
      }
    }
  });

  it("the FAQ names what IS still refused, so the ceiling stays actionable", () => {
    // Removing the false claim must not leave the reader with no bound at all.
    // A single oversize page is genuinely untranslatable and they need to know.
    const facts = read("src/lib/tools/tool-facts.ts");
    expect(facts).toMatch(/SINGLE page/);
    expect(facts).toMatch(/skipped/i);
  });

  it("the FAQ names the SECOND bound, which the delivery cap created", () => {
    /**
     * "A LONGER DOCUMENT IS NOT REFUSED: it is split at page boundaries" was
     * true the day it was written and the delivery cap made it conditional.
     * A job now stops where its reservation stops, and a job whose reservation
     * covers no page is refused outright — so a reader told only about the
     * single-oversize-page case has been told the old truth.
     *
     * This is the same shape as the claim the test above exists to have
     * removed, one release later: not a wrong sentence, a sentence the system
     * grew past. Two independent patterns rather than one phrase, so a rewrite
     * has to keep the MEANING rather than the wording.
     */
    const facts = read("src/lib/tools/tool-facts.ts");
    expect(
      facts,
      "the translate FAQ does not mention the daily allowance, so it still " +
        "reads as though length is the only bound on how far a translation gets",
    ).toMatch(/daily allowance/i);
    expect(
      facts,
      "the FAQ does not say what happens to the part the allowance does not " +
        "cover — a bound with no stated consequence is not actionable",
    ).toMatch(/marked in place|says so in place|the reason named/i);
  });

  it("the panel refuses on the SAME plan the worker refuses on", () => {
    // Not "the panel mentions chunking" — the panel must call the same planner,
    // or two hand-written versions of "does this fit" drift and the stricter
    // one silently hides the other.
    const CHUNKING = "src/lib/workers/translate/chunking.ts";
    const panel = read("src/components/tools/translate-worker-panel.tsx");
    expect(
      panel,
      "the translate panel must plan with planTranslateChunks, or its pre-upload " +
        "refusal can be stricter than the worker and make chunking unreachable",
    ).toContain("planTranslateChunks");
    expect(
      panel,
      "the panel plans with something other than the worker's chunking module",
    ).toContain('from "@/lib/workers/translate/chunking"');

    /**
     * THE ENGINE'S ASSERTION WAS A STRING, AND THE STRING MOVED.
     *
     * It used to read `expect(engine).toContain("planTranslateChunks")`, and
     * the delivery cap turned the engine's call into `capPagesToDelivery`,
     * which plans the pages it allows. The PROPERTY did not change for a
     * moment — both sides still plan with the one planner — but the guard went
     * red, and a guard that goes red when nothing broke gets relaxed by
     * whoever is in a hurry.
     *
     * So it pins the relationship instead of the name: the engine plans
     * through the panel's module, and whatever that module wraps the planner in
     * must actually call the planner rather than reimplement it. The
     * behavioural half — an unbounded cap producing byte-identical plans to the
     * bare planner — is proven over generated documents in
     * `translate/chunking.cap.test.ts`.
     */
    const engine = read("src/lib/workers/translate/engine.ts");
    expect(
      engine,
      "the engine no longer plans through the module the panel plans with",
    ).toContain('from "./chunking"');
    const planner = /planTranslateChunks|capPagesToDelivery/.test(engine);
    expect(
      planner,
      "the engine plans with neither the shared planner nor its delivery-capped wrapper",
    ).toBe(true);
    const chunking = read(CHUNKING);
    expect(
      /export function capPagesToDelivery[\s\S]*?planTranslateChunks\(/.test(
        chunking,
      ),
      "capPagesToDelivery no longer delegates to planTranslateChunks — the two " +
        "sides can now disagree about what fits while both look correct",
    ).toBe(true);
  });
});
