import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  chromiumPdfArgs,
  createNativeChromiumPdfRunner,
  nativeHtmlRenderDeps,
  probeChromiumFromConfig,
} from "./native";
import type { NativeHtmlRenderConfig } from "./native-config";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const HTML = new TextEncoder().encode("<h1>Hello</h1>");
const config: NativeHtmlRenderConfig = {
  enabled: true,
  candidates: ["chromium"],
  overridden: false,
  timeoutMs: 10_000,
  maxInputBytes: 1000,
  maxOutputBytes: 1000,
  tmpDir: "/tmp",
};

function fsStub(output = PDF) {
  return {
    mkdtemp: vi.fn(async () => "/tmp/pdfxyz-html-1"),
    writeFile: vi.fn(async () => {}),
    readFile: vi.fn(async () => output),
    rm: vi.fn(async () => {}),
  };
}

describe("native Chromium HTML renderer", () => {
  it("builds fixed print-to-pdf argv", () => {
    expect(chromiumPdfArgs("/tmp/in.html", "/tmp/out.pdf")).toEqual([
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=10000",
      "--print-to-pdf=/tmp/out.pdf",
      "/tmp/in.html",
    ]);
  });

  it("renders HTML through temp input/output and cleans up", async () => {
    const exec = vi.fn(async () => ({ code: 0, timedOut: false }));
    const fs = fsStub();
    const runner = createNativeChromiumPdfRunner(config, { exec, fs, resolveOnPath: () => true });
    const output = await runner.renderHtml(HTML);
    expect([...output]).toEqual([...PDF]);
    expect(fs.writeFile).toHaveBeenCalledWith(
      join("/tmp/pdfxyz-html-1", "input.html"),
      HTML,
    );
    expect(exec).toHaveBeenCalledWith("chromium", expect.arrayContaining([
        `--print-to-pdf=${join("/tmp/pdfxyz-html-1", "output.pdf")}`,
        pathToFileURL(join("/tmp/pdfxyz-html-1", "input.html")).toString(),
      ]), expect.objectContaining({ timeout: 10_000 }));
    expect(fs.rm).toHaveBeenCalledWith("/tmp/pdfxyz-html-1", { recursive: true, force: true });
  });

  it("renders URL without writing input HTML", async () => {
    const exec = vi.fn(async () => ({ code: 0, timedOut: false }));
    const fs = fsStub();
    const runner = createNativeChromiumPdfRunner(config, { exec, fs, resolveOnPath: () => true });
    await expect(runner.renderUrl("https://example.com")).resolves.toBeInstanceOf(Uint8Array);
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalledWith("chromium", expect.arrayContaining(["https://example.com"]), expect.any(Object));
  });

  it("fails on Chromium errors or unusable output", async () => {
    await expect(createNativeChromiumPdfRunner(config, { exec: vi.fn(async () => ({ code: 1, timedOut: false })), fs: fsStub(), resolveOnPath: () => true }).renderHtml(HTML)).rejects.toThrow(/failed/i);
    await expect(createNativeChromiumPdfRunner(config, { exec: vi.fn(async () => ({ code: 0, timedOut: false })), fs: fsStub(new TextEncoder().encode("not pdf")), resolveOnPath: () => true }).renderHtml(HTML)).rejects.toThrow(/usable PDF/i);
  });

  it("probes candidates and wires deps only when Chromium is available", () => {
    expect(probeChromiumFromConfig(config, { resolveOnPath: (bin) => bin === "chromium" })).toBe("chromium");
    expect(nativeHtmlRenderDeps({}, { resolveOnPath: () => false }).chromium).toBeUndefined();
    expect(nativeHtmlRenderDeps({}, { resolveOnPath: () => true }).chromium).toBeDefined();
  });
});
