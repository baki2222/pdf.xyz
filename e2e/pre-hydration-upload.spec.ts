import { test, expect } from "@playwright/test";
import { writeTempPdf } from "./helpers";

/**
 * Our dropzones are server-rendered, so their `<input type="file">` is clickable
 * as soon as the HTML lands — before the client bundle boots. A file picked in
 * that window fires `change` at an element React isn't listening to yet, so the
 * event is lost while the file stays in `input.files`: the page then shows an
 * untouched dropzone that the user can only escape by picking a *different*
 * file. `useEarlyFilePick` closes that window by adopting whatever is already
 * in the input the moment React mounts.
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
