import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { VIEWER_LABELS } from "../src/lib/pdf/viewer-copy";
import {
  VIEWER_PROOF_PAGES,
  VIEWER_PROOF_URL,
  VIEWER_PROOF_WORD,
  viewerProofPdf,
} from "../src/tests/viewer-fixtures";
import { ownerOnlyEncryptedPdf } from "../src/tests/encrypted-pdf-fixture";

/**
 * The PDF Viewer at the point of consumption: the served build, a real
 * browser, a real three-page PDF (src/tests/viewer-fixtures.ts).
 *
 * The property the highlight proof is about is ALIGNMENT: a search's
 * highlight sits over the word's ink, not merely somewhere on the page. It
 * is read from pixels — the canvas pixels inside the highlight's box must
 * hold ink, and the same box moved off the line must not — at 100%, at a
 * zoom step and after Rotate view. A text layer drawn at the wrong scale,
 * or not turned with the canvas, puts the box over white paper.
 */

const BYTES = Buffer.from(viewerProofPdf());
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function open(page: Page, buffer = BYTES, name = "proof.pdf") {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
  await page.goto("/tools/pdf-viewer");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer,
  });
  const region = page.getByRole("region", { name: `PDF viewer: ${name}` });
  await expect(region).toBeVisible({ timeout: 30_000 });
  return region;
}

const pageField = (page: Page) =>
  page.getByRole("textbox", { name: VIEWER_LABELS.pageNumber });

/** Dark pixels of page `n`'s canvas inside `box` (a page-space CSS box). */
async function inkIn(
  page: Page,
  n: number,
  box: { x: number; y: number; width: number; height: number },
): Promise<{ dark: number; total: number }> {
  const canvas = page.locator(`[data-viewer-page="${n}"] canvas`);
  await expect(canvas).toBeAttached({ timeout: 20_000 });
  return canvas.evaluate((el, b) => {
    const c = el as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const sx = c.width / r.width;
    const sy = c.height / r.height;
    const x0 = Math.max(0, Math.floor((b.x - r.left) * sx));
    const y0 = Math.max(0, Math.floor((b.y - r.top) * sy));
    const x1 = Math.min(c.width, Math.ceil((b.x + b.width - r.left) * sx));
    const y1 = Math.min(c.height, Math.ceil((b.y + b.height - r.top) * sy));
    if (x1 <= x0 || y1 <= y0) return { dark: 0, total: 0 };
    const d = c.getContext("2d")!.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i]! + d[i + 1]! + d[i + 2]! < 384) dark += 1;
    }
    return { dark, total: d.length / 4 };
  }, box);
}

/** The highlight over the word, and the proof it sits on the word's ink. */
async function expectHighlightOnInk(
  page: Page,
  hit: Locator,
  /** Which way is off the line, below it on the page: down upright, left after a quarter turn clockwise. */
  away: "down" | "left" = "down",
) {
  await expect(hit).toBeVisible();
  const box = (await hit.boundingBox())!;
  expect(box.width).toBeGreaterThan(4);
  const on = await inkIn(page, 3, box);
  expect(on.total, "the highlight's box covers canvas pixels").toBeGreaterThan(
    20,
  );
  // Ink inside the box: the word's glyphs.
  expect(on.dark / on.total, "ink under the highlight").toBeGreaterThan(0.04);
  // Negative control: the same box, moved off the line (below it on the
  // page, where it is blank) by three of its own thicknesses, holds no ink.
  // A box over paper would have passed a check that only asked for a box.
  const off = await inkIn(
    page,
    3,
    away === "down"
      ? { ...box, y: box.y + box.height * 3 }
      : { ...box, x: box.x - box.width * 3 },
  );
  expect(off.total, "the moved box is still on the page").toBeGreaterThan(20);
  expect(off.dark, "no ink where there is no text").toBe(0);
}

test.describe("PDF Viewer", () => {
  test("open, navigate, zoom, search with an aligned highlight, follow a link, thumbnails, bookmarks, rotate, download", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const writes: string[] = [];
    page.on("request", (req) => {
      if (["POST", "PUT", "PATCH"].includes(req.method())) {
        writes.push(`${req.method()} ${req.url()}`);
      }
    });

    const region = await open(page);
    await expect(pageField(page)).toHaveValue("1");
    await expect(region.getByText(`of ${VIEWER_PROOF_PAGES}`)).toBeVisible();

    // Page 1 is drawn: ink on its canvas (the heading line).
    const ink1 = await inkIn(
      page,
      1,
      (await page.locator('[data-viewer-page="1"]').boundingBox())!,
    );
    expect(ink1.dark).toBeGreaterThan(200);

    // Next, then the page field.
    await page.getByRole("button", { name: VIEWER_LABELS.next }).click();
    await expect(pageField(page)).toHaveValue("2");
    await pageField(page).fill("1");
    await pageField(page).press("Enter");
    await expect(pageField(page)).toHaveValue("1");

    // Links on page 1: the page link and the web link; the script link is
    // not drawn at all.
    const links = page.locator('[data-viewer-page="1"] [data-viewer-link]');
    await expect(links).toHaveCount(2);
    const web = page.locator('[data-viewer-page="1"] [data-viewer-link="url"]');
    await expect(web).toHaveAttribute("href", VIEWER_PROOF_URL);
    await expect(web).toHaveAttribute("rel", "noopener noreferrer nofollow");
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
    // Follow the internal link to page 3.
    await page
      .locator('[data-viewer-page="1"] [data-viewer-link="page"]')
      .click();
    await expect(pageField(page)).toHaveValue("3");

    // Search: one match, on page 3, mid-line, highlighted over its ink.
    await page.getByRole("button", { name: VIEWER_LABELS.search }).click();
    const field = page.getByRole("searchbox", {
      name: VIEWER_LABELS.searchField,
    });
    await field.fill(VIEWER_PROOF_WORD);
    await field.press("Enter");
    await expect(page.locator("[data-viewer-search-status]")).toContainText(
      "1 match on 1 page.",
    );
    const hit = page.locator(
      '[data-viewer-page="3"] mark[data-viewer-hit="active"]',
    );
    await expect(hit).toHaveText(VIEWER_PROOF_WORD);
    await expectHighlightOnInk(page, hit);

    // At a zoom step: still over the word.
    await page
      .getByRole("combobox", { name: VIEWER_LABELS.zoom })
      .selectOption("1.5");
    await expect(
      page.locator('[data-viewer-page="3"] mark[data-viewer-hit="active"]'),
    ).toBeVisible();
    // The page re-draws at the new scale before its pixels are read.
    await expect(page.locator('[data-viewer-page="3"]')).toHaveAttribute(
      "data-viewer-page-status",
      "drawn",
    );
    await expectHighlightOnInk(
      page,
      page.locator('[data-viewer-page="3"] mark[data-viewer-hit="active"]'),
    );

    // After Rotate view: the text layer turns with the canvas.
    await page.getByRole("button", { name: VIEWER_LABELS.rotate }).click();
    await expect(page.locator("[data-viewer-rotate-note]")).toBeVisible();
    await expect(page.locator('[data-viewer-page="3"]')).toHaveAttribute(
      "data-viewer-page-status",
      "drawn",
    );
    await page.getByRole("button", { name: VIEWER_LABELS.nextMatch }).click();
    await expectHighlightOnInk(
      page,
      page.locator('[data-viewer-page="3"] mark[data-viewer-hit="active"]'),
      "left",
    );
    // Turn back to upright for the rest.
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: VIEWER_LABELS.rotate }).click();
    }
    await expect(page.locator("[data-viewer-rotate-note]")).toHaveCount(0);

    // Thumbnails: one per page, drawn, and a pick moves the view.
    await page.getByRole("button", { name: VIEWER_LABELS.thumbnails }).click();
    const thumbs = page.locator("[data-viewer-thumbnail]");
    await expect(thumbs).toHaveCount(VIEWER_PROOF_PAGES);
    await expect(thumbs.nth(1).locator("img")).toBeVisible({ timeout: 20_000 });
    await thumbs.nth(1).click();
    await expect(pageField(page)).toHaveValue("2");

    // Bookmarks: the outline's two entries, and a pick moves the view.
    await page.getByRole("button", { name: VIEWER_LABELS.bookmarks }).click();
    await page.getByRole("button", { name: "Third page" }).click();
    await expect(pageField(page)).toHaveValue("3");

    // Download: the bytes opened, unchanged.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: VIEWER_LABELS.download }).click(),
    ]);
    const path = await download.path();
    const { readFileSync } = await import("node:fs");
    const saved = readFileSync(path!);
    expect(sha(saved)).toBe(sha(BYTES));
    expect(download.suggestedFilename()).toBe("proof.pdf");

    // Nothing was sent anywhere.
    expect(writes).toEqual([]);
  });

  test("keys work inside the viewer, and Ctrl+P is left to the browser", async ({
    page,
  }) => {
    await open(page);
    const scroller = page.locator("[data-viewer-scroller]");
    await scroller.focus();
    await page.keyboard.press("End");
    await expect(pageField(page)).toHaveValue(String(VIEWER_PROOF_PAGES));
    await page.keyboard.press("Home");
    await expect(pageField(page)).toHaveValue("1");
    await page.keyboard.press("PageDown");
    await expect(pageField(page)).toHaveValue("2");
    const prevented = await scroller.evaluate((el) => {
      const e = new KeyboardEvent("keydown", {
        key: "p",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(false);
  });

  test("a PDF whose author restricted editing opens, as in any viewer", async ({
    page,
  }) => {
    await open(page, Buffer.from(ownerOnlyEncryptedPdf()), "restricted.pdf");
    await expect(pageField(page)).toHaveValue("1");
    await expect(page.locator('[data-viewer-page="1"]')).toHaveAttribute(
      "data-viewer-page-status",
      "drawn",
      { timeout: 20_000 },
    );
  });

  test("axe finds no WCAG A/AA violation with a file open and search showing", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: VIEWER_LABELS.search }).click();
    await page
      .getByRole("searchbox", { name: VIEWER_LABELS.searchField })
      .fill(VIEWER_PROOF_WORD);
    await expect(page.locator("[data-viewer-search-status]")).toContainText(
      "1 match",
    );
    const fromRoot = createRequire(join(process.cwd(), "package.json"));
    await page.addScriptTag({ path: fromRoot.resolve("axe-core/axe.min.js") });
    const found = await page.evaluate(async () => {
      const axe = (
        window as unknown as {
          axe: {
            run: (
              ctx: Element,
              opts: object,
            ) => Promise<{ violations: { id: string; nodes: unknown[] }[] }>;
          };
        }
      ).axe;
      const region = document.querySelector("[data-pdf-viewer]")!;
      const r = await axe.run(region, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
        },
      });
      return r.violations.map((v) => `${v.id} x${v.nodes.length}`);
    });
    expect(found).toEqual([]);
  });
});
