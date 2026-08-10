import { describe, expect, it, vi } from "vitest";
import {
  createHtmlRenderProcessor,
  htmlPdfOutputName,
  webpagePdfOutputName,
} from "./html-render";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);
const HTML = new TextEncoder().encode("<!doctype html><h1>Hello</h1>");

const htmlInput = {
  tool: "html-to-pdf",
  options: {},
  inputs: [
    {
      fileId: "file_html",
      filename: "landing.page.html",
      contentType: "text/html",
      bytes: HTML,
    },
  ],
};

describe("html-render processor", () => {
  it("owns html-to-pdf and webpage-to-pdf and reports readiness", () => {
    const processor = createHtmlRenderProcessor({
      chromium: { renderHtml: vi.fn(), renderUrl: vi.fn() },
    });
    expect(processor.tools).toEqual(["html-to-pdf", "webpage-to-pdf"]);
    expect(processor.supports("html-to-pdf")).toBe(true);
    expect(processor.supports("webpage-to-pdf")).toBe(true);
    expect(processor.capability()).toMatchObject({
      id: "html-render",
      ready: true,
    });
  });

  it("fails honestly without Chromium", async () => {
    const result = await createHtmlRenderProcessor({}).process(htmlInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_implemented");
  });

  it("renders uploaded HTML to a PDF artifact", async () => {
    const processor = createHtmlRenderProcessor({
      chromium: { renderHtml: vi.fn(async () => PDF), renderUrl: vi.fn() },
    });
    const result = await processor.process(htmlInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifacts[0]?.filename).toBe("landing.page.pdf");
      expect(result.artifacts[0]?.contentType).toBe("application/pdf");
      expect(result.meta).toMatchObject({ engine: "chromium", source: "html" });
    }
  });

  it("renders a URL-input webpage job to a PDF artifact", async () => {
    const renderUrl = vi.fn(async () => PDF);
    const processor = createHtmlRenderProcessor({
      chromium: { renderHtml: vi.fn(), renderUrl },
    });
    const result = await processor.process({
      tool: "webpage-to-pdf",
      inputs: [],
      options: { url: "https://example.com/report" },
    });
    expect(result.ok).toBe(true);
    expect(renderUrl).toHaveBeenCalledWith("https://example.com/report");
    if (result.ok)
      expect(result.artifacts[0]?.filename).toBe("example.com-report.pdf");
  });

  it("rejects malformed inputs and unsafe webpage URLs", async () => {
    const processor = createHtmlRenderProcessor({
      chromium: { renderHtml: vi.fn(), renderUrl: vi.fn() },
    });
    const noFile = await processor.process({
      tool: "html-to-pdf",
      options: {},
      inputs: [],
    });
    expect(noFile.ok).toBe(false);
    if (!noFile.ok) expect(noFile.error.code).toBe("unprocessable_entity");

    const badUrl = await processor.process({
      tool: "webpage-to-pdf",
      options: { url: "http://127.0.0.1" },
      inputs: [],
    });
    expect(badUrl.ok).toBe(false);
    if (!badUrl.ok) expect(badUrl.error.code).toBe("unprocessable_entity");
  });

  it("builds deterministic output names", () => {
    expect(htmlPdfOutputName("index.html")).toBe("index.pdf");
    expect(webpagePdfOutputName("https://example.com/a/b?x=1")).toBe(
      "example.com-a-b.pdf",
    );
  });
});
