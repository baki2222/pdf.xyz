import { test, expect, type Page, type Route } from "@playwright/test";
import { fileInput, makePdfBytes, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";
import {
  OWNER_ONLY_PDF_BASE64,
  USER_PASSWORD_PDF_BASE64,
} from "../src/tests/fixtures-encrypted";
import {
  PROTECT_RESTRICTED_REASON,
  UNLOCK_NOT_LOCKED_REASON,
} from "../src/lib/batch/security-copy";

/**
 * Protect PDF's and Unlock PDF's batch through the served page (batch plan
 * P4), the worker MOCKED at the wire (`page.route`), every request recorded
 * in the order the page made it:
 *
 *  - Unlock, 3 PDFs — one not locked, two locked with different passwords:
 *    the not-locked one is looked at in the browser and never reserved,
 *    PUT or sent as a job; the other two run strictly in turn; the one the
 *    password does not open fails its row, and "Try another password" runs
 *    that file, and only it, again with the new password;
 *  - Protect, 3 PDFs — one already encrypted: refused before any upload,
 *    the other two each carry the same password and strength.
 */

const FIRST = "e2e-first-K7m";
const SECOND = "e2e-second-P9q";
const WRONG =
  "The password is incorrect, or this PDF cannot be unlocked with it.";

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

function jobBody(
  tool: string,
  id: string,
  status: string,
  n: number,
  error?: { code: string; message: string; retryable: boolean },
) {
  const now = new Date().toISOString();
  return {
    jobId: id,
    tool,
    capability: "secure-worker",
    status,
    progress: status === "completed" ? 100 : 0,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    ...(error ? { error } : {}),
    ...(status === "completed"
      ? {
          artifacts: [
            {
              artifactId: `art_s${n}`,
              filename: `file-${n}-out.pdf`,
              contentType: "application/pdf",
              bytes: 8,
              url: `/__e2e/sec-art/${n}`,
              expiresAt: now,
            },
          ],
        }
      : {}),
  };
}

/**
 * The worker at the wire. `opens(n, options)` decides whether job n
 * completes or fails on a wrong password, from the options its body sent.
 */
async function mockWorker(
  page: Page,
  tool: string,
  opens: (n: number, options: Record<string, unknown>) => boolean,
) {
  const log: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const outcome = new Map<string, boolean>();
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
      sessionId: `ses_s${n}`,
      tool,
      slots: [
        {
          fileId: `file_s${n}`,
          filename: "in",
          url: `/__e2e/sec-upload/${n}`,
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    });
  });
  await page.route("**/__e2e/sec-upload/**", async (route) => {
    log.push(`put ${route.request().url().split("/").pop()}`);
    await json(route, 200, {});
  });
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    jobs += 1;
    const id = `job_s${jobs}`;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    outcome.set(
      id,
      opens(jobs, (body.options ?? {}) as Record<string, unknown>),
    );
    log.push(`create ${id}`);
    await json(route, 200, jobBody(tool, id, "queued", jobs));
  });
  await page.route("**/api/jobs/job_s*", async (route) => {
    const id = route.request().url().split("/").pop()!;
    const n = Number(id.slice(5));
    const ok = outcome.get(id) ?? false;
    log.push(`terminal ${id}`);
    await json(
      route,
      200,
      ok
        ? jobBody(tool, id, "completed", n)
        : jobBody(tool, id, "failed", n, {
            code: "unprocessable_entity",
            message: WRONG,
            retryable: false,
          }),
    );
  });
  await page.route("**/__e2e/sec-art/**", async (route) => {
    log.push(`download ${route.request().url().split("/").pop()}`);
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/pdf" },
      body: Buffer.from("%PDF-1.7\n%%EOF\n"),
    });
  });
  return { log, bodies };
}

const pdf = (name: string, buffer: Buffer) => ({
  name: `${name}.pdf`,
  mimeType: "application/pdf",
  buffer,
});

test("Unlock, 3 PDFs: the unlocked one never leaves, jobs run in turn, and another password reruns only the failed row", async ({
  page,
}) => {
  const { log, bodies } = await mockWorker(
    page,
    "unlock-pdf",
    // Job 1 is statement-a (opens with FIRST); every later job is
    // statement-b, which opens only with SECOND.
    (n, options) =>
      n === 1 ? options.password === FIRST : options.password === SECOND,
  );
  await page.goto("/tools/unlock-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  const locked = Buffer.from(USER_PASSWORD_PDF_BASE64, "base64");
  await input.setInputFiles([
    pdf("plain", Buffer.from(await makePdfBytes("plain", 1))),
    pdf("statement-a", locked),
    pdf("statement-b", locked),
  ]);
  const run = page.getByRole("button", { name: "Unlock 3 PDFs" });
  await expect(run).toBeVisible();
  // Run waits for the password.
  await expect(run).toHaveAttribute("aria-disabled", "true");
  await page.getByLabel("Current password", { exact: true }).fill(FIRST);
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  await page.waitForTimeout(300);
  expect(log, "a file was uploaded before Run").toEqual([]);
  await run.click();
  await expect(
    page.getByRole("heading", {
      name: "Batch complete. 1 done, 1 failed, 1 skipped.",
    }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(UNLOCK_NOT_LOCKED_REASON)).toBeVisible();
  await expect(page.getByText(WRONG)).toBeVisible();
  // The not-locked file was never reserved, PUT or sent.
  expect(log.filter((l) => l.startsWith("reserve"))).toEqual([
    "reserve 1",
    "reserve 2",
  ]);
  expect(log.filter((l) => l.startsWith("put"))).toEqual(["put 1", "put 2"]);
  // Strictly in turn: file 2 is reserved only after job 1 ended and its
  // output was fetched.
  expect(log.indexOf("terminal job_s1")).toBeLessThan(
    log.indexOf("download 1"),
  );
  expect(log.indexOf("download 1")).toBeLessThan(log.indexOf("reserve 2"));
  // The same password in both job bodies.
  expect(bodies.map((b) => b.options)).toEqual([
    { password: FIRST },
    { password: FIRST },
  ]);

  // Try another password, for the failed row only.
  await expect(
    page.getByRole("heading", {
      name: "Try another password for the 1 failed file",
    }),
  ).toBeVisible();
  await page.getByLabel("Another password", { exact: true }).fill(SECOND);
  await page.getByRole("button", { name: "Try it on 1 PDF" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Batch complete. 2 done, 0 failed, 1 skipped.",
    }),
  ).toBeVisible({ timeout: 30_000 });
  expect(log.filter((l) => l.startsWith("reserve"))).toHaveLength(3);
  expect(log.filter((l) => l.startsWith("create"))).toEqual([
    "create job_s1",
    "create job_s2",
    "create job_s3",
  ]);
  expect(log.indexOf("terminal job_s2")).toBeLessThan(log.indexOf("reserve 3"));
  expect(bodies[2]!.options).toEqual({ password: SECOND });
  await expect(
    page.getByRole("button", { name: "Download all (2)" }),
  ).toBeVisible();
  // Nothing of the batch in storage, and no password anywhere in it.
  const stored = await page.evaluate(() =>
    JSON.stringify({ ...sessionStorage, ...localStorage }),
  );
  expect(stored).not.toContain(FIRST);
  expect(stored).not.toContain(SECOND);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  expect(page.url()).not.toContain(FIRST);
});

test("Protect, 3 PDFs: an encrypted one is refused before any upload", async ({
  page,
}) => {
  const { log, bodies } = await mockWorker(page, "protect-pdf", () => true);
  await page.goto("/tools/protect-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles([
    pdf("one", Buffer.from(await makePdfBytes("one", 1))),
    pdf("restricted", Buffer.from(OWNER_ONLY_PDF_BASE64, "base64")),
    pdf("two", Buffer.from(await makePdfBytes("two", 1))),
  ]);
  const run = page.getByRole("button", { name: "Protect 3 PDFs" });
  await expect(run).toBeVisible();
  await page.getByLabel("New password", { exact: true }).fill(FIRST);
  await page.getByLabel("Confirm password", { exact: true }).fill(FIRST);
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  await run.click();
  await expect(
    page.getByRole("heading", {
      name: "Batch complete. 2 done, 0 failed, 1 skipped.",
    }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(PROTECT_RESTRICTED_REASON)).toBeVisible();
  // Two uploads, in turn; the encrypted file never reached the network.
  expect(log.filter((l) => l.startsWith("put"))).toEqual(["put 1", "put 2"]);
  expect(log.filter((l) => l.startsWith("reserve"))).toHaveLength(2);
  expect(log.indexOf("download 1")).toBeLessThan(log.indexOf("reserve 2"));
  expect(bodies).toHaveLength(2);
  expect(bodies[0]!.options).toEqual(bodies[1]!.options);
  expect(bodies[0]!.options).toMatchObject({ password: FIRST });
});
