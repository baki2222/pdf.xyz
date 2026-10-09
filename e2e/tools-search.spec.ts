import { test, expect, type Page } from "@playwright/test";
import { attachConsoleGuard, waitForHydration } from "./helpers";

/**
 * `/tools?q=` as a reader receives it: a prerendered page that ranks the
 * query after hydration.
 *
 * The redesign spec asked for "the served HTML of /tools?q=pdf%20jpg" to list
 * PDF to JPG first. That cannot be true and should not be: `/tools` is static
 * (pages-static.test.ts), the query never reaches the server, and the served
 * page is the whole catalogue a crawler reads (ssr-content.test.ts). So this
 * checks the two halves where each lives — the served HTML is the unfiltered
 * catalogue, and the page the reader sees after hydration is ranked.
 */

/** Tool-page links inside the main content, in document order. */
async function toolLinks(page: Page): Promise<string[]> {
  const hrefs = await page
    .getByRole("main")
    .locator('a[href^="/tools/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  return hrefs.filter((href) => /^\/tools\/[a-z0-9-]+$/.test(href));
}

test.describe("the /tools search, after hydration", () => {
  test("?q=pdf%20jpg ranks PDF to JPG first — and the served HTML stays the whole catalogue", async ({
    page,
    request,
  }) => {
    const guard = attachConsoleGuard(page);

    // The served half: the static page, before any script runs.
    const served = await (await request.get("/tools?q=pdf%20jpg")).text();
    expect(served).not.toContain("Best matches for");
    expect(served).toContain('href="/tools/merge-pdf"');
    expect(served).toContain('href="/tools/webpage-to-pdf"');

    // The hydrated half.
    await page.goto("/tools?q=pdf%20jpg");
    await waitForHydration(
      page.getByRole("searchbox", { name: /search tools/i }),
    );
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Best matches for “pdf jpg”",
      }),
    ).toBeVisible();
    expect((await toolLinks(page))[0]).toBe("/tools/pdf-to-jpg");
    // The deep link is left as the reader arrived with it.
    expect(new URL(page.url()).search).toBe("?q=pdf%20jpg");

    expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
    expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
  });

  test("?q=heic answers that nothing opens HEIC, with the way in, and no Webpage to PDF", async ({
    page,
  }) => {
    const guard = attachConsoleGuard(page);
    await page.goto("/tools?q=heic");
    await waitForHydration(
      page.getByRole("searchbox", { name: /search tools/i }),
    );
    const answer = page.getByRole("region", {
      name: "No tool here opens HEIC photos.",
    });
    await expect(answer).toBeVisible();
    await expect(answer.getByText("Save a JPG copy first.")).toBeVisible();
    await expect(
      answer.getByRole("link", { name: /JPG to PDF/ }),
    ).toHaveAttribute("href", "/tools/jpg-to-pdf");
    expect(await toolLinks(page)).not.toContain("/tools/webpage-to-pdf");

    expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
  });

  test("typing ranks as you go, and a format filter survives a category click", async ({
    page,
  }) => {
    await page.goto("/tools?accepts=pdf");
    const box = page.getByRole("searchbox", { name: /search tools/i });
    await waitForHydration(box);
    await expect(
      page.getByRole("button", { name: /takes pdf/i }),
    ).toBeVisible();
    await box.fill("flip");
    await expect(
      page.getByRole("heading", { level: 2, name: "Best matches for “flip”" }),
    ).toBeVisible();
    expect((await toolLinks(page))[0]).toBe("/tools/rotate-pdf");
    await page.getByRole("button", { name: /^All tools/ }).click();
    await expect(page).toHaveURL(/accepts=pdf/);
    await expect(page).toHaveURL(/q=flip/);
  });
});
