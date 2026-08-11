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
const SHARED_CAP_PANELS = [
  "src/components/tools/summarize-worker-panel.tsx",
  "src/components/tools/chat-with-pdf-worker-panel.tsx",
  "src/components/tools/ai-extract-worker-panel.tsx",
];

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

  it.each([
    ["4 pages", 13_528, "45s"],
    ["5 pages", 16_910, "54s"],
    ["6 pages", 20_292, "61s"],
    ["40 pages", 135_280, "49s"],
  ])(
    "refuses %s / %i chars, which failed in %s on production",
    (_pp, chars) => {
      // Every one of these reached the provider, was billed, and came back
      // "reached its output limit". The 4-page case is the near boundary: the
      // first published ceiling (21,538) would have admitted three of these four.
      expect(TRANSLATE_MAX_INPUT_CHARS).toBeLessThan(chars);
    },
  );

  it("sits inside the measured bracket, which is the whole claim", () => {
    // The true boundary is somewhere in (10,258, 13,528). Any ceiling in that
    // gap is defensible; anything outside it contradicts an observation.
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
