import { describe, expect, it } from "vitest";
import {
  hasJobResults,
  sanitizeJobResults,
  type JobResults,
} from "./results";
import {
  OCR_MAX_REPORTED_CHARACTERS,
  OCR_MAX_REPORTED_PAGES,
  buildOcrResultMeta,
  type OcrResultMeta,
} from "./ocr";

/** A representative, valid OCR result-meta a runner produces. */
function ocrMeta(over: Partial<OcrResultMeta> = {}): OcrResultMeta {
  return buildOcrResultMeta({
    engine: "ocrmypdf",
    languages: ["eng", "spa"],
    outputMode: "both",
    producedSearchablePdf: true,
    producedTextSidecar: true,
    pageCount: 3,
    textCharacters: 1_240,
    ...over,
  });
}

describe("hasJobResults", () => {
  it("is false for null/undefined/empty and for all-empty blocks", () => {
    expect(hasJobResults(null)).toBe(false);
    expect(hasJobResults(undefined)).toBe(false);
    expect(hasJobResults({})).toBe(false);
    expect(hasJobResults({ ocr: undefined })).toBe(false);
  });

  it("is true once any block is populated", () => {
    expect(hasJobResults({ ocr: ocrMeta() })).toBe(true);
  });
});

describe("sanitizeJobResults — the redaction/persistence boundary", () => {
  it("normalizes absent/empty input to undefined (never a misleading empty object)", () => {
    expect(sanitizeJobResults(undefined)).toBeUndefined();
    expect(sanitizeJobResults(null)).toBeUndefined();
    expect(sanitizeJobResults({})).toBeUndefined();
    expect(sanitizeJobResults({ ocr: undefined })).toBeUndefined();
    // A non-object slips through the type system from an untrusted source.
    expect(sanitizeJobResults("nope" as unknown as JobResults)).toBeUndefined();
  });

  it("passes a valid OCR block through, schema-stable and intact", () => {
    const clean = sanitizeJobResults({ ocr: ocrMeta() });
    expect(clean?.ocr).toEqual({
      engine: "ocrmypdf",
      languages: ["eng", "spa"],
      outputMode: "both",
      producedSearchablePdf: true,
      producedTextSidecar: true,
      pageCount: 3,
      textCharacters: 1_240,
      meanConfidence: null,
      lowConfidenceWordRatio: null,
      recognizedWords: null,
    });
  });

  it("re-bounds pathological counts at the boundary", () => {
    const clean = sanitizeJobResults({
      ocr: ocrMeta({
        pageCount: OCR_MAX_REPORTED_PAGES + 10_000,
        textCharacters: OCR_MAX_REPORTED_CHARACTERS + 1,
      }),
    });
    expect(clean?.ocr?.pageCount).toBe(OCR_MAX_REPORTED_PAGES);
    expect(clean?.ocr?.textCharacters).toBe(OCR_MAX_REPORTED_CHARACTERS);
  });

  it("re-sanitizes a hostile engine token, collapsing it to the safe `unknown` family", () => {
    // A runner (or a tampered record) tries to smuggle a path + secret through the
    // free-text engine field. It is not EXACTLY a known family, so it degrades to
    // `unknown` — no fragment, path, or secret can survive as the client-facing engine.
    const clean = sanitizeJobResults({
      ocr: {
        ...ocrMeta(),
        engine: "/usr/local/bin/ocrmypdf --pass=SECRETVALUE /tmp/pdfxyz-abc/in.pdf",
      } as OcrResultMeta,
    });
    const engine = clean?.ocr?.engine ?? "";
    expect(engine).toBe("unknown");
    expect(engine).not.toContain("/");
    expect(engine).not.toContain(" ");
    expect(engine).not.toContain("SECRETVALUE");
    expect(engine.length).toBeLessThanOrEqual(32);
  });

  it("constrains the client-facing engine to the closed family set (ocrmypdf/tesseract/unknown)", () => {
    const engineOf = (engine: string) =>
      sanitizeJobResults({ ocr: ocrMeta({ engine }) })?.ocr?.engine;
    // Known families pass through verbatim.
    expect(engineOf("ocrmypdf")).toBe("ocrmypdf");
    expect(engineOf("tesseract")).toBe("tesseract");
    // A version, a different engine, or any decorated value collapses to `unknown`
    // rather than laundering a fragment through as a "known" family.
    expect(engineOf("ocrmypdf-16.4.0")).toBe("unknown");
    expect(engineOf("kraken")).toBe("unknown");
    expect(engineOf("ocrmypdfSECRET")).toBe("unknown");
  });

  it("filters languages to the allowlist and drops a smuggled sentence", () => {
    const clean = sanitizeJobResults({
      ocr: {
        ...ocrMeta(),
        languages: [
          "eng",
          "klingon",
          "The account balance is $9,412.55",
        ] as unknown as OcrResultMeta["languages"],
      },
    });
    expect(clean?.ocr?.languages).toEqual(["eng"]);
  });

  it("drops the whole OCR block when the output mode is not from the real contract", () => {
    // An unrecognized discriminant means the block did not come from a real run —
    // reject it whole rather than coerce a value onto the record.
    const clean = sanitizeJobResults({
      ocr: {
        ...ocrMeta(),
        outputMode: "exfiltrate" as unknown as OcrResultMeta["outputMode"],
      },
    });
    expect(clean).toBeUndefined();
  });

  it("nulls counts that contradict the produced artifacts (no phantom output)", () => {
    const clean = sanitizeJobResults({
      ocr: ocrMeta({
        producedSearchablePdf: false,
        producedTextSidecar: false,
        pageCount: 12,
        textCharacters: 999,
      }),
    });
    expect(clean?.ocr?.pageCount).toBeNull();
    expect(clean?.ocr?.textCharacters).toBeNull();
  });

  it("is idempotent — sanitizing an already-clean value changes nothing", () => {
    const once = sanitizeJobResults({ ocr: ocrMeta() });
    const twice = sanitizeJobResults(once);
    expect(twice).toEqual(once);
  });

  it("never lets recognized text, a path, key, URL, or secret survive serialization", () => {
    const TEXT = "SENSITIVE-OCR-TEXT-9f3c recognized on page 1";
    const hostile: JobResults = {
      ocr: {
        // Every free-text-ish field seeded with a distinct leak sentinel.
        engine: `ocrmypdf ${TEXT} /tmp/pdfxyz-xyz/in.pdf`,
        languages: [
          "eng",
          TEXT,
          "s3://bucket/object-key",
          "https://signed.example/url?sig=SECRET",
        ] as unknown as OcrResultMeta["languages"],
        outputMode: "both",
        producedSearchablePdf: true,
        producedTextSidecar: true,
        pageCount: 2,
        textCharacters: 42,
        meanConfidence: null,
        lowConfidenceWordRatio: null,
        recognizedWords: null,
      },
    };
    const serialized = JSON.stringify(sanitizeJobResults(hostile));
    for (const sentinel of [
      TEXT,
      "SENSITIVE",
      "sensitive",
      "/tmp/",
      "s3://",
      "bucket",
      "object-key",
      "https://",
      "signed.example",
      "SECRET",
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
    // The engine collapsed to the safe `unknown` family, and the safe structural
    // facts (a valid language, the output mode) still made it through.
    expect(serialized).toContain("unknown");
    expect(serialized).toContain("eng");
    expect(serialized).toContain("both");
  });
});
