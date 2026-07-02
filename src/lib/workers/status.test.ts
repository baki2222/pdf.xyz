import { describe, expect, it } from "vitest";
import type { ToolAvailability } from "./compression/engine";
import type { OcrEngineAvailability } from "./ocr/engine";
import { buildWorkerStatus } from "./status";

const noTools: ToolAvailability = {
  ghostscript: false,
  qpdf: false,
  mutool: false,
};

const noOcr: OcrEngineAvailability = { ocrmypdf: false, tesseract: false };

describe("buildWorkerStatus", () => {
  it("reports disabled with no capability by default", () => {
    const status = buildWorkerStatus("disabled");
    expect(status.mode).toBe("disabled");
    expect(status.enabled).toBe(false);
    expect(status.localDevOnly).toBe(false);
    expect(status.compress).toEqual({
      lossless: false,
      deep: false,
      engines: [],
    });
    expect(status.detail).toMatch(/no secure worker/i);
  });

  it("reports remote-configured as not-enabled (no pipeline shipped)", () => {
    const status = buildWorkerStatus("remote-configured");
    expect(status.enabled).toBe(false);
    expect(status.localDevOnly).toBe(false);
    expect(status.compress.deep).toBe(false);
    expect(status.detail).toMatch(/no processing pipeline/i);
  });

  it("reports local-dev as enabled with lossless, but deep off with no engine", () => {
    const status = buildWorkerStatus("local-dev", noTools);
    expect(status.enabled).toBe(true);
    expect(status.localDevOnly).toBe(true);
    expect(status.compress.lossless).toBe(true);
    expect(status.compress.deep).toBe(false);
    expect(status.compress.engines).toEqual([]);
    expect(status.detail).toMatch(/no native engine/i);
  });

  it("reports deep on with the installed engines in preference order", () => {
    const status = buildWorkerStatus("local-dev", {
      ghostscript: false,
      qpdf: true,
      mutool: true,
    });
    expect(status.compress.deep).toBe(true);
    expect(status.compress.engines).toEqual(["qpdf", "mutool"]);
    expect(status.detail).toContain("qpdf");
  });

  it("treats missing tool data in local-dev as no deep engine", () => {
    const status = buildWorkerStatus("local-dev");
    expect(status.compress.lossless).toBe(true);
    expect(status.compress.deep).toBe(false);
  });
});

describe("buildWorkerStatus — OCR capability", () => {
  it("reports no OCR capability when the worker is disabled", () => {
    expect(buildWorkerStatus("disabled").ocr).toEqual({
      pdf: false,
      image: false,
      engines: [],
    });
  });

  it("reports no OCR capability when remote-configured (no pipeline shipped)", () => {
    expect(buildWorkerStatus("remote-configured").ocr).toEqual({
      pdf: false,
      image: false,
      engines: [],
    });
  });

  it("reports full OCR capability in local-dev when OCRmyPDF is installed", () => {
    const status = buildWorkerStatus("local-dev", noTools, {
      ocrmypdf: true,
      tesseract: true,
    });
    expect(status.ocr.pdf).toBe(true);
    expect(status.ocr.image).toBe(true);
    expect(status.ocr.engines).toEqual(["ocrmypdf", "tesseract"]);
  });

  it("reports image-only OCR when only Tesseract is installed", () => {
    const status = buildWorkerStatus("local-dev", noTools, {
      ocrmypdf: false,
      tesseract: true,
    });
    expect(status.ocr.pdf).toBe(false);
    expect(status.ocr.image).toBe(true);
    expect(status.ocr.engines).toEqual(["tesseract"]);
  });

  it("reports no OCR capability in local-dev when no engine is installed", () => {
    const status = buildWorkerStatus("local-dev", noTools, noOcr);
    expect(status.ocr).toEqual({ pdf: false, image: false, engines: [] });
  });

  it("treats missing OCR engine data in local-dev as no OCR capability", () => {
    expect(buildWorkerStatus("local-dev", noTools).ocr).toEqual({
      pdf: false,
      image: false,
      engines: [],
    });
  });
});
