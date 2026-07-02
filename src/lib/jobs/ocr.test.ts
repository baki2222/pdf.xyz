import { describe, expect, it } from "vitest";
import {
  DEFAULT_OCR_LANGUAGE,
  DEFAULT_OCR_OUTPUT_MODE,
  MAX_OCR_LANGUAGES,
  OCR_LANGUAGE_CODES,
  OCR_OUTPUT_MODES,
  describeOcrRequest,
  isOcrLanguage,
  isOcrOutputMode,
  ocrOutputsForMode,
  parseOcrOptions,
} from "./ocr";

describe("OCR language + mode allowlists", () => {
  it("recognizes only curated language codes", () => {
    expect(isOcrLanguage("eng")).toBe(true);
    expect(isOcrLanguage("chi_sim")).toBe(true);
    expect(isOcrLanguage("elvish")).toBe(false);
    expect(isOcrLanguage(42)).toBe(false);
    expect(isOcrLanguage(undefined)).toBe(false);
  });

  it("recognizes only known output modes", () => {
    expect(isOcrOutputMode("searchable-pdf")).toBe(true);
    expect(isOcrOutputMode("both")).toBe(true);
    expect(isOcrOutputMode("interpretive-dance")).toBe(false);
  });

  it("maps each output mode to its formats", () => {
    expect(ocrOutputsForMode("searchable-pdf")).toEqual(["PDF"]);
    expect(ocrOutputsForMode("text")).toEqual(["TXT"]);
    expect(ocrOutputsForMode("both")).toEqual(["PDF", "TXT"]);
  });

  it("keeps the default language and output mode inside their allowlists", () => {
    expect(OCR_LANGUAGE_CODES).toContain(DEFAULT_OCR_LANGUAGE);
    expect(OCR_OUTPUT_MODES.map((m) => m.id)).toContain(
      DEFAULT_OCR_OUTPUT_MODE,
    );
  });
});

describe("parseOcrOptions", () => {
  it("applies honest defaults for an empty options bag", () => {
    const result = parseOcrOptions({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        languages: ["eng"],
        outputMode: "searchable-pdf",
        skipTextPages: false,
      });
    }
  });

  it("accepts a single language code or an array of codes", () => {
    const single = parseOcrOptions({ languages: "deu" });
    expect(single.ok && single.value.languages).toEqual(["deu"]);

    const many = parseOcrOptions({ languages: ["eng", "fra"] });
    expect(many.ok && many.value.languages).toEqual(["eng", "fra"]);
  });

  it("de-duplicates repeated languages while preserving order", () => {
    const result = parseOcrOptions({ languages: ["fra", "eng", "fra"] });
    expect(result.ok && result.value.languages).toEqual(["fra", "eng"]);
  });

  it("rejects an unsupported language with a field error", () => {
    const result = parseOcrOptions({ languages: ["eng", "klingon"] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.body.error.code).toBe("unprocessable_entity");
      expect(result.error.body.error.details?.[0]?.field).toBe(
        "options.languages",
      );
      expect(result.error.body.error.message).toContain("klingon");
    }
  });

  it("rejects an empty language list", () => {
    const result = parseOcrOptions({ languages: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.body.error.code).toBe("unprocessable_entity");
    }
  });

  it("rejects more than the max number of languages", () => {
    const tooMany = OCR_LANGUAGE_CODES.slice(0, MAX_OCR_LANGUAGES + 1);
    const result = parseOcrOptions({ languages: [...tooMany] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.body.error.message).toContain(String(MAX_OCR_LANGUAGES));
    }
  });

  it("rejects a languages value that is neither a string nor an array", () => {
    const result = parseOcrOptions({ languages: { code: "eng" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.body.error.code).toBe("invalid_request");
    }
  });

  it("accepts each supported output mode", () => {
    for (const mode of OCR_OUTPUT_MODES) {
      const result = parseOcrOptions({ outputMode: mode.id });
      expect(result.ok && result.value.outputMode).toBe(mode.id);
    }
  });

  it("rejects an unknown output mode", () => {
    const result = parseOcrOptions({ outputMode: "epub" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.body.error.code).toBe("invalid_request");
      expect(result.error.body.error.details?.[0]?.field).toBe(
        "options.outputMode",
      );
    }
  });

  it("accepts an explicit skipTextPages boolean and rejects non-booleans", () => {
    const on = parseOcrOptions({ skipTextPages: true });
    expect(on.ok && on.value.skipTextPages).toBe(true);

    const coerced = parseOcrOptions({ skipTextPages: "yes" });
    expect(coerced.ok).toBe(false);
    if (!coerced.ok) {
      expect(coerced.error.body.error.code).toBe("invalid_request");
    }
  });
});

describe("describeOcrRequest", () => {
  it("summarizes languages and output mode in human terms", () => {
    const parsed = parseOcrOptions({
      languages: ["eng", "spa"],
      outputMode: "both",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(describeOcrRequest(parsed.value)).toBe(
        "English, Spanish → Searchable PDF + text",
      );
    }
  });
});
