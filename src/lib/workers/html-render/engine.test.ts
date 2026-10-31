import { describe, expect, it, vi } from "vitest";
import {
  HTML_TO_PDF_TOOL,
  WEBPAGE_TO_PDF_TOOL,
  WebpageFetchError,
  isRetryableWebpageFetch,
  runHtmlToPdf,
  runWebpageToPdf,
  webpageFetchMessage,
  type ChromiumPdfRunner,
  type WebpageFetchFailure,
} from "./engine";
import { DEFAULT_HTML_RENDER_OPTIONS } from "@/lib/jobs/html-render-options";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);
const HTML = new TextEncoder().encode(
  "<!doctype html><html><body><h1>Hello</h1></body></html>",
);

function runner(output = PDF): ChromiumPdfRunner {
  return {
    renderHtml: vi.fn(async () => output),
    renderUrl: vi.fn(async () => output),
  };
}

describe("html-render engine", () => {
  it("declares the owned tools", () => {
    expect([HTML_TO_PDF_TOOL, WEBPAGE_TO_PDF_TOOL]).toEqual([
      "html-to-pdf",
      "webpage-to-pdf",
    ]);
  });

  it("fails honestly when Chromium is unavailable", async () => {
    await expect(runHtmlToPdf(HTML, {})).resolves.toMatchObject({
      ok: false,
      kind: "unsupported",
    });
    await expect(
      runWebpageToPdf("https://example.com", {}),
    ).resolves.toMatchObject({ ok: false, kind: "unsupported" });
  });

  it("renders HTML bytes with Chromium and validates PDF output", async () => {
    const chromium = runner();
    const result = await runHtmlToPdf(HTML, { chromium });
    expect(result).toMatchObject({
      ok: true,
      meta: { engine: "chromium", source: "html", outputBytes: PDF.byteLength },
    });
    // No layout asked for: the defaults, which render exactly as before.
    // The third argument is the run control: no attempt signal here.
    expect(chromium.renderHtml).toHaveBeenCalledWith(
      HTML,
      DEFAULT_HTML_RENDER_OPTIONS,
      {},
    );
  });

  it("hands the validated layout to Chromium for both tools", async () => {
    const chromium = runner();
    const layout = {
      ...DEFAULT_HTML_RENDER_OPTIONS,
      pageSize: "A4" as const,
      orientation: "landscape" as const,
      onePage: true,
    };
    await runHtmlToPdf(HTML, { chromium }, layout);
    expect(chromium.renderHtml).toHaveBeenCalledWith(HTML, layout, {});
    await runWebpageToPdf("https://example.com/report", { chromium }, layout);
    expect(chromium.renderUrl).toHaveBeenCalledWith(
      "https://example.com/report",
      layout,
      {},
    );
  });

  it("renders safe public webpage URLs with Chromium", async () => {
    const chromium = runner();
    const result = await runWebpageToPdf("https://example.com/report", {
      chromium,
    });
    expect(result).toMatchObject({
      ok: true,
      meta: { engine: "chromium", source: "url" },
    });
    expect(chromium.renderUrl).toHaveBeenCalledWith(
      "https://example.com/report",
      DEFAULT_HTML_RENDER_OPTIONS,
      {},
    );
  });

  it("rejects invalid or private URLs before invoking Chromium", async () => {
    const chromium = runner();
    await expect(
      runWebpageToPdf("http://localhost:3000", { chromium }),
    ).resolves.toMatchObject({ ok: false, kind: "invalid_url" });
    await expect(
      runWebpageToPdf("ftp://example.com", { chromium }),
    ).resolves.toMatchObject({ ok: false, kind: "invalid_url" });
    expect(chromium.renderUrl).not.toHaveBeenCalled();
  });

  it("enforces size limits and never accepts non-PDF output", async () => {
    await expect(
      runHtmlToPdf(HTML, { chromium: runner(), limits: { maxInputBytes: 4 } }),
    ).resolves.toMatchObject({ ok: false, kind: "too_large", limitBytes: 4 });
    await expect(
      runHtmlToPdf(HTML, {
        chromium: runner(new TextEncoder().encode("no pdf")),
      }),
    ).resolves.toMatchObject({ ok: false, kind: "failed" });
  });

  /*
   * Until 2026-09 this catch returned "Chromium could not render this
   * webpage." for EVERY error — so even once the renderer could tell a 404
   * from a crash, the user could not. What the site did is now what they read.
   */
  it("tells the user what the site did, not that Chromium failed", async () => {
    const failures: WebpageFetchFailure[] = [
      { reason: "http", status: 404 },
      { reason: "http", status: 403 },
      { reason: "http", status: 503 },
      { reason: "http", status: 429 },
      { reason: "http", status: 418 },
      { reason: "challenge", status: 403 },
      { reason: "blocked" },
      { reason: "unresolved" },
      { reason: "unreachable" },
      { reason: "unreadable" },
      { reason: "navigation", errorText: "net::ERR_ABORTED" },
    ];
    const generic = await runWebpageToPdf("https://example.com/", {
      chromium: {
        renderHtml: vi.fn(),
        renderUrl: vi.fn(async () => {
          throw new Error("boom");
        }),
      },
    });
    const messages = new Set<string>();
    for (const failure of failures) {
      const result = await runWebpageToPdf("https://example.com/", {
        chromium: {
          renderHtml: vi.fn(),
          renderUrl: vi.fn(async () => {
            throw new WebpageFetchError(failure);
          }),
        },
      });
      expect(result).toEqual({
        ok: false,
        kind: "page_unavailable",
        failure,
        retryable: isRetryableWebpageFetch(failure),
        message: webpageFetchMessage(failure),
      });
      if (!result.ok) {
        expect(result.message).not.toBe(generic.ok ? "" : generic.message);
        messages.add(result.message);
      }
      // An HTTP answer names its status; the user can act on a number.
      if ("status" in failure)
        expect(webpageFetchMessage(failure)).toContain(String(failure.status));
    }
    // Every failure reads differently: none is a catch-all in disguise.
    expect(messages.size).toBe(failures.length);
    // Positive control: an error that is NOT the site's keeps the generic
    // sentence, so the typed branch above is what changed the message.
    expect(generic).toMatchObject({
      ok: false,
      kind: "failed",
      message: "Chromium could not render this webpage.",
    });
  });

  it("retries only what could answer differently next time", () => {
    const retryable = (failure: WebpageFetchFailure) =>
      isRetryableWebpageFetch(failure);
    expect(retryable({ reason: "http", status: 500 })).toBe(true);
    expect(retryable({ reason: "http", status: 503 })).toBe(true);
    expect(retryable({ reason: "http", status: 429 })).toBe(true);
    expect(retryable({ reason: "unreachable" })).toBe(true);
    expect(retryable({ reason: "http", status: 404 })).toBe(false);
    expect(retryable({ reason: "http", status: 499 })).toBe(false);
    expect(retryable({ reason: "challenge", status: 503 })).toBe(false);
    expect(retryable({ reason: "blocked" })).toBe(false);
    expect(retryable({ reason: "unresolved" })).toBe(false);
  });
});
