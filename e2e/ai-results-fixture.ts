import { expect, type Page, type Route } from "@playwright/test";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";
import { readWorkbookSheets } from "../src/lib/workers/ooxml/workbook-read";

/**
 * The AI results on the page (competitor audit #4 and #16, 2026-11-17),
 * through the SERVED pages with the worker mocked at the wire (`page.route`).
 * Nothing here reaches a real worker or AI provider.
 */

export const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** A completed job for `tool` whose one artifact is `pkg`, served at the wire. */
export async function mockCompletedJob(
  page: Page,
  tool: string,
  filename: string,
  pkg: Buffer,
) {
  const now = new Date().toISOString();
  const done = {
    jobId: "job_air1",
    tool,
    capability: "ai",
    status: "completed",
    progress: 100,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    artifacts: [
      {
        artifactId: "art_air1",
        filename,
        contentType: "application/zip",
        bytes: pkg.byteLength,
        url: "/__e2e/air-art/1",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    ],
  };
  await page.route("**/api/worker/status", (route) =>
    json(route, 200, READY_WORKER_STATUS),
  );
  await page.route("**/api/uploads", (route) =>
    json(route, 200, {
      sessionId: "ses_air1",
      tool,
      slots: [
        {
          fileId: "f_air00000001",
          filename: "in",
          url: "/__e2e/air-upload/1",
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    }),
  );
  await page.route("**/__e2e/air-upload/**", (route) => json(route, 200, {}));
  await page.route("**/api/jobs", (route) =>
    route.request().method() === "POST"
      ? json(route, 200, done)
      : route.fallback(),
  );
  await page.route("**/api/jobs/job_air1", (route) => json(route, 200, done));
  await page.route("**/__e2e/air-art/**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "application/zip" },
      body: pkg,
    }),
  );
}

/** A PDF of `pages` pages, each carrying the given lines of selectable text. */
export async function textPdf(pages: string[][]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    lines.forEach((line, i) =>
      page.drawText(line, { x: 20, y: 770 - i * 9, size: 6, font }),
    );
  }
  return Buffer.from(await doc.save());
}

/** An AI Data Extraction package holding `data` as extraction.json. */
export async function extractionPackage(data: unknown): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("extraction.json", JSON.stringify(data, null, 2));
  zip.file("model-output.json", JSON.stringify(data));
  zip.file("extraction.md", "# Extraction\n");
  zip.file("manifest.json", JSON.stringify({ schema: "pdfxyz.extract/v1" }));
  zip.file("README.txt", "Test package.\n");
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

/** A Summarize PDF package holding `summary` as both text and Markdown. */
export async function summaryPackage(summary: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("summary.txt", summary);
  zip.file("summary.md", `# Summary\n\n${summary}\n`);
  zip.file("manifest.json", JSON.stringify({ schema: "pdfxyz.summary/v1" }));
  zip.file("README.txt", "Test package.\n");
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

/** What the page put on the clipboard, read back through the page itself. */
export function clipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

/** The file the next download saves, as bytes. */
export async function nextDownload(page: Page, press: () => Promise<void>) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    press(),
  ]);
  const path = await download.path();
  const { readFileSync } = await import("node:fs");
  return { name: download.suggestedFilename(), bytes: readFileSync(path) };
}

/** Every row of a workbook's first sheet, as the reader decodes it. */
export async function workbookRows(bytes: Buffer) {
  const [sheet] = await readWorkbookSheets(new Uint8Array(bytes));
  return {
    name: sheet!.name,
    rows: sheet!.sheet.rows.map((r) => r.cells.map((c) => c.value)),
    types: sheet!.sheet.rows.map((r) => r.cells.map((c) => c.type)),
  };
}

/** No sideways scroll at the current width, with the result on screen. */
export async function expectNoSidewaysScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, `page is ${scroll}px wide in a ${client}px viewport`).toBe(
    client,
  );
}

/** Grant the page the clipboard, as a reader's browser grants it on a press. */
export async function grantClipboard(page: Page) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
}
