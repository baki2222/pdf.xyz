import { describe, expect, it } from "vitest";
import {
  DEFAULT_OCR_LANGUAGE,
  MAX_OCR_LANGUAGES,
  OCR_LANGUAGE_CODES,
  parseOcrOptions,
  parsePdfToWordOptions,
  PDF_TO_WORD_OCR_LANGUAGE_CODES,
  PDF_TO_WORD_RTL_REFUSAL,
  RTL_OCR_LANGUAGES,
} from "./ocr";

const field = (r: ReturnType<typeof parsePdfToWordOptions>) =>
  r.ok ? null : (r.error.body.error.details?.[0]?.field ?? null);

describe("parsePdfToWordOptions", () => {
  it("{} is today's job: no OCR, no languages", () => {
    expect(parsePdfToWordOptions({})).toEqual({
      ok: true,
      value: { ocr: false, languages: [] },
    });
  });

  it("OCR on defaults to OCR's own default language", () => {
    const r = parsePdfToWordOptions({ ocr: true });
    expect(r.ok && r.value).toEqual({
      ocr: true,
      languages: [DEFAULT_OCR_LANGUAGE],
    });
  });

  it("validates languages with OCR PDF's own rules — same verdicts, same messages", () => {
    const tooMany = OCR_LANGUAGE_CODES.slice(0, MAX_OCR_LANGUAGES + 1);
    for (const languages of [["xx"], [], tooMany, [OCR_LANGUAGE_CODES[1]]]) {
      const word = parsePdfToWordOptions({ ocr: true, languages });
      const ocr = parseOcrOptions({ languages });
      expect(word.ok).toBe(ocr.ok);
      if (!word.ok && !ocr.ok)
        expect(word.error.body.error.message).toBe(
          ocr.error.body.error.message,
        );
    }
  });

  // Arabic was accepted here until 2026-10-25, when the first in-image proof
  // that read the DOCX back found its words missing. Withheld, by name.
  it("refuses a right-to-left language, and offers every other OCR language", () => {
    for (const code of RTL_OCR_LANGUAGES) {
      const r = parsePdfToWordOptions({ ocr: true, languages: ["eng", code] });
      expect(r.ok, code).toBe(false);
      if (!r.ok)
        expect(r.error.body.error.message).toBe(PDF_TO_WORD_RTL_REFUSAL);
    }
    expect(PDF_TO_WORD_OCR_LANGUAGE_CODES.length).toBe(
      OCR_LANGUAGE_CODES.length - RTL_OCR_LANGUAGES.length,
    );
    for (const code of PDF_TO_WORD_OCR_LANGUAGE_CODES)
      expect(parsePdfToWordOptions({ ocr: true, languages: [code] }).ok).toBe(
        true,
      );
  });

  it("refuses a non-boolean ocr, and languages sent without ocr", () => {
    expect(field(parsePdfToWordOptions({ ocr: "yes" }))).toBe("options.ocr");
    expect(field(parsePdfToWordOptions({ languages: ["eng"] }))).toBe(
      "options.languages",
    );
  });
});
