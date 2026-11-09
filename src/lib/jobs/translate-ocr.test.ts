// @vitest-environment node
/**
 * The price a scan's copy states is the price the route charges, in the unit
 * the page publishes the allowance in (CLAUDE.md rule 3: a constant has no
 * relationships, so it gets a second, independent bound written as a test).
 */
import { describe, expect, it } from "vitest";
import {
  AI_CHARACTER_ALLOWANCE,
  AI_CHARACTER_ALLOWANCE_DELIVERED,
  AI_JOB_DELIVERY_LIMITS,
} from "./ai-allowance";
import { aiReservationGiven } from "./delivery-cap";
import { TRANSLATE_MAX_INPUT_CHARS } from "./translate-limits";
import { parseTranslateOptions } from "./translate-pdf";
import { PDF_TO_WORD_RTL_REFUSAL } from "./ocr";
import {
  TRANSLATE_OCR_CHARGE,
  TRANSLATE_OCR_CHARGE_PUBLISHED,
  TRANSLATE_OCR_CHARGE_SENTENCE,
  TRANSLATE_OCR_EXPLAINER,
} from "./translate-ocr";

describe("what a scan costs", () => {
  it("is exactly what the route reserves for an undeclared translate job carrying an OCR request", () => {
    // The body the panel sends for a scan: no declaration, an OCR request.
    const reservation = aiReservationGiven(
      "translate-pdf",
      { options: { targetLanguage: "en", ocr: true, languages: ["deu"] } },
      AI_JOB_DELIVERY_LIMITS,
      false,
    );
    expect(reservation.charge).toBe(TRANSLATE_OCR_CHARGE);
    // ...and the cap the worker applies to the RECOGNISED text is that charge.
    expect(reservation.delivery?.characters).toBe(TRANSLATE_OCR_CHARGE);
  });

  it("in the page's unit is one full pass, a whole number, and fits the published day", () => {
    expect(Number.isInteger(TRANSLATE_OCR_CHARGE_PUBLISHED)).toBe(true);
    expect(TRANSLATE_OCR_CHARGE_PUBLISHED).toBe(TRANSLATE_MAX_INPUT_CHARS);
    expect(TRANSLATE_OCR_CHARGE_PUBLISHED).toBeLessThanOrEqual(
      AI_CHARACTER_ALLOWANCE_DELIVERED,
    );
    // The bucket unit and the page unit differ by the headroom: the charge
    // in the bucket must fit the bucket the same way.
    expect(TRANSLATE_OCR_CHARGE / AI_CHARACTER_ALLOWANCE).toBeCloseTo(
      TRANSLATE_OCR_CHARGE_PUBLISHED / AI_CHARACTER_ALLOWANCE_DELIVERED,
      10,
    );
  });

  it("the copy states the page-unit figure beside the published day, never the bucket's", () => {
    const fmt = (n: number) => n.toLocaleString("en-US");
    for (const sentence of [
      TRANSLATE_OCR_EXPLAINER,
      TRANSLATE_OCR_CHARGE_SENTENCE,
    ]) {
      expect(sentence).toContain(fmt(TRANSLATE_OCR_CHARGE_PUBLISHED));
      expect(sentence).toContain(fmt(AI_CHARACTER_ALLOWANCE_DELIVERED));
      // The first draft's defect: 41,032 beside a day of 30,774.
      expect(sentence).not.toContain(fmt(TRANSLATE_OCR_CHARGE));
    }
  });
});

describe("the OCR request in a translate options bag", () => {
  it("is validated by PDF to Word's parser: a right-to-left language gets its typed refusal", () => {
    const parsed = parseTranslateOptions({
      targetLanguage: "en",
      ocr: true,
      languages: ["urd"],
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.body.error.code).toBe("unprocessable_entity");
      expect(parsed.error.body.error.message).toBe(PDF_TO_WORD_RTL_REFUSAL);
    }
  });

  it("an unknown language and too many languages are refused; a good one passes", () => {
    expect(
      parseTranslateOptions({
        targetLanguage: "en",
        ocr: true,
        languages: ["xx"],
      }).ok,
    ).toBe(false);
    expect(
      parseTranslateOptions({
        targetLanguage: "en",
        ocr: true,
        languages: ["eng", "deu", "fra", "spa", "ita"],
      }).ok,
    ).toBe(false);
    expect(
      parseTranslateOptions({
        targetLanguage: "en",
        ocr: true,
        languages: ["deu"],
      }).ok,
    ).toBe(true);
  });

  it("control: a bag with no OCR key parses exactly as before", () => {
    expect(parseTranslateOptions({ targetLanguage: "en" })).toEqual({
      ok: true,
      value: { targetLanguage: "en", sourceLanguage: "auto" },
    });
  });
});
