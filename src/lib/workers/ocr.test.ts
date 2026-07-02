import { describe, expect, it } from "vitest";
import { OCR_LANGUAGE_CODES } from "@/lib/jobs/ocr";
import {
  OCR_ENGINE_BINARIES,
  buildOcrCapability,
  probeOcrEngines,
  type OcrEngineAvailability,
} from "./ocr";

const noEngines: OcrEngineAvailability = {
  ocrmypdf: false,
  tesseract: false,
};

describe("buildOcrCapability", () => {
  it("reports OCR unavailable in every mode this build runs in", () => {
    for (const mode of ["disabled", "remote-configured", "local-dev"] as const) {
      const ocr = buildOcrCapability(mode);
      expect(ocr.available).toBe(false);
      expect(ocr.engine).toBeNull();
      expect(ocr.languages).toEqual([]);
      expect(ocr.detail.length).toBeGreaterThan(0);
    }
  });

  it("gives a mode-specific, honest reason when unavailable", () => {
    expect(buildOcrCapability("disabled").detail).toMatch(
      /native ocr engine/i,
    );
    // Phase 23: OCR is a real, optional out-of-band backend — the copy no longer
    // implies it is future/vaporware, but still honestly says it can't run *here*.
    expect(buildOcrCapability("remote-configured").detail).toMatch(
      /out-of-band secure worker/i,
    );
    expect(buildOcrCapability("remote-configured").detail).not.toMatch(
      /no ocr pipeline|when ocr ships/i,
    );
    expect(buildOcrCapability("local-dev").detail).toMatch(
      /doesn't include an ocr processor/i,
    );
  });

  it("stays unavailable even with engines present while OCR is disabled", () => {
    const ocr = buildOcrCapability("disabled", {
      ocrmypdf: true,
      tesseract: true,
    });
    expect(ocr.available).toBe(false);
    expect(ocr.engine).toBeNull();
  });

  it("flips on and picks the preferred engine when one is advertised", () => {
    const ocr = buildOcrCapability("remote-configured", {
      ocrmypdf: false,
      tesseract: true,
    });
    expect(ocr.available).toBe(true);
    expect(ocr.engine).toBe("tesseract");
    expect(ocr.languages).toEqual([...OCR_LANGUAGE_CODES]);
    expect(ocr.detail).toContain("tesseract");
  });

  it("prefers ocrmypdf over tesseract when both are advertised", () => {
    const ocr = buildOcrCapability("remote-configured", {
      ocrmypdf: true,
      tesseract: true,
    });
    expect(ocr.engine).toBe("ocrmypdf");
  });

  it("treats no advertised engines as unavailable", () => {
    expect(buildOcrCapability("remote-configured", noEngines).available).toBe(
      false,
    );
  });
});

describe("probeOcrEngines", () => {
  it("maps a resolver over each engine binary (presence only)", () => {
    const present = new Set([OCR_ENGINE_BINARIES.tesseract]);
    const availability = probeOcrEngines((binary) => present.has(binary));
    expect(availability).toEqual({ ocrmypdf: false, tesseract: true });
  });
});
