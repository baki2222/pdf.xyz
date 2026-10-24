import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { captureDownload, pdfPageTexts } from "./client-proof/artifacts";
import { fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";

/**
 * Edit text on a touch phone (390 × 844, 3x): the Edit text tool is reachable
 * in the docked toolbar, a TAP on a line of the PDF's own text opens it for
 * typing, and the downloaded file has the new word and not the old one.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

test("tap a line of text, retype a word, download", async ({ page }) => {
  test.setTimeout(90_000);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const only = doc.addPage([612, 792]);
  only.drawText("Phone total 350", { x: 72, y: 700, size: 24, font });
  await page.goto("/tools/edit-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "phone.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('[data-editor-page="0"]')).toBeAttached({
    timeout: 20_000,
  });

  const tool = page.getByRole("button", { name: "Edit text", exact: true });
  await tool.scrollIntoViewIfNeeded();
  await tool.tap();
  const run = page.getByRole("button", { name: /Edit text “Phone total 350”/ });
  await expect(run).toBeAttached({ timeout: 20_000 });
  await run.scrollIntoViewIfNeeded();
  const box = (await run.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  const editor = page.locator("[data-run-editor]");
  await expect(editor).toBeFocused();
  await editor.fill("Phone total 420");
  await editor.press("Enter");
  await expect(page.locator('[data-object-kind="textedit"] text')).toHaveText(
    "Phone total 420",
  );

  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /apply & download/i }),
  );
  const [text] = await pdfPageTexts(buf);
  expect(text).not.toContain("350");
  expect(text).toContain("Phone total 420");
});
