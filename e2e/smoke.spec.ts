import { test, expect } from "@playwright/test";
import path from "node:path";
import { attachConsoleGuard } from "./helpers";
import { findIndexNowKey } from "../scripts/indexnow-submit.mjs";

test.describe("core pages", () => {
  test("homepage renders, is navigable, and ships structured data", async ({
    page,
  }) => {
    const guard = attachConsoleGuard(page);
    const res = await page.goto("/");
    expect(res?.status()).toBe(200);

    // Landmarks + hero headline.
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: /every pdf tool/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /browse all tools/i }).first(),
    ).toBeVisible();

    // JSON-LD: the FAQPage schema should be present.
    const ldJson = (
      await page.locator('script[type="application/ld+json"]').allTextContents()
    ).join("\n");
    expect(ldJson).toContain('"FAQPage"');
    expect(ldJson).toContain('"Organization"');

    expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
    expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
  });

  test("tools catalog lists tools and filters by category", async ({
    page,
  }) => {
    const guard = attachConsoleGuard(page);
    await page.goto("/tools");

    await expect(
      page.getByRole("heading", {
        level: 1,
        // "Every PDF tool, one place" until 2026-10-23.
        name: "All PDF tools",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: /search tools/i }),
    ).toBeVisible();

    // The catalog is data-driven; expect a healthy number of tool links.
    const toolLinks = page.locator('a[href^="/tools/"]');
    expect(await toolLinks.count()).toBeGreaterThanOrEqual(20);
    await expect(
      page.getByRole("link", { name: "Merge PDF" }).first(),
    ).toBeVisible();

    // Filtering updates the shareable URL and narrows results.
    await page.getByRole("button", { name: /^AI/ }).click();
    await expect(page).toHaveURL(/category=ai/);
    await expect(
      page.getByRole("link", { name: "Chat with PDF" }).first(),
    ).toBeVisible();

    expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
    expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
  });

  test("supported tool page mounts the in-browser runner", async ({ page }) => {
    const guard = attachConsoleGuard(page);
    await page.goto("/tools/merge-pdf");

    await expect(
      page.getByRole("heading", { level: 1, name: "Merge PDF" }),
    ).toBeVisible();
    await expect(page.getByText(/runs in your browser/i).first()).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }),
    ).toBeVisible();
    // The client runner exposes a file input for staging PDFs locally.
    expect(
      await page.locator('input[type="file"]').count(),
    ).toBeGreaterThanOrEqual(1);

    const ldJson = (
      await page.locator('script[type="application/ld+json"]').allTextContents()
    ).join("\n");
    expect(ldJson).toContain('"BreadcrumbList"');
    expect(ldJson).toContain('"WebApplication"');

    expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
    expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
  });

  test("workspace page renders and is marked noindex", async ({ page }) => {
    const guard = attachConsoleGuard(page);
    await page.goto("/workspace");

    await expect(
      page.getByRole("heading", { level: 1, name: /your workspace/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Add files" })).toBeVisible();
    expect(
      await page.locator('input[type="file"]').count(),
    ).toBeGreaterThanOrEqual(1);

    const robots = await page
      .locator('meta[name="robots"]')
      .first()
      .getAttribute("content");
    expect(robots).toContain("noindex");

    expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
    expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
  });
});

test.describe("production hardening", () => {
  test("security headers are present on responses", async ({ page }) => {
    const res = await page.goto("/");
    const headers = res!.headers();

    const csp = headers["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBeTruthy();
    expect(headers["permissions-policy"] ?? "").toContain("camera=()");
  });

  test("robots, sitemap, and manifest are served", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    const robotsBody = await robots.text();
    expect(robotsBody).toContain("Sitemap:");
    expect(robotsBody).toMatch(/Allow: \//);

    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    const sitemapBody = await sitemap.text();
    expect(sitemapBody).toContain("<urlset");
    expect(sitemapBody).toContain("/tools/merge-pdf");

    // Follow the index the way a crawler does — read its child from the
    // served XML rather than naming it here — and require the same page set
    // the metadata-route sitemap publishes. The index is what Google reads.
    const index = await request.get("/sitemap-index.xml");
    expect(index.status()).toBe(200);
    const child = /<loc>([^<]+)<\/loc>/.exec(await index.text())?.[1];
    expect(child, "the sitemap index names no child").toBeTruthy();
    const childRes = await request.get(new URL(child!).pathname);
    expect(childRes.status()).toBe(200);
    expect(childRes.headers()["content-type"]).toContain("xml");
    const childBody = await childRes.text();
    const urlsOf = (xml: string) =>
      [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
    expect(urlsOf(childBody).length).toBeGreaterThan(60);
    expect(urlsOf(childBody)).toEqual(urlsOf(sitemapBody));

    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.status()).toBe(200);
    const manifestJson = JSON.parse(await manifest.text());
    expect(manifestJson.name).toContain("pdf.xyz");
    expect(Array.isArray(manifestJson.icons)).toBe(true);
  });

  test("the IndexNow key file is served at the host root", async ({
    request,
  }) => {
    // IndexNow fetches this before it accepts a submission; a 404 or a body
    // that is not the key turns every publish's submission into a 403.
    const key = findIndexNowKey(path.join(process.cwd(), "public"));
    const res = await request.get(`/${key}.txt`);
    expect(res.status()).toBe(200);
    expect((await res.text()).trim()).toBe(key);
  });

  test("the OpenGraph share image is wired and generated", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    const ogUrl = await page
      .locator('meta[property="og:image"]')
      .first()
      .getAttribute("content");
    expect(ogUrl, "og:image meta tag should be present").toBeTruthy();

    const og = await request.get(new URL(ogUrl!).pathname);
    expect(og.status()).toBe(200);
    expect(og.headers()["content-type"]).toContain("image/");
  });
});
