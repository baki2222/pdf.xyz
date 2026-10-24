import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  captureDownload,
  pdfPageTexts,
  pdfTextPositions,
} from "./client-proof/artifacts";
import { attachConsoleGuard, fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";

/**
 * Edit PDF's Phase 2, driven by hand through the live page and proven on the
 * bytes it downloads: click a line of text already in the PDF and change a
 * word; find a word on the page and replace it; drag a redaction box over a
 * line. Each downloaded file is read with pdfjs in THIS process — the old
 * words are ABSENT from the text a reader (or a search, or a copy) gets, the
 * new words are there, where the run was.
 *
 * `EDITOR_SHOTS=<dir>` saves a screenshot of each step for a reviewer.
 */

const PAGE_W = 612;
const PAGE_H = 792;

async function fixture(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  page.drawText("Invoice number 1001", { x: 72, y: 700, size: 16, font });
  page.drawText("Customer: Jane Doe", { x: 72, y: 660, size: 12, font });
  page.drawText("Account 4242 4242 secret", { x: 72, y: 620, size: 12, font });
  page.drawText("Thank you for your business", {
    x: 72,
    y: 580,
    size: 12,
    font,
  });
  return Buffer.from(await doc.save());
}

async function shot(page: Page, name: string) {
  const dir = process.env.EDITOR_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page
    .locator("[data-wysiwyg-editor]")
    .screenshot({ path: join(dir, `${name}.png`) });
}

/** Screen coordinates of a point given in a page's viewer points. */
async function at(page: Page, index: number, x: number, y: number) {
  const sheet = page.locator(`[data-editor-page="${index}"]`);
  await sheet.scrollIntoViewIfNeeded();
  const box = (await sheet.boundingBox())!;
  const scale = box.width / PAGE_W;
  return { x: box.x + x * scale, y: box.y + y * scale, scale };
}

const said = (page: Page) =>
  page.locator("[data-wysiwyg-editor] > [role=status]");

async function open(page: Page) {
  await page.goto("/tools/edit-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "invoice.pdf",
    mimeType: "application/pdf",
    buffer: await fixture(),
  });
  await expect(
    page.locator('[data-editor-page="0"] [data-page-raster] canvas'),
  ).toBeAttached({ timeout: 20_000 });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

test("click a line of text, change a word, download: the old word is gone from the file", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const guard = attachConsoleGuard(page);
  await open(page);

  await page.getByRole("button", { name: "Edit text", exact: true }).click();
  const run = page.getByRole("button", {
    name: /Edit text “Invoice number 1001”/,
  });
  await expect(run).toBeAttached({ timeout: 20_000 });
  await run.click();
  const editor = page.locator("[data-run-editor]");
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("Invoice number 1001");
  // Helvetica is a standard font: the replacement is written in it.
  await expect(page.locator("[data-font-note]")).toHaveAttribute(
    "data-font-note",
    "own",
  );
  await editor.fill("Invoice number 2002");
  await shot(page, "edit-text-run");
  await editor.press("Enter");
  await expect(said(page)).toContainText("Text edited");
  await expect(page.locator('[data-object-kind="textedit"] text')).toHaveText(
    "Invoice number 2002",
  );

  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /apply & download/i }),
  );
  const [text] = await pdfPageTexts(buf);
  expect(text).not.toContain("1001");
  expect(text).toContain("Invoice number 2002");
  expect(text).toContain("Customer: Jane Doe");
  const [first] = await pdfTextPositions(buf);
  const placed = first!.runs.find((r) => r.str.includes("2002"))!;
  expect(placed, "the replacement is in the file").toBeTruthy();
  expect(Math.abs(placed.x - 72)).toBeLessThan(1);
  expect(Math.abs(placed.y - (PAGE_H - 700))).toBeLessThan(1);
  expect(guard.pageErrors).toEqual([]);
  expect(guard.cspViolations()).toEqual([]);
});

test("find & replace one word across the page", async ({ page }) => {
  test.setTimeout(90_000);
  const guard = attachConsoleGuard(page);
  await open(page);
  await page.locator("[data-editor-viewport]").focus();
  await page.keyboard.press("Control+f");
  const find = page.getByRole("searchbox", { name: "Find" });
  await expect(find).toBeFocused();
  await find.fill("Jane");
  await expect(page.locator("[data-find-status]")).toHaveText("1 of 1 match", {
    timeout: 20_000,
  });
  await expect(page.locator('[data-find-hit="current"]')).toHaveCount(1);
  await page.getByRole("textbox", { name: "Replace with" }).fill("John");
  await shot(page, "find-replace-panel");
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(said(page)).toContainText("1 replaced");
  await expect(page.locator("[data-find-status]")).toHaveText("No matches");

  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /apply & download/i }),
  );
  const [text] = await pdfPageTexts(buf);
  expect(text).not.toContain("Jane");
  expect(text).toContain("Customer: John Doe");
  expect(text).toContain("Invoice number 1001");
  expect(guard.pageErrors).toEqual([]);
});

test("redact a line: the text under the box is removed from the file", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const guard = attachConsoleGuard(page);
  await open(page);
  await page.getByRole("button", { name: "Redact", exact: true }).click();
  // The "Account …" line: baseline at 792 - 620 = 172 pt from the top.
  const a = await at(page, 0, 66, 172 - 13);
  const b = await at(page, 0, 300, 172 + 5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('[data-object-kind="redact"]')).toHaveCount(1);
  await expect(page.locator("[data-redact-note]:visible")).toContainText(
    "removed from the file",
  );
  await shot(page, "redact-box");

  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /apply & download/i }),
  );
  const [text] = await pdfPageTexts(buf);
  expect(text).not.toContain("4242");
  expect(text).not.toContain("secret");
  expect(text).toContain("Customer: Jane Doe");
  expect(text).toContain("Thank you for your business");
  expect(guard.pageErrors).toEqual([]);
});
