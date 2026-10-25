// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_OCR_LANGUAGES, OCR_LANGUAGE_CODES } from "./ocr";
import {
  OCR_LANGUAGE_BY_BCP47,
  TRADITIONAL_CHINESE_PACK,
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
    const reached = new Set([
      ...Object.values(OCR_LANGUAGE_BY_BCP47),
      TRADITIONAL_CHINESE_PACK,
    ]);
    expect(reached).toEqual(new Set(OCR_LANGUAGE_CODES));
  });

  it("reads the languages added 2026-10-25 from their browser tags", () => {
    const cases: [string, string][] = [
      ["el-GR", "ell"],
      ["he-IL", "heb"],
      ["iw", "heb"],
      ["fa-IR", "fas"],
      ["ur-PK", "urd"],
      ["mr-IN", "mar"],
      ["ne-NP", "nep"],
      ["gu-IN", "guj"],
      ["pa-IN", "pan"],
      ["ta-IN", "tam"],
      ["te-IN", "tel"],
      ["ms-MY", "msa"],
      ["fil-PH", "fil"],
      ["tl", "fil"],
      ["sw-KE", "swa"],
    ];
    for (const [tag, pack] of cases)
      expect(ocrLanguagesFromBrowser([tag]), tag).toEqual([pack, "eng"]);
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

  // INVERTED 2026-10-25. Until then only the Simplified pack shipped, and this
  // test pinned `["zh-TW", "zh-Hant"] → ["eng"]`: a Traditional reader got no
  // Chinese preselected rather than the wrong script. With `chi_tra` in the
  // image, the same tags must now pick the Traditional pack — and must still
  // never fall through to the Simplified one.
  it("reads Simplified Chinese as Simplified and Traditional as Traditional", () => {
    expect(ocrLanguagesFromBrowser(["zh-CN"])).toEqual(["chi_sim", "eng"]);
    expect(ocrLanguagesFromBrowser(["zh-Hans-SG"])).toEqual(["chi_sim", "eng"]);
    expect(ocrLanguagesFromBrowser(["zh-TW", "zh-Hant"])).toEqual([
      "chi_tra",
      "eng",
    ]);
    expect(ocrLanguagesFromBrowser(["zh-HK"])).not.toContain("chi_sim");
  });
});
