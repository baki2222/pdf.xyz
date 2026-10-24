import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import {
  captureDownload,
  pdfPageTexts,
  pdfTextPositions,
} from "./client-proof/artifacts";
import { attachConsoleGuard, fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";

/**
 * Edit PDF, driven by hand through the live page and proven on the bytes it
 * downloads.
 *
 * A two-page Letter fixture whose SECOND page carries /Rotate 90 — the page
 * shape Rotate PDF writes and the one the old coordinate form placed
 * sideways. Through the real editor: place a text box by clicking, type into
 * it, drag it; draw a rectangle, resize it from a handle, undo and redo that;
 * place text on the rotated page; Apply & download. Then the downloaded file
 * is opened with pdfjs in THIS process and read in the frame a reader sees:
 * every string is there, upright, within 1 pt of where the editor drew it.
 *
 * Positions are taken from the editor's own DOM in page points (the SVG's
 * viewBox is the page in points), so the comparison is "where the overlay
 * showed it" against "where a viewer shows it" — the WYSIWYG promise itself.
 */

const PAGE_W = 612;
const PAGE_H = 792;

async function fixture(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc
    .addPage([PAGE_W, PAGE_H])
    .drawText("BASE ONE", { x: 72, y: 720, size: 14, font });
  const two = doc.addPage([PAGE_W, PAGE_H]);
  two.drawText("BASE TWO", { x: 72, y: 720, size: 14, font });
  two.setRotation(degrees(90));
  return Buffer.from(await doc.save());
}

/** Screen coordinates of a point given in a page's viewer points. */
async function at(page: Page, index: number, x: number, y: number) {
  const sheet = page.locator(`[data-editor-page="${index}"]`);
  await sheet.scrollIntoViewIfNeeded();
  const box = (await sheet.boundingBox())!;
  const [w] = (await sheet.getAttribute("data-page-pt"))!
    .split("x")
    .map(Number);
  const scale = box.width / w!;
  return { x: box.x + x * scale, y: box.y + y * scale, scale };
}

/** An object's SVG rect attributes, in page points. */
async function rectOf(page: Page, kind: string) {
  const rect = page.locator(`[data-object-kind="${kind}"] > rect`).first();
  const read = async (name: string) => Number(await rect.getAttribute(name));
  return {
    x: await read("x"),
    y: await read("y"),
    width: await read("width"),
    height: await read("height"),
  };
}

/** The first text line's position (x, baseline) in page points. */
async function textAt(page: Page, words: string) {
  const t = page
    .locator('[data-object-kind="text"] text')
    .filter({ hasText: words })
    .first();
  return {
    x: Number(await t.getAttribute("x")),
    y: Number(await t.getAttribute("y")),
  };
}

/** The editor's own live region (the page has others). */
const said = (page: Page) =>
  page.locator("[data-wysiwyg-editor] > [role=status]");

async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

test("place, type, drag, resize, undo, redo, download — on a rotated page too", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const guard = attachConsoleGuard(page);
  await page.goto("/tools/edit-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "two-pages.pdf",
    mimeType: "application/pdf",
    buffer: await fixture(),
  });
  await expect(page.locator('[data-editor-page="1"]')).toBeAttached({
    timeout: 20_000,
  });
  // The rotated page is shown in the frame a reader sees: wider than tall.
  await expect(page.locator('[data-editor-page="1"]')).toHaveAttribute(
    "data-page-pt",
    `${PAGE_H}x${PAGE_W}`,
  );
  // pdf.js drew page 1 (a real raster, not a blank sheet).
  await expect(
    page.locator('[data-editor-page="0"] [data-page-raster] canvas'),
  ).toBeAttached({ timeout: 20_000 });

  // ── Text box: click to place, type, leave.
  await page.getByRole("button", { name: "Text", exact: true }).click();
  let p = await at(page, 0, 100, 150);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.type("WYSIWYG-E2E");
  await page.keyboard.press("Escape");
  await expect(said(page)).toContainText("Text box added");
  const placed = await textAt(page, "WYSIWYG-E2E");
  expect(Math.abs(placed.x - 100)).toBeLessThan(1);

  // ── Drag it 60 pt right, 40 pt down.
  p = await at(page, 0, placed.x + 20, placed.y - 4);
  await drag(page, p, { x: p.x + 60 * p.scale, y: p.y + 40 * p.scale });
  const moved = await textAt(page, "WYSIWYG-E2E");
  expect(Math.abs(moved.x - placed.x - 60)).toBeLessThan(1);
  expect(Math.abs(moved.y - placed.y - 40)).toBeLessThan(1);

  // ── Rectangle: drag it out, then resize from its south-east handle.
  await page.getByRole("button", { name: "Rectangle" }).click();
  const a = await at(page, 0, 100, 320);
  const b = await at(page, 0, 220, 380);
  await drag(page, a, b);
  const drawn = await rectOf(page, "shape");
  expect(drawn.x).toBeCloseTo(100, 0);
  expect(drawn.width).toBeCloseTo(120, 0);
  expect(drawn.height).toBeCloseTo(60, 0);
  const handle = page.locator('[data-handle="se"]');
  const hb = (await handle.boundingBox())!;
  const h = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
  await drag(page, h, { x: h.x + 40 * a.scale, y: h.y + 20 * a.scale });
  const resized = await rectOf(page, "shape");
  expect(resized.width).toBeCloseTo(160, 0);
  expect(resized.height).toBeCloseTo(80, 0);

  // ── Undo the resize (keyboard), then redo it (toolbar).
  await page.locator("[data-editor-viewport]").focus();
  await page.keyboard.press("Control+z");
  await expect(said(page)).toContainText("Undid: Resize");
  expect((await rectOf(page, "shape")).width).toBeCloseTo(120, 0);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(said(page)).toContainText("Redid: Resize");
  expect((await rectOf(page, "shape")).width).toBeCloseTo(160, 0);

  // ── Text on the rotated page.
  await page.getByRole("button", { name: "Text", exact: true }).click();
  p = await at(page, 1, 300, 200);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.type("ROTATED-E2E");
  await page.keyboard.press("Escape");
  const rotated = await textAt(page, "ROTATED-E2E");

  // ── Apply & download, and read what was downloaded.
  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /apply & download/i }),
  );
  await expect(
    page.getByRole("heading", { name: /edited pdf ready/i }),
  ).toBeVisible();

  const texts = await pdfPageTexts(buf);
  expect(texts).toHaveLength(2);
  expect(texts[0]).toContain("BASE ONE");
  expect(texts[0]).toContain("WYSIWYG-E2E");
  expect(texts[1]).toContain("BASE TWO");
  expect(texts[1]).toContain("ROTATED-E2E");

  const pages = await pdfTextPositions(buf);
  expect(pages[1]!.width).toBeCloseTo(PAGE_H, 3);
  const run = (i: number, s: string) =>
    pages[i]!.runs.find((r) => r.str === s)!;
  for (const [i, s, want] of [
    [0, "WYSIWYG-E2E", moved],
    [1, "ROTATED-E2E", rotated],
  ] as const) {
    const got = run(i, s);
    expect(got, `${s} is in the file`).toBeTruthy();
    expect(got.upright, `${s} reads upright`).toBe(true);
    expect(Math.abs(got.x - want.x), `${s} x`).toBeLessThan(1);
    expect(Math.abs(got.y - want.y), `${s} baseline`).toBeLessThan(1);
  }
  expect(guard.pageErrors).toEqual([]);
  expect(guard.cspViolations()).toEqual([]);
});

test("Bengali is previewed in the face the export embeds, and lands in the file", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const guard = attachConsoleGuard(page);
  await page.goto("/tools/edit-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "bangla.pdf",
    mimeType: "application/pdf",
    buffer: await fixture(),
  });
  await expect(page.locator('[data-editor-page="0"]')).toBeAttached({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const p = await at(page, 0, 80, 200);
  await page.mouse.click(p.x, p.y);
  const words = "আমার সোনার বাংলা";
  await page.keyboard.insertText(words);
  await page.keyboard.press("Escape");

  // The overlay draws it with the Noto Bengali face, fetched from our own
  // origin and registered as a FontFace — not a system fallback.
  const line = page.locator('[data-object-kind="text"] text').first();
  await expect(line).toHaveAttribute("font-family", /pdfxyz-editor-bengali/, {
    timeout: 20_000,
  });
  expect(
    await page.evaluate(() =>
      [...document.fonts].some(
        (f) =>
          f.family.includes("pdfxyz-editor-bengali") && f.status === "loaded",
      ),
    ),
  ).toBe(true);

  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /apply & download/i }),
  );
  const [first] = await pdfPageTexts(buf);
  for (const ch of ["আ", "ম", "স", "ন", "ব", "ল"]) expect(first).toContain(ch);
  expect(guard.pageErrors).toEqual([]);
  expect(guard.cspViolations()).toEqual([]);
});
