import { describe, expect, it } from "vitest";
import type { ToolAvailability } from "./compression/engine";
import { buildWorkerStatus } from "./status";

const noTools: ToolAvailability = {
  ghostscript: false,
  qpdf: false,
  mutool: false,
};

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

  it("reports OCR as unavailable with an honest reason in every mode", () => {
    for (const mode of ["disabled", "remote-configured", "local-dev"] as const) {
      const status = buildWorkerStatus(mode);
      expect(status.ocr.available).toBe(false);
      expect(status.ocr.engine).toBeNull();
      expect(status.ocr.languages).toEqual([]);
      expect(status.ocr.detail.length).toBeGreaterThan(0);
    }
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
    // OCR is not part of the local-dev worker, so it stays unavailable.
    expect(status.ocr.available).toBe(false);
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
