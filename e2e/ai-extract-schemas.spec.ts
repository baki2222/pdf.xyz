import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { fileInput, waitForHydration } from "./helpers";
import { axeViolations } from "./chat-citations-fixture";
import {
  expectNoSidewaysScroll,
  extractionPackage,
  mockCompletedJob,
  textPdf,
} from "./ai-results-fixture";

/**
 * AI Data Extraction's saved schemas (competitor audit #16), through the
 * SERVED page with the worker mocked at the wire (`page.route`; nothing
 * reaches a real worker or AI provider):
 *
 *  - three fields saved, the page RELOADED, the schema loaded and run: the
 *    `POST /api/jobs` body carries exactly those fields;
 *  - Export JSON downloads a file that Import JSON opens back;
 *  - a malformed file is refused and changes nothing;
 *  - with storage blocked, saving says it is off and a job still runs;
 *  - axe on the open saved-schemas UI, and a 375x812 pass.
 */

const THREE = [
  { name: "invoice_number", type: "string" },
  { name: "total", type: "number", description: "grand total incl. VAT" },
  { name: "issued", type: "date" },
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    try {
      window.localStorage.setItem(key, "denied");
    } catch {
      // The blocked-storage test makes this throw; the banner then shows.
    }
  }, CONSENT_STORAGE_KEY);
});

/** Records every job request body, then lets the mock answer it. */
async function recordJobs(page: Page) {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/jobs", (route) => {
    if (route.request().method() === "POST")
      bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fallback();
  });
  return bodies;
}

async function openTool(page: Page) {
  await mockCompletedJob(
    page,
    "ai-extract",
    "invoice-extraction.zip",
    await extractionPackage({ invoice_number: "INV-7", total: 12.5 }),
  );
  const bodies = await recordJobs(page);
  await page.goto("/tools/ai-extract");
  await waitForHydration(fileInput(page));
  return bodies;
}

async function fillThree(page: Page) {
  const add = page.getByRole("button", { name: "Add field" });
  await add.click();
  await add.click();
  for (const [i, field] of THREE.entries()) {
    await page
      .getByRole("textbox", { name: `Field ${i + 1} name` })
      .fill(field.name);
    await page
      .getByRole("combobox", { name: `Field ${i + 1} type` })
      .selectOption(field.type);
    if (field.description)
      await page
        .getByRole("textbox", { name: `Field ${i + 1} hint` })
        .fill(field.description);
  }
}

async function openSaved(page: Page) {
  await page.getByRole("button", { name: "Saved schemas" }).click();
  await expect(
    page.getByRole("textbox", { name: "Schema name" }),
  ).toBeVisible();
}

async function shownNames(page: Page) {
  const out: string[] = [];
  for (let i = 1; ; i++) {
    const box = page.getByRole("textbox", { name: `Field ${i} name` });
    if ((await box.count()) === 0) return out;
    out.push(await box.inputValue());
  }
}

async function run(page: Page, bodies: Record<string, unknown>[]) {
  await fileInput(page).setInputFiles({
    name: "invoice.pdf",
    mimeType: "application/pdf",
    buffer: await textPdf([["Invoice INV-7. Total 12.50. Issued 2026-11-01."]]),
  });
  const runButton = page.getByRole("button", { name: "Extract data" });
  await expect(runButton).not.toHaveAttribute("aria-disabled", "true");
  await runButton.click();
  await expect.poll(() => bodies.length, { timeout: 20_000 }).toBe(1);
  return bodies[0]!.options;
}

/**
 * axe with the page scrolled to the top. axe's target-size rule counts a
 * control the sticky site header covers, so where the page happened to be
 * scrolled decided the verdict on the field rows above Saved schemas (seen
 * once: "Field 2 type" under the header). At the top nothing is under it.
 */
async function axeAtTop(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  return axeViolations(page);
}

const status = (page: Page) =>
  page.locator('[data-chunk="pdfxyz:lazy:ai-extract-schemas"] [role="status"]');

test("save three fields, reload, load them, run: the job carries exactly those fields", async ({
  page,
}) => {
  await openTool(page);
  await fillThree(page);
  await openSaved(page);
  await page
    .getByRole("textbox", { name: "Schema name" })
    .fill("Supplier invoice");
  await page.getByRole("button", { name: "Save schema" }).click();
  await expect(status(page)).toContainText("Supplier invoice");
  await expect(status(page)).toContainText("3 fields, in this browser.");

  // axe on the open UI with a saved schema listed, and the phone width.
  expect(await axeAtTop(page)).toEqual([]);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(200);
  await expectNoSidewaysScroll(page);
  await expect(
    page.getByRole("button", { name: "Load Supplier invoice" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.reload();
  const bodies = await recordJobs(page);
  await waitForHydration(fileInput(page));
  expect(await shownNames(page)).toEqual([""]);
  await openSaved(page);
  await page.getByRole("button", { name: "Load Supplier invoice" }).click();
  expect(await shownNames(page)).toEqual(THREE.map((f) => f.name));
  expect(await run(page, bodies)).toEqual({ mode: "schema", schema: THREE });
});

test("Export JSON, then Import JSON: the same fields come back", async ({
  page,
}) => {
  await openTool(page);
  await fillThree(page);
  await openSaved(page);
  await page
    .getByRole("textbox", { name: "Schema name" })
    .fill("Supplier invoice");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export JSON" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("supplier-invoice.schema.json");
  const text = readFileSync(await download.path(), "utf8");
  expect(JSON.parse(text)).toMatchObject({
    name: "Supplier invoice",
    fields: THREE,
  });

  await page.getByRole("button", { name: "Remove field 3" }).click();
  await page.getByRole("button", { name: "Remove field 2" }).click();
  await page.getByRole("textbox", { name: "Field 1 name" }).fill("other");
  expect(await shownNames(page)).toEqual(["other"]);
  await page
    .locator('input[aria-label="Schema file to import"]')
    .setInputFiles({
      name: "supplier-invoice.schema.json",
      mimeType: "application/json",
      buffer: Buffer.from(text),
    });
  await expect(status(page)).toContainText("from the file: 3 fields.");
  expect(await shownNames(page)).toEqual(THREE.map((f) => f.name));
});

test("a malformed schema file is refused and changes nothing", async ({
  page,
}) => {
  await openTool(page);
  await fillThree(page);
  await openSaved(page);
  for (const [text, says] of [
    ["{ not json", "not valid JSON"],
    [JSON.stringify({ hello: "world" }), "not a schema file"],
  ] as const) {
    await page
      .locator('input[aria-label="Schema file to import"]')
      .setInputFiles({
        name: "bad.json",
        mimeType: "application/json",
        buffer: Buffer.from(text),
      });
    await expect(status(page)).toContainText(says);
    await expect(status(page)).toContainText("Nothing was changed.");
    expect(await shownNames(page)).toEqual(THREE.map((f) => f.name));
  }
});

test("storage blocked: saving says it is off, and a job still runs", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const bodies = await openTool(page);
  await fillThree(page);
  await openSaved(page);
  await expect(page.getByText(/^Saving is off: /)).toBeVisible();
  await expect(page.getByRole("list", { name: "Saved schemas" })).toHaveCount(
    0,
  );
  // With storage blocked the consent banner shows and, here, cannot be
  // answered away (its decision is read back from the blocked storage). It
  // sits over the field rows, and axe's target-size rule flagged "Field 3
  // type" under it in 1 of 3 repeats, depending on when it appeared. It is
  // hidden for the axe pass, so axe judges this tool's UI, not where the
  // banner landed.
  const banner = page.getByRole("region", { name: "Analytics consent" });
  await expect(banner).toBeVisible();
  await page.addStyleTag({
    content: 'section[aria-label="Analytics consent"]{display:none}',
  });
  await expect(banner).toBeHidden();
  expect(await axeAtTop(page)).toEqual([]);
  expect(await run(page, bodies)).toEqual({ mode: "schema", schema: THREE });
  expect(errors).toEqual([]);
});

test("a keyboard Delete moves focus to Undo, and Undo to the row it brought back", async ({
  page,
}) => {
  await openTool(page);
  await fillThree(page);
  await openSaved(page);
  const name = page.getByRole("textbox", { name: "Schema name" });
  for (const n of ["Alpha", "Beta"]) {
    await name.fill(n);
    await page.getByRole("button", { name: "Save schema" }).click();
  }
  await page.getByRole("button", { name: "Delete Beta" }).focus();
  await page.keyboard.press("Enter");
  await expect(status(page)).toContainText("Deleted");
  await expect(page.getByRole("button", { name: "Undo" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(status(page)).toContainText("Undone.");
  await expect(page.getByRole("button", { name: "Delete Beta" })).toBeFocused();
});

test("the saved-schemas chunk fails to load: the panel says so, and opening it again retries", async ({
  page,
}) => {
  await openTool(page);
  let blocked = true;
  await page.route("**/_next/static/chunks/**", (route) =>
    blocked ? route.abort() : route.fallback(),
  );
  const toggle = page.getByRole("button", { name: "Saved schemas" });
  await toggle.click();
  await expect(
    page.getByText(
      "Saved schemas could not load. Check your connection, then close this and open it again.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Schema name" })).toHaveCount(
    0,
  );
  blocked = false;
  await toggle.click();
  await toggle.click();
  await expect(
    page.getByRole("textbox", { name: "Schema name" }),
  ).toBeVisible();
  await expect(page.getByText(/could not load/)).toHaveCount(0);
});
