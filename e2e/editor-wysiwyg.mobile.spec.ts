import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { captureDownload, pdfTextPositions } from "./client-proof/artifacts";
import { fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";

/**
 * Edit PDF on a touch phone (390 × 844, 3x): the page fits the screen's
 * width, the toolbar is reachable, a TAP places a text box, the soft keyboard
 * types into it, and the downloaded file carries the words where they were
 * shown — on a /Rotate 90 page, the case the old form got wrong.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

test("tap to place text on a rotated page, then download it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const only = doc.addPage([612, 792]);
  only.drawText("PHONE BASE", { x: 72, y: 720, size: 14, font });
  only.setRotation(degrees(90));
  await page.goto("/tools/edit-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "phone.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  });
  const sheet = page.locator('[data-editor-page="0"]');
  await expect(sheet).toHaveAttribute("data-page-pt", "792x612", {
    timeout: 20_000,
  });

  // Fit width: the whole page width is on screen.
  const viewport = page.viewportSize()!;
  await sheet.scrollIntoViewIfNeeded();
  let box = (await sheet.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);

  // The toolbar is reachable and its Text tool is a real target.
  const text = page.getByRole("button", { name: "Text", exact: true });
  await text.scrollIntoViewIfNeeded();
  await text.tap();
  await sheet.scrollIntoViewIfNeeded();
  box = (await sheet.boundingBox())!;
  const scale = box.width / 792;
  await page.touchscreen.tap(box.x + 120 * scale, box.y + 100 * scale);
  const editor = page.getByLabel("Text box text");
  await expect(editor).toBeFocused();
  await page.keyboard.type("PHONE-E2E");
  await page.keyboard.press("Escape");

  const t = page
    .locator('[data-object-kind="text"] text')
    .filter({ hasText: "PHONE-E2E" });
  const want = {
    x: Number(await t.getAttribute("x")),
    y: Number(await t.getAttribute("y")),
  };

  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /apply & download/i }),
  );
  const [read] = await pdfTextPositions(buf);
  const run = read!.runs.find((r) => r.str === "PHONE-E2E");
  expect(run, "the text is in the file").toBeTruthy();
  expect(run!.upright).toBe(true);
  expect(Math.abs(run!.x - want.x)).toBeLessThan(1);
  expect(Math.abs(run!.y - want.y)).toBeLessThan(1);
  expect(read!.runs.map((r) => r.str)).toContain("PHONE BASE");
});
