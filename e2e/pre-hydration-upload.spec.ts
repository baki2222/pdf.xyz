import { test, expect } from "@playwright/test";
import { writeTempPdf } from "./helpers";

/**
 * Our dropzones are server-rendered, so their `<input type="file">` is clickable
 * as soon as the HTML lands — before the client bundle boots. A file picked in
 * that window fires `change` at an element React isn't listening to yet, so the
 * event is lost while the file stays in `input.files`: the page then shows an
 * untouched dropzone that the user can only escape by picking a *different*
 * file. The drop box closes that window by adopting whatever is already in
 * its inputs the moment React takes it (`useDropBox`, which replaced
 * `useEarlyFilePick` in the WP-07 re-review).
 *
 * These specs deliberately upload *without* waiting for hydration — that is the
 * whole point — so they must not use the hydration-gated `uploadFiles` helper.
 */

/** Hold the client bundle back so the pre-hydration window is wide and certain. */
async function stallScripts(page: import("@playwright/test").Page) {
  await page.route("**/*.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
}

test("a tool dropzone adopts a file picked before hydration", async ({
  page,
}) => {
  await stallScripts(page);
  const source = await writeTempPdf("early.pdf", 2);

  // `commit` resolves as soon as the HTML lands — the bundle is still in flight.
  await page.goto("/tools/rotate-pdf", { waitUntil: "commit" });
  await page.locator('input[type="file"]').first().setInputFiles(source);

  await expect(page.getByText("early.pdf")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /apply rotation/i }),
  ).toBeVisible();
});

test("the workspace adopts files picked before hydration", async ({ page }) => {
  await stallScripts(page);
  const source = await writeTempPdf("staged.pdf", 1);

  await page.goto("/workspace", { waitUntil: "commit" });
  await page.locator('input[type="file"]').first().setInputFiles(source);

  await expect(page.getByText("staged.pdf")).toBeVisible();
});

test("the home desk adopts files picked before hydration", async ({ page }) => {
  await stallScripts(page);
  const source = await writeTempPdf("early-home.pdf", 2);

  await page.goto("/", { waitUntil: "commit" });
  // The desk's own picker: the page's first file input, server-rendered.
  await page.locator('input[type="file"]').first().setInputFiles(source);

  // Adopted on mount, measured, and listed on the ticket.
  const ticket = page.getByRole("region", {
    name: "What you can do with these files",
  });
  await expect(ticket.getByText("early-home.pdf")).toBeVisible({
    timeout: 20_000,
  });
  await expect(ticket).toContainText(/1 PDF\s·\s2 pages/);
});

/**
 * The same window for TYPED text (2026-10-24): Text to PDF and Markdown to PDF
 * render their textarea on the server, so a reader on a slow phone can type
 * before hydration. The words stay in the box, React's state stays empty, and
 * "Create PDF" does nothing — found by the client proof flaking against
 * production, where hydration is slower than locally.
 */
for (const { slug, box } of [
  { slug: "text-to-pdf", box: /Paste or type plain text here/ },
  { slug: "markdown-to-pdf", box: /Write or paste Markdown here/ },
]) {
  test(`${slug} keeps text typed before hydration`, async ({ page }) => {
    await stallScripts(page);
    await page.goto(`/tools/${slug}`, { waitUntil: "commit" });
    await page.getByPlaceholder(box).fill("typed-before-hydration");
    const create = page.getByRole("button", { name: /create pdf/i });
    await expect(create).toBeEnabled({ timeout: 20_000 });
    // Hydrated now: the press must act on the typed words.
    await expect
      .poll(() =>
        create.evaluate((el) =>
          Object.keys(el).some((k) => k.startsWith("__reactFiber$")),
        ),
      )
      .toBe(true);
    await create.click();
    await expect(
      page.getByRole("heading", { name: /pdf created/i }),
    ).toBeVisible({ timeout: 20_000 });
  });
}
