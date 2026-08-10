import { test, expect } from "@playwright/test";

/**
 * An unknown tool slug must answer 404, not 200.
 *
 * This uses the `request` fixture and asserts on the STATUS LINE, because the
 * bug it pins is invisible to everything else. `/tools/[slug]` calls
 * `notFound()` for an unrecognised slug and renders the site's 404 page, so a
 * human — and a `page.goto()` assertion about the visible text — sees a
 * perfectly correct "This page took a wrong turn". Measured on production on
 * 2026-08-05, that page was served with `HTTP/1.1 200 OK` and 36 KB of markup,
 * because `dynamicParams` defaults to true and Next rendered the unknown slug
 * on demand rather than refusing it. A soft 404: crawlers index the URL, and
 * `noIndex` only asks them not to.
 *
 * So the discriminator is the status code alone. Any assertion about the body
 * would have been green throughout the bug's life.
 */

const UNKNOWN_SLUG = "definitely-not-a-real-tool";

test.describe("unknown routes answer 404", () => {
  test("a real tool slug is still 200", async ({ request }) => {
    // The control. Without it, "everything under /tools 404s" — a far worse
    // bug — would pass this file.
    const res = await request.get("/tools/merge-pdf");
    expect(res.status()).toBe(200);
  });

  test("an unknown tool slug is 404, not a 200 that says 404", async ({
    request,
  }) => {
    const res = await request.get(`/tools/${UNKNOWN_SLUG}`);
    expect(res.status()).toBe(404);
  });

  test("the 404 body is the site's own page, not a bare error", async ({
    request,
  }) => {
    // A correct status served with an empty or framework-default body would be
    // a different regression, and the status assertion above cannot see it.
    const res = await request.get(`/tools/${UNKNOWN_SLUG}`);
    const html = await res.text();
    expect(html).toContain("This page took a wrong turn");
  });

  test("the share cards for an unknown slug are 404, not a brand fallback", async ({
    request,
  }) => {
    // These routes rendered a generic pdf.xyz card with a 200 for any slug at
    // all, which is a share preview for a page that does not exist.
    for (const suffix of ["opengraph-image", "twitter-image"]) {
      const res = await request.get(`/tools/${UNKNOWN_SLUG}/${suffix}`);
      expect(res.status(), `/tools/${UNKNOWN_SLUG}/${suffix}`).toBe(404);
    }
  });

  test("a share card for a real tool is still 200 and a PNG", async ({
    request,
  }) => {
    const res = await request.get("/tools/merge-pdf/opengraph-image");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  });

  test("a path outside /tools is 404", async ({ request }) => {
    const res = await request.get("/no-such-page-at-all");
    expect(res.status()).toBe(404);
  });
});
