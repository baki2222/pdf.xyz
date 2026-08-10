import { describe, expect, it } from "vitest";
import { resolveNativeHtmlRenderConfig } from "./native-config";

describe("resolveNativeHtmlRenderConfig", () => {
  it("defaults to enabled Chromium candidates and bounded limits", () => {
    expect(resolveNativeHtmlRenderConfig({})).toMatchObject({
      enabled: true,
      candidates: [
        "chromium",
        "chromium-browser",
        "google-chrome",
        "google-chrome-stable",
      ],
      overridden: false,
      timeoutMs: 120_000,
      maxInputBytes: 20 * 1024 * 1024,
      maxOutputBytes: 100 * 1024 * 1024,
    });
  });

  it("supports disable, binary override, timeout/input/output, and tmpdir", () => {
    expect(
      resolveNativeHtmlRenderConfig({
        PDFXYZ_HTML_RENDER: "off",
        PDFXYZ_CHROMIUM_BIN: "/usr/bin/chromium",
        PDFXYZ_HTML_RENDER_TIMEOUT_MS: "45000",
        PDFXYZ_HTML_RENDER_MAX_INPUT_BYTES: "12345",
        PDFXYZ_HTML_RENDER_MAX_OUTPUT_BYTES: "67890",
        PDFXYZ_HTML_RENDER_TMPDIR: "/tmp/pdfxyz",
      }),
    ).toMatchObject({
      enabled: false,
      candidates: ["/usr/bin/chromium"],
      overridden: true,
      timeoutMs: 45_000,
      maxInputBytes: 12_345,
      maxOutputBytes: 67_890,
      tmpDir: "/tmp/pdfxyz",
    });
  });
});
