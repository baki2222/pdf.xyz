import { expect, test, type CDPSession } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { BATCH_LIMITS, overCountReason } from "../../src/lib/batch/limits";
import { batchMaxFilesFor } from "../../src/lib/batch/tools";
import { attachConsoleGuard, fileInput, waitForHydration } from "../helpers";
import { captureDownload, downloadBytesOf, zipEntries } from "./artifacts";
import { embedRasterImage } from "../../src/lib/pdf/pdf-lib";
import { encodePng } from "./fixtures";
import {
  countRequests,
  pageCountOf,
  redPicturesPdf,
} from "./image-batch-cases";
import { decodePng, pixelAt } from "../../src/lib/png-probe";

/**
 * A raster batch on a 375px phone (batch plan P2): five ten-page PDFs of
 * one name through PDF to PNG, the ZIP saved and opened — five folders,
 * "scan" to "scan (5)", ten PNGs in each, every one decoded and red where
 * its page is red — with no request to `/api/` and every control the batch
 * draws at least 44px tall. A sixth file is damaged: it fails its own row,
 * "Retry failed" is a 44px target pressed from the keyboard, and the five
 * finished files stay downloadable ("Download all", from the keyboard too).
 * Then the raster cap, from the page: one file past `batchMaxFilesFor` is
 * listed with the reason, never dropped. Last, what "Download all" costs in
 * memory for five ten-page Letter PDFs at the default and the highest
 * resolution, measured and printed (review of P2).
 */
test.use({ viewport: { width: 375, height: 812 } });

const FILES = 5;
const PAGES = 10;

test("PDF to PNG at 375px: five ten-page PDFs, one folder each, every page decoded", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const guard = attachConsoleGuard(page);
  const pdf = Buffer.from(await redPicturesPdf(PAGES));
  // Health: the input really has the pages the folders are counted against.
  expect(await pageCountOf(pdf)).toBe(PAGES);
  await page.goto("/tools/pdf-to-png");
  const input = fileInput(page);
  await waitForHydration(input);
  const requests = countRequests(page);
  await input.setInputFiles([
    ...Array.from({ length: FILES }, () => ({
      name: "scan.pdf",
      mimeType: "application/pdf",
      buffer: pdf,
    })),
    {
      name: "damaged.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(
        ["%PDF-1.7", "1 0 obj << /Type /Catalog >>", "%%EOF", ""].join(
          String.fromCharCode(10),
        ),
      ),
    },
  ]);
  const run = page.getByRole("button", { name: `Convert ${FILES + 1} PDFs` });
  await expect(run).toBeVisible({ timeout: 20_000 });

  // Every control the batch draws before Run is a phone's 44px target.
  const panel = page.locator("[data-chunk]").filter({ has: run });
  const view = page.getByRole("list", { name: "Files in this batch" });
  const buttons = panel.getByRole("button");
  const radios = panel.getByRole("radio");
  const targets = [...(await buttons.all()), ...(await radios.all())];
  expect(targets.length).toBeGreaterThan(FILES);
  for (const target of targets) {
    const box = await target.boundingBox();
    expect(
      box && box.height >= 44,
      `${await target.textContent()} is ${box?.height}px tall`,
    ).toBe(true);
  }

  await run.click();
  const settled = page.getByRole("heading", {
    name: `Batch complete. ${FILES} done, 1 failed.`,
  });
  await expect(settled).toBeVisible({ timeout: 200_000 });
  // The damaged file failed on its own row, with a reason.
  const damaged = view.getByRole("listitem").filter({ hasText: "damaged.pdf" });
  await expect(damaged).not.toContainText("Canceled");
  // After the run: Retry, Download all and each row's ZIP button are 44px.
  const retry = page.getByRole("button", { name: "Retry failed (1)" });
  const all = page.getByRole("button", { name: `Download all (${FILES})` });
  const rowZips = view.getByRole("button", { name: /^Download the 10 / });
  expect(await rowZips.count()).toBe(FILES);
  for (const target of [retry, all, ...(await rowZips.all())]) {
    const box = await target.boundingBox();
    expect(
      box && box.height >= 44,
      `${(await target.getAttribute("aria-label")) ?? (await target.textContent())} is ${box?.height}px tall`,
    ).toBe(true);
  }
  // Retry, from the keyboard: the damaged file runs again and fails again,
  // the five finished files untouched.
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(settled).toBeVisible({ timeout: 60_000 });
  // "Download all", from the keyboard.
  await all.focus();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Enter"),
  ]);
  const zip = await downloadBytesOf(download);
  const entries = await zipEntries(zip);
  const folders = [
    "scan",
    ...Array.from({ length: FILES - 1 }, (_, i) => `scan (${i + 2})`),
  ];
  const want = folders.flatMap((folder) =>
    Array.from(
      { length: PAGES },
      (_, i) => `${folder}/scan-page-${String(i + 1).padStart(2, "0")}.png`,
    ),
  );
  expect([...entries.keys()].sort()).toEqual(want.sort());
  for (const [name, bytes] of entries) {
    const png = decodePng(new Uint8Array(bytes));
    const mid = pixelAt(png, png.width >> 1, png.height >> 1);
    expect(mid.r > 150 && mid.g < 100 && mid.b < 100, name).toBe(true);
  }
  expect(requests().all, "the counter was not listening").toBeGreaterThan(0);
  expect(requests().api, "requests to /api/ while the batch ran").toBe(0);
  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
});

test("the raster cap, from the page: one file past it is listed with the reason", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const max = batchMaxFilesFor("pdf-to-png");
  // Health: this is the raster cap, below the client cap.
  expect(max).toBe(BATCH_LIMITS.rasterMaxFiles);
  expect(max).toBeLessThan(BATCH_LIMITS.clientMaxFiles);
  const pdf = Buffer.from(await redPicturesPdf(1));
  await page.goto("/tools/pdf-to-png");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles(
    Array.from({ length: max + 1 }, (_, i) => ({
      name: `page-${i + 1}.pdf`,
      mimeType: "application/pdf",
      buffer: pdf,
    })),
  );
  await expect(
    page.getByRole("button", { name: `Convert ${max} PDFs` }),
  ).toBeVisible({ timeout: 20_000 });
  const alert = page.getByRole("alert").filter({ hasText: "not added" });
  await expect(alert).toContainText(`page-${max + 1}.pdf`);
  await expect(alert).toContainText(overCountReason(max));
});

/**
 * `pages` Letter pages, each
 * one full-page picture of seeded noise. Noise is the stress case for an
 * image's size (it barely compresses), so the archive here is near the
 * heaviest a ten-page PDF makes.
 */
async function noisyLetterPdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
  for (let p = 0; p < pages; p += 1) {
    const w = 306;
    const h = 396;
    const rgb = Buffer.alloc(w * h * 3);
    for (let i = 0; i < rgb.length; i += 1) rgb[i] = next();
    const png = await embedRasterImage(
      doc,
      new Uint8Array(encodePng(rgb, w, h)),
      "png",
    );
    doc
      .addPage([612, 792])
      .drawImage(png, { x: 0, y: 0, width: 612, height: 792 });
  }
  return Buffer.from(await doc.save());
}

/** The renderer's JS heap plus ArrayBuffer backing stores, in bytes. */
async function heapNow(cdp: CDPSession): Promise<number> {
  const usage = (await cdp.send("Runtime.getHeapUsage")) as {
    usedSize: number;
    backingStorageSize?: number;
  };
  return usage.usedSize + (usage.backingStorageSize ?? 0);
}

for (const resolution of ["High (150 DPI)", "Print (300 DPI)"]) {
  test(`what Download all costs in memory: 5 x 10 Letter pages at ${resolution}`, async ({
    page,
  }) => {
    test.setTimeout(600_000);
    const pdf = await noisyLetterPdf(PAGES);
    await page.goto("/tools/pdf-to-png");
    const input = fileInput(page);
    await waitForHydration(input);
    await input.setInputFiles(
      Array.from({ length: FILES }, (_, i) => ({
        name: `letter-${i + 1}.pdf`,
        mimeType: "application/pdf",
        buffer: pdf,
      })),
    );
    await page.getByRole("radio", { name: resolution }).check();
    await page.getByRole("button", { name: `Convert ${FILES} PDFs` }).click();
    await expect(
      page.getByRole("heading", {
        name: `Batch complete. ${FILES} done, 0 failed.`,
      }),
    ).toBeVisible({ timeout: 540_000 });
    const cdp = await page.context().newCDPSession(page);
    const before = await heapNow(cdp);
    let peak = before;
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        peak = Math.max(peak, await heapNow(cdp));
        await new Promise((r) => setTimeout(r, 25));
      }
    })();
    // Each row's own ZIP, one after another: what the reader is sent to
    // when the whole would be too much to bundle at once.
    const rowZips = page.getByRole("button", { name: /^Download the 10 / });
    expect(await rowZips.count()).toBe(FILES);
    let outputs = 0;
    let largestZip = 0;
    for (const rowZip of await rowZips.all()) {
      const zip = await captureDownload(page, rowZip);
      const entries = await zipEntries(zip);
      expect(entries.size).toBe(PAGES);
      outputs += [...entries.values()].reduce((n, b) => n + b.length, 0);
      largestZip = Math.max(largestZip, zip.length);
    }
    sampling = false;
    await sampler;
    const all = page.getByRole("button", { name: /^Download all/ });
    const note = page.getByText("Save each file's results from its own row.");
    const mb = (n: number) => (n / 1048576).toFixed(1);
    const line = `[memory] ${resolution}: ${FILES * PAGES} PNGs, ${mb(outputs)} MB of images (largest row ZIP ${mb(largestZip)} MB); renderer heap + array buffers ${mb(before)} MB before the row ZIPs, peak ${mb(peak)} MB while they built (+${mb(peak - before)} MB); Download all ${outputs > BATCH_LIMITS.clientMaxTotalBytes ? "withheld" : "offered"}`;
    console.log(line);
    test.info().annotations.push({ type: "memory", description: line });
    // "Download all" is offered exactly when what it would bundle fits the
    // batch's own total; past it, the note sends the reader to the rows.
    if (outputs > BATCH_LIMITS.clientMaxTotalBytes) {
      await expect(all).toHaveCount(0);
      await expect(note).toBeVisible();
    } else {
      await expect(all).toBeVisible();
      await expect(note).toHaveCount(0);
    }
    // Health: the sampler saw the builds.
    expect(peak - before).toBeGreaterThan(0);
  });
}
