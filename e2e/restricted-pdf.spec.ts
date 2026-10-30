import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { captureDownload } from "./client-proof/artifacts";
import { attachConsoleGuard, fileInput, waitForHydration } from "./helpers";
import { PDFJS_DOCUMENT_DEFAULTS } from "../src/lib/pdf/wasm-assets";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";

/**
 * A PDF whose author restricted it (opens with no password; fill in the
 * form and comment, nothing else — qpdf R6 AES-256, `src/tests/fixtures/
 * restricted-pdf/README.md`) opened in Edit PDF, driven through the live
 * page and proven on the bytes it downloads, read back by pdf.js in THIS
 * process (an independent decryptor):
 *
 *  - restricted: the banner says what the author allows, the content tools
 *    are off, two fields are filled, and the download is still encrypted
 *    with the SAME permissions and the typed values inside;
 *  - unlocked: a wrong owner password is refused, the right one turns every
 *    tool on, and the download is then not encrypted.
 *
 * `SHOTS_DIR` set: screenshots of each state are written there.
 */

const FIXTURE = join(
  process.cwd(),
  "src/tests/fixtures/restricted-pdf/qpdf-r6-aes256.pdf",
);
const OWNER = "owner-r6-test";
const GRANT = [4, 32, 256, 512, 2048];

interface Read {
  encrypted: boolean;
  permissions: number[] | null;
  values: Record<string, unknown>;
}

async function readAsViewer(buf: Buffer): Promise<Read> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useWorkerFetch: false,
    disableFontFace: true,
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  try {
    const doc = await task.promise;
    const { info } = await doc.getMetadata();
    const values: Record<string, unknown> = {};
    for (const [name, list] of Object.entries(
      (await doc.getFieldObjects()) ?? {},
    ))
      values[name] = (list as { value?: unknown }[]).find(
        (f) => f.value !== undefined && f.value !== null,
      )?.value;
    return {
      encrypted:
        (info as { EncryptFilterName?: unknown }).EncryptFilterName != null,
      permissions: await doc.getPermissions(),
      values,
    };
  } finally {
    await task.destroy();
  }
}

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  // The toolbar's buttons fade between states; shoot after the fade.
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(dir, name) });
}

async function open(page: Page) {
  await page.goto("/tools/edit-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "restricted-form.pdf",
    mimeType: "application/pdf",
    buffer: readFileSync(FIXTURE),
  });
  await expect(page.locator('[data-editor-page="0"]')).toBeAttached({
    timeout: 20_000,
  });
}

test.beforeEach(async ({ page }) => {
  // The analytics question answered, so it covers nothing in the shots.
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

const tool = (page: Page, name: string) =>
  page
    .getByRole("toolbar", { name: "Editor tools" })
    .getByRole("button", { name, exact: true });

test("restricted: fills the form and keeps the author's encryption", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const guard = attachConsoleGuard(page);
  await open(page);

  const banner = page.locator('[data-protection-banner="restricted"]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("This PDF has limited permissions");
  await expect(banner).toContainText("filling in the form");
  await expect(banner).toContainText("enter the owner password");
  // Content tools off, with the reason; Select stays.
  await expect(tool(page, "Text")).toHaveAttribute("aria-disabled", "true");
  await expect(tool(page, "Text")).toHaveAttribute("title", /owner password/);
  await expect(tool(page, "Whiteout")).toHaveAttribute("aria-disabled", "true");
  await expect(tool(page, "Select")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await banner.scrollIntoViewIfNeeded();
  await shot(page, "restricted-banner.png");

  const name = page.locator('[data-file-field="full_name"]');
  await name.scrollIntoViewIfNeeded();
  await expect(name).toBeVisible();
  await name.fill("Ada Lovelace");
  await page.locator('[data-file-field="agree"]').check();
  await shot(page, "restricted-filled.png");

  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /apply & download/i }),
  );
  // The original, byte for byte, then the update.
  const original = readFileSync(FIXTURE);
  expect(buf.subarray(0, original.length).equals(original)).toBe(true);
  const read = await readAsViewer(buf);
  expect(read.encrypted).toBe(true);
  expect(read.permissions).toEqual(GRANT);
  expect(read.values.full_name).toBe("Ada Lovelace");
  expect(read.values.agree).not.toBe("Off");
  await expect(page.getByText("author's protection kept")).toBeVisible();
  expect(guard.pageErrors).toEqual([]);
  expect(guard.cspViolations()).toEqual([]);
});

test("owner password: wrong refused, right unlocks every tool and drops the encryption", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const guard = attachConsoleGuard(page);
  await open(page);
  const field = page.getByLabel("Owner password");
  await field.fill("not-the-owner-password");
  await page.getByRole("button", { name: "Unlock all tools" }).click();
  await expect(
    page.locator("[data-protection-banner] [role=alert]"),
  ).toContainText("isn't this PDF's owner password");
  await expect(tool(page, "Text")).toHaveAttribute("aria-disabled", "true");
  // The field never keeps what was typed.
  await expect(field).toHaveValue("");

  await field.fill(OWNER);
  await page.getByRole("button", { name: "Unlock all tools" }).click();
  await expect(
    page.locator('[data-protection-banner="unlocked"]'),
  ).toContainText("not encrypted");
  await expect(tool(page, "Text")).not.toHaveAttribute("aria-disabled", "true");
  await expect(tool(page, "Whiteout")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await shot(page, "restricted-unlocked.png");

  const name = page.locator('[data-file-field="full_name"]');
  await name.scrollIntoViewIfNeeded();
  await name.fill("Grace Hopper");
  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /apply & download/i }),
  );
  const read = await readAsViewer(buf);
  expect(read.encrypted).toBe(false);
  expect(read.permissions).toBeNull();
  expect(read.values.full_name).toBe("Grace Hopper");
  expect(guard.pageErrors).toEqual([]);
});

test("Fill Forms: fills a restricted form, flattening off, the author's encryption kept", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const guard = attachConsoleGuard(page);
  await page.goto("/tools/fill-forms");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "restricted-form.pdf",
    mimeType: "application/pdf",
    buffer: readFileSync(FIXTURE),
  });
  await expect(
    page.locator('[data-protection-banner="restricted"]'),
  ).toBeVisible({ timeout: 20_000 });
  const flatten = page.getByRole("checkbox", {
    name: /flatten after filling/i,
  });
  await expect(flatten).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText(/changes the page content/)).toBeVisible();
  await page.getByPlaceholder("Type here…").first().fill("Ada Lovelace");
  await page.getByRole("button", { name: "Fill form" }).click();
  await expect(page.getByText("author's protection kept")).toBeVisible();
  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /download filled pdf/i }),
  );
  const read = await readAsViewer(buf);
  expect(read.encrypted).toBe(true);
  expect(read.permissions).toEqual(GRANT);
  expect(read.values.full_name).toBe("Ada Lovelace");
  expect(guard.pageErrors).toEqual([]);
});
