import { test, expect, type Page, type Route } from "@playwright/test";
import JSZip from "jszip";
import { fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";

/**
 * HTML to PDF's two new inputs (competitor audit #26) through the SERVED
 * page, the worker mocked at the wire (`page.route`), up to the job POST:
 *
 *  - PASTE: "Or paste HTML code" opens a labelled box; what is pasted is
 *    uploaded as pasted.html (declared text/html, its size the byte-order
 *    mark plus its UTF-8), by the same requests a chosen file makes.
 *  - ZIP, offered: a .zip of two pages asks which to print; the upload is
 *    declared application/zip and the job carries the chosen page as
 *    `entry`.
 *  - ZIP, NOT offered (the running worker does not prove `htmlZip`): the
 *    picker takes HTML only, a .zip is refused at the pick, and nothing is
 *    uploaded.
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

async function mockWorker(page: Page, htmlZip: boolean) {
  const log: string[] = [];
  const uploads: Record<string, unknown>[] = [];
  const jobs: Record<string, unknown>[] = [];
  await page.route("**/api/worker/status", (route) =>
    json(route, 200, { ...READY_WORKER_STATUS, htmlZip }),
  );
  await page.route("**/api/uploads", async (route) => {
    log.push("reserve");
    uploads.push(JSON.parse(route.request().postDataBuffer()!.toString()));
    await json(route, 200, {
      sessionId: "ses_h1",
      tool: "html-to-pdf",
      slots: [
        {
          fileId: "f_htmlinputs001",
          filename: "in",
          url: "/__e2e/html-upload/1",
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    });
  });
  await page.route("**/__e2e/html-upload/**", async (route) => {
    log.push("put");
    await json(route, 200, {});
  });
  const failed = {
    jobId: "job_h1",
    tool: "html-to-pdf",
    capability: "secure-worker",
    status: "failed",
    progress: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
    log.push("create");
    jobs.push(JSON.parse(route.request().postDataBuffer()!.toString()));
    // Ends the job at once: what is under test is the request.
    await json(route, 200, failed);
  });
  await page.route("**/api/jobs/job_h1", (route) => json(route, 200, failed));
  return { log, uploads, jobs };
}

async function open(page: Page) {
  await page.goto("/tools/html-to-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  return input;
}

async function zipBuffer(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

const render = (page: Page) => page.getByRole("button", { name: "Render PDF" });

test("pasted HTML goes up as pasted.html, UTF-8 with its mark, by the same requests as a file", async ({
  page,
}) => {
  const { log, uploads, jobs } = await mockWorker(page, false);
  await open(page);
  await page.getByRole("button", { name: "Or paste HTML code" }).click();
  const box = page.getByLabel("HTML code");
  await expect(box).toBeVisible();
  const html = "<p>বাংলা café \u{1F600}</p>";
  await box.fill(html);
  await expect(render(page)).not.toHaveAttribute("aria-disabled", "true");
  expect(log, "something was uploaded before Run").toEqual([]);
  await render(page).click();
  await expect.poll(() => jobs.length, { timeout: 15_000 }).toBe(1);
  expect(log).toEqual(["reserve", "put", "create"]);
  expect(uploads[0]).toMatchObject({
    tool: "html-to-pdf",
    files: [
      {
        filename: "pasted.html",
        contentType: "text/html",
        bytes: 3 + Buffer.byteLength(html, "utf8"),
      },
    ],
  });
  expect(jobs[0]).toMatchObject({
    tool: "html-to-pdf",
    inputNames: ["pasted.html"],
  });
  expect((jobs[0]!.options as Record<string, unknown>).entry).toBeUndefined();
});

test("ZIP offered: two pages ask which to print; the upload is declared a ZIP and the job carries the page", async ({
  page,
}) => {
  const { log, uploads, jobs } = await mockWorker(page, true);
  const input = await open(page);
  await expect(
    page.getByText("HTML, or a ZIP of a page and its files"),
  ).toBeVisible();
  await input.setInputFiles({
    name: "site.zip",
    mimeType: "application/zip",
    buffer: await zipBuffer({
      "a.html": '<link rel="stylesheet" href="a.css"><p>a</p>',
      "a.css": "p{color:red}",
      "b.html": "<p>b</p>",
    }),
  });
  await expect(page.getByText("site.zip")).toBeVisible();
  const picker = page.getByLabel("Page to print");
  await expect(picker).toBeVisible();
  await expect(render(page)).toHaveAttribute("aria-disabled", "true");
  await picker.selectOption("a.html");
  await expect(render(page)).not.toHaveAttribute("aria-disabled", "true");
  expect(log, "something was uploaded before Run").toEqual([]);
  await render(page).click();
  await expect.poll(() => jobs.length, { timeout: 15_000 }).toBe(1);
  expect(uploads[0]).toMatchObject({
    tool: "html-to-pdf",
    files: [{ filename: "site.zip", contentType: "application/zip" }],
  });
  expect(jobs[0]).toMatchObject({
    tool: "html-to-pdf",
    inputNames: ["site.zip"],
    options: { entry: "a.html" },
  });
});

test("ZIP not offered (an old worker): the picker takes HTML only, a .zip is refused at the pick, nothing is uploaded", async ({
  page,
}) => {
  const { log } = await mockWorker(page, false);
  const input = await open(page);
  expect(await input.getAttribute("accept")).not.toMatch(/zip/);
  await input.setInputFiles({
    name: "site.zip",
    mimeType: "application/zip",
    buffer: await zipBuffer({ "index.html": "<p>x</p>" }),
  });
  await expect(page.getByText(/isn't a file HTML to PDF takes/)).toBeVisible();
  await expect(page.getByLabel("Page to print")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(log).toEqual([]);
});
