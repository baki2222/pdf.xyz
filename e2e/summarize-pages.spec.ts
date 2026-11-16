import { test, expect, type Page, type Route } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";
import { addOutline, fitDest } from "../src/tests/bookmark-fixtures";

/**
 * Summarize PDF's "Part to summarize" (competitor audit summarize-pdf#5)
 * through the SERVED page, with the worker mocked at the wire:
 *
 *  - the live status proves `summarizePages`: a PDF with two top-level
 *    bookmarks (pages 1 and 3) offers both sections; picking the second
 *    posts `pages: [[3, 4]]` with a `declaredCharacters` SMALLER than the
 *    same page's whole-document declaration (the exact equality with the
 *    browser's count of pages 3-4 is held over real pdf.js by
 *    `summarize-pages.chain.test.ts`: this spec runs as CommonJS and cannot
 *    load the text module), and a completed job that echoes those pages
 *    shows the selection sentence;
 *  - it does not: no control, and the body carries no `pages`.
 */

/** Built from a code point (house rule). */
const EN = String.fromCharCode(0x2013);

const LINES = [
  "Opening page of the e2e report.",
  "A second page with a longer paragraph of selectable text on it.",
  "Findings start on page three.",
  "Page four ends the findings with one more sentence.",
];

async function outlinedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const line of LINES) {
    doc.addPage([400, 200]).drawText(line, { x: 20, y: 100, size: 10, font });
  }
  addOutline(doc, [
    { title: "Opening", dest: fitDest(doc, 0) },
    { title: "Findings", dest: fitDest(doc, 2) },
  ]);
  return doc.save();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * A job that echoes the pages it was sent (completed, `pagesSent` = the
 * body's `pages`), or fails at once when none were sent: what is under test
 * for a whole-document run is the request.
 */
async function mockWorker(page: Page, summarizePages: boolean) {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/worker/status", (route) =>
    json(route, 200, { ...READY_WORKER_STATUS, summarizePages }),
  );
  await page.route("**/api/uploads", (route) =>
    json(route, 200, {
      sessionId: "ses_s1",
      tool: "summarize-pdf",
      slots: [
        {
          fileId: "file_s1",
          filename: "in",
          url: "/__e2e/summarize-upload/1",
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    }),
  );
  await page.route("**/__e2e/summarize-upload/**", (route) =>
    json(route, 200, {}),
  );
  await page.route("**/__e2e/summarize-download", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "application/zip" },
      body: Buffer.from([]),
    }),
  );
  const now = new Date().toISOString();
  const jobFor = (pagesSent: unknown) => ({
    jobId: "job_s1",
    tool: "summarize-pdf",
    capability: "ai",
    progress: 100,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    ...(pagesSent
      ? {
          status: "completed",
          artifacts: [
            {
              artifactId: "art_s1",
              filename: "report-summary.zip",
              contentType: "application/zip",
              bytes: 10,
              url: "/__e2e/summarize-download",
              expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            },
          ],
          results: {
            ai: {
              truncation: {
                truncated: false,
                charactersSent: 80,
                charactersTotal: 80,
                totalPages: 4,
                lastCompletePage: 4,
                cutMidPage: false,
                pagesSent,
              },
            },
          },
        }
      : {
          status: "failed",
          error: {
            code: "internal_error",
            message: "Stopped by the test.",
            retryable: false,
          },
        }),
  });
  let last: ReturnType<typeof jobFor> = jobFor(undefined);
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = JSON.parse(route.request().postDataBuffer()!.toString());
    bodies.push(body);
    last = jobFor((body.options as Record<string, unknown>).pages);
    await json(route, 200, last);
  });
  await page.route("**/api/jobs/job_s1", (route) => json(route, 200, last));
  return { bodies };
}

async function choose(page: Page, bytes: Uint8Array) {
  await page.goto("/tools/summarize-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "report.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  });
  await expect(page.getByText("report.pdf", { exact: true })).toBeVisible();
  const run = page.getByRole("button", { name: "Summarize PDF" });
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  return run;
}

test("summarizePages proven: a bookmarked section posts its pages and their count, and the result names them", async ({
  page,
}) => {
  const bytes = await outlinedPdf();
  const { bodies } = await mockWorker(page, true);
  const run = await choose(page, bytes);
  // First the whole document, for the count to compare against.
  await run.click();
  await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1);
  const whole = bodies[0]!.declaredCharacters as number;
  expect(Object.keys(bodies[0]!.options as object)).not.toContain("pages");
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  const part = page.getByLabel("Part to summarize");
  await expect(part).toBeVisible();
  await expect(
    part.getByRole("option", { name: `Findings (pages 3${EN}4)` }),
  ).toHaveCount(1);
  await part.selectOption({ label: `Findings (pages 3${EN}4)` });
  await run.click();
  await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(2);
  const body = bodies[1]!;
  expect((body.options as Record<string, unknown>).pages).toEqual([[3, 4]]);
  // Health: the whole document was counted at all.
  expect(Number.isInteger(whole) && whole > 0).toBe(true);
  const chosen = body.declaredCharacters as number;
  expect(Number.isInteger(chosen) && chosen > 0).toBe(true);
  expect(chosen).toBeLessThan(whole);
  await expect(
    page.getByText(
      `This summary covers pages 3${EN}4 of 4, the pages you chose.`,
    ),
  ).toBeVisible({ timeout: 15_000 });
});

test("summarizePages not proven: no control, and the body carries no pages", async ({
  page,
}) => {
  const { bodies } = await mockWorker(page, false);
  const run = await choose(page, await outlinedPdf());
  await expect(page.getByLabel("Part to summarize")).toHaveCount(0);
  await run.click();
  await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1);
  expect(Object.keys(bodies[0]!.options as object)).not.toContain("pages");
});
