import { test, expect, type Page, type Route } from "@playwright/test";
import { fileInput, makePdfBytes, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";

/**
 * Translate PDF's reflowed PDF (competitor audit #29 slice 1, 2026-11-15)
 * through the SERVED page, with the worker mocked at the wire:
 *
 *  - the live status lists the target in `translatePdfLanguages`: the
 *    "You get" row names the PDF, and a job that returns the ZIP then the PDF
 *    offers the PDF's download FIRST;
 *  - the status publishes no such key (today's production image): the row
 *    reads exactly as before.
 *
 * The row strings are typed here rather than imported, on purpose: this is
 * what the reader sees, and an import would follow a reworded constant.
 */

const ZIP_ROW = "ZIP · translation.md + translation.txt + manifest";
const PDF_ROW =
  "PDF (text reflowed, not the original layout) + ZIP · translation.md + translation.txt + manifest";

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

async function mockWorker(page: Page, languages: string[] | null) {
  await page.route("**/api/worker/status", (route) =>
    json(route, 200, {
      ...READY_WORKER_STATUS,
      ...(languages ? { translatePdfLanguages: languages } : {}),
    }),
  );
  await page.route("**/api/uploads", (route) =>
    json(route, 200, {
      sessionId: "ses_p1",
      tool: "translate-pdf",
      slots: [
        {
          fileId: "file_p1",
          filename: "in",
          url: "/__e2e/translate-pdf-upload/1",
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    }),
  );
  await page.route("**/__e2e/translate-pdf-upload/**", (route) =>
    json(route, 200, {}),
  );
  const expires = new Date(Date.now() + 3_600_000).toISOString();
  const artifact = (id: string, filename: string, contentType: string) => ({
    artifactId: id,
    filename,
    contentType,
    bytes: 4,
    url: `/__e2e/translate-pdf-artifact/${id}`,
    expiresAt: expires,
  });
  const job = {
    jobId: "job_p1",
    tool: "translate-pdf",
    capability: "secure-worker",
    status: "completed",
    progress: 100,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: expires,
    retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    artifacts: [
      artifact("art_zip", "report-translation.zip", "application/zip"),
      artifact("art_pdf", "report-translated.pdf", "application/pdf"),
    ],
    results: {
      ai: {
        truncation: {
          truncated: false,
          charactersSent: 20,
          charactersTotal: 20,
          totalPages: 1,
          lastCompletePage: 1,
          cutMidPage: false,
        },
        pdf: { rendered: true, pages: 1, bytes: 4 },
      },
    },
  };
  await page.route("**/api/jobs", (route) =>
    route.request().method() === "POST"
      ? json(route, 200, job)
      : route.fallback(),
  );
  await page.route("**/api/jobs/job_p1", (route) => json(route, 200, job));
  await page.route("**/__e2e/translate-pdf-artifact/**", (route) =>
    route.fulfill({ status: 200, body: Buffer.from([1, 2, 3, 4]) }),
  );
}

test("a proven target: the row names the PDF, and the PDF is offered first", async ({
  page,
}) => {
  await mockWorker(page, ["en", "es"]);
  await page.goto("/tools/translate-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  // The spec rows sit in a collapsed disclosure: present, not shown.
  await expect(page.getByText(PDF_ROW)).toBeAttached();
  await input.setInputFiles({
    name: "report.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await makePdfBytes("translate me", 1)),
  });
  const run = page.getByRole("button", { name: "Translate PDF" });
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  await run.click();
  const downloads = page.getByRole("button", { name: /^Download / });
  await expect(downloads).toHaveCount(2, { timeout: 20_000 });
  await expect(downloads.nth(0)).toHaveText(/report-translated\.pdf/);
  await expect(downloads.nth(1)).toHaveText(/report-translation\.zip/);
});

test("no key published: the row reads exactly as before", async ({ page }) => {
  await mockWorker(page, null);
  await page.goto("/tools/translate-pdf");
  await waitForHydration(fileInput(page));
  await expect(page.getByText(ZIP_ROW)).toBeAttached();
  await expect(page.getByText(PDF_ROW)).toHaveCount(0);
});
