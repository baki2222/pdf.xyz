import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { captureDownload } from "./client-proof/artifacts";
import { attachConsoleGuard, fileInput, waitForHydration } from "./helpers";
import { PDFJS_DOCUMENT_DEFAULTS } from "../src/lib/pdf/wasm-assets";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";

/**
 * Annotate PDF on a PDF whose author restricted it — it opens with no
 * password (qpdf R6 AES-256, `src/tests/fixtures/restricted-pdf/README.md`).
 * Until 2026-10-30 this page refused such a file with the editing-
 * restrictions message, while Edit PDF, which mounts the same editor, opened
 * it; the first run of this spec, before `annotate-runner.tsx` opted into
 * `openProtected`, stopped at that refusal.
 *
 *  - comments granted (/P bit 6): the banner, Highlight ready, a highlight
 *    dragged out and downloaded — then read by pdf.js in THIS process (an
 *    independent decryptor) with the empty password: still encrypted, the
 *    same permissions, the original bytes as its prefix, a /Highlight on
 *    the page;
 *  - view only: the banner says comments are not allowed by the author and
 *    offers the owner password, and every mark-up tool is locked.
 */

const DIR = join(process.cwd(), "src/tests/fixtures/restricted-pdf");
const COMMENTS = join(DIR, "qpdf-r6-aes256.pdf");
const VIEW_ONLY = join(DIR, "qpdf-r6-view-only.pdf");
const GRANT = [4, 32, 256, 512, 2048];

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

async function open(page: Page, fixture: string) {
  await page.goto("/tools/annotate-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "restricted.pdf",
    mimeType: "application/pdf",
    buffer: readFileSync(fixture),
  });
  // The refusal this replaced has no banner: before the opt-in, this waits
  // out its timeout beside "This PDF has editing restrictions …".
  await expect(
    page.locator('[data-protection-banner="restricted"]'),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-editor-page="0"]')).toBeAttached();
}

const tool = (page: Page, name: string) =>
  page
    .getByRole("toolbar", { name: "Editor tools" })
    .getByRole("button", { name, exact: true });

test("Annotate PDF, restricted with comments allowed: a highlight is saved as a comment under the author's encryption", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const guard = attachConsoleGuard(page);
  await open(page, COMMENTS);
  const banner = page.locator('[data-protection-banner="restricted"]');
  await expect(banner.locator("[data-banner-comments]")).toContainText(
    "saved as comments",
  );
  await expect(banner.getByLabel("Owner password")).toBeVisible();
  // Highlight is still the tool this page opens on; page-content tools are off.
  await expect(tool(page, "Highlight")).toHaveAttribute("aria-pressed", "true");
  await expect(tool(page, "Whiteout")).toHaveAttribute("aria-disabled", "true");
  // The "Mark up" first step names Whiteout, which is locked here: not shown.
  await expect(page.locator("[data-first-step]")).toHaveCount(0);

  const sheet = page.locator('[data-editor-page="0"]');
  await sheet.scrollIntoViewIfNeeded();
  const box = (await sheet.boundingBox())!;
  const scale = box.width / 612;
  const pt = (x: number, y: number) => ({
    x: box.x + x * scale,
    y: box.y + y * scale,
  });
  await page.mouse.move(pt(60, 50).x, pt(60, 50).y);
  await page.mouse.down();
  await page.mouse.move(pt(260, 82).x, pt(260, 82).y, { steps: 8 });
  await page.mouse.up();
  // Fixed to comments — flattening is never offered on a restricted file.
  await expect(page.locator('[data-markup-mode="comments"]')).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Flatten into the page" }),
  ).toHaveCount(0);

  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /apply & download/i }),
  );
  const original = readFileSync(COMMENTS);
  expect(buf.subarray(0, original.length).equals(original)).toBe(true);
  expect(buf.length).toBeGreaterThan(original.length);

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    password: "",
    useWorkerFetch: false,
    disableFontFace: true,
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  try {
    const doc = await task.promise;
    const { info } = await doc.getMetadata();
    expect(
      (info as { EncryptFilterName?: unknown }).EncryptFilterName,
    ).not.toBeNull();
    expect(await doc.getPermissions()).toEqual(GRANT);
    const annots = (await (await doc.getPage(1)).getAnnotations()) as {
      subtype: string;
    }[];
    expect(annots.filter((a) => a.subtype === "Highlight")).toHaveLength(1);
  } finally {
    await task.destroy();
  }
  await expect(
    page.getByRole("heading", { name: "Annotated PDF ready" }),
  ).toBeVisible();
  await expect(page.getByText("1 saved as comment")).toBeVisible();
  await expect(page.getByText("author's protection kept")).toBeVisible();
  expect(guard.pageErrors).toEqual([]);
  expect(guard.cspViolations()).toEqual([]);
});

test("Annotate PDF, view-only: the banner says the author allows no comments, and the mark-up tools are locked", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const guard = attachConsoleGuard(page);
  await open(page, VIEW_ONLY);
  const banner = page.locator('[data-protection-banner="restricted"]');
  await expect(banner.locator('[data-banner-comments="locked"]')).toHaveText(
    "This PDF's author doesn't allow comments, so highlights, drawings, notes and shapes need the owner password too.",
  );
  await expect(banner.getByLabel("Owner password")).toBeVisible();
  await expect(
    banner.getByRole("button", { name: "Unlock all tools" }),
  ).toBeVisible();
  for (const name of ["Highlight", "Draw", "Note", "Whiteout"])
    await expect(tool(page, name)).toHaveAttribute("aria-disabled", "true");
  await expect(tool(page, "Select")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-locked-help]")).toHaveText(
    "This PDF's author allows no changes. Enter the owner password above to unlock the tools.",
  );
  expect(guard.pageErrors).toEqual([]);
});
