import { test, expect, type Page, type Route } from "@playwright/test";
import {
  fileInput,
  makeFormPdfBytes,
  makePdfBytes,
  waitForHydration,
} from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { USER_PASSWORD_PDF_BASE64 } from "../src/tests/fixtures-encrypted";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";

/**
 * Worker tools as immediate and honest as browser tools (redesign WP-10),
 * proved through the page against a production build, with the worker
 * MOCKED at the wire (`page.route`: the status check, the upload session,
 * the upload, the job and its polling, the artifact):
 *
 *  - the drop zone works before the status answers, and nothing says the
 *    tool is off before the answer does;
 *  - a 429 is waited out and offered back as Try again, which recovers;
 *  - one status request per page, however many parts of it need the answer;
 *  - NOTHING is uploaded before Run — a picked file, or one staged by a
 *    hand-off from another tool's "Continue with";
 *  - the docket stamps the stages the job was seen in, in order, and calls a
 *    stage it never saw "passed";
 *  - a worker result continues to a browser tool (Word to PDF → Sign PDF),
 *    and G.7 is counted: DOCX → PDF → signed in 7 actions or fewer (row 5),
 *    and an encrypted PDF in Rotate → Unlock → Continue with Rotate (row 4).
 */

test.beforeEach(async ({ page }) => {
  // The consent banner is fixed to the bottom of the screen, over a result.
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

type Reply = {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
};

interface MockOptions {
  /** Each status request gets the next reply; the last repeats. */
  statusReplies?: Reply[];
  /** Hold every status reply this long. */
  statusDelayMs?: number;
  /** The statuses successive polls read after the job is created. */
  jobStatuses?: string[];
  /** The file the completed job serves. */
  artifact?: { filename: string; contentType: string; bytes: Uint8Array };
}

interface Wire {
  statusRequests: number;
  /** Every request that moves file bytes or reserves a slot to. */
  uploads: string[];
  jobsCreated: number;
  /** When each status reply was SENT (Date.now()). */
  statusAnsweredAt: number[];
}

const READY: Reply = { status: 200, body: READY_WORKER_STATUS };
const NOT_ENABLED: Reply = {
  status: 200,
  body: {
    ...READY_WORKER_STATUS,
    mode: "disabled",
    enabled: false,
    daemon: { ...READY_WORKER_STATUS.daemon, drainable: false },
    providers: {
      ...READY_WORKER_STATUS.providers,
      queue: { ...READY_WORKER_STATUS.providers.queue, ready: false },
    },
  },
};

const JOB_ID = "job_e2ewp10";

function job(
  tool: string,
  status: string,
  artifact?: MockOptions["artifact"],
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    jobId: JOB_ID,
    tool,
    capability: "secure-worker",
    status,
    progress: status === "completed" ? 100 : 0,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    ...(status === "completed" && artifact
      ? {
          artifacts: [
            {
              artifactId: "art_e2e1",
              filename: artifact.filename,
              contentType: artifact.contentType,
              bytes: artifact.bytes.byteLength,
              url: "/__e2e/artifact/art_e2e1",
              expiresAt: now,
            },
          ],
        }
      : {}),
  };
}

const json = (route: Route, status: number, body: unknown, headers = {}) =>
  route.fulfill({
    status,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The worker, at the wire. */
async function mockWorker(page: Page, opts: MockOptions = {}): Promise<Wire> {
  const wire: Wire = {
    statusRequests: 0,
    uploads: [],
    jobsCreated: 0,
    statusAnsweredAt: [],
  };
  const replies = opts.statusReplies ?? [READY];
  let tool = "";
  let polls = 0;
  await page.route("**/api/worker/status", async (route) => {
    const reply = replies[Math.min(wire.statusRequests, replies.length - 1)]!;
    wire.statusRequests += 1;
    if (opts.statusDelayMs) await sleep(opts.statusDelayMs);
    wire.statusAnsweredAt.push(Date.now());
    await json(route, reply.status, reply.body ?? {}, reply.headers);
  });
  await page.route("**/api/uploads", async (route) => {
    const body = route.request().postDataJSON() as { tool: string };
    tool = body.tool;
    wire.uploads.push(`session ${body.tool}`);
    await json(route, 200, {
      sessionId: "ses_e2e1",
      tool: body.tool,
      slots: [
        {
          fileId: "file_e2e1",
          filename: "in",
          url: "/__e2e/upload/file_e2e1",
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    });
  });
  await page.route("**/__e2e/upload/**", async (route) => {
    wire.uploads.push(`put ${route.request().method()}`);
    // Long enough for the docket to show the upload running.
    await sleep(400);
    await json(route, 200, {});
  });
  const statuses = opts.jobStatuses ?? ["queued", "processing", "completed"];
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { tool: string };
    tool = body.tool;
    wire.jobsCreated += 1;
    polls = 0;
    await json(route, 200, job(tool, statuses[0]!, opts.artifact));
  });
  await page.route(`**/api/jobs/${JOB_ID}`, async (route) => {
    polls += 1;
    const status = statuses[Math.min(polls, statuses.length - 1)]!;
    await json(route, 200, job(tool, status, opts.artifact));
  });
  await page.route("**/__e2e/artifact/**", async (route) => {
    await sleep(300);
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": opts.artifact?.contentType ?? "application/pdf",
      },
      body: Buffer.from(opts.artifact?.bytes ?? new Uint8Array()),
    });
  });
  return wire;
}

const DOCX = {
  name: "report.docx",
  mimeType:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  buffer: Buffer.from("PK\u0003\u0004 a document, as far as a picker can tell"),
};

const slot = (page: Page) => page.locator('[data-slot="worker-status"]');

/** The result card, by the sentence it announces — not the FAQ's copy of it. */
const card = (page: Page, announce: string) =>
  page.getByRole("group", { name: announce });

test("the drop zone takes a file before the status answers, and 'off' is said only after the answer", async ({
  page,
}) => {
  const wire = await mockWorker(page, {
    statusReplies: [NOT_ENABLED],
    statusDelayMs: 2000,
  });
  // Record, from the first script on, when anything says the tool is off.
  await page.addInitScript(() => {
    const w = window as unknown as { __offAt?: number };
    const look = () => {
      // The PANEL's words: the page's FAQ explains the badge, in prose.
      const text =
        (document.querySelector("[data-tool-panel]") as HTMLElement | null)
          ?.innerText ?? "";
      if (
        w.__offAt === undefined &&
        /Not enabled|Status unknown|Notify me when this ships/.test(text)
      )
        w.__offAt = Date.now();
    };
    new MutationObserver(look).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  const started = Date.now();
  await page.goto("/tools/word-to-pdf", { waitUntil: "commit" });
  const sheet = page.getByText("Add your document, or browse", {
    exact: true,
  });
  await expect(sheet).toBeVisible({ timeout: 2000 });
  const visibleAfter = Date.now() - started;
  // Before the status answers (it is held 2s): the sheet is there, under
  // 500ms from the response starting, and it TAKES a file.
  expect(visibleAfter).toBeLessThan(500 + 1000); // goto's own commit wait
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles(DOCX);
  await expect(page.getByText("report.docx", { exact: true })).toBeVisible();
  expect(wire.statusAnsweredAt).toEqual([]);
  await expect(slot(page)).toHaveAttribute("data-state", "loading");

  // The answer arrives: NOW the panel says it is off — and keeps the file.
  await expect(slot(page)).toHaveAttribute("data-state", "off");
  await expect(
    page.locator("[data-tool-panel]").getByText("Not enabled", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("report.docx", { exact: true })).toBeVisible();
  const offAt = await page.evaluate(
    () => (window as unknown as { __offAt?: number }).__offAt,
  );
  expect(
    offAt,
    "the off state was never recorded (positive control)",
  ).toBeDefined();
  expect(offAt!).toBeGreaterThanOrEqual(wire.statusAnsweredAt[0]!);
  expect(wire.uploads).toEqual([]);
});

test("a 429 is waited out and offered back as Try again, which recovers", async ({
  page,
}) => {
  const wire = await mockWorker(page, {
    statusReplies: [{ status: 429, headers: { "retry-after": "1" } }, READY],
  });
  await page.goto("/tools/word-to-pdf");
  const tryAgain = slot(page).getByRole("button", { name: "Try again" });
  await expect(tryAgain).toBeVisible();
  expect(wire.statusRequests).toBe(1);
  await tryAgain.click();
  await expect(slot(page)).toHaveAttribute("data-state", "run");
  expect(wire.statusRequests).toBe(2);
});

for (const slug of ["word-to-pdf", "ocr-pdf", "protect-pdf", "summarize-pdf"])
  test(`${slug}: exactly one status request per page`, async ({ page }) => {
    const wire = await mockWorker(page);
    await page.goto(`/tools/${slug}`);
    await expect(slot(page)).toHaveAttribute("data-state", "run");
    // Long enough for a second copy of the effect, or a retry, to have run.
    await page.waitForTimeout(1500);
    expect(wire.statusRequests).toBe(1);
  });

test("Word to PDF: nothing uploads before Run, and the docket stamps the stages it saw, in order", async ({
  page,
}) => {
  const pdf = await makePdfBytes("report", 1);
  const wire = await mockWorker(page, {
    jobStatuses: ["queued", "processing", "processing", "completed"],
    artifact: {
      filename: "report.pdf",
      contentType: "application/pdf",
      bytes: pdf,
    },
  });
  // Every step the docket marks as current, in the order it marked them.
  await page.addInitScript(() => {
    const w = window as unknown as { __steps: string[] };
    w.__steps = [];
    new MutationObserver(() => {
      const now = document.querySelector('[data-docket] [aria-current="step"]');
      const title =
        now?.querySelector("span:nth-child(2)")?.textContent ?? null;
      if (title && w.__steps[w.__steps.length - 1] !== title)
        w.__steps.push(title);
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  await page.goto("/tools/word-to-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles(DOCX);
  const run = page.getByRole("button", { name: "Convert to PDF" });
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  await page.waitForTimeout(800);
  expect(wire.uploads, "a picked file was uploaded before Run").toEqual([]);

  await run.click();
  await expect(card(page, "Your PDF is ready.")).toBeVisible({
    timeout: 20_000,
  });
  expect(wire.uploads).toEqual(["session word-to-pdf", "put PUT"]);
  expect(wire.jobsCreated).toBe(1);

  const steps = await page.evaluate(
    () => (window as unknown as { __steps: string[] }).__steps,
  );
  expect(steps).toEqual(["Encrypted upload", "Processing", "Download"]);
  const rows = page.locator("[data-docket] li");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText(/Encrypted upload.*✓/);
  // The status never read "scanning": the check ran between two polls, so
  // the docket knows it happened and not how long it took.
  await expect(rows.nth(1)).toContainText(/Structural preflight\s*passed$/);
  await expect(rows.nth(2)).toContainText(/Processing.*\d:\d\d\.\d ✓/);
  await expect(rows.nth(3)).toContainText(/Download.*✓/);
  await expect(rows.nth(4)).toContainText(
    /Auto-delete.*scheduled · outputs expire after \d+ minutes/,
  );
});

test("a staged hand-off uploads nothing either: Flatten PDF's Continue with Protect PDF", async ({
  page,
}) => {
  const protectedPdf = await makePdfBytes("protected", 1);
  const wire = await mockWorker(page, {
    artifact: {
      filename: "form-flattened-protected.pdf",
      contentType: "application/pdf",
      bytes: protectedPdf,
    },
  });
  await page.goto("/tools/flatten-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "form.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await makeFormPdfBytes("form")),
  });
  await page.getByRole("button", { name: /flatten form fields/i }).click();
  const row = page.getByRole("group", { name: "Continue with" });
  await row.getByRole("link", { name: /protect pdf/i }).click();

  await expect(page).toHaveURL(/\/tools\/protect-pdf$/);
  // Staged, by name, and said to wait for Run.
  await expect(
    page.getByText(/nothing is uploaded until you press Encrypt PDF/),
  ).toBeVisible();
  await expect(page.getByText(/^form.*\.pdf$/).first()).toBeVisible();
  await expect(slot(page)).toHaveAttribute("data-state", "run");
  await page.waitForTimeout(800);
  expect(wire.uploads, "a staged file was uploaded before Run").toEqual([]);

  await page.getByLabel("New password").fill("correct horse");
  await page.getByRole("button", { name: "Encrypt PDF" }).click();
  await expect(card(page, "Your PDF is protected and ready.")).toBeVisible({
    timeout: 20_000,
  });
  expect(wire.uploads).toEqual(["session protect-pdf", "put PUT"]);
});

test("G.7 row 5: DOCX → PDF → signed, Word to PDF continuing to Sign PDF, in 7 actions or fewer", async ({
  page,
}) => {
  const pdf = await makePdfBytes("report", 1);
  await mockWorker(page, {
    artifact: {
      filename: "report.pdf",
      contentType: "application/pdf",
      bytes: pdf,
    },
  });
  let actions = 0;
  await page.goto("/tools/word-to-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await expect(slot(page)).toHaveAttribute("data-state", "run");
  await input.setInputFiles(DOCX);
  actions++;
  await page.getByRole("button", { name: "Convert to PDF" }).click();
  actions++;
  const row = page.getByRole("group", { name: "Continue with" });
  await row.getByRole("link", { name: /sign pdf/i }).click({ timeout: 20_000 });
  actions++;
  await expect(page).toHaveURL(/\/tools\/sign-pdf$/);
  await expect(
    page.getByText("Loaded your result from Word to PDF."),
  ).toBeVisible();
  // Sign PDF is the shared editor since 2026-10-24: its signature panel
  // opens on Type; the signature is then placed with a click on the page,
  // and Apply & download saves the file in the same press.
  await page.getByLabel("Your name").fill("Ada Lovelace");
  actions++;
  await page.getByRole("button", { name: "Use signature" }).click();
  actions++;
  const sheet = page.locator('[data-editor-page="0"]');
  await sheet.scrollIntoViewIfNeeded();
  const box = (await sheet.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.8);
  actions++;
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /apply & download/i }).click();
  actions++;
  await expect(page.getByText(/pdf signed/i).first()).toBeVisible();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  // WAS 9 (G.7): download the PDF, open Sign PDF, pick it again. Then 6 with
  // the form, whose default corner needed no click; 7 since 2026-10-24,
  // because the editor asks WHERE the signature goes (one click on the
  // page) and the form's separate Download press is gone.
  expect(actions).toBeLessThanOrEqual(7);
  expect(actions).toBe(7);
});

test("G.7 row 4: an encrypted PDF in Rotate → Unlock (the file goes along) → Continue with Rotate", async ({
  page,
}) => {
  const unlocked = await makePdfBytes("unlocked", 1);
  const wire = await mockWorker(page, {
    artifact: {
      filename: "locked-unlocked.pdf",
      contentType: "application/pdf",
      bytes: unlocked,
    },
  });
  let actions = 0;
  await page.goto("/tools/rotate-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "locked.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(USER_PASSWORD_PDF_BASE64, "base64"),
  });
  actions++;
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "This PDF is password-protected." });
  await expect(alert).toContainText("Your file goes with you");
  await alert.getByRole("link", { name: "Open Unlock PDF" }).click();
  actions++;

  await expect(page).toHaveURL(/\/tools\/unlock-pdf$/);
  // The file arrived as the remedy, staged — not uploaded.
  await expect(
    page.getByText(/nothing is uploaded until you press Unlock PDF/),
  ).toBeVisible();
  await expect(page.getByText("locked.pdf", { exact: true })).toBeVisible();
  await expect(slot(page)).toHaveAttribute("data-state", "run");
  expect(wire.uploads).toEqual([]);
  await page.getByLabel("Current password").fill("user-pass");
  actions++;
  await page.getByRole("button", { name: "Unlock PDF" }).click();
  actions++;
  await expect(card(page, "Your PDF is unlocked and ready.")).toBeVisible({
    timeout: 20_000,
  });
  expect(wire.uploads).toEqual(["session unlock-pdf", "put PUT"]);

  // Owed back: Rotate is the first row, though Unlock's own plan never
  // ranks it.
  const row = page.getByRole("group", { name: "Continue with" });
  const first = row.getByRole("link").first();
  await expect(first).toContainText(/rotate pdf/i);
  await first.click();
  actions++;
  await expect(page).toHaveURL(/\/tools\/rotate-pdf$/);
  await expect(
    page.getByText("locked-unlocked.pdf", { exact: true }).first(),
  ).toBeVisible();
  // WAS a dead end; five actions from the locked file to Rotate holding the
  // unlocked one.
  expect(actions).toBe(5);
});
