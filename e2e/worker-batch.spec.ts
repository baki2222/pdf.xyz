import { test, expect, type Page, type Route } from "@playwright/test";
import { fileInput, makePdfBytes, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";

/**
 * A worker batch through the served page (batch plan P3), with the worker
 * MOCKED at the wire (`page.route`), every request recorded in the order
 * the page made it:
 *
 *  - three PDFs on Optimize for Web run as three of today's single jobs,
 *    strictly in turn: file k+1 is not even reserved before job k has
 *    ended and its output has been fetched;
 *  - nothing is uploaded before Run;
 *  - Cancel while the first job runs stops it with exactly ONE DELETE, and
 *    the files after it never reach the network (one reservation, one PUT).
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

function jobBody(id: string, status: string, n: number) {
  const now = new Date().toISOString();
  return {
    jobId: id,
    tool: "optimize-web",
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
              artifactId: `art_b${n}`,
              filename: `file-${n}-web.pdf`,
              contentType: "application/pdf",
              bytes: 8,
              url: `/__e2e/batch-art/${n}`,
              expiresAt: now,
            },
          ],
        }
      : {}),
  };
}

/** The worker at the wire; `finishes` false keeps every job processing. */
async function mockBatchWorker(page: Page, finishes: boolean) {
  const log: string[] = [];
  let reservations = 0;
  let jobs = 0;
  const polls = new Map<string, number>();
  await page.route("**/api/worker/status", (route) =>
    json(route, 200, READY_WORKER_STATUS),
  );
  await page.route("**/api/uploads", async (route) => {
    reservations += 1;
    const n = reservations;
    log.push(`reserve ${n}`);
    await json(route, 200, {
      sessionId: `ses_b${n}`,
      tool: "optimize-web",
      slots: [
        {
          fileId: `file_b${n}`,
          filename: "in",
          url: `/__e2e/batch-upload/${n}`,
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    });
  });
  await page.route("**/__e2e/batch-upload/**", async (route) => {
    log.push(`put ${route.request().url().split("/").pop()}`);
    await json(route, 200, {});
  });
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    jobs += 1;
    const id = `job_b${jobs}`;
    polls.set(id, 0);
    log.push(`create ${id}`);
    await json(route, 200, jobBody(id, "queued", jobs));
  });
  await page.route("**/api/jobs/job_b*", async (route) => {
    const id = route.request().url().split("/").pop()!;
    if (route.request().method() === "DELETE") {
      log.push(`delete ${id}`);
      return json(route, 200, jobBody(id, "canceled", 0));
    }
    const n = (polls.get(id) ?? 0) + 1;
    polls.set(id, n);
    const status = finishes && n >= 2 ? "completed" : "processing";
    if (status === "completed") log.push(`terminal ${id}`);
    await json(route, 200, jobBody(id, status, Number(id.slice(5))));
  });
  await page.route("**/__e2e/batch-art/**", async (route) => {
    log.push(`download ${route.request().url().split("/").pop()}`);
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/pdf" },
      body: Buffer.from("%PDF-1.7\n%%EOF\n"),
    });
  });
  return log;
}

async function addThree(page: Page) {
  await page.goto("/tools/optimize-web");
  const input = fileInput(page);
  await waitForHydration(input);
  const files = await Promise.all(
    ["one", "two", "three"].map(async (name) => ({
      name: `${name}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(await makePdfBytes(name, 1)),
    })),
  );
  await input.setInputFiles(files);
  const run = page.getByRole("button", { name: "Optimize 3 PDFs" });
  await expect(run).toBeVisible();
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  return run;
}

test("three PDFs run as three single jobs, strictly one after another", async ({
  page,
}) => {
  const log = await mockBatchWorker(page, true);
  const run = await addThree(page);
  await page.waitForTimeout(500);
  expect(log, "a file was uploaded before Run").toEqual([]);
  await run.click();
  await expect(
    page.getByRole("heading", { name: "Batch complete. 3 done, 0 failed." }),
  ).toBeVisible({ timeout: 30_000 });
  expect(log.filter((l) => l.startsWith("reserve"))).toHaveLength(3);
  expect(log.filter((l) => l.startsWith("create"))).toHaveLength(3);
  // Each file's life ends before the next one begins.
  for (const k of [1, 2]) {
    const done = log.indexOf(`download ${k}`);
    const next = log.indexOf(`reserve ${k + 1}`);
    expect(done, `file ${k} was never downloaded`).toBeGreaterThanOrEqual(0);
    expect(log.indexOf(`terminal job_b${k}`)).toBeLessThan(done);
    expect(
      next,
      `file ${k + 1} was reserved before file ${k} ended`,
    ).toBeGreaterThan(done);
  }
  await expect(
    page.getByRole("button", { name: "Download all (3)" }),
  ).toBeVisible();
});

test("Cancel during the first job sends one DELETE, and the other files never leave", async ({
  page,
}) => {
  const log = await mockBatchWorker(page, false);
  const run = await addThree(page);
  await run.click();
  await expect.poll(() => log.includes("create job_b1")).toBe(true);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("heading", { name: "Batch canceled." }),
  ).toBeVisible();
  await page.waitForTimeout(1500);
  expect(log.filter((l) => l.startsWith("put"))).toEqual(["put 1"]);
  expect(log.filter((l) => l.startsWith("reserve"))).toEqual(["reserve 1"]);
  expect(log.filter((l) => l.startsWith("delete"))).toEqual(["delete job_b1"]);
});
