import { createRequire } from "node:module";
import { join } from "node:path";
import { test, expect, type Page, type Route } from "@playwright/test";
import { fileInput, makePdfBytes, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";
import { buildTablesZip } from "../src/lib/workers/table-extract/engine";
import { TABLE_PREVIEW_ROWS } from "../src/lib/jobs/table-preview-limits";

/**
 * Extract Tables' result preview (competitor audit #22, 2026-11-17) through
 * the SERVED page, with the worker mocked at the wire and its ZIP written by
 * the REAL engine (`buildTablesZip`) in this test: several tables, a wide
 * one, a Bengali one, and a ZIP with no table at all.
 *
 *  - the first rows of each table show, read in the browser from the ZIP;
 *  - the wide table scrolls inside the card, never the page (also at
 *    375x812);
 *  - the preview's chunk is fetched with the result, not with the page
 *    (read from the JS the browser actually received);
 *  - the result card passes axe's WCAG 2.x A/AA rules.
 */

/** Built from code points (house rule). */
const cp = (...points: number[]) => String.fromCodePoint(...points);
const BN_NAME = cp(0x09a8, 0x09be, 0x09ae);
const BN_CITY = cp(0x09a2, 0x09be, 0x0995, 0x09be);
const CJK = cp(0x8868, 0x683c);
const MARKER = "pdfxyz:lazy:table-preview";

const TABLES = [
  {
    pageNumber: 1,
    rows: Array.from({ length: 9 }, (_, r) => [`Item ${r}`, `${r * 10}`]),
  },
  {
    pageNumber: 2,
    rows: Array.from({ length: 3 }, (_, r) =>
      Array.from({ length: 28 }, (_, c) => `Wide${r}x${c} value`),
    ),
  },
  {
    pageNumber: 3,
    rows: [
      [BN_NAME, CJK, ""],
      [BN_CITY, "", "7"],
    ],
  },
];

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

async function mockWorker(
  page: Page,
  zip: Uint8Array,
  tables: { tableCount: number; tablePages: number[] },
) {
  await page.route("**/api/worker/status", (route) =>
    json(route, 200, READY_WORKER_STATUS),
  );
  await page.route("**/api/uploads", (route) =>
    json(route, 200, {
      sessionId: "ses_t1",
      tool: "extract-tables",
      slots: [
        {
          fileId: "file_t1",
          filename: "in",
          url: "/__e2e/tables-upload/1",
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    }),
  );
  await page.route("**/__e2e/tables-upload/**", (route) =>
    json(route, 200, {}),
  );
  await page.route("**/__e2e/tables-download", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "application/zip" },
      body: Buffer.from(zip),
    }),
  );
  const now = new Date().toISOString();
  const job = {
    jobId: "job_t1",
    tool: "extract-tables",
    capability: "worker",
    status: "completed",
    progress: 100,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    artifacts: [
      {
        artifactId: "art_t1",
        filename: "statement-tables.zip",
        contentType: "application/zip",
        bytes: zip.byteLength,
        url: "/__e2e/tables-download",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    ],
    results: {
      tables: {
        ...tables,
        pageCount: 3,
        tablePagesTruncated: false,
        combined: false,
      },
    },
  };
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await json(route, 200, job);
  });
  await page.route("**/api/jobs/job_t1", (route) => json(route, 200, job));
}

/** Every JS body the browser receives, so the preview's fetch can be dated. */
function recordScripts(page: Page): string[] {
  const bodies: string[] = [];
  page.on("response", async (response) => {
    if (!/\.js(\?|$)/.test(response.url())) return;
    try {
      bodies.push(await response.text());
    } catch {
      /* a redirect or an aborted body */
    }
  });
  return bodies;
}

async function runOnce(page: Page) {
  await page.goto("/tools/extract-tables");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "statement.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await makePdfBytes("statement", 3)),
  });
  const run = page.getByRole("button", { name: "Extract tables" });
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  return run;
}

/** axe over `selector`, or over its result card (`[role="group"]`) with `card`. */
async function axeViolations(page: Page, selector: string, card = false) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(
    async ({ tags, selector, card }) => {
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
      const target = document.querySelector(selector)!;
      const r = await axe.run(
        card ? target.closest('[role="group"]')! : target,
        {
          runOnly: { type: "tag", values: tags },
        },
      );
      return r.violations.map(
        (v) =>
          `${v.id} at ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
      );
    },
    { tags: TAGS, selector, card },
  );
}

/** True when the page itself scrolls sideways. */
const pageScrollsSideways = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );

for (const [viewport, scheme] of [
  [null, "light"],
  [null, "dark"],
  [{ width: 375, height: 812 }, "light"],
] as const) {
  const at =
    (viewport ? ` at ${viewport.width}x${viewport.height}` : "") +
    ` (${scheme})`;
  test(`several tables: the first rows of each show, read from the ZIP; the wide one scrolls inside the card${at}`, async ({
    page,
  }) => {
    if (viewport) await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: scheme });
    const scripts = recordScripts(page);
    await mockWorker(page, await buildTablesZip(TABLES), {
      tableCount: 3,
      tablePages: [1, 2, 3],
    });
    const run = await runOnce(page);
    // Lazy: nothing the page loaded so far carries the preview.
    expect(scripts.length).toBeGreaterThanOrEqual(5);
    expect(scripts.some((s) => s.includes(MARKER))).toBe(false);
    await run.click();

    await expect(
      page.getByText(`Table 1, page 1: first ${TABLE_PREVIEW_ROWS} of 9 rows`),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Table 2, page 2: all 3 rows")).toBeVisible();
    await expect(page.getByText("Table 3, page 3: all 2 rows")).toBeVisible();
    // The fetch came with the result.
    expect(scripts.some((s) => s.includes(MARKER))).toBe(true);

    // Rows: the header plus the first body rows, no more.
    const first = page.locator('[data-table-preview="table-1.csv"]');
    await expect(first.locator("tbody tr")).toHaveCount(TABLE_PREVIEW_ROWS - 1);
    await expect(
      first.getByRole("columnheader", { name: "Item 0" }),
    ).toBeVisible();
    // Bengali and CJK as text, an empty header cell named for a reader.
    const bn = page.locator('[data-table-preview="table-3.csv"]');
    await expect(bn.getByRole("columnheader", { name: BN_NAME })).toBeVisible();
    await expect(bn.getByRole("columnheader", { name: CJK })).toBeVisible();
    await expect(bn.getByRole("cell", { name: BN_CITY })).toBeVisible();
    await expect(
      bn.getByRole("columnheader", { name: "Column 3" }),
    ).toHaveCount(1);

    // The wide table: 28 columns, scrolling inside its own box.
    const wide = page.locator('[data-table-preview="table-2.csv"]');
    await expect(wide.locator("thead th")).toHaveCount(28);
    const box = await wide.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    expect(box.client).toBeGreaterThan(100);
    expect(box.scroll).toBeGreaterThan(box.client);
    expect(await pageScrollsSideways(page)).toBe(false);
    // Positive control for the page measure: a planted wide block is seen.
    const planted = await page.evaluate(() => {
      const el = document.createElement("div");
      el.style.width = "3000px";
      el.style.height = "1px";
      document.body.append(el);
      const wider =
        document.documentElement.scrollWidth > window.innerWidth + 1;
      el.remove();
      return wider;
    });
    expect(planted).toBe(true);

    // axe over the result card, in its finished state.
    const violations = await axeViolations(page, `[data-chunk="${MARKER}"]`);
    expect(violations, violations.join("\n")).toEqual([]);
    const card = await axeViolations(page, `[data-chunk="${MARKER}"]`, true);
    expect(card, card.join("\n")).toEqual([]);
  });
}

test("a ZIP with no table: the preview says so and offers the OCR switch and PDF to Excel", async ({
  page,
}) => {
  await mockWorker(page, await buildTablesZip([]), {
    tableCount: 0,
    tablePages: [],
  });
  const run = await runOnce(page);
  await run.click();
  await expect(
    page.getByText(
      /^The ZIP holds no table to preview\. If the pages are scans, turn on /,
    ),
  ).toBeVisible({ timeout: 15_000 });
  const preview = page.locator(`[data-chunk="${MARKER}"]`);
  await expect(
    preview.getByRole("link", { name: "Open PDF to Excel" }),
  ).toHaveAttribute("href", "/tools/pdf-to-excel");
  await expect(preview.getByRole("table")).toHaveCount(0);
  const violations = await axeViolations(page, `[data-chunk="${MARKER}"]`);
  expect(violations, violations.join("\n")).toEqual([]);
});
