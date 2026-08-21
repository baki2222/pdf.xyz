import { test, expect } from "@playwright/test";
import { FONT_PACKS, fontPackUrl } from "../src/lib/pdf/font-packs";

/**
 * The faces are actually SERVED by the deployed app.
 *
 * Every other check on this feature reads structure: that the pack table
 * matches the installed packages, that the copy step lists the right files,
 * that the glyph ids in a saved PDF resolve to real outlines inside the
 * embedded subset. None of them notices if the bytes never reach the
 * deployment — and the failure that produces is a tool that refuses Bengali on
 * production while every test stays green, which is the exact shape of the
 * defect this feature exists to close, one layer down.
 *
 * This is the only check that exercises the real server, so it is deliberately
 * dumb: fetch each face over HTTP and require a 200 whose body is the right
 * length and starts with a TrueType signature.
 *
 * BOUND, stated so nobody reads more into it. This proves the bytes are
 * reachable. It does NOT rasterise. The "a viewer really paints these glyphs"
 * half was measured once in Chromium, at 3x, counting pixels darker than
 * mid-grey — 12,821 for Bengali, 11,337 for Chinese, and 11,337 for the same
 * Chinese text with the font embedded WHOLE rather than subset, which is the
 * comparison that matters. Those numbers are recorded in
 * `src/lib/pdf/unicode-font.test.ts`, and the structural chain that agrees with
 * them runs on every commit; a checked-in file that renders blank
 * (`src/tests/fixtures-broken-subset.ts`) keeps that chain honest.
 */
test.describe("Unicode faces for the text tools", () => {
  test("every shipped face is served", async ({ request }) => {
    for (const pack of FONT_PACKS) {
      const url = fontPackUrl(pack);
      const res = await request.get(url);
      expect(
        res.status(),
        `${url} is not served — every ${pack.label} watermark, page number, header, note and signature would fail with a font-fetch error. Did the build run scripts/copy-noto-fonts.ts?`,
      ).toBe(200);
      const body = await res.body();
      expect(
        body.byteLength,
        `${url} served ${body.byteLength} bytes, expected ${pack.bytes}`,
      ).toBe(pack.bytes);
      // A 200 carrying an HTML error page would pass a status check and a
      // loose size check; it will not pass a TrueType signature.
      expect(
        Array.from(body.subarray(0, 4)),
        `${url} does not begin with a TrueType signature`,
      ).toEqual([0x00, 0x01, 0x00, 0x00]);
    }
  });

  test("faces are cacheable forever, since the URL carries the version", async ({
    request,
  }) => {
    // 10.5 MB for the Chinese face. Re-downloading it because the URL was not
    // version-stamped would be the most expensive cache miss in the product.
    const res = await request.get(fontPackUrl(FONT_PACKS[0]!));
    expect(res.headers()["cache-control"]).toContain("immutable");
  });
});
