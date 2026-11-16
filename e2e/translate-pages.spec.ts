import { test, expect, type Page, type Route } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";

/**
 * Translate PDF's Pages field (competitor audit #29, slice 6) through the
 * SERVED page, with the worker mocked at the wire:
 *
 *  - the live status proves `translatePageRange`: "2,4" on a five-page PDF
 *    posts `pages: [[2,2],[4,4]]` with a `declaredCharacters` SMALLER than
 *    the same file's whole-document declaration (the exact equality with
 *    the browser's count of those pages is held over real pdf.js by
 *    `translate-worker-panel.pages.test.tsx`: this spec runs as CommonJS and
 *    cannot load the text module), and a completed job that echoes those
 *    pages shows the selection sentence;
 *  - it does not: no field, and the body carries no `pages`.
 */

const LINES = [
  "Opening page of the e2e report.",
  "A second page with a longer paragraph of selectable text on it.",
  "The third page is not chosen.",
  "Page four holds one more sentence.",
  "The last page ends the report.",
];

async function fivePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const line of LINES) {
    doc.addPage([400, 200]).drawText(line, { x: 20, y: 100, size: 10, font });
  }
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
async function mockWorker(page: Page, translatePageRange: boolean) {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/worker/status", (route) =>
    json(route, 200, { ...READY_WORKER_STATUS, translatePageRange }),
  );
  await page.route("**/api/uploads", (route) =>
    json(route, 200, {
      sessionId: "ses_s1",
      tool: "translate-pdf",
      slots: [
        {
          fileId: "file_s1",
          filename: "in",
          url: "/__e2e/translate-upload/1",
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    }),
  );
  await page.route("**/__e2e/translate-upload/**", (route) =>
    json(route, 200, {}),
  );
  await page.route("**/__e2e/translate-download", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "application/zip" },
      body: Buffer.from([]),
    }),
  );
  const now = new Date().toISOString();
  const jobFor = (pagesSent: unknown) => ({
    jobId: "job_s1",
    tool: "translate-pdf",
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
              filename: "report-translation.zip",
              contentType: "application/zip",
              bytes: 10,
              url: "/__e2e/translate-download",
              expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            },
          ],
          results: {
            ai: {
              truncation: {
                truncated: false,
                charactersSent: 80,
                charactersTotal: 80,
                totalPages: 5,
                lastCompletePage: 5,
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
  await page.goto("/tools/translate-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "report.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  });
  await expect(page.getByText("report.pdf", { exact: true })).toBeVisible();
  const run = page.getByRole("button", { name: "Translate PDF" });
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  return run;
}

test("translatePageRange proven: typed pages post their spans and their count, and the result names them", async ({
  page,
}) => {
  const { bodies } = await mockWorker(page, true);
  const run = await choose(page, await fivePagePdf());
  // First the whole document, for the count to compare against.
  await run.click();
  await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1);
  const whole = bodies[0]!.declaredCharacters as number;
  expect(Object.keys(bodies[0]!.options as object)).not.toContain("pages");
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  const field = page.getByLabel("Pages (optional)");
  await expect(field).toBeVisible();
  await field.fill("2,4");
  await run.click();
  await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(2);
  const body = bodies[1]!;
  expect((body.options as Record<string, unknown>).pages).toEqual([
    [2, 2],
    [4, 4],
  ]);
  // Health: the whole document was counted at all.
  expect(Number.isInteger(whole) && whole > 0).toBe(true);
  const chosen = body.declaredCharacters as number;
  expect(Number.isInteger(chosen) && chosen > 0).toBe(true);
  expect(chosen).toBeLessThan(whole);
  expect(body.declaredTextPages).toBe(2);
  await expect(
    page.getByText(
      "You chose pages 2 and 4 of 5. No other page was sent to the AI model.",
    ),
  ).toBeVisible({ timeout: 15_000 });
});

test("translatePageRange not proven: no field, and the body carries no pages", async ({
  page,
}) => {
  const { bodies } = await mockWorker(page, false);
  const run = await choose(page, await fivePagePdf());
  await expect(page.getByLabel("Pages (optional)")).toHaveCount(0);
  await run.click();
  await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1);
  expect(Object.keys(bodies[0]!.options as object)).not.toContain("pages");
});
