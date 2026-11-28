import { readFile } from "node:fs/promises";
import { test, expect, type Page, type Route } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { fileInput, makePdfBytes, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";
import {
  OWNER_ONLY_PDF_BASE64,
  USER_PASSWORD_PDF_BASE64,
} from "../src/tests/fixtures-encrypted";
import {
  UNLOCK_NOT_LOCKED_LINE,
  UNLOCK_OWNER_PASSWORD_LABEL,
  UNLOCK_WRONG_PASSWORD_LINE,
} from "../src/components/tools/unlock-preflight";

/**
 * Unlock PDF's single-file panel through the served page, the worker MOCKED
 * at the wire (`page.route`), every upload reservation, PUT and job POST
 * counted (audits unlock-pdf#1 and #5):
 *
 *  - a PDF that is not locked: the "not locked" line, 0 requests;
 *  - a PDF that needs a password, with a wrong one: an inline error under
 *    the field, 0 requests;
 *  - the same file with its real password: the picked bytes are uploaded,
 *    the typed password is in the job request, and the bytes the (mocked)
 *    worker returns are the bytes saved. Decryption itself is qpdf's on the
 *    worker and is NOT proven here; this proves the page's chain only.
 *  - a restricted file: the field asks for the owner (permissions) password;
 *  - the field's autocomplete as served: "current-password" on Unlock,
 *    "new-password" on Protect (the control).
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

/** What reached the mocked wire, per page: the uploaded bytes and the job request. */
const wire = new WeakMap<
  Page,
  { put?: Buffer; job?: string; served: Uint8Array }
>();

async function mockWorker(page: Page, output: Uint8Array) {
  const sent: string[] = [];
  const seen: { put?: Buffer; job?: string; served: Uint8Array } = {
    served: output,
  };
  wire.set(page, seen);
  await page.route("**/api/worker/status", (route) =>
    json(route, 200, READY_WORKER_STATUS),
  );
  await page.route("**/api/uploads", async (route) => {
    sent.push(`reserve ${route.request().method()}`);
    await json(route, 200, {
      sessionId: "ses_u1",
      tool: "unlock-pdf",
      slots: [
        {
          fileId: "file_u1",
          filename: "in",
          url: "/__e2e/unlock-upload/1",
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    });
  });
  await page.route("**/__e2e/unlock-upload/**", async (route) => {
    sent.push(`put ${route.request().method()}`);
    seen.put = route.request().postDataBuffer() ?? undefined;
    await json(route, 200, {});
  });
  const job = (status: string) => {
    const now = new Date().toISOString();
    return {
      jobId: "job_u1",
      tool: "unlock-pdf",
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
                artifactId: "art_u1",
                filename: "locked-unlocked.pdf",
                contentType: "application/pdf",
                bytes: output.length,
                url: "/__e2e/unlock-art/1",
                expiresAt: now,
              },
            ],
          }
        : {}),
    };
  };
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    sent.push("job POST");
    seen.job = route.request().postData() ?? undefined;
    await json(route, 200, job("queued"));
  });
  await page.route("**/api/jobs/job_u1", (route) =>
    json(route, 200, job("completed")),
  );
  await page.route("**/__e2e/unlock-art/**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "application/pdf" },
      body: Buffer.from(output),
    }),
  );
  return sent;
}

async function openUnlock(page: Page, file: { name: string; buffer: Buffer }) {
  const sent = await mockWorker(page, await makePdfBytes("unlocked", 1));
  await page.goto("/tools/unlock-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({ ...file, mimeType: "application/pdf" });
  await expect(page.getByText(file.name, { exact: true })).toBeVisible();
  return sent;
}

const locked = () => ({
  name: "locked.pdf",
  buffer: Buffer.from(USER_PASSWORD_PDF_BASE64, "base64"),
});

test("a PDF that is not locked is reported at once and nothing is sent", async ({
  page,
}) => {
  const sent = await openUnlock(page, {
    name: "plain.pdf",
    buffer: Buffer.from(await makePdfBytes("plain", 1)),
  });
  await expect(page.getByText(UNLOCK_NOT_LOCKED_LINE)).toBeVisible();
  await page.locator("#pdf-security-password").fill("anything");
  const run = page.getByRole("button", { name: "Unlock PDF" });
  await expect(run).toHaveAttribute("aria-disabled", "true");
  await run.click({ force: true });
  await expect(page.getByText(UNLOCK_NOT_LOCKED_LINE)).toBeVisible();
  expect(sent).toEqual([]);
});

test("a wrong open password is caught in the browser, inline, and nothing is sent", async ({
  page,
}) => {
  const sent = await openUnlock(page, locked());
  await expect(page.getByLabel("Current password")).toBeVisible();
  await page.getByLabel("Current password").fill("not-the-password");
  await page.getByRole("button", { name: "Unlock PDF" }).click();
  const alert = page.locator("#pdf-security-password-hint");
  await expect(alert).toHaveText(UNLOCK_WRONG_PASSWORD_LINE);
  await expect(alert).toHaveAttribute("role", "alert");
  expect(sent).toEqual([]);
});

test("the right password uploads the picked file and that password, and saves what the worker returns", async ({
  page,
}) => {
  const file = locked();
  const sent = await openUnlock(page, file);
  await page.getByLabel("Current password").fill("open-sesame");
  await page.getByRole("button", { name: "Unlock PDF" }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download locked-unlocked.pdf" })
    .click({ timeout: 20_000 });
  const saved = await readFile((await (await download).path())!);
  expect(sent).toEqual(["reserve POST", "put PUT", "job POST"]);
  // Review 2026-11-28 findings 4 and 10: the worker here is a mock that
  // serves the same unlocked file whatever it is sent, so "the download
  // has no /Encrypt" proved nothing about decryption. What this test CAN
  // prove is the page's half of the chain: the bytes picked are the bytes
  // uploaded, the password typed is in the job request, and the bytes the
  // worker returns are the bytes saved. Decryption itself is qpdf's, on the
  // worker, which this change does not touch.
  const seen = wire.get(page)!;
  expect(seen.put?.equals(file.buffer)).toBe(true);
  expect(seen.job).toContain('"open-sesame"');
  expect(saved.equals(Buffer.from(seen.served))).toBe(true);
  expect((await PDFDocument.load(saved)).getPageCount()).toBe(1);
  await expect(page.getByText(UNLOCK_WRONG_PASSWORD_LINE)).toHaveCount(0);
});

test("a restricted PDF asks for its owner (permissions) password", async ({
  page,
}) => {
  const sent = await openUnlock(page, {
    name: "restricted.pdf",
    buffer: Buffer.from(OWNER_ONLY_PDF_BASE64, "base64"),
  });
  await expect(page.getByLabel(UNLOCK_OWNER_PASSWORD_LABEL)).toBeVisible();
  await expect(page.getByLabel("Current password")).toHaveCount(0);
  expect(sent).toEqual([]);
});

test("the password field's autocomplete as served: current-password on Unlock, new-password on Protect", async ({
  page,
}) => {
  await mockWorker(page, new Uint8Array());
  await page.goto("/tools/unlock-pdf");
  await expect(page.locator("#pdf-security-password")).toHaveAttribute(
    "autocomplete",
    "current-password",
  );
  await page.goto("/tools/protect-pdf");
  await expect(page.locator("#pdf-security-password")).toHaveAttribute(
    "autocomplete",
    "new-password",
  );
});
