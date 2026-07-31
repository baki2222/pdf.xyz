import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { libreOfficeConvertArgs, createNativeLibreOfficePdfRunner, nativeOfficeConversionDeps, probeLibreOfficeFromConfig } from "./native";
import { resolveNativeOfficeConversionConfig, type NativeOfficeConversionConfig } from "./native-config";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const DOCX = new TextEncoder().encode("docx");
const config: NativeOfficeConversionConfig = { enabled: true, candidates: ["soffice", "libreoffice"], overridden: false, timeoutMs: 120_000, maxInputBytes: 1000, maxOutputBytes: 1000, tmpDir: "/tmp" };

function fsStub(output = PDF) {
  return { mkdtemp: vi.fn(async () => "/tmp/pdfxyz-office-1"), writeFile: vi.fn(async () => {}), readFile: vi.fn(async () => output), rm: vi.fn(async () => {}) };
}

describe("native LibreOffice Office converter", () => {
  it("resolves config defaults and overrides", () => {
    expect(resolveNativeOfficeConversionConfig({})).toMatchObject({ enabled: true, candidates: ["soffice", "libreoffice"], timeoutMs: 120_000 });
    expect(resolveNativeOfficeConversionConfig({ PDFXYZ_OFFICE_CONVERSION: "off", PDFXYZ_LIBREOFFICE_BIN: "/usr/bin/soffice", PDFXYZ_OFFICE_CONVERSION_TIMEOUT_MS: "45000" })).toMatchObject({ enabled: false, candidates: ["/usr/bin/soffice"], overridden: true, timeoutMs: 45_000 });
  });

  it("builds fixed no-shell conversion argv", () => {
    expect(libreOfficeConvertArgs("/tmp/in.docx", "/tmp/out")).toEqual(["--headless", "--nologo", "--nofirststartwizard", "--nodefault", "--nolockcheck", "--convert-to", "pdf", "--outdir", "/tmp/out", "/tmp/in.docx"]);
  });

  it("converts through temp input/output and cleans up", async () => {
    const exec = vi.fn(async () => ({ code: 0, timedOut: false }));
    const fs = fsStub();
    const runner = createNativeLibreOfficePdfRunner(config, { exec, fs, resolveOnPath: (bin) => bin === "soffice" });
    const output = await runner.convertToPdf(DOCX, "report.docx");
    expect([...output]).toEqual([...PDF]);
    expect(fs.writeFile).toHaveBeenCalledWith(
      join("/tmp/pdfxyz-office-1", "input.docx"),
      DOCX,
    );
    expect(exec).toHaveBeenCalledWith("soffice", expect.arrayContaining([
        "--outdir",
        "/tmp/pdfxyz-office-1",
        join("/tmp/pdfxyz-office-1", "input.docx"),
      ]), expect.objectContaining({ timeout: 120_000 }));
    expect(fs.readFile).toHaveBeenCalledWith(join("/tmp/pdfxyz-office-1", "input.pdf"));
    expect(fs.rm).toHaveBeenCalledWith("/tmp/pdfxyz-office-1", { recursive: true, force: true });
  });

  it("fails on conversion error or non-PDF output", async () => {
    await expect(createNativeLibreOfficePdfRunner(config, { exec: vi.fn(async () => ({ code: 1, timedOut: false })), fs: fsStub(), resolveOnPath: () => true }).convertToPdf(DOCX, "x.docx")).rejects.toThrow(/failed/i);
    await expect(createNativeLibreOfficePdfRunner(config, { exec: vi.fn(async () => ({ code: 0, timedOut: false })), fs: fsStub(new TextEncoder().encode("bad")), resolveOnPath: () => true }).convertToPdf(DOCX, "x.docx")).rejects.toThrow(/usable PDF/i);
  });

  it("probes and wires deps only when LibreOffice is available", () => {
    expect(probeLibreOfficeFromConfig(config, { resolveOnPath: (bin) => bin === "soffice" })).toBe("soffice");
    expect(nativeOfficeConversionDeps({}, { resolveOnPath: () => false }).libreoffice).toBeUndefined();
    expect(nativeOfficeConversionDeps({}, { resolveOnPath: () => true }).libreoffice).toBeDefined();
  });
});
