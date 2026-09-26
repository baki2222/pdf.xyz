import { describe, expect, it } from "vitest";
import {
  HTML_RENDER_MAX_INPUT_BYTES,
  resolveNativeHtmlRenderConfig,
} from "./native-config";

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
      maxInputBytes: HTML_RENDER_MAX_INPUT_BYTES,
      maxOutputBytes: 100 * 1024 * 1024,
    });
  });

  it("supports disable, binary override, timeout/input/output, and tmpdir", () => {
    expect(
      resolveNativeHtmlRenderConfig({
        PDFXYZ_HTML_RENDER: "off",
        PDFXYZ_CHROMIUM_BIN: "/usr/bin/chromium",
        PDFXYZ_HTML_RENDER_TIMEOUT_MS: "45000",
        PDFXYZ_HTML_RENDER_MAX_INPUT_BYTES: String(
          HTML_RENDER_MAX_INPUT_BYTES + 12_345,
        ),
        PDFXYZ_HTML_RENDER_MAX_OUTPUT_BYTES: "67890",
        PDFXYZ_HTML_RENDER_TMPDIR: "/tmp/pdfxyz",
      }),
    ).toMatchObject({
      enabled: false,
      candidates: ["/usr/bin/chromium"],
      overridden: true,
      timeoutMs: 45_000,
      maxInputBytes: HTML_RENDER_MAX_INPUT_BYTES + 12_345,
      maxOutputBytes: 67_890,
      tmpDir: "/tmp/pdfxyz",
    });
  });

  /**
   * INVERTED. The case above used to set the input cap to 12,345 bytes and
   * expect it honoured. The HTML to PDF page states HTML_RENDER_MAX_INPUT_BYTES,
   * and the web tier cannot see a worker's env, so an override BELOW it made
   * the page overstate what the renderer accepts. An override may only raise.
   */
  it("an input override cannot lower the cap below the published figure", () => {
    expect(
      resolveNativeHtmlRenderConfig({
        PDFXYZ_HTML_RENDER_MAX_INPUT_BYTES: "12345",
      }).maxInputBytes,
    ).toBe(HTML_RENDER_MAX_INPUT_BYTES);
  });
});
