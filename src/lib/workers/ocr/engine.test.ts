import { describe, expect, it } from "vitest";
import {
  DEFAULT_OCR_LANGUAGES,
  looksLikeInputKind,
  ocrArtifactType,
  ocrInputKindForContentType,
  OCR_ENGINES,
  parseOcrOptions,
  parsePageRange,
  planOcr,
  probeOcrEngines,
  requiresOcrmypdf,
  runOcr,
  type OcrEngineAvailability,
  type OcrOptions,
} from "./engine";

const bothEngines: OcrEngineAvailability = { ocrmypdf: true, tesseract: true };
const onlyTesseract: OcrEngineAvailability = {
  ocrmypdf: false,
  tesseract: true,
};
const onlyOcrmypdf: OcrEngineAvailability = { ocrmypdf: true, tesseract: false };
const noEngines: OcrEngineAvailability = { ocrmypdf: false, tesseract: false };

/** A minimal valid options object for run/plan tests. */
function opts(overrides: Partial<OcrOptions> = {}): OcrOptions {
  return {
    languages: ["eng"],
    outputMode: "searchable-pdf",
    deskew: false,
    rotate: false,
    clean: false,
    onExistingText: "skip",
    ...overrides,
  };
}

describe("parseOcrOptions", () => {
  it("defaults to English, searchable PDF, no preprocessing, skip existing text", () => {
    const result = parseOcrOptions({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.languages).toEqual([...DEFAULT_OCR_LANGUAGES]);
      expect(result.value.outputMode).toBe("searchable-pdf");
      expect(result.value.deskew).toBe(false);
      expect(result.value.rotate).toBe(false);
      expect(result.value.clean).toBe(false);
      expect(result.value.onExistingText).toBe("skip");
      expect(result.value.pages).toBeUndefined();
    }
  });

  it("accepts an explicit language list and de-duplicates while preserving order", () => {
    const result = parseOcrOptions({ languages: ["deu", "eng", "deu"] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.languages).toEqual(["deu", "eng"]);
  });

  it("accepts a single language passed as a bare string", () => {
    const result = parseOcrOptions({ languages: "chi_sim" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.languages).toEqual(["chi_sim"]);
  });

  it("rejects an empty language list", () => {
    const result = parseOcrOptions({ languages: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.body.error.code).toBe("invalid_request");
  });

  it("rejects more than the maximum number of languages", () => {
    const many = Array.from({ length: 9 }, () => "eng");
    // De-dup happens after the count check, so nine entries is rejected up-front.
    const result = parseOcrOptions({ languages: many });
    expect(result.ok).toBe(false);
  });

  it("rejects malformed / injection-shaped language tokens", () => {
    for (const bad of [
      "en",
      "ENG",
      "eng ",
      "e/g",
      "eng;rm -rf /",
      "eng+deu",
      "--foo",
      "1234",
      "",
    ]) {
      const result = parseOcrOptions({ languages: [bad] });
      expect(result.ok, `expected ${JSON.stringify(bad)} to be rejected`).toBe(
        false,
      );
    }
  });

  it("accepts the text-sidecar output mode and rejects unknown modes", () => {
    expect(parseOcrOptions({ outputMode: "text-sidecar" }).ok).toBe(true);
    const bad = parseOcrOptions({ outputMode: "epub" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.body.error.code).toBe("invalid_request");
  });

  it("accepts boolean preprocessing flags and rejects non-booleans", () => {
    const good = parseOcrOptions({ deskew: true, rotate: true, clean: true });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.value.deskew).toBe(true);
      expect(good.value.rotate).toBe(true);
      expect(good.value.clean).toBe(true);
    }
    expect(parseOcrOptions({ deskew: "yes" }).ok).toBe(false);
    expect(parseOcrOptions({ rotate: 1 }).ok).toBe(false);
  });

  it("validates the existing-text strategy", () => {
    for (const s of ["skip", "force", "redo"]) {
      const r = parseOcrOptions({ onExistingText: s });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.onExistingText).toBe(s);
    }
    expect(parseOcrOptions({ onExistingText: "ignore" }).ok).toBe(false);
  });

  it("parses and normalises a page range, rejecting bad ones", () => {
    const ok = parseOcrOptions({ pages: " 1-3, 5 " } as Record<string, unknown>);
    // Whitespace inside the token is not allowed by the grammar.
    expect(ok.ok).toBe(false);
    const clean = parseOcrOptions({ pages: "1-3,5" });
    expect(clean.ok).toBe(true);
    if (clean.ok) expect(clean.value.pages).toBe("1-3,5");
  });

  it("ignores unknown extra keys (forward-compatible)", () => {
    const result = parseOcrOptions({ languages: ["eng"], vibes: "immaculate" });
    expect(result.ok).toBe(true);
  });
});

describe("parsePageRange", () => {
  it("accepts single pages and ascending ranges, normalising leading zeros", () => {
    expect(parsePageRange("5")).toEqual({ ok: true, value: "5" });
    expect(parsePageRange("1-3,5")).toEqual({ ok: true, value: "1-3,5" });
    expect(parsePageRange("01-03")).toEqual({ ok: true, value: "1-3" });
  });

  it("rejects descending ranges", () => {
    expect(parsePageRange("5-3").ok).toBe(false);
  });

  it("rejects zero, negatives, and non-numeric tokens", () => {
    for (const bad of ["0", "-1", "abc", "1,,2", "1-", "1-2-3", "1 2", ""]) {
      expect(parsePageRange(bad).ok, bad).toBe(false);
    }
  });

  it("rejects page numbers above the ceiling", () => {
    expect(parsePageRange("10001").ok).toBe(false);
  });

  it("rejects a non-string value", () => {
    expect(parsePageRange(5 as unknown).ok).toBe(false);
  });
});

describe("probeOcrEngines", () => {
  it("reports availability from the injected resolver only", () => {
    const engines = probeOcrEngines((bin) => bin === "tesseract");
    expect(engines).toEqual({ ocrmypdf: false, tesseract: true });
  });
});

describe("requiresOcrmypdf", () => {
  it("is true for PDF inputs regardless of options", () => {
    expect(requiresOcrmypdf(opts(), "pdf")).toBe(true);
  });

  it("is true for images that ask for deskew, clean, or a page range", () => {
    expect(requiresOcrmypdf(opts({ deskew: true }), "image")).toBe(true);
    expect(requiresOcrmypdf(opts({ clean: true }), "image")).toBe(true);
    expect(requiresOcrmypdf(opts({ pages: "1-2" }), "image")).toBe(true);
  });

  it("is false for a plain image with only languages/rotate", () => {
    expect(requiresOcrmypdf(opts({ rotate: true }), "image")).toBe(false);
  });
});

describe("planOcr", () => {
  it("uses ocrmypdf for a PDF when it is installed", () => {
    const plan = planOcr(opts(), bothEngines, "pdf");
    expect(plan).toEqual({ supported: true, engine: "ocrmypdf" });
  });

  it("reports unsupported for a PDF when ocrmypdf is missing (even if tesseract is present)", () => {
    const plan = planOcr(opts(), onlyTesseract, "pdf");
    expect(plan.supported).toBe(false);
    if (!plan.supported) expect(plan.requires).toEqual(["ocrmypdf"]);
  });

  it("prefers ocrmypdf for a plain image when both are present", () => {
    const plan = planOcr(opts(), bothEngines, "image");
    expect(plan.supported && plan.engine).toBe("ocrmypdf");
  });

  it("falls back to tesseract for a plain image when only it is installed", () => {
    const plan = planOcr(opts(), onlyTesseract, "image");
    expect(plan.supported && plan.engine).toBe("tesseract");
  });

  it("requires ocrmypdf for an image that asks for deskew, even if tesseract is present", () => {
    const plan = planOcr(opts({ deskew: true }), onlyTesseract, "image");
    expect(plan.supported).toBe(false);
    if (!plan.supported) expect(plan.requires).toEqual(["ocrmypdf"]);
  });

  it("reports unsupported with both engine names when nothing is installed", () => {
    const plan = planOcr(opts(), noEngines, "image");
    expect(plan.supported).toBe(false);
    if (!plan.supported) expect(plan.requires).toEqual(OCR_ENGINES);
  });
});

describe("ocrInputKindForContentType", () => {
  it("maps PDF and image MIME types, tolerating parameters", () => {
    expect(ocrInputKindForContentType("application/pdf")).toBe("pdf");
    expect(ocrInputKindForContentType("image/png")).toBe("image");
    expect(ocrInputKindForContentType("image/jpeg")).toBe("image");
    expect(ocrInputKindForContentType("image/jpg")).toBe("image");
    expect(ocrInputKindForContentType("IMAGE/PNG; foo=bar")).toBe("image");
  });

  it("returns null for anything that can't be OCR'd", () => {
    expect(ocrInputKindForContentType("text/plain")).toBeNull();
    expect(ocrInputKindForContentType("application/zip")).toBeNull();
  });
});

describe("ocrArtifactType", () => {
  it("maps output modes to content type + extension", () => {
    expect(ocrArtifactType("searchable-pdf")).toEqual({
      contentType: "application/pdf",
      ext: "pdf",
    });
    expect(ocrArtifactType("text-sidecar")).toEqual({
      contentType: "text/plain; charset=utf-8",
      ext: "txt",
    });
  });
});

describe("looksLikeInputKind", () => {
  it("accepts a PDF header, even with a few leading bytes", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // "%PDF-1"
    expect(looksLikeInputKind(pdf, "pdf")).toBe(true);
    const withPrefix = new Uint8Array([0x0a, 0x0a, ...pdf]);
    expect(looksLikeInputKind(withPrefix, "pdf")).toBe(true);
  });

  it("accepts PNG and JPEG magic bytes for image inputs", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(looksLikeInputKind(png, "image")).toBe(true);
    expect(looksLikeInputKind(jpeg, "image")).toBe(true);
  });

  it("rejects bytes that don't match the declared kind", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(looksLikeInputKind(png, "pdf")).toBe(false);
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(looksLikeInputKind(pdf, "image")).toBe(false);
    expect(looksLikeInputKind(new Uint8Array([1, 2, 3]), "image")).toBe(false);
  });
});

describe("runOcr", () => {
  const validPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

  it("produces a searchable PDF artifact with honest metadata", async () => {
    const output = new Uint8Array(64).fill(9);
    let sawEngine: string | null = null;
    const run = await runOcr(
      validPdf,
      opts({ languages: ["eng", "deu"] }),
      { inputKind: "pdf" },
      {
        engines: bothEngines,
        native: async (_bytes, ctx) => {
          sawEngine = ctx.engine;
          return output;
        },
      },
    );
    expect(sawEngine).toBe("ocrmypdf");
    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.output).toBe(output);
      expect(run.contentType).toBe("application/pdf");
      expect(run.outputExt).toBe("pdf");
      expect(run.meta.engine).toBe("ocrmypdf");
      expect(run.meta.outputMode).toBe("searchable-pdf");
      expect(run.meta.languages).toEqual(["eng", "deu"]);
      expect(run.meta.inputKind).toBe("pdf");
      expect(run.meta.originalBytes).toBe(validPdf.byteLength);
      expect(run.meta.outputBytes).toBe(output.byteLength);
    }
  });

  it("produces a text sidecar artifact for text-sidecar mode", async () => {
    const run = await runOcr(
      validPdf,
      opts({ outputMode: "text-sidecar" }),
      { inputKind: "pdf" },
      { engines: onlyOcrmypdf, native: async () => new Uint8Array([0x41]) },
    );
    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.contentType).toBe("text/plain; charset=utf-8");
      expect(run.outputExt).toBe("txt");
    }
  });

  it("never invents output when no OCR engine is installed", async () => {
    let nativeCalled = false;
    const run = await runOcr(
      validPdf,
      opts(),
      { inputKind: "pdf" },
      {
        engines: noEngines,
        native: async () => {
          nativeCalled = true;
          return new Uint8Array([1]);
        },
      },
    );
    expect(nativeCalled).toBe(false);
    expect(run.ok).toBe(false);
    if (!run.ok && run.kind === "unsupported") {
      expect(run.requires).toEqual(["ocrmypdf"]);
    } else {
      throw new Error("expected an unsupported result");
    }
  });

  it("reports invalid_input when the bytes don't match the declared kind", async () => {
    const run = await runOcr(
      new Uint8Array([1, 2, 3, 4]),
      opts(),
      { inputKind: "pdf" },
      { engines: onlyOcrmypdf, native: async () => new Uint8Array([1]) },
    );
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("invalid_input");
  });

  it("classifies a native engine crash as an honest failure", async () => {
    const run = await runOcr(
      validPdf,
      opts(),
      { inputKind: "pdf" },
      {
        engines: onlyOcrmypdf,
        sniff: () => true,
        native: async () => {
          throw new Error("boom");
        },
      },
    );
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });

  it("treats empty engine output as a failure, not a success", async () => {
    const run = await runOcr(
      validPdf,
      opts(),
      { inputKind: "pdf" },
      {
        engines: onlyOcrmypdf,
        sniff: () => true,
        native: async () => new Uint8Array(0),
      },
    );
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });

  it("fails honestly when an engine is available but no executor is wired", async () => {
    const run = await runOcr(validPdf, opts(), { inputKind: "pdf" }, {
      engines: onlyOcrmypdf,
      sniff: () => true,
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });
});
