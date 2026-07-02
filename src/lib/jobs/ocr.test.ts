import { describe, expect, it } from "vitest";
import {
  DEFAULT_OCR_LANGUAGE,
  DEFAULT_OCR_OUTPUT_MODE,
  MAX_OCR_LANGUAGES,
  OCR_LANGUAGE_CODES,
  OCR_MAX_REPORTED_CHARACTERS,
  OCR_MAX_REPORTED_PAGES,
  OCR_OUTPUT_MODES,
  buildOcrResultMeta,
  describeOcrRequest,
  isOcrLanguage,
  isOcrOutputMode,
  ocrOutputsForMode,
  parseOcrOptions,
  type OcrLanguage,
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

describe("buildOcrResultMeta — bounded, honest, schema-stable", () => {
  it("passes through real facts and counts for a both-mode run", () => {
    const meta = buildOcrResultMeta({
      engine: "ocrmypdf",
      languages: ["eng", "spa"],
      outputMode: "both",
      producedSearchablePdf: true,
      producedTextSidecar: true,
      pageCount: 12,
      textCharacters: 3456,
      meanConfidence: 0.91,
    });
    expect(meta).toEqual({
      engine: "ocrmypdf",
      languages: ["eng", "spa"],
      outputMode: "both",
      producedSearchablePdf: true,
      producedTextSidecar: true,
      pageCount: 12,
      textCharacters: 3456,
      meanConfidence: 0.91,
    });
  });

  it("filters languages to the allowlist, de-dupes, and caps at the max", () => {
    // A deliberately dirty set (a bogus code, a duplicate, and more than the max) —
    // cast through the input type so the builder's own sanitization is what's tested.
    const dirty = ["eng", "eng", "klingon", "spa", "fra", "deu", "ita", "por"] as OcrLanguage[];
    const meta = buildOcrResultMeta({
      engine: "tesseract",
      languages: dirty,
      outputMode: "searchable-pdf",
      producedSearchablePdf: true,
      producedTextSidecar: false,
    });
    // "klingon" dropped, "eng" de-duped, and no more than MAX_OCR_LANGUAGES kept.
    expect(meta.languages).not.toContain("klingon");
    expect(meta.languages.length).toBeLessThanOrEqual(MAX_OCR_LANGUAGES);
    expect(new Set(meta.languages).size).toBe(meta.languages.length);
  });

  it("nulls a page count when no searchable PDF was produced, and a char count when no sidecar", () => {
    const textOnly = buildOcrResultMeta({
      engine: "ocrmypdf",
      languages: ["eng"],
      outputMode: "text",
      producedSearchablePdf: false,
      producedTextSidecar: true,
      pageCount: 9, // meaningless without a PDF → nulled
      textCharacters: 100,
    });
    expect(textOnly.pageCount).toBeNull();
    expect(textOnly.textCharacters).toBe(100);

    const pdfOnly = buildOcrResultMeta({
      engine: "ocrmypdf",
      languages: ["eng"],
      outputMode: "searchable-pdf",
      producedSearchablePdf: true,
      producedTextSidecar: false,
      pageCount: 4,
      textCharacters: 500, // meaningless without a sidecar → nulled
    });
    expect(pdfOnly.textCharacters).toBeNull();
    expect(pdfOnly.pageCount).toBe(4);
  });

  it("coerces bad counts to null and clamps huge ones to the bound (never NaN/∞/negative)", () => {
    const meta = buildOcrResultMeta({
      engine: "ocrmypdf",
      languages: ["eng"],
      outputMode: "both",
      producedSearchablePdf: true,
      producedTextSidecar: true,
      pageCount: Number.POSITIVE_INFINITY,
      textCharacters: -5,
    });
    expect(meta.pageCount).toBeNull();
    expect(meta.textCharacters).toBeNull();

    const clamped = buildOcrResultMeta({
      engine: "ocrmypdf",
      languages: ["eng"],
      outputMode: "both",
      producedSearchablePdf: true,
      producedTextSidecar: true,
      pageCount: OCR_MAX_REPORTED_PAGES + 10_000,
      textCharacters: OCR_MAX_REPORTED_CHARACTERS + 10_000,
    });
    expect(clamped.pageCount).toBe(OCR_MAX_REPORTED_PAGES);
    expect(clamped.textCharacters).toBe(OCR_MAX_REPORTED_CHARACTERS);
    // Fractional counts floor to an integer.
    const fractional = buildOcrResultMeta({
      engine: "ocrmypdf",
      languages: ["eng"],
      outputMode: "searchable-pdf",
      producedSearchablePdf: true,
      producedTextSidecar: false,
      pageCount: 3.9,
    });
    expect(fractional.pageCount).toBe(3);
  });

  it("keeps a confidence only when a real number in [0,1] — never invents one", () => {
    const good = buildOcrResultMeta({
      engine: "ocrmypdf",
      languages: ["eng"],
      outputMode: "searchable-pdf",
      producedSearchablePdf: true,
      producedTextSidecar: false,
      meanConfidence: 0.5,
    });
    expect(good.meanConfidence).toBe(0.5);

    for (const bad of [1.5, -0.1, Number.NaN, undefined, null]) {
      const meta = buildOcrResultMeta({
        engine: "ocrmypdf",
        languages: ["eng"],
        outputMode: "searchable-pdf",
        producedSearchablePdf: true,
        producedTextSidecar: false,
        meanConfidence: bad,
      });
      expect(meta.meanConfidence).toBeNull();
    }
  });

  it("reduces the engine to a short safe token — a stray path/text can never ride in", () => {
    const meta = buildOcrResultMeta({
      engine: "/usr/local/bin/ocrmypdf --sidecar /tmp/secret.txt",
      languages: ["eng"],
      outputMode: "searchable-pdf",
      producedSearchablePdf: true,
      producedTextSidecar: false,
    });
    expect(meta.engine).not.toContain("/");
    expect(meta.engine).not.toContain(" ");
    expect(meta.engine.length).toBeLessThanOrEqual(32);
    // An all-unsafe engine name degrades to a fixed placeholder, never empty.
    expect(buildOcrResultMeta({
      engine: "/// ",
      languages: ["eng"],
      outputMode: "searchable-pdf",
      producedSearchablePdf: true,
      producedTextSidecar: false,
    }).engine).toBe("unknown");
  });

  it("produces a schema-stable shape with no recognized text or nested content", () => {
    const meta = buildOcrResultMeta({
      engine: "ocrmypdf",
      languages: ["eng"],
      outputMode: "both",
      producedSearchablePdf: true,
      producedTextSidecar: true,
      pageCount: 2,
      textCharacters: 40,
    });
    // Exactly the documented keys — the shape never varies by engine/option.
    expect(Object.keys(meta).sort()).toEqual(
      [
        "engine",
        "languages",
        "meanConfidence",
        "outputMode",
        "pageCount",
        "producedSearchablePdf",
        "producedTextSidecar",
        "textCharacters",
      ].sort(),
    );
    // Only the languages array is non-scalar; nothing carries free text.
    for (const [key, value] of Object.entries(meta)) {
      if (key === "languages") continue;
      expect(["string", "number", "boolean", "object"]).toContain(typeof value);
      if (value !== null) expect(typeof value).not.toBe("object");
    }
  });
});
