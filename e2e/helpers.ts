import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

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
    page.drawText(`${label} — page ${i + 1}`, { x: 24, y: 200, size: 16, font });
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
 * Attach a guard that records console errors and uncaught page errors. Used to
 * assert a page loads cleanly under the production CSP (a blocked script,
 * worker, or wasm surfaces here as a "Content Security Policy" console error).
 */
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
      consoleErrors.filter((t) => /content security policy|refused to/i.test(t)),
  };
}
