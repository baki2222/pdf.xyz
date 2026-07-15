import { describe, expect, it, vi } from "vitest";
import {
  HTML_TO_PDF_TOOL,
  WEBPAGE_TO_PDF_TOOL,
  runHtmlToPdf,
  runWebpageToPdf,
  type ChromiumPdfRunner,
} from "./engine";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const HTML = new TextEncoder().encode("<!doctype html><html><body><h1>Hello</h1></body></html>");

function runner(output = PDF): ChromiumPdfRunner {
  return {
    renderHtml: vi.fn(async () => output),
    renderUrl: vi.fn(async () => output),
  };
}

describe("html-render engine", () => {
  it("declares the owned tools", () => {
    expect([HTML_TO_PDF_TOOL, WEBPAGE_TO_PDF_TOOL]).toEqual(["html-to-pdf", "webpage-to-pdf"]);
  });

  it("fails honestly when Chromium is unavailable", async () => {
    await expect(runHtmlToPdf(HTML, {})).resolves.toMatchObject({ ok: false, kind: "unsupported" });
    await expect(runWebpageToPdf("https://example.com", {})).resolves.toMatchObject({ ok: false, kind: "unsupported" });
  });

  it("renders HTML bytes with Chromium and validates PDF output", async () => {
    const chromium = runner();
    const result = await runHtmlToPdf(HTML, { chromium });
    expect(result).toMatchObject({ ok: true, meta: { engine: "chromium", source: "html", outputBytes: PDF.byteLength } });
    expect(chromium.renderHtml).toHaveBeenCalledWith(HTML);
  });

  it("renders safe public webpage URLs with Chromium", async () => {
    const chromium = runner();
    const result = await runWebpageToPdf("https://example.com/report", { chromium });
    expect(result).toMatchObject({ ok: true, meta: { engine: "chromium", source: "url" } });
    expect(chromium.renderUrl).toHaveBeenCalledWith("https://example.com/report");
  });

  it("rejects invalid or private URLs before invoking Chromium", async () => {
    const chromium = runner();
    await expect(runWebpageToPdf("http://localhost:3000", { chromium })).resolves.toMatchObject({ ok: false, kind: "invalid_url" });
    await expect(runWebpageToPdf("ftp://example.com", { chromium })).resolves.toMatchObject({ ok: false, kind: "invalid_url" });
    expect(chromium.renderUrl).not.toHaveBeenCalled();
  });

  it("enforces size limits and never accepts non-PDF output", async () => {
    await expect(runHtmlToPdf(HTML, { chromium: runner(), limits: { maxInputBytes: 4 } })).resolves.toMatchObject({ ok: false, kind: "too_large", limitBytes: 4 });
    await expect(runHtmlToPdf(HTML, { chromium: runner(new TextEncoder().encode("no pdf")) })).resolves.toMatchObject({ ok: false, kind: "failed" });
  });
});
