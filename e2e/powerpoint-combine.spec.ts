import { test, expect, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { fileInput, makePdfBytes, waitForHydration } from "./helpers";
import { pdfPageTexts } from "./client-proof/artifacts";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";
import { COMBINE_PDFS_LABEL } from "../src/lib/batch/worker-copy";

/**
 * Audit wave 2, powerpoint-to-pdf#1, through the SERVED page with the worker
 * mocked at the wire: three decks dropped in the order one, two, three, with
 * "Combine into one PDF" ticked, give ONE downloaded PDF whose page count is
 * the sum of the three converted PDFs and whose segments start, in drop
 * order, with each deck's own first page. The join runs in the browser: the
 * page makes no request after the last artifact is fetched.
 *
 * Each deck's PDF has a different page count (2, 1, 3), so a join in the
 * wrong order or with a deck missing cannot add up to the same pages.
 */

const PAGES = [2, 1, 3];
const DECKS = ["one", "two", "three"];
const PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

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

function jobBody(id: string, status: string, n: number) {
  const now = new Date().toISOString();
  return {
    jobId: id,
    tool: "powerpoint-to-pdf",
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
              artifactId: `art_p${n}`,
              filename: `${DECKS[n - 1]}.pdf`,
              contentType: "application/pdf",
              bytes: 8,
              url: `/__e2e/deck-art/${n}`,
              expiresAt: now,
            },
          ],
        }
      : {}),
  };
}

async function mockWorker(page: Page) {
  const log: string[] = [];
  let reservations = 0;
  let jobs = 0;
  await page.route("**/api/worker/status", (route) =>
    json(route, 200, READY_WORKER_STATUS),
  );
  await page.route("**/api/uploads", async (route) => {
    reservations += 1;
    const n = reservations;
    log.push(`reserve ${n}`);
    await json(route, 200, {
      sessionId: `ses_p${n}`,
      tool: "powerpoint-to-pdf",
      slots: [
        {
          fileId: `file_p${n}`,
          filename: "in",
          url: `/__e2e/deck-upload/${n}`,
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    });
  });
  await page.route("**/__e2e/deck-upload/**", async (route) => {
    log.push("put");
    await json(route, 200, {});
  });
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    jobs += 1;
    log.push(`create ${jobs}`);
    await json(route, 200, jobBody(`job_p${jobs}`, "queued", jobs));
  });
  await page.route("**/api/jobs/job_p*", async (route) => {
    const id = route.request().url().split("/").pop()!;
    await json(route, 200, jobBody(id, "completed", Number(id.slice(5))));
  });
  await page.route("**/__e2e/deck-art/**", async (route) => {
    const n = Number(route.request().url().split("/").pop());
    log.push(`artifact ${n}`);
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/pdf" },
      body: Buffer.from(
        await makePdfBytes(`deck-${DECKS[n - 1]}`, PAGES[n - 1]),
      ),
    });
  });
  return log;
}

test("PowerPoint to PDF: three decks, Combine into one PDF, one PDF in drop order", async ({
  page,
}) => {
  const log = await mockWorker(page);
  await page.goto("/tools/powerpoint-to-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles(
    DECKS.map((name) => ({
      name: `${name}.pptx`,
      mimeType: PPTX,
      buffer: Buffer.from(`PK\u0003\u0004 deck ${name}`),
    })),
  );
  const run = page.getByRole("button", { name: "Convert 3 presentations" });
  await expect(run).toBeVisible({ timeout: 15_000 });
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  const combine = page.getByRole("checkbox", { name: COMBINE_PDFS_LABEL });
  await combine.check();
  await run.click();

  const one = page.getByRole("button", { name: /^download one pdf/i });
  await expect(one).toBeVisible({ timeout: 30_000 });
  const before = log.length;
  const download = page.waitForEvent("download");
  await one.click();
  const file = await (await download).path();
  // Joined in the browser: nothing went over the wire for it.
  expect(log.slice(before)).toEqual([]);
  expect(log.filter((l) => l.startsWith("artifact"))).toEqual([
    "artifact 1",
    "artifact 2",
    "artifact 3",
  ]);

  const bytes = await readFile(file);
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(PAGES.reduce((a, b) => a + b, 0));
  const texts = await pdfPageTexts(bytes);
  let at = 0;
  DECKS.forEach((deck, i) => {
    expect(texts[at]).toContain(`deck-${deck}`);
    expect(texts[at]).toContain("page 1");
    at += PAGES[i]!;
  });
});

test("CONTROL: without the tick there is no single-PDF download", async ({
  page,
}) => {
  await mockWorker(page);
  await page.goto("/tools/powerpoint-to-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles(
    DECKS.map((name) => ({
      name: `${name}.pptx`,
      mimeType: PPTX,
      buffer: Buffer.from(`PK\u0003\u0004 deck ${name}`),
    })),
  );
  const run = page.getByRole("button", { name: "Convert 3 presentations" });
  await expect(run).not.toHaveAttribute("aria-disabled", "true", {
    timeout: 15_000,
  });
  await run.click();
  await expect(page.getByRole("button", { name: /download all/i })).toBeVisible(
    { timeout: 30_000 },
  );
  await expect(
    page.getByRole("button", { name: /^download one pdf/i }),
  ).toHaveCount(0);
});
