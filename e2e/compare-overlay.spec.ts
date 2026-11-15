import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { fileInput, waitForHydration } from "./helpers";
import { PDF_IMAGE_TOO_LARGE_MESSAGE } from "../src/lib/pdf/pdfjs-guard";
import {
  imageBombAtCapPdf,
  rawPdf,
} from "../src/tests/hostile/conversion-out.fixtures";
import { NO_VISIBLE_DIFFERENCE } from "../src/components/tools/runner/compare/visual-claim";

/**
 * Compare PDF's Overlay in a real browser, on a served build (audit
 * compare-pdf#3, S3, 2026-11-15). Overlay pages lays page k of PDF 2 over
 * page k of PDF 1, drawn by pdf.js through the output path, and marks
 * where the ink differs. Proved here at the point of consumption: a stamp
 * the text comparison cannot see is outlined and stepped to; two saves of
 * the same document get the one gated sentence, on a page and over all
 * pages; two scans get "Compare pages visually"; a partly scanned file
 * gets a bar line that opens the Overlay at that page; an over-budget
 * image and an over-budget page are refused in the guard's words and
 * never get the sentence; a page-count mismatch and a stopped scan get
 * none either; Start over leaves no canvas; and nothing is uploaded.
 */

const PHRASE = new RegExp(NO_VISIBLE_DIFFERENCE);
const LINES = [
  "Master services agreement",
  "1. The supplier delivers the goods by the date agreed.",
  "2. The buyer pays within thirty days of the invoice.",
];

async function textPdf(
  pages: number,
  opts: { stamp?: boolean; emptyPage?: number; tag?: string } = {},
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([612, 792]);
    if (opts.emptyPage === p) continue;
    [...LINES, `${opts.tag ?? "Page"} ${p + 1}`].forEach((line, i) =>
      page.drawText(line, { x: 60, y: 712 - i * 20, size: 12, font }),
    );
    if (opts.stamp && p === 0)
      page.drawRectangle({
        x: 380,
        y: 300,
        width: 160,
        height: 70,
        color: rgb(0.8, 0.1, 0.1),
      });
  }
  return Buffer.from(await doc.save());
}

/** A page with no text: a grey "scan" of bars, `mark` adding a block. */
async function scanPdf(mark: boolean): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  for (let y = 100; y < 700; y += 30)
    page.drawRectangle({
      x: 60,
      y,
      width: 400 - (y % 90),
      height: 10,
      color: rgb(0.15, 0.15, 0.15),
    });
  if (mark)
    page.drawRectangle({
      x: 420,
      y: 40,
      width: 120,
      height: 50,
      color: rgb(0, 0, 0),
    });
  return Buffer.from(await doc.save());
}

/** Two pages: page 1 holds three 36 MP images (past the page budget). */
function overBudgetPagePdf(): Buffer {
  const stub = {
    dict: "/Type /XObject /Subtype /Image /Width 6000 /Height 6000 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode",
    stream: new Uint8Array([0x78, 0x9c]),
  };
  return Buffer.from(
    rawPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R 9 0 R] /Count 2 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /XObject << /A 5 0 R /B 6 0 R /C 7 0 R >> /Font << /F1 8 0 R >> >> /Contents 4 0 R >>",
      {
        dict: "",
        stream:
          "q 100 0 0 100 50 50 cm /A Do Q q 100 0 0 100 200 50 cm /B Do Q q 100 0 0 100 350 50 cm /C Do Q BT /F1 14 Tf 72 700 Td (Invoice heading) Tj ET",
      },
      stub,
      stub,
      stub,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 8 0 R >> >> /Contents 10 0 R >>",
      { dict: "", stream: "BT /F1 14 Tf 72 700 Td (Second page) Tj ET" },
    ]),
  );
}

async function compared(
  page: Page,
  left: Buffer,
  right: Buffer,
  heading: RegExp,
) {
  await page.goto("/tools/compare-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles([
    { name: "v1.pdf", mimeType: "application/pdf", buffer: left },
    { name: "v2.pdf", mimeType: "application/pdf", buffer: right },
  ]);
  await expect(
    page.locator("[data-tool-panel]").getByText("2/2 selected"),
  ).toBeVisible();
  await page.getByRole("button", { name: /compare pdfs/i }).click();
  await expect(page.getByRole("heading", { name: heading })).toBeVisible({
    timeout: 30_000,
  });
}

const overlay = (page: Page) =>
  page.locator("[data-chunk='pdfxyz:lazy:compare-overlay']");

async function openOverlay(page: Page) {
  await page.getByRole("button", { name: "Overlay pages" }).click();
  await expect(overlay(page)).toBeVisible({ timeout: 30_000 });
  await expect(overlay(page)).not.toHaveAttribute("aria-busy", "true", {
    timeout: 30_000,
  });
}

const liveLine = (page: Page) =>
  overlay(page).locator('[role="status"][aria-live="polite"]').first();

test.describe("Overlay pages", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("a stamp the text cannot see is outlined, and Next difference steps to it", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await compared(
      page,
      await textPdf(1),
      await textPdf(1, { stamp: true }),
      /selectable text matches/i,
    );
    await openOverlay(page);
    await expect(overlay(page)).toContainText(/\d+ differences? on this page/);
    await expect(liveLine(page)).toHaveText(/^Difference 1 of \d+, /);
    const next = overlay(page).getByRole("button", { name: "Next difference" });
    if ((await next.getAttribute("aria-disabled")) !== "true") {
      await next.click();
      await expect(liveLine(page)).toHaveText(/^Difference 2 of \d+, /);
    }
    // The outline is painted: the blue S2 uses for the active mark.
    const blue = await overlay(page)
      .locator("canvas")
      .evaluate((c: HTMLCanvasElement) => {
        const d = c
          .getContext("2d")!
          .getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4)
          if (d[i] === 0x1d && d[i + 1] === 0x4e && d[i + 2] === 0xd8) n++;
        return n;
      });
    expect(blue).toBeGreaterThan(0);
    await expect(overlay(page)).not.toContainText(PHRASE);
  });

  test("two saves of one document: the page sentence, then the all-pages sentence", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await compared(
      page,
      await textPdf(2),
      await textPdf(2),
      /selectable text matches/i,
    );
    await openOverlay(page);
    await expect(overlay(page)).toContainText(
      `${NO_VISIBLE_DIFFERENCE} (about 150 dpi, in grayscale).`,
    );
    await overlay(page)
      .getByRole("button", { name: "Check all pages" })
      .click();
    await expect(overlay(page)).toContainText(
      `${NO_VISIBLE_DIFFERENCE} on any of the 2 pages (about 150 dpi, in grayscale).`,
      { timeout: 60_000 },
    );
  });

  test("two scans: No text to compare, then Compare pages visually finds the mark", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await compared(
      page,
      await scanPdf(false),
      await scanPdf(true),
      /no text to compare/i,
    );
    await page.getByRole("button", { name: "Compare pages visually" }).click();
    await expect(overlay(page)).toBeVisible({ timeout: 30_000 });
    await expect(overlay(page)).toContainText(/\d+ differences? on this page/, {
      timeout: 30_000,
    });
    await expect(overlay(page)).not.toContainText(PHRASE);
  });

  test("a partly scanned file: the bar line opens the Overlay at that page", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await compared(
      page,
      await textPdf(3, { emptyPage: 1 }),
      await textPdf(3, { emptyPage: 1, tag: "Sheet" }),
      /differences found/i,
    );
    await expect(
      page.getByText(
        "1 page of PDF 1 and 1 page of PDF 2 have no selectable text, so their text was not compared.",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Compare pages visually" }).click();
    await expect(overlay(page)).toContainText(
      "Pages are compared by number: page 2 with page 2.",
      { timeout: 30_000 },
    );
  });

  test("an image over its budget is refused in the guard's words, never the sentence (CO-08)", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const bomb = Buffer.from(await imageBombAtCapPdf());
    await compared(page, bomb, bomb, /selectable text matches/i);
    await openOverlay(page);
    await expect(overlay(page)).toContainText(PDF_IMAGE_TOO_LARGE_MESSAGE, {
      timeout: 60_000,
    });
    await expect(overlay(page)).not.toContainText(PHRASE);
  });

  test("a page over the page budget: refused alone, and Check all checks nothing", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const file = overBudgetPagePdf();
    await compared(page, file, file, /selectable text matches/i);
    await openOverlay(page);
    await expect(overlay(page)).toContainText(
      /could not be compared visually: Page 1 of this PDF has more image data/,
      { timeout: 60_000 },
    );
    await expect(overlay(page)).toContainText("So this page is not compared.");
    await expect(overlay(page)).not.toContainText(PHRASE);
    await overlay(page)
      .getByRole("button", { name: "Check all pages" })
      .click();
    await expect(overlay(page)).toContainText("No pages were checked.", {
      timeout: 60_000,
    });
    await expect(overlay(page)).not.toContainText(PHRASE);
  });

  test("different page counts: the unpaired pages are named, and nothing is claimed", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await compared(
      page,
      await textPdf(2),
      await textPdf(3),
      /differences found/i,
    );
    await openOverlay(page);
    await expect(overlay(page)).toContainText(
      "PDF 2 has 1 more page (3); it has nothing to compare with.",
    );
    await expect(overlay(page)).not.toContainText(PHRASE);
  });

  test("Check all on 30 pages, stopped: it says so and claims nothing; Start over leaves no canvas", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await compared(
      page,
      await textPdf(30),
      await textPdf(30),
      /selectable text matches/i,
    );
    await openOverlay(page);
    await overlay(page)
      .getByRole("button", { name: "Check all pages" })
      .click();
    await expect(overlay(page)).toHaveAttribute("aria-busy", "true");
    await overlay(page).getByRole("button", { name: "Stop" }).click();
    await expect(overlay(page)).toContainText(
      /Checked \d+ of 30 pages; stopped\./,
      { timeout: 30_000 },
    );
    await expect(overlay(page)).not.toContainText(PHRASE);
    await page.getByRole("button", { name: /start over/i }).click();
    await expect(overlay(page)).toHaveCount(0);
    expect(await page.locator("canvas").count()).toBe(0);
  });

  test("nothing is uploaded while the Overlay draws", async ({ page }) => {
    test.setTimeout(120_000);
    const seen: { method: string; url: string; body: boolean }[] = [];
    page.on("request", (r) =>
      seen.push({
        method: r.method(),
        url: r.url(),
        body: r.postDataBuffer() !== null,
      }),
    );
    await compared(
      page,
      await textPdf(2),
      await textPdf(2, { stamp: true }),
      /selectable text matches/i,
    );
    const from = seen.length;
    await openOverlay(page);
    await overlay(page)
      .getByRole("button", { name: "Check all pages" })
      .click();
    await expect(overlay(page)).toContainText(/Differences on 1 page/, {
      timeout: 60_000,
    });
    const site = new URL(page.url()).origin;
    const during = seen.slice(from);
    // Analytics beacons go to their own origin; only the site's are counted.
    const ours = during.filter((r) => new URL(r.url).origin === site);
    expect(ours.filter((r) => r.method !== "GET")).toEqual([]);
    expect(ours.filter((r) => r.body)).toEqual([]);
    for (const r of ours)
      expect(new URL(r.url).pathname, r.url).toMatch(
        /^\/_next\/static\/|\.(?:js|mjs|wasm|bcmap|pfb|ttf|json)$/,
      );
  });
});

test.describe("at 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("44 px controls (the slider's box included) and no sideways scroll", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await compared(
      page,
      await textPdf(2),
      await textPdf(2, { stamp: true }),
      /selectable text matches/i,
    );
    await openOverlay(page);
    const controls = [
      ...[
        "Previous page",
        "Next page",
        "Previous difference",
        "Next difference",
        "Check all pages",
        "Show the list",
        "Overlay pages",
      ].map((name) => page.getByRole("button", { name, exact: true })),
      page.getByRole("slider", { name: "Blend between PDF 1 and PDF 2" }),
    ];
    for (const c of controls) {
      const b = (await c.boundingBox())!;
      expect(b.width, String(c)).toBeGreaterThanOrEqual(43.5);
      expect(b.height, String(c)).toBeGreaterThanOrEqual(43.5);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(375);
  });

  for (const scheme of ["light", "dark"] as const)
    test(`axe finds no WCAG A/AA violation in the Overlay (${scheme})`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.emulateMedia({ colorScheme: scheme });
      await compared(
        page,
        await textPdf(2),
        await textPdf(2, { stamp: true }),
        /selectable text matches/i,
      );
      await openOverlay(page);
      await page.waitForFunction(() =>
        document.getAnimations().every((a) => a.playState !== "running"),
      );
      const fromRoot = createRequire(join(process.cwd(), "package.json"));
      await page.addScriptTag({
        path: fromRoot.resolve("axe-core/axe.min.js"),
      });
      const found = await page.evaluate(async () => {
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
        const panel = document.querySelector("[data-tool-panel]")!;
        const r = await axe.run(panel, {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
          },
        });
        return r.violations.map(
          (v) =>
            `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
        );
      });
      // Health: the scan ran over the Overlay, not over an empty panel.
      await expect(overlay(page).locator("canvas")).toBeAttached();
      expect(found).toEqual([]);
    });
});
