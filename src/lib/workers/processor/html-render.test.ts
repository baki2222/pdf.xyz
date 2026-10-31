import { describe, expect, it, vi } from "vitest";
import { DEFAULT_HTML_RENDER_OPTIONS } from "@/lib/jobs/html-render-options";
import {
  createHtmlRenderProcessor,
  htmlPdfOutputName,
  webpagePdfOutputName,
} from "./html-render";
import {
  WebpageFetchError,
  webpageFetchMessage,
  type WebpageFetchFailure,
} from "../html-render/engine";

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
    expect(renderUrl).toHaveBeenCalledWith(
      "https://example.com/report",
      DEFAULT_HTML_RENDER_OPTIONS,
      {},
    );
    if (result.ok)
      expect(result.artifacts[0]?.filename).toBe("example.com-report.pdf");
  });

  it("parses the layout from the job's options and renders with it", async () => {
    const renderUrl = vi.fn(async () => PDF);
    const renderHtml = vi.fn(async () => PDF);
    const processor = createHtmlRenderProcessor({
      chromium: { renderHtml, renderUrl },
    });
    await processor.process({
      tool: "webpage-to-pdf",
      inputs: [],
      options: {
        url: "https://example.com/report",
        pageSize: "A4",
        orientation: "landscape",
        onePage: true,
      },
    });
    expect(renderUrl).toHaveBeenCalledWith(
      "https://example.com/report",
      {
        ...DEFAULT_HTML_RENDER_OPTIONS,
        pageSize: "A4",
        orientation: "landscape",
        onePage: true,
      },
      {},
    );
    await processor.process({
      tool: "html-to-pdf",
      options: { margin: "none", viewport: "phone" },
      inputs: [
        {
          fileId: "f",
          filename: "page.html",
          contentType: "text/html",
          bytes: new TextEncoder().encode("<p>x</p>"),
        },
      ],
    });
    expect(renderHtml).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      {
        ...DEFAULT_HTML_RENDER_OPTIONS,
        margin: "none",
        viewport: "phone",
      },
      {},
    );
  });

  it("refuses a layout value it does not offer, finally, before rendering", async () => {
    const renderHtml = vi.fn(async () => PDF);
    const processor = createHtmlRenderProcessor({
      chromium: { renderHtml, renderUrl: vi.fn() },
    });
    const result = await processor.process({
      tool: "html-to-pdf",
      options: { pageSize: "B5" },
      inputs: [
        {
          fileId: "f",
          filename: "page.html",
          contentType: "text/html",
          bytes: new TextEncoder().encode("<p>x</p>"),
        },
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_request", retryable: false },
    });
    expect(renderHtml).not.toHaveBeenCalled();
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

  /*
   * The composed chain renderer error -> engine -> job error. A site's answer
   * is the site's doing: it must never read as `internal_error`, and a 404
   * must not be requeued to fetch the same 404 twice more.
   */
  it("a page the site would not serve fails the job with the site's reason", async () => {
    const run = async (failure: WebpageFetchFailure) =>
      createHtmlRenderProcessor({
        chromium: {
          renderHtml: vi.fn(),
          renderUrl: vi.fn(async () => {
            throw new WebpageFetchError(failure);
          }),
        },
      }).process({
        tool: "webpage-to-pdf",
        inputs: [],
        options: { url: "https://example.com/missing" },
      });
    const notFound = { reason: "http", status: 404 } as const;
    expect(await run(notFound)).toMatchObject({
      ok: false,
      error: {
        code: "unprocessable_entity",
        message: webpageFetchMessage(notFound),
        retryable: false,
      },
    });
    const down = { reason: "http", status: 503 } as const;
    expect(await run(down)).toMatchObject({
      ok: false,
      error: {
        code: "service_unavailable",
        message: webpageFetchMessage(down),
        retryable: true,
      },
    });
  });

  it("builds deterministic output names", () => {
    expect(htmlPdfOutputName("index.html")).toBe("index.pdf");
    expect(webpagePdfOutputName("https://example.com/a/b?x=1")).toBe(
      "example.com-a-b.pdf",
    );
  });
});
