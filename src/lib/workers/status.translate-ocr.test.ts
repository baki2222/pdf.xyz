// @vitest-environment node
/**
 * `WorkerStatus.translateOcr` — what the Translate panel reads to offer OCR
 * for a scan (audit translate-pdf#3). True only when an OBSERVED worker
 * proves the chain AND OCR itself; every other combination is `false`, so the
 * panel keeps refusing a scan before upload.
 */
import { describe, expect, it } from "vitest";
import { buildWorkerStatus } from "./status";

const ENGINES = { ocrmypdf: true, tesseract: true } as const;

function status(observed: boolean, translateOcr: boolean, ocr: boolean) {
  return buildWorkerStatus(
    "remote-configured",
    undefined,
    ocr ? ENGINES : undefined,
    {},
    undefined,
    observed,
    ocr,
    false,
    ocr ? ["eng"] : undefined,
    translateOcr,
  );
}

describe("buildWorkerStatus — translateOcr", () => {
  it("positive control: observed, proven, and OCR available", () => {
    const s = status(true, true, true);
    expect(s.ocr.available, "the fixture's OCR is not available").toBe(true);
    expect(s.translateOcr).toBe(true);
  });

  it.each([
    ["not observed", false, true, true],
    ["the chain not proven", true, false, true],
    ["OCR itself unavailable", true, true, false],
  ] as const)("%s → false", (_name, observed, translateOcr, ocr) => {
    expect(status(observed, translateOcr, ocr).translateOcr).toBe(false);
  });
});
