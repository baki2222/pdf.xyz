import { test, expect } from "@playwright/test";
import { fileInput, waitForHydration } from "./helpers";
import { captureDownload, pdfPageTexts } from "./client-proof/artifacts";
import { makeTextPdf, pageMarker } from "./client-proof/fixtures";

/**
 * Organize Pages' "Move to position…" on a phone (audit organize-pages#4,
 * 2026-11-22). Pages moved one step a press, a native drag that a touch
 * browser never fires, and Home / End only on a grabbed handle: page 80 to
 * the front was 79 presses. Here it is one field and Enter, on an 80-page
 * file, judged on the file the phone downloads: page 1 is the old page 80,
 * and the other 79 keep their order.
 */
const NAME = "eighty.pdf";
const PAGES = 80;

test("page 80 goes to position 1 in one step, and the download says so", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const bytes = await makeTextPdf(NAME, { pages: PAGES });
  await page.goto("/tools/organize-pages");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: NAME,
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  });

  const trigger = page.getByRole("button", {
    name: `Move page ${PAGES} to position…`,
  });
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.tap();
  const field = page.getByLabel(
    `New position for page ${PAGES}, 1 to ${PAGES}`,
  );
  // The field takes focus, so the phone's keyboard opens on it.
  await expect(field).toBeFocused();
  await field.fill("1");
  await field.press("Enter");

  const tiles = page
    .getByRole("list", { name: /^Pages/ })
    .getByRole("listitem");
  await expect(tiles.first()).toHaveAttribute(
    "aria-label",
    `Page ${PAGES}, position 1 of ${PAGES}`,
  );
  await expect(tiles.nth(1)).toHaveAttribute(
    "aria-label",
    `Page 1, position 2 of ${PAGES}`,
  );
  // Focus is back on the moved page's own button, at the front.
  await expect(trigger).toBeFocused();

  const run = page.getByRole("button", { name: /apply & export/i });
  await run.tap();
  await expect(
    page.getByRole("heading", { name: /pages organized/i }),
  ).toBeVisible({ timeout: 60_000 });
  const out = await captureDownload(
    page,
    page.getByRole("button", { name: /download organized pdf/i }),
  );
  const texts = await pdfPageTexts(out);
  expect(texts).toHaveLength(PAGES);
  // The marker is `pageMarker(NAME, n)`; read n whole, so page 8 is never
  // taken for page 80.
  const prefix = pageMarker(NAME, 0).replace(/0$/, "");
  const markers = texts.map((text) => {
    const found = text
      .split(/\s+/)
      .filter((word) => word.startsWith(prefix))
      .map((word) => Number(word.slice(prefix.length)));
    expect(found, `one marker per page: ${text}`).toHaveLength(1);
    return found[0];
  });
  expect(markers).toEqual([
    PAGES,
    ...Array.from({ length: PAGES - 1 }, (_, i) => i + 1),
  ]);
});
