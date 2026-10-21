// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_OCR_LANGUAGES, OCR_LANGUAGE_CODES } from "./ocr";
import {
  OCR_LANGUAGE_BY_BCP47,
  ocrLanguagesFromBrowser,
} from "./ocr-browser-languages";

/**
 * OCR against the wrong language returns fluent garbage and a completed job,
 * so the panel preselects what the reader's browser says they read (spec
 * D.7): `navigator.languages ∩ OCR_LANGUAGES`, English always kept, at most
 * `MAX_OCR_LANGUAGES`.
 */
describe("ocrLanguagesFromBrowser", () => {
  it("the map reaches every OCR language, and only OCR languages (both ways)", () => {
    const reached = new Set(Object.values(OCR_LANGUAGE_BY_BCP47));
    expect(reached).toEqual(new Set(OCR_LANGUAGE_CODES));
  });

  it("keeps English and adds the reader's languages, in their order", () => {
    expect(ocrLanguagesFromBrowser(["bn-BD", "en-US"])).toEqual(["ben", "eng"]);
    expect(ocrLanguagesFromBrowser(["de-DE", "de", "fr"])).toEqual([
      "deu",
      "fra",
      "eng",
    ]);
  });

  it("is English alone for an English, unknown or empty list", () => {
    expect(ocrLanguagesFromBrowser(["en-GB", "en"])).toEqual(["eng"]);
    expect(ocrLanguagesFromBrowser(["xx-YY", "tlh"])).toEqual(["eng"]);
    expect(ocrLanguagesFromBrowser([])).toEqual(["eng"]);
  });

  it("caps at MAX_OCR_LANGUAGES with English inside the cap", () => {
    const picked = ocrLanguagesFromBrowser([
      "es",
      "fr",
      "de",
      "it",
      "pt",
      "nl",
    ]);
    expect(picked.length).toBe(MAX_OCR_LANGUAGES);
    expect(picked).toContain("eng");
    expect(picked.slice(0, MAX_OCR_LANGUAGES - 1)).toEqual([
      "spa",
      "fra",
      "deu",
    ]);
  });

  it("reads Simplified Chinese and not Traditional", () => {
    expect(ocrLanguagesFromBrowser(["zh-CN"])).toEqual(["chi_sim", "eng"]);
    expect(ocrLanguagesFromBrowser(["zh-Hans-SG"])).toEqual(["chi_sim", "eng"]);
    expect(ocrLanguagesFromBrowser(["zh-TW", "zh-Hant"])).toEqual(["eng"]);
  });
});
