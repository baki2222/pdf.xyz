import { test, expect, type Page, type Route } from "@playwright/test";
import {
  fileInput,
  makePdfBytes,
  makeScanPdfBytes,
  waitForHydration,
} from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";
import { TRANSLATE_NO_TEXT_MESSAGE } from "../src/lib/jobs/translate-limits";
import { TRANSLATE_SCAN_CHECK } from "../src/lib/jobs/translate-ocr";

/**
 * OCR inside Translate PDF (audit translate-pdf#3) through the SERVED page,
 * with the worker mocked at the wire (`page.route`):
 *
 *  - the live status advertises `translateOcr`: a scan shows the language
 *    picker, nothing is uploaded before Run, and the job body carries the
 *    OCR request (`ocr: true`, the chosen languages) with NO declared count;
 *  - it does not: today's refusal sentence, and nothing leaves the page.
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

async function mockWorker(page: Page, translateOcr: boolean) {
  const log: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/worker/status", (route) =>
    json(route, 200, {
      ...READY_WORKER_STATUS,
      ocr: { ...READY_WORKER_STATUS.ocr, languages: ["eng", "deu"] },
      translateOcr,
    }),
  );
  await page.route("**/api/uploads", async (route) => {
    log.push("reserve");
    await json(route, 200, {
      sessionId: "ses_t1",
      tool: "translate-pdf",
      slots: [
        {
          fileId: "file_t1",
          filename: "in",
          url: "/__e2e/translate-upload/1",
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    });
  });
  await page.route("**/__e2e/translate-upload/**", async (route) => {
    log.push("put");
    await json(route, 200, {});
  });
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    log.push("create");
    bodies.push(JSON.parse(route.request().postDataBuffer()!.toString()));
    const now = new Date().toISOString();
    // Ends the job at once: what is under test is the request.
    await json(route, 200, {
      jobId: "job_t1",
      tool: "translate-pdf",
      capability: "secure-worker",
      status: "failed",
      progress: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
      error: {
        code: "internal_error",
        message: "Stopped by the test.",
        retryable: false,
      },
    });
  });
  await page.route("**/api/jobs/job_t1", (route) =>
    json(route, 200, {
      jobId: "job_t1",
      tool: "translate-pdf",
      status: "failed",
      error: {
        code: "internal_error",
        message: "Stopped by the test.",
        retryable: false,
      },
    }),
  );
  return { log, bodies };
}

async function choose(page: Page, bytes: Uint8Array, name: string) {
  await page.goto("/tools/translate-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  });
  await expect(page.getByText(name)).toBeVisible();
  const run = page.getByRole("button", { name: "Translate PDF" });
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  return run;
}

test("translateOcr advertised: a scan gets the language picker, and Run sends the OCR request with no declared count", async ({
  page,
}) => {
  const { log, bodies } = await mockWorker(page, true);
  const run = await choose(page, await makeScanPdfBytes(1), "scan.pdf");
  const section = page.getByRole("region", {
    name: "Recognise the scan's text first",
  });
  await expect(section).toBeVisible();
  await expect(section).toContainText(TRANSLATE_SCAN_CHECK);
  await section.getByRole("button", { name: "German" }).click();
  await page.waitForTimeout(300);
  expect(log, "something was uploaded before Run").toEqual([]);
  await run.click();
  await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1);
  const body = bodies[0]!;
  expect(body.tool).toBe("translate-pdf");
  const options = body.options as Record<string, unknown>;
  expect(options.ocr).toBe(true);
  expect(options.languages).toEqual(expect.arrayContaining(["deu"]));
  expect(body.declaredCharacters).toBeUndefined();
  expect(body.declaredTextPages).toBeUndefined();
  expect(log).toEqual(["reserve", "put", "create"]);
});

test("translateOcr advertised: a typed PDF shows no picker and is sent counted", async ({
  page,
}) => {
  const { bodies } = await mockWorker(page, true);
  const run = await choose(page, await makePdfBytes("typed", 1), "typed.pdf");
  await page.waitForTimeout(500);
  await expect(
    page.getByRole("region", { name: "Recognise the scan's text first" }),
  ).toHaveCount(0);
  await run.click();
  await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1);
  const body = bodies[0]!;
  expect((body.options as Record<string, unknown>).ocr).toBeUndefined();
  expect(typeof body.declaredCharacters).toBe("number");
});

test("translateOcr NOT advertised: today's refusal, no picker, nothing leaves the page", async ({
  page,
}) => {
  const { log, bodies } = await mockWorker(page, false);
  const run = await choose(page, await makeScanPdfBytes(1), "scan.pdf");
  await page.waitForTimeout(500);
  await expect(
    page.getByRole("region", { name: "Recognise the scan's text first" }),
  ).toHaveCount(0);
  await run.click();
  await expect(
    page.getByRole("alert").filter({ hasText: TRANSLATE_NO_TEXT_MESSAGE }),
  ).toContainText(TRANSLATE_NO_TEXT_MESSAGE);
  expect(log).toEqual([]);
  expect(bodies).toEqual([]);
});

/*
 * REVIEW FINDINGS (2026-11-09), first measured with throwaway specs against
 * this served build: a Run pressed straight after choosing a scan sent an OCR
 * job the reader had never been shown; Source = German still sent ["eng"];
 * and at 375 px the section's arrival pushed Run from y 708 to y 1,823 with
 * nothing telling the reader why.
 */

test("a Run pressed straight after choosing a scan sends nothing, brings the section to focus, and the next Run sends", async ({
  page,
}) => {
  const { log, bodies } = await mockWorker(page, true);
  await page.goto("/tools/translate-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "scan.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await makeScanPdfBytes(1)),
  });
  const section = page.getByRole("region", {
    name: "Recognise the scan's text first",
  });
  const run = page.getByRole("button", { name: "Translate PDF" });
  await run.click();
  const drawnAtClick = await section.count();
  await expect(section).toBeVisible();
  await expect(
    section.getByText("Recognise the scan's text first", { exact: true }),
  ).toBeFocused();
  await page.waitForTimeout(500);
  if (drawnAtClick === 0)
    expect(
      log,
      "an OCR job was sent from a Run made before the section",
    ).toEqual([]);
  await run.click();
  await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1);
  expect((bodies[0]!.options as Record<string, unknown>).ocr).toBe(true);
  // The first click must have met the case under test, or this proved nothing.
  expect(drawnAtClick, "the section was already drawn at the first click").toBe(
    0,
  );
});

test("Source language = German recognises the scan in German", async ({
  page,
}) => {
  const { bodies } = await mockWorker(page, true);
  const run = await choose(page, await makeScanPdfBytes(1), "scan.pdf");
  await expect(
    page.getByRole("region", { name: "Recognise the scan's text first" }),
  ).toBeVisible();
  await page.getByLabel("Source language").selectOption({ label: "German" });
  await run.click();
  await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1);
  expect((bodies[0]!.options as Record<string, unknown>).languages).toEqual([
    "deu",
  ]);
});

test.describe("at 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("the section's arrival is brought into view and focused, not dropped silently above Run", async ({
    page,
  }) => {
    await mockWorker(page, true);
    await choose(page, await makeScanPdfBytes(1), "scan.pdf");
    const heading = page
      .getByRole("region", { name: "Recognise the scan's text first" })
      .getByText("Recognise the scan's text first", { exact: true });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
  });
});
