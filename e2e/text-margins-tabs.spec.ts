import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { fileInput, waitForHydration } from "./helpers";
import { TEXT_MARGINS, TEXT_TAB_STOP } from "../src/lib/pdf/text-page-options";
import { COURIER_ADVANCE_EM, drawnRuns } from "../src/tests/pdf-drawn-runs";

/**
 * Audit wave 2, text-to-pdf#3 and #7, through the SERVED page: the Margins
 * chips reach the PDF that downloads, in the editor and in the batch, and a
 * tab-separated table pasted into the box comes out with its columns lined
 * up. Read from the downloaded bytes: each body line's x, and each column's
 * first glyph from Courier's published advance.
 */

const TAB = String.fromCharCode(9);
const margin = (id: string) => TEXT_MARGINS.find((m) => m.id === id)!;

/** The x of every body line on page 1 (after the heading and the counter). */
async function bodyRuns(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return drawnRuns(doc, 0).slice(2);
}

test("Text to PDF: Narrow margins and tab stops reach the downloaded PDF", async ({
  page,
}) => {
  await page.goto("/tools/text-to-pdf");
  const box = page.getByPlaceholder("Paste or type plain text here…");
  await waitForHydration(box);
  const rows = [
    ["id", "name", "due"],
    ["1", "Jo", "May"],
    ["22", "Alexand", "June"],
  ];
  await box.fill(rows.map((r) => r.join(TAB)).join("\n"));
  const narrow = page.getByRole("button", {
    name: margin("narrow").label,
    exact: true,
  });
  await narrow.click();
  await expect(narrow).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /create pdf/i }).click();
  await expect(page.getByRole("heading", { name: "PDF created" })).toBeVisible({
    timeout: 20_000,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^download pdf$/i }).click();
  const body = await bodyRuns(await readFile(await (await download).path()));
  expect(body).toHaveLength(rows.length);
  for (const run of body) expect(run.x).toBeCloseTo(margin("narrow").points, 6);
  // Each column's first glyph at one x on every row, one tab stop apart.
  const xs = body.map((run, i) => {
    let from = 0;
    return rows[i]!.map((cell) => {
      const at = run.text.indexOf(cell, from);
      expect(at).toBeGreaterThan(-1);
      from = at + cell.length;
      return run.x + at * COURIER_ADVANCE_EM * run.size;
    });
  });
  for (let col = 0; col < rows[0]!.length; col++)
    for (const row of xs) expect(row[col]!).toBeCloseTo(xs[0]![col]!, 6);
  expect(xs[0]![1]! - xs[0]![0]!).toBeCloseTo(
    COURIER_ADVANCE_EM * body[0]!.size * TEXT_TAB_STOP,
    6,
  );
});

test("Text to PDF batch: Wide margins reach every PDF in the ZIP", async ({
  page,
}) => {
  await page.goto("/tools/text-to-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles([
    { name: "one.txt", mimeType: "text/plain", buffer: Buffer.from("first") },
    { name: "two.txt", mimeType: "text/plain", buffer: Buffer.from("second") },
  ]);
  const run = page.getByRole("button", { name: "Convert 2 text files" });
  await expect(run).toBeVisible({ timeout: 15_000 });
  const wide = page.getByRole("button", {
    name: margin("wide").label,
    exact: true,
  });
  await wide.click();
  await expect(wide).toHaveAttribute("aria-pressed", "true");
  await run.click();
  const zipButton = page.getByRole("button", { name: /download all/i });
  await expect(zipButton).toBeVisible({ timeout: 20_000 });
  const download = page.waitForEvent("download");
  await zipButton.click();
  const zip = await JSZip.loadAsync(
    await readFile(await (await download).path()),
  );
  const pdfs = Object.keys(zip.files).filter((n) => n.endsWith(".pdf"));
  expect(pdfs).toHaveLength(2);
  for (const name of pdfs) {
    const body = await bodyRuns(await zip.file(name)!.async("uint8array"));
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]!.x).toBeCloseTo(margin("wide").points, 6);
  }
});
