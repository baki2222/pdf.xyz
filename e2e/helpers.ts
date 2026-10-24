import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { drawRasterImage, embedRasterImage } from "../src/lib/pdf/pdf-lib";

/**
 * Generate a tiny, valid multi-page PDF in-process with pdf-lib. We never ship
 * or commit sample documents — fixtures are synthesized per run and written to
 * the OS temp dir, satisfying "generate fixtures safely" for the upload flow.
 */
export async function makePdfBytes(
  label: string,
  pageCount = 2,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([320, 240]);
    page.drawText(`${label} — page ${i + 1}`, {
      x: 24,
      y: 200,
      size: 16,
      font,
    });
  }
  return doc.save();
}

/** Write a generated PDF to a temp file and return its path. */
export async function writeTempPdf(name: string, pages = 2): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "pdfxyz-e2e-"));
  const path = join(dir, name);
  writeFileSync(path, await makePdfBytes(name, pages));
  return path;
}

/**
 * Generate a single-page PDF carrying a fillable AcroForm (one text field and
 * one checkbox), so the flatten runner has real fields to flatten end-to-end.
 */
export async function makeFormPdfBytes(label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([320, 240]);
  page.drawText(label, { x: 24, y: 210, size: 12, font });
  const form = doc.getForm();
  const name = form.createTextField("e2e.name");
  name.setText("Ada Lovelace");
  name.addToPage(page, { x: 24, y: 160, width: 200, height: 20 });
  const agree = form.createCheckBox("e2e.agree");
  agree.check();
  agree.addToPage(page, { x: 24, y: 130, width: 16, height: 16 });
  return doc.save();
}

/** Write a generated form PDF to a temp file and return its path. */
export async function writeTempFormPdf(name: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "pdfxyz-e2e-"));
  const path = join(dir, name);
  writeFileSync(path, await makeFormPdfBytes(name));
  return path;
}

/** A 1×1 opaque PNG: the whole of a generated scan's page. */
const PNG_1PX = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

/**
 * What a scanner produces: each page one full-bleed image, and no text
 * operator anywhere — so no text layer to select. Embedded through the
 * product's own raster boundary, which `raster-embedder-boundary.test.ts`
 * holds every caller to (e2e included).
 */
export async function makeScanPdfBytes(pageCount = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const image = await embedRasterImage(doc, PNG_1PX, "png");
  for (let i = 0; i < pageCount; i++) {
    await drawRasterImage(doc.addPage([612, 792]), image, {
      x: 0,
      y: 0,
      width: 612,
      height: 792,
    });
  }
  return doc.save();
}

/** Write a generated scan to a temp file and return its path. */
export async function writeTempScanPdf(
  name: string,
  pages = 1,
): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "pdfxyz-e2e-"));
  const path = join(dir, name);
  writeFileSync(path, await makeScanPdfBytes(pages));
  return path;
}

/** The runner/workspace file picker — every upload flow goes through this. */
export function fileInput(page: Page): Locator {
  return page.locator('input[type="file"]').first();
}

/**
 * Resolve once React has actually claimed `target`, i.e. the node is wired up
 * and will respond to events.
 *
 * Waiting for server-rendered copy to appear does NOT prove this: that markup
 * ships in the SSR HTML and is visible while hydration is still pending. React
 * instead tags every host node it hydrates with an internal `__reactFiber$…`
 * key, so the presence of that key is a direct signal about this exact element.
 */
export async function waitForHydration(target: Locator): Promise<void> {
  await target.waitFor({ state: "attached" });
  await expect
    .poll(
      () =>
        target.evaluate((el) =>
          Object.keys(el).some((k) => k.startsWith("__reactFiber$")),
        ),
      {
        message:
          "element never hydrated — the page is inert, so interactions are silently dropped",
      },
    )
    .toBe(true);
}

/**
 * Stage files through the page's file picker the way a user would.
 *
 * `setInputFiles` writes the file list and dispatches `change` synchronously.
 * Immediately after `page.goto` the input already exists in the server-rendered
 * HTML while hydration is still pending (~60ms locally, and far longer under
 * parallel-worker CPU contention), so there is no listener to receive that
 * event: the file is dropped without a trace and the spec fails seconds later
 * on a missing filename, pointing nowhere near the real cause. Gate the upload
 * on the input actually being live.
 */
export async function uploadFiles(
  page: Page,
  files: string | string[],
): Promise<void> {
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles(files);
}

/**
 * Attach a guard that records console errors and uncaught page errors. Used to
 * assert a page loads cleanly under the production CSP (a blocked script,
 * worker, or wasm surfaces here as a "Content Security Policy" console error).
 */
/**
 * Edit PDF's editor (since 2026-10-24): choose Text, click on page 1 as
 * drawn, type, and leave the box — one text box placed, the way a reader
 * places it. Resolves once the editor has said it was added.
 */
export async function placeEditorText(page: Page, words: string) {
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const sheet = page.locator('[data-editor-page="0"]');
  await sheet.scrollIntoViewIfNeeded();
  const box = (await sheet.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.2, box.y + 60);
  await page.keyboard.type(words);
  await page.keyboard.press("Escape");
  await expect(
    page.locator("[data-wysiwyg-editor] > [role=status]"),
  ).toContainText("Text box added");
}

export function attachConsoleGuard(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  return {
    consoleErrors,
    pageErrors,
    cspViolations: () =>
      consoleErrors.filter((t) =>
        /content security policy|refused to/i.test(t),
      ),
  };
}
