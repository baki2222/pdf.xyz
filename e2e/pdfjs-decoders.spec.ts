import { test, expect } from "@playwright/test";
import { PDFJS_WASM_ASSETS, PDFJS_WASM_URL } from "../src/lib/pdf/wasm-assets";

/**
 * The decoders are actually SERVED by the deployed app.
 *
 * Every other check on this fix reads source: that the option is passed, that
 * the pinned version matches, that the copy step lists the right files. None
 * of them notices if the assets never reach the deployment — and the failure
 * that produces is the original defect exactly: a scanned page renders blank
 * into a downloaded file, with no error and nothing logged.
 *
 * This is the only check that exercises the real server, so it is deliberately
 * dumb: fetch each asset over HTTP and require a 200 with a non-trivial body.
 *
 * Bound, stated: this proves the bytes are reachable. It does NOT prove pdfjs
 * decodes with them — that needs a codec fixture, which is the separate
 * proposal.
 */
test.describe("pdfjs image decoders", () => {
  test("every declared decoder asset is served", async ({ request }) => {
    for (const asset of PDFJS_WASM_ASSETS) {
      const url = `${PDFJS_WASM_URL}${asset}`;
      const res = await request.get(url);
      expect(
        res.status(),
        `${url} is not served — pdfjs would fail to decode JPEG2000/JBIG2 images ` +
          "and render them blank, silently. Did the build run scripts/copy-pdfjs-wasm.ts?",
      ).toBe(200);
      const body = await res.body();
      expect(body.byteLength, `${url} served an empty body`).toBeGreaterThan(
        1024,
      );
    }
  });

  test("decoder assets are cacheable forever, since the URL carries the version", async ({
    request,
  }) => {
    const res = await request.get(`${PDFJS_WASM_URL}${PDFJS_WASM_ASSETS[0]}`);
    expect(res.headers()["cache-control"]).toContain("immutable");
  });
});
