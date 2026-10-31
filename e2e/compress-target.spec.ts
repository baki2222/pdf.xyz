import { test, expect, type Page, type Route } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";

/**
 * Compress PDF's Target size (2026-10-31), through the page of a production
 * build with the worker MOCKED at the wire: the request the panel sends, and
 * the sentence it draws from what comes back. The ladder itself is proven on
 * the real engine by the in-image options proof (container.yml) and, once
 * the worker image is published, by
 * `BASE=https://pdf.xyz pnpm worker:prove-tools "compress-pdf (target size)"`.
 *
 *  - with "200 KB" chosen, the job asks for 204,800 bytes and the result says
 *    it is under, from the size of the file actually downloaded;
 *  - a job record WITHOUT a target block — a worker image older than the
 *    feature, which runs at the Quality setting and ignores the target — is
 *    not reported as "the smallest we could make";
 *  - "No target" (the default) sends exactly what a run sent before.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

const KB = 1024;

/** A PDF of about `kb` KB (pdf-lib writes /Subject as UTF-16 hex, 4 B a character). */
async function pdfOfAbout(kb: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.setSubject("x".repeat((kb * KB) / 4));
  // Without object streams: inside one, the pad is Flate-compressed to nothing.
  return doc.save({ useObjectStreams: false });
}

const json = (route: Route, body: unknown) =>
  route.fulfill({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** The worker, at the wire; returns the options every job was created with. */
async function mockWorker(
  page: Page,
  artifact: Uint8Array,
  target: ((asked: number) => Record<string, unknown>) | null,
) {
  const sent: Record<string, unknown>[] = [];
  await page.route("**/api/worker/status", (route) =>
    json(route, READY_WORKER_STATUS),
  );
  await page.route("**/api/uploads", (route) =>
    json(route, {
      sessionId: "ses_target",
      tool: "compress-pdf",
      slots: [
        {
          fileId: "file_target",
          filename: "in",
          url: "/__e2e/upload/file_target",
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    }),
  );
  await page.route("**/__e2e/upload/**", (route) => json(route, {}));
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const options = (
      route.request().postDataJSON() as { options: Record<string, unknown> }
    ).options;
    sent.push(options);
    const now = new Date().toISOString();
    const asked = options.targetBytes;
    await json(route, {
      jobId: "job_target",
      tool: "compress-pdf",
      capability: "secure-worker",
      status: "completed",
      progress: 100,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
      artifacts: [
        {
          artifactId: "art_target",
          filename: "scan-compressed.pdf",
          contentType: "application/pdf",
          bytes: artifact.byteLength,
          url: "/__e2e/artifact/art_target",
          expiresAt: now,
        },
      ],
      results: {
        compression: {
          pageCheck: "verified",
          pagesIn: 1,
          pagesOut: 1,
          ...(target && typeof asked === "number"
            ? { target: target(asked) }
            : {}),
        },
      },
    });
  });
  await page.route("**/__e2e/artifact/**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "application/pdf" },
      body: Buffer.from(artifact),
    }),
  );
  return sent;
}

async function openWith(page: Page, bytes: Uint8Array) {
  await page.goto("/tools/compress-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "scan.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  });
  const run = page.getByRole("button", {
    name: /compress images on our server/i,
  });
  await expect(run).toBeVisible({ timeout: 20_000 });
  return run;
}

test("200 KB: the job asks for it, and the result says it is under, from the downloaded size", async ({
  page,
}) => {
  const artifact = await pdfOfAbout(150);
  const sent = await mockWorker(page, artifact, (asked) => ({
    targetBytes: asked,
    met: true,
    attempts: 2,
    outputBytes: artifact.byteLength,
  }));
  const run = await openWith(page, await pdfOfAbout(320));
  const preset = page.getByRole("button", { name: "200 KB", exact: true });
  await preset.click();
  await expect(preset).toHaveAttribute("aria-pressed", "true");
  await run.click();
  const line = page.locator("[data-target-met]");
  await expect(line).toHaveText(
    /^Now 15\d\.\d KB — under your 200 KB target\.$/,
    { timeout: 20_000 },
  );
  await expect(line).toHaveAttribute("data-target-met", "true");
  await expect(
    page.getByRole("button", { name: /download compressed pdf/i }),
  ).toBeVisible();
  expect(sent).toEqual([
    { profile: "deep", targetDpi: 150, targetBytes: 200 * KB },
  ]);
});

test("a worker that ignored the target is not reported as 'the smallest we could make'", async ({
  page,
}) => {
  const artifact = await pdfOfAbout(250);
  const sent = await mockWorker(page, artifact, null);
  const run = await openWith(page, await pdfOfAbout(320));
  await page.getByRole("button", { name: "200 KB", exact: true }).click();
  await run.click();
  // The result's own line (the card also announces it to a screen reader).
  const line = page.locator("[data-target-met]");
  await expect(line).toHaveText(/did not apply your 200 KB target/, {
    timeout: 20_000,
  });
  await expect(line).not.toHaveText(/smallest we could make/);
  expect(sent[0]?.targetBytes).toBe(200 * KB);
});

test("No target is the default and sends what a run always sent", async ({
  page,
}) => {
  const artifact = await pdfOfAbout(150);
  const sent = await mockWorker(page, artifact, null);
  const run = await openWith(page, await pdfOfAbout(320));
  await expect(
    page.getByRole("button", { name: "No target", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await run.click();
  await expect(
    page.getByRole("button", { name: /download compressed pdf/i }),
  ).toBeVisible({ timeout: 20_000 });
  // No target line on the result (the FAQ's quoted example is not one).
  await expect(page.locator("[data-target-met]")).toHaveCount(0);
  expect(sent).toEqual([{ profile: "deep", targetDpi: 150 }]);
});
