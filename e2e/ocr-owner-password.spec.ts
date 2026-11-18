import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test, expect, type Page, type Route } from "@playwright/test";
import { fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";

/**
 * OCR PDF's Owner password field for a restricted PDF (competitor-audit
 * backlog #11) through the SERVED page, with the worker mocked at the wire:
 *
 *  - the live status proves `ocrOwnerPassword`: a restricted PDF (qpdf-made
 *    fixture, opens with no password) shows the field; Run waits for a
 *    password; the job posted carries `ownerPassword` (the sealed-option
 *    field: the job route seals it before the queue stores it);
 *  - it does not: the same file shows no field, and the job carries no key;
 *  - an unrestricted PDF shows no field even when it is proven;
 *  - axe over the field, and a 375x812 pass with no sideways scroll.
 *
 * The job is failed by the mock as soon as it is posted: what is under test
 * is the field and the request.
 */

const RESTRICTED = readFileSync(
  join(process.cwd(), "src/tests/fixtures/restricted-pdf/qpdf-r6-aes256.pdf"),
);
const PLAIN = readFileSync(
  join(process.cwd(), "src/tests/fixtures/restricted-pdf/base.pdf"),
);
const OWNER = "owner-r6-test";
const LABEL = "Owner password";

const fromRoot = createRequire(join(process.cwd(), "package.json"));
const AXE = fromRoot.resolve("axe-core/axe.min.js");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

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

async function mockWorker(page: Page, ocrOwnerPassword: boolean) {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/worker/status", (route) =>
    json(route, 200, { ...READY_WORKER_STATUS, ocrOwnerPassword }),
  );
  await page.route("**/api/uploads", (route) =>
    json(route, 200, {
      sessionId: "ses_o1",
      tool: "ocr-pdf",
      slots: [
        {
          fileId: "file_o1",
          filename: "in",
          url: "/__e2e/ocr-owner-upload/1",
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    }),
  );
  await page.route("**/__e2e/ocr-owner-upload/**", (route) =>
    json(route, 200, {}),
  );
  const now = new Date().toISOString();
  const failed = {
    jobId: "job_o1",
    tool: "ocr-pdf",
    capability: "ocr",
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
  await page.route("**/api/jobs/job_o1", (route) => json(route, 200, failed));
  return { bodies };
}

async function choose(page: Page, name: string, buffer: Buffer) {
  await page.goto("/tools/ocr-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({ name, mimeType: "application/pdf", buffer });
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  return page.getByRole("button", { name: "Recognize text" });
}

async function axeOver(page: Page, selector: string): Promise<string[]> {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(
    async ({ tags, selector }) => {
      const axe = (
        window as unknown as {
          axe: {
            run: (
              ctx: Element,
              opts: object,
            ) => Promise<{
              violations: { id: string; nodes: { target: string[] }[] }[];
            }>;
          };
        }
      ).axe;
      const r = await axe.run(document.querySelector(selector)!, {
        runOnly: { type: "tag", values: tags },
      });
      return r.violations.map(
        (v) =>
          `${v.id} at ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
      );
    },
    { tags: TAGS, selector },
  );
}

const pageScrollsSideways = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );

for (const viewport of [null, { width: 375, height: 812 }] as const) {
  const at = viewport ? ` at ${viewport.width}x${viewport.height}` : "";
  test(`ocrOwnerPassword proven: a restricted PDF shows the field, Run waits for it, and the job carries ownerPassword${at}`, async ({
    page,
  }) => {
    if (viewport) await page.setViewportSize(viewport);
    const { bodies } = await mockWorker(page, true);
    const run = await choose(page, "restricted.pdf", RESTRICTED);
    const field = page.getByLabel(LABEL, { exact: true });
    await expect(field).toBeVisible({ timeout: 15_000 });
    await expect(run).toHaveAttribute("aria-disabled", "true");
    expect(await axeOver(page, "[data-ocr-owner-password]")).toEqual([]);
    expect(await pageScrollsSideways(page)).toBe(false);
    await field.fill(OWNER);
    await expect(run).not.toHaveAttribute("aria-disabled", "true");
    await run.click();
    await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1);
    expect(bodies[0]!.options).toMatchObject({ ownerPassword: OWNER });
    // The password reaches the page nowhere but the field it was typed in.
    const stored = await page.evaluate(() =>
      JSON.stringify({ ...window.localStorage, ...window.sessionStorage }),
    );
    expect(stored).not.toContain(OWNER);
  });
}

// Review finding (2026-11-18): on the served build Run was live for about
// 0.7 s after a restricted PDF was chosen, before the field's probe had
// answered, and a click in that gap posted the job with no ownerPassword.
test("ocrOwnerPassword proven: Run stays off until the probe answers, and a click in the gap posts nothing", async ({
  page,
}) => {
  const { bodies } = await mockWorker(page, true);
  await page.goto("/tools/ocr-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  // The live status is in before the file is chosen, as for a person who
  // reads the page first.
  await expect
    .poll(() =>
      page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .some((e) => e.name.includes("/api/worker/status")),
      ),
    )
    .toBe(true);
  const run = page.getByRole("button", { name: "Recognize text" });
  await input.setInputFiles({
    name: "restricted.pdf",
    mimeType: "application/pdf",
    buffer: RESTRICTED,
  });
  // Straight away: no wait for the field.
  const samples: (string | null)[] = [];
  const field = page.getByLabel(LABEL, { exact: true });
  for (let i = 0; i < 200 && (await field.count()) === 0; i += 1) {
    if (await page.getByText("restricted.pdf", { exact: true }).count())
      samples.push(await run.getAttribute("aria-disabled"));
    await run.click({ force: true, timeout: 1_000 }).catch(() => {});
  }
  await expect(field).toBeVisible({ timeout: 15_000 });
  // Health: the gap was sampled at all.
  expect(samples.length).toBeGreaterThan(0);
  expect(samples.filter((s) => s !== "true")).toEqual([]);
  await page.waitForTimeout(500);
  expect(bodies).toEqual([]);
});

test("ocrOwnerPassword not proven: a restricted PDF shows no field, and the job carries no key", async ({
  page,
}) => {
  const { bodies } = await mockWorker(page, false);
  const run = await choose(page, "restricted.pdf", RESTRICTED);
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  await expect(page.getByLabel(LABEL, { exact: true })).toHaveCount(0);
  await run.click();
  await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1);
  expect(bodies[0]!.options).not.toHaveProperty("ownerPassword");
});

test("ocrOwnerPassword proven: an unrestricted PDF shows no field, and the job carries no key", async ({
  page,
}) => {
  const { bodies } = await mockWorker(page, true);
  const run = await choose(page, "plain.pdf", PLAIN);
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  // Positive control for the absence: the same wait shows the field for a
  // restricted file above, so give the probe the same chance here.
  await page.waitForTimeout(1500);
  await expect(page.getByLabel(LABEL, { exact: true })).toHaveCount(0);
  await run.click();
  await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1);
  expect(bodies[0]!.options).not.toHaveProperty("ownerPassword");
});
