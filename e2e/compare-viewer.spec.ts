import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { fileInput, waitForHydration } from "./helpers";
import { PAGE_IMAGES_NOTE } from "../src/lib/pdf/pdfjs-guard";
import { rawPdf } from "../src/tests/hostile/conversion-out.fixtures";

/**
 * Compare PDF's page view in a real browser, on a served build (audit
 * compare-pdf#2, S2, 2026-11-15): "Show changes on the pages" draws both
 * PDFs side by side — "Original" and "Revised" — with removed text crossed
 * out and added text underlined ON the pages' own text layer, Previous and
 * Next change move both files, "Scroll both files together" keeps them
 * level until it is unticked, and Start over leaves no page view and no
 * canvas behind. At 375 px the files are switched one at a time. Two
 * controls: a reordered page whose edited line is duplicated says so and
 * draws nothing, and a page with no text says it was not compared. A page
 * drawn as the image-budget note keeps its marks over the note.
 *
 * The fixture is the page-header pair (src/tests/compare-fixtures.ts): the
 * revision inserts a page before page 2 and edits "Total due: 100" to 120,
 * so that change sits on page 2 of the first file and page 3 of the second.
 */

const MIN = 44;
const body = (tag: string, n = 8) =>
  Array.from({ length: n }, (_, i) => `${tag} body line ${i + 1}`);

interface Line {
  text: string;
  x: number;
  y: number;
  size?: number;
}

async function pdf(pages: (string[] | Line[])[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    lines.forEach((line, i) => {
      if (typeof line === "string")
        page.drawText(line, { x: 48, y: 740 - i * 18, size: 11, font });
      else
        page.drawText(line.text, {
          x: line.x,
          y: line.y,
          size: line.size ?? 12,
          font,
        });
    });
  }
  return Buffer.from(await doc.save());
}

/** Four changes: page 1, an inserted page, "Total due" (2 → 3), the last page. */
function pair(): { left: string[][]; right: string[][] } {
  const p1 = body("alpha");
  const p2 = body("bravo");
  const p3 = body("charlie");
  const left = [p1, [...p2.slice(0, 6), "Total due: 100", ...p2.slice(6)], p3];
  const right = [
    p1.map((l, i) => (i === 2 ? `${l} revised` : l)),
    body("inserted"),
    [...p2.slice(0, 6), "Total due: 120", ...p2.slice(6)],
    p3.map((l, i) => (i === 7 ? `${l} amended` : l)),
  ];
  return { left, right };
}

async function compared(page: Page, left: Buffer, right: Buffer) {
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
  await expect(
    page.getByRole("heading", { name: /differences found/i }),
  ).toBeVisible({ timeout: 30_000 });
  return page.getByRole("region", { name: "Changes" });
}

async function openPages(page: Page, changes: Locator) {
  await changes
    .getByRole("button", { name: "Show changes on the pages" })
    .click();
  await expect(
    page.getByRole("group", { name: "Changes on the pages" }),
  ).toBeVisible({ timeout: 30_000 });
}

const side = (page: Page, which: "left" | "right") =>
  page.locator(`[data-compare-side="${which}"]`);

/** Is `inner` inside `outer`'s box, as painted? */
async function inside(inner: Locator, outer: Locator): Promise<boolean> {
  const a = await inner.boundingBox();
  const b = await outer.boundingBox();
  if (!a || !b) return false;
  return (
    a.y >= b.y - 1 &&
    a.y + a.height <= b.y + b.height + 1 &&
    a.x >= b.x - 1 &&
    a.x + a.width <= b.x + b.width + 1
  );
}

async function axeViolations(page: Page): Promise<string[]> {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running"),
  );
  const fromRoot = createRequire(join(process.cwd(), "package.json"));
  await page.addScriptTag({ path: fromRoot.resolve("axe-core/axe.min.js") });
  return page.evaluate(async () => {
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
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
    );
  });
}

test.describe("at 1280 px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("both files side by side, marks on the pages, moves, sync, and Start over leaves nothing", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { left, right } = pair();
    const changes = await compared(page, await pdf(left), await pdf(right));
    await openPages(page, changes);
    const L = side(page, "left");
    const R = side(page, "right");
    await expect(
      page.getByRole("region", { name: "Original: v1.pdf" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Revised: v2.pdf" }),
    ).toBeVisible();
    await expect(page.getByText("Original · v1.pdf")).toBeVisible();
    await expect(page.getByText("Revised · v2.pdf")).toBeVisible();

    // Next twice: the "Total due" change, page 2 → page 3.
    const next = changes.getByRole("button", { name: "Next change" });
    await next.click();
    await next.click();
    await expect(changes.getByRole("status").first()).toHaveText(
      /^Change 3 of 4 · page 2 → page 3/,
    );
    const removed = L.locator(
      '[data-viewer-page="2"] mark[data-mark-kind="removed"]',
    );
    const added = R.locator(
      '[data-viewer-page="3"] mark[data-mark-kind="added"]',
    );
    await expect(removed).toHaveText("100", { timeout: 20_000 });
    await expect(added).toHaveText("120");
    // The active change's marks are in each column's view.
    const activeL = L.locator('mark[data-viewer-hit="active"]').first();
    const activeR = R.locator('mark[data-viewer-hit="active"]').first();
    await expect.poll(() => inside(activeL, L)).toBe(true);
    await expect.poll(() => inside(activeR, R)).toBe(true);
    // The marks are drawn: the decoration is set, and named, on each kind.
    expect(
      await removed.evaluate((m) => getComputedStyle(m).textDecorationLine),
    ).toContain("line-through");
    expect(
      await added.evaluate((m) => getComputedStyle(m).textDecorationLine),
    ).toContain("underline");
    expect(
      await page.locator("[data-compare-viewer] canvas").count(),
    ).toBeLessThanOrEqual(8);

    // Scroll both files together: the reader's scroll of Original moves Revised…
    const sync = page.getByRole("checkbox", {
      name: "Scroll both files together",
    });
    await expect(sync).toBeChecked();
    const rBefore = await R.evaluate((el) => el.scrollTop);
    await L.hover();
    await page.mouse.wheel(0, 700);
    await expect
      .poll(() => R.evaluate((el) => el.scrollTop), { timeout: 5_000 })
      .not.toBe(rBefore);
    // …and, unticked, it does not.
    await sync.uncheck();
    const rAfter = await R.evaluate((el) => el.scrollTop);
    await L.hover();
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(500);
    expect(await R.evaluate((el) => el.scrollTop)).toBe(rAfter);

    // Start over: no page view, no canvas.
    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page.locator("[data-compare-viewer]")).toHaveCount(0);
    await expect(page.locator("canvas")).toHaveCount(0);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe finds no WCAG A/AA violation in the page view (${scheme})`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.emulateMedia({ colorScheme: scheme });
      const { left, right } = pair();
      const changes = await compared(page, await pdf(left), await pdf(right));
      await openPages(page, changes);
      // Health: the scan runs over drawn marks, not an empty view.
      await expect(
        page.locator("[data-compare-viewer] mark[data-mark-kind]").first(),
      ).toBeAttached({ timeout: 20_000 });
      expect(await axeViolations(page)).toEqual([]);
    });
  }

  test("a reordered page with its edited line duplicated says so and draws no mark there", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const reordered = (second: string): Line[] => [
      { text: second, x: 72, y: 600 },
      { text: "Statement Heading", x: 72, y: 720, size: 18 },
      { text: "Total: 10", x: 72, y: 660 },
      { text: "Closing words of the statement.", x: 72, y: 560 },
    ];
    const changes = await compared(
      page,
      await pdf([reordered("Total: 10")]),
      await pdf([reordered("Total: 15")]),
    );
    await openPages(page, changes);
    const L = side(page, "left");
    await expect(L.locator("[data-compare-page-note]")).toHaveText(
      "1 changed line on this page could not be placed on the page. It is in the list of changes.",
      { timeout: 20_000 },
    );
    await expect(L.locator("mark[data-mark-kind]")).toHaveCount(0);
    // Control: the second file's copy is unique there, and is marked.
    await expect(
      side(page, "right").locator('mark[data-mark-kind="added"]'),
    ).toHaveText("15");
  });

  // ADDED 2026-11-15 (review r1): a footer "Confidential" drawn first and a
  // header "Confidential" drawn last read in the same text order as the
  // stream; the removed footer was struck through on the header (y=569 in a
  // text layer spanning 554..1071, the top of the page). Now flagged.
  test("an identical header and footer, the footer removed: flagged, nothing struck on the header", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const footer: Line = { text: "Confidential", x: 72, y: 40, size: 9 };
    const header: Line = { text: "Confidential", x: 72, y: 760, size: 9 };
    const bodyLines: Line[] = [
      { text: "Body paragraph one starts here.", x: 72, y: 700 },
      { text: "Body paragraph one continues.", x: 72, y: 686 },
    ];
    const changes = await compared(
      page,
      await pdf([[footer, ...bodyLines, header]]),
      await pdf([[...bodyLines, header]]),
    );
    await openPages(page, changes);
    const L = side(page, "left");
    await expect(L.locator("[data-compare-page-note]")).toHaveText(
      "1 changed line on this page could not be placed on the page. It is in the list of changes.",
      { timeout: 20_000 },
    );
    await expect(L.locator("mark[data-mark-kind]")).toHaveCount(0);
    // Control: the page itself was drawn with its text, so the absence of a
    // mark is not a page that never drew.
    await expect(L.locator(".textLayer").first()).toContainText("Confidential");
  });

  test("a page with no selectable text says it was not compared", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const changes = await compared(
      page,
      await pdf([body("one", 4), [], body("three", 4)]),
      await pdf([
        [...body("one", 3), "one body line 4 changed"],
        [],
        body("three", 4),
      ]),
    );
    await openPages(page, changes);
    for (const which of ["left", "right"] as const)
      await expect(
        side(page, which).locator("[data-compare-page-note]"),
      ).toHaveText("No selectable text on this page, so it was not compared.", {
        timeout: 20_000,
      });
  });

  test("a page drawn as the image-budget note keeps its marks, and its note is heard", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // Three 36 MP images on page 1 (past the page budget) under one text
    // line, as e2e/page-note-a11y.spec.ts draws them.
    const over = (total: string) => {
      const stub = {
        dict: "/Type /XObject /Subtype /Image /Width 6000 /Height 6000 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode",
        stream: new Uint8Array([0x78, 0x9c]),
      };
      return Buffer.from(
        rawPdf([
          "<< /Type /Catalog /Pages 2 0 R >>",
          "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /XObject << /A 5 0 R /B 6 0 R /C 7 0 R >> /Font << /F1 8 0 R >> >> /Contents 4 0 R >>",
          {
            dict: "",
            stream: `q 100 0 0 100 50 50 cm /A Do Q q 100 0 0 100 200 50 cm /B Do Q q 100 0 0 100 350 50 cm /C Do Q BT /F1 14 Tf 72 700 Td (Invoice heading) Tj 0 -24 Td (${total}) Tj ET`,
          },
          stub,
          stub,
          stub,
          "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        ]),
      );
    };
    const changes = await compared(
      page,
      over("Total due: 100"),
      over("Total due: 120"),
    );
    await openPages(page, changes);
    const L = side(page, "left");
    await expect(
      L.getByRole("img", { name: PAGE_IMAGES_NOTE, exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(L.locator('mark[data-mark-kind="removed"]')).toHaveText("100");
    expect(
      await page.locator("[data-compare-viewer] canvas").count(),
    ).toBeLessThanOrEqual(8);
  });
});

test.describe("at 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("44 px controls, no sideways scroll, Revised shows its marks, and Next brings the pages into view", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { left, right } = pair();
    const changes = await compared(page, await pdf(left), await pdf(right));
    await openPages(page, changes);
    for (const name of [
      "Show changes on the pages",
      "Show the list",
      "Original",
      "Revised",
      "Previous change",
      "Next change",
    ]) {
      const b = (await page
        .getByRole("button", { name, exact: true })
        .boundingBox())!;
      expect(b.width, `${name} width`).toBeGreaterThanOrEqual(MIN - 0.5);
      expect(b.height, `${name} height`).toBeGreaterThanOrEqual(MIN - 0.5);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(375);
    // One file at a time.
    await expect(side(page, "right")).toHaveCount(0);
    await page.getByRole("button", { name: "Revised", exact: true }).click();
    await expect(side(page, "left")).toHaveCount(0);
    await expect(
      side(page, "right").locator('mark[data-mark-kind="added"]').first(),
    ).toBeAttached({ timeout: 20_000 });
    // Next: the pages come into the window (the bar is not pinned here).
    await page.evaluate(() => window.scrollTo(0, 0));
    await changes.getByRole("button", { name: "Next change" }).click();
    await expect
      .poll(async () => {
        const box = await page.locator("[data-compare-viewer]").boundingBox();
        const h = await page.evaluate(() => window.innerHeight);
        return box !== null && box.y < h && box.y + box.height > 0;
      })
      .toBe(true);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe finds no WCAG A/AA violation at 375 px (${scheme})`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.emulateMedia({ colorScheme: scheme });
      const { left, right } = pair();
      const changes = await compared(page, await pdf(left), await pdf(right));
      await openPages(page, changes);
      await expect(
        page.locator("[data-compare-viewer] mark[data-mark-kind]").first(),
      ).toBeAttached({ timeout: 20_000 });
      expect(await axeViolations(page)).toEqual([]);
    });
  }
});
