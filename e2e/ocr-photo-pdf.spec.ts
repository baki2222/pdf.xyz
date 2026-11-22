import { test, expect, type Page, type Route } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";
import { JPEG_30X20, JPEG_30X20_EXIF6 } from "../src/tests/jpeg-fixtures";

/**
 * OCR PDF's photo-to-PDF step (audits ocr-pdf#2 and ocr-pdf#3) through the
 * SERVED page, with the worker MOCKED at the wire. The mock's job returns
 * the very bytes the page uploaded as its artifact, so what is downloaded
 * and decoded here is what the browser built and sent:
 *
 *  - a photo with "Straighten crooked pages" ticked goes as a one-page PDF,
 *    with `deskew: true`; unticked (the control) it goes as the JPEG itself;
 *  - "Combine into one PDF" with 3 photos and 1 PDF sends exactly ONE job
 *    (counted at the wire), and the download is a 4-page PDF in list order.
 *
 * That the real worker then straightens, turns and reads such a PDF is the
 * existing PDF path's proof; the composed chain on production is recorded
 * in the lane report.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

const json = (route: Route, body: unknown) =>
  route.fulfill({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function mockEchoWorker(page: Page) {
  const net = {
    reserves: [] as { filename: string; contentType: string }[],
    jobs: [] as { options: Record<string, unknown> }[],
    uploaded: null as Buffer | null,
    /** The bytes the page fetched as the job's result, once it did. */
    served: null as Buffer | null,
  };
  const now = new Date().toISOString();
  const job = (status: string) => ({
    jobId: "job_p1",
    tool: "ocr-pdf",
    capability: "secure-worker",
    status,
    progress: status === "completed" ? 100 : 0,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    ...(status === "completed"
      ? {
          artifacts: [
            {
              artifactId: "art_p1",
              filename: "result-ocr.pdf",
              contentType: "application/pdf",
              bytes: net.uploaded?.byteLength ?? 0,
              url: "/__e2e/ocr-photo-art",
              expiresAt: now,
            },
          ],
        }
      : {}),
  });
  await page.route("**/api/worker/status", (route) =>
    json(route, READY_WORKER_STATUS),
  );
  await page.route("**/api/uploads", async (route) => {
    const body = JSON.parse(route.request().postDataBuffer()!.toString()) as {
      files: { filename: string; contentType: string }[];
    };
    net.reserves.push({
      filename: body.files[0]!.filename,
      contentType: body.files[0]!.contentType,
    });
    await json(route, {
      sessionId: "ses_p1",
      tool: "ocr-pdf",
      slots: [
        {
          fileId: "file_p1",
          filename: "in",
          url: "/__e2e/ocr-photo-upload",
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    });
  });
  await page.route("**/__e2e/ocr-photo-upload", async (route) => {
    net.uploaded = route.request().postDataBuffer();
    await json(route, {});
  });
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    net.jobs.push(JSON.parse(route.request().postDataBuffer()!.toString()));
    await json(route, job("completed"));
  });
  await page.route("**/api/jobs/job_p1", (route) =>
    json(route, job("completed")),
  );
  await page.route("**/__e2e/ocr-photo-art", (route) => {
    net.served = net.uploaded ?? Buffer.alloc(0);
    return route.fulfill({
      status: 200,
      headers: { "content-type": "application/pdf" },
      body: net.served,
    });
  });
  return net;
}

async function open(
  page: Page,
  files: { name: string; mimeType: string; buffer: Buffer }[],
) {
  await page.goto("/tools/ocr-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles(files);
}

const photo = (name: string, bytes: Uint8Array = JPEG_30X20) => ({
  name,
  mimeType: "image/jpeg",
  buffer: Buffer.from(bytes),
});

/**
 * The result the page received from the job and offers for download: the
 * artifact bytes it fetched (an `<a download>` to a mocked URL is not one
 * Playwright can save, so the fetched bytes are decoded instead).
 */
async function downloadPdf(page: Page, net: { served: Buffer | null }) {
  const link = page.getByRole("link", { name: /download result-ocr.pdf/i });
  await expect(link).toBeVisible({ timeout: 20_000 });
  expect(net.served, "the page never fetched the result").not.toBeNull();
  return PDFDocument.load(net.served!);
}

const pageSizes = (doc: PDFDocument) =>
  doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return [Math.round(width), Math.round(height)];
  });

test("a photo with Straighten ticked goes as a one-page PDF with deskew", async ({
  page,
}) => {
  const net = await mockEchoWorker(page);
  await open(page, [photo("receipt.jpg")]);
  await page
    .getByRole("checkbox", { name: "Straighten crooked pages" })
    .check();
  const run = page.getByRole("button", { name: "Recognize text" });
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  await run.click();
  const doc = await downloadPdf(page, net);
  expect(net.reserves).toEqual([
    { filename: "receipt.pdf", contentType: "application/pdf" },
  ]);
  expect(net.jobs).toHaveLength(1);
  expect(net.jobs[0]!.options).toMatchObject({ deskew: true });
  expect(pageSizes(doc)).toEqual([[30, 20]]);
});

test("CONTROL: the same photo with the boxes unticked goes as the JPEG itself", async ({
  page,
}) => {
  const net = await mockEchoWorker(page);
  await open(page, [photo("receipt.jpg")]);
  const run = page.getByRole("button", { name: "Recognize text" });
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  await run.click();
  await expect(
    page.getByRole("link", { name: /download result-ocr\.pdf/i }),
  ).toBeVisible({ timeout: 20_000 });
  expect(net.reserves).toEqual([
    { filename: "receipt.jpg", contentType: "image/jpeg" },
  ]);
  expect(net.jobs[0]!.options).toMatchObject({
    deskew: false,
    rotatePages: false,
  });
  expect(new Uint8Array(net.uploaded!)).toEqual(JPEG_30X20);
});

test("Combine into one PDF: 3 photos + 1 PDF, exactly one job, a 4-page download in list order", async ({
  page,
}) => {
  const net = await mockEchoWorker(page);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([200, 200]).drawText("DELTA", { x: 20, y: 100, size: 20, font });
  await open(page, [
    photo("one.jpg"),
    photo("two.jpg", JPEG_30X20_EXIF6),
    photo("three.jpg"),
    {
      name: "four.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await pdf.save()),
    },
  ]);
  await page
    .getByRole("checkbox", { name: /Combine into one PDF/ })
    .check({ timeout: 20_000 });
  const run = page.getByRole("button", { name: "Recognize text in one PDF" });
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  await run.click();
  const doc = await downloadPdf(page, net);
  expect(net.jobs).toHaveLength(1);
  expect(net.reserves).toEqual([
    { filename: "one-combined.pdf", contentType: "application/pdf" },
  ]);
  expect(doc.getPageCount()).toBe(4);
  expect(pageSizes(doc)).toEqual([
    [30, 20],
    [20, 30],
    [30, 20],
    [200, 200],
  ]);
});
