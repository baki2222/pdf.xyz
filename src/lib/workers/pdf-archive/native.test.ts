import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import {
  createNativeGhostscriptPdfARunner,
  ghostscriptPdfAArgs,
  nativePdfArchiveDeps,
  probeGhostscriptFromConfig,
} from "./native";
import type { NativePdfArchiveConfig } from "./native-config";

const config: NativePdfArchiveConfig = {
  enabled: true,
  binary: "gs",
  overridden: false,
  timeoutMs: 10_000,
  maxInputBytes: 1000,
  maxOutputBytes: 1000,
  tmpDir: "/tmp",
};
const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);

function fsStub(output = PDF) {
  return {
    mkdtemp: vi.fn(async () => "/tmp/pdfxyz-pdfa-1"),
    writeFile: vi.fn(async () => {}),
    readFile: vi.fn(async () => output),
    rm: vi.fn(async () => {}),
  };
}

describe("Ghostscript PDF/A native runner", () => {
  it("builds fixed PDF/A argv without a shell", () => {
    expect(ghostscriptPdfAArgs("/in.pdf", "/out.pdf")).toEqual([
      "-dPDFA=2",
      "-dBATCH",
      "-dNOPAUSE",
      "-dNOOUTERSAVE",
      "-dSAFER",
      "-sProcessColorModel=DeviceRGB",
      "-sDEVICE=pdfwrite",
      "-dPDFACompatibilityPolicy=1",
      "-sOutputFile=/out.pdf",
      "/in.pdf",
    ]);
  });

  it("converts in an isolated temp dir and always cleans up", async () => {
    const exec = vi.fn(async () => ({ code: 0, timedOut: false }));
    const fs = fsStub();
    const runner = createNativeGhostscriptPdfARunner(config, { exec, fs });
    const output = await runner.convertToPdfA(PDF, { standard: "PDF/A-2b" });
    expect([...output.bytes]).toEqual([...PDF]);
    expect(output.notes).toEqual([]);
    expect(fs.writeFile).toHaveBeenCalledWith(
      join("/tmp/pdfxyz-pdfa-1", "input.pdf"),
      PDF,
    );
    expect(exec).toHaveBeenCalledWith(
      "gs",
      expect.arrayContaining(["-dPDFA=2"]),
      expect.objectContaining({ timeout: 10_000 }),
    );
    expect(fs.rm).toHaveBeenCalledWith("/tmp/pdfxyz-pdfa-1", {
      recursive: true,
      force: true,
    });
  });

  it("fails on non-zero or unusable output", async () => {
    await expect(
      createNativeGhostscriptPdfARunner(config, {
        exec: vi.fn(async () => ({ code: 1, timedOut: false })),
        fs: fsStub(),
      }).convertToPdfA(PDF, { standard: "PDF/A-2b" }),
    ).rejects.toThrow(/failed/i);

    await expect(
      createNativeGhostscriptPdfARunner(config, {
        exec: vi.fn(async () => ({ code: 0, timedOut: false })),
        fs: fsStub(new TextEncoder().encode("nope")),
      }).convertToPdfA(PDF, { standard: "PDF/A-2b" }),
    ).rejects.toThrow(/usable PDF/i);
  });

  it("probes config and returns deps only when Ghostscript is available", () => {
    expect(
      probeGhostscriptFromConfig(config, { resolveOnPath: () => true }),
    ).toBe(true);
    expect(
      nativePdfArchiveDeps({}, { resolveOnPath: () => false }).ghostscript,
    ).toBeUndefined();
    expect(
      nativePdfArchiveDeps({}, { resolveOnPath: () => true }).ghostscript,
    ).toBeDefined();
  });
});
