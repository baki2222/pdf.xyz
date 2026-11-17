import { test, expect, type Page, type Route } from "@playwright/test";
import { fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";

/**
 * Excel to PDF's CSV Delimiter and Character set (competitor audit #18)
 * through the SERVED page, with the worker mocked at the wire:
 *
 *  - the live status proves `csvImportOptions`: a .csv shows both selects,
 *    and the job posted after choosing Semicolon and Windows-1251 carries
 *    exactly those two options; an .xlsx shows neither;
 *  - it does not: a .csv shows neither, and the job carries no CSV key.
 *
 * The job is failed by the mock as soon as it is posted: what is under test
 * is the request.
 */

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

async function mockWorker(page: Page, csvImportOptions: boolean) {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/worker/status", (route) =>
    json(route, 200, { ...READY_WORKER_STATUS, csvImportOptions }),
  );
  await page.route("**/api/uploads", (route) =>
    json(route, 200, {
      sessionId: "ses_c1",
      tool: "excel-to-pdf",
      slots: [
        {
          fileId: "file_c1",
          filename: "in",
          url: "/__e2e/csv-upload/1",
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    }),
  );
  await page.route("**/__e2e/csv-upload/**", (route) => json(route, 200, {}));
  const now = new Date().toISOString();
  const failed = {
    jobId: "job_c1",
    tool: "excel-to-pdf",
    capability: "security",
    status: "failed",
    progress: 100,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    error: {
      code: "internal_error",
      message: "Stopped by the test.",
      retryable: false,
    },
  };
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    bodies.push(JSON.parse(route.request().postDataBuffer()!.toString()));
    await json(route, 200, failed);
  });
  await page.route("**/api/jobs/job_c1", (route) => json(route, 200, failed));
  return { bodies };
}

async function choose(page: Page, name: string, mimeType: string) {
  await page.goto("/tools/excel-to-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name,
    mimeType,
    buffer: Buffer.from("Region;Total\nNorth;1200\n"),
  });
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  const run = page.getByRole("button", { name: "Convert to PDF" });
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  await expect(run).toBeEnabled();
  return run;
}

test("csvImportOptions proven: a .csv shows both selects, and the job carries the choices", async ({
  page,
}) => {
  const { bodies } = await mockWorker(page, true);
  const run = await choose(page, "regions.csv", "text/csv");
  const delimiter = page.getByLabel("Delimiter", { exact: true });
  const charset = page.getByLabel("Character set", { exact: true });
  await expect(delimiter).toBeVisible();
  await expect(charset).toBeVisible();
  await expect(delimiter).toHaveValue("");
  await delimiter.selectOption({ label: "Semicolon" });
  await charset.selectOption({ label: "Windows-1251 (Cyrillic)" });
  await run.click();
  await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1);
  expect(bodies[0]!.options).toEqual({
    csvDelimiter: "semicolon",
    csvCharset: "windows-1251",
  });
});

test("csvImportOptions proven: left on Auto, the .csv job carries no CSV key", async ({
  page,
}) => {
  const { bodies } = await mockWorker(page, true);
  const run = await choose(page, "regions.csv", "text/csv");
  await expect(page.getByLabel("Delimiter", { exact: true })).toBeVisible();
  await run.click();
  await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1);
  expect(bodies[0]!.options).toEqual({});
});

test("csvImportOptions proven: an .xlsx shows neither select", async ({
  page,
}) => {
  await mockWorker(page, true);
  await choose(
    page,
    "book.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  // Health: the panel's own controls rendered, so absence means something.
  await expect(page.getByLabel("Orientation", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Delimiter", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Character set", { exact: true })).toHaveCount(
    0,
  );
});

test("csvImportOptions not proven: a .csv shows neither, and the job carries no CSV key", async ({
  page,
}) => {
  const { bodies } = await mockWorker(page, false);
  const run = await choose(page, "regions.csv", "text/csv");
  await expect(page.getByLabel("Delimiter", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Character set", { exact: true })).toHaveCount(
    0,
  );
  await run.click();
  await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1);
  expect(bodies[0]!.options).toEqual({});
});
