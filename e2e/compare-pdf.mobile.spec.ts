import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { fileInput, waitForHydration } from "./helpers";

/**
 * Compare PDF's RESULT on a 375 px phone (audit compare-pdf#4, 2026-11-14):
 * two real PDFs through the page, then the changes view as a thumb meets it
 * — the page header of each change is visible, Previous/Next change are
 * 44 px targets, the page does not scroll sideways, the n key moves the live
 * line, and axe finds no WCAG A/AA violation in the result, in the light
 * and the dark scheme. The tool-layout and axe sweeps see only a page's
 * first state; this is the state after a run.
 */
const MIN = 44;
const SCREEN = 375;

test.use({ viewport: { width: SCREEN, height: 812 } });

const body = (tag: string) =>
  Array.from(
    { length: 9 },
    (_, i) => `${tag} clause ${i + 1} stands as agreed`,
  );

async function pdf(pages: string[][]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    lines.forEach((line, i) =>
      page.drawText(line, { x: 48, y: 740 - i * 18, size: 11, font }),
    );
  }
  return Buffer.from(await doc.save());
}

async function compared(page: Page) {
  const left = [body("Alpha"), body("Bravo"), body("Charlie")];
  const right = left.map((lines, p) =>
    lines.map((line, i) =>
      p !== 1 && i === 4 ? line.replace("as agreed", "as amended") : line,
    ),
  );
  await page.goto("/tools/compare-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles([
    { name: "v1.pdf", mimeType: "application/pdf", buffer: await pdf(left) },
    { name: "v2.pdf", mimeType: "application/pdf", buffer: await pdf(right) },
  ]);
  await expect(
    page.locator("[data-tool-panel]").getByText("2/2 selected"),
  ).toBeVisible();
  await page.getByRole("button", { name: /compare pdfs/i }).click();
  await expect(
    page.getByRole("heading", { name: /differences found/i }),
  ).toBeVisible({ timeout: 30_000 });
}

test("the changes view on a phone: headers, 44 px steps, no sideways scroll, n moves", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await compared(page);
  const changes = page.getByRole("region", { name: "Changes" });
  await expect(
    changes.getByRole("heading", { level: 3, name: "Page 1 → page 1" }),
  ).toBeVisible();
  await expect(
    changes.getByRole("heading", { level: 3, name: "Page 3 → page 3" }),
  ).toBeAttached();
  const status = changes.getByRole("status");
  await expect(status).toHaveText("Change 1 of 2 · page 1 → page 1");

  for (const name of ["Previous change", "Next change"]) {
    const b = (await changes.getByRole("button", { name }).boundingBox())!;
    expect(b.width, `${name} width`).toBeGreaterThanOrEqual(MIN - 0.5);
    expect(b.height, `${name} height`).toBeGreaterThanOrEqual(MIN - 0.5);
    expect(b.x + b.width, `${name} right edge`).toBeLessThanOrEqual(SCREEN + 1);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(SCREEN);

  await changes.getByRole("heading", { level: 3 }).first().focus();
  await page.keyboard.press("n");
  await expect(status).toHaveText("Change 2 of 2 · page 3 → page 3");
  await expect(page.locator(":focus")).toHaveText("Page 3 → page 3");
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe finds no WCAG A/AA violation in the result (${scheme})`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    await compared(page);
    // Contrast is read off the page as painted: wait for the result's
    // entrance to finish, or a mid-fade colour reads as a violation.
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== "running"),
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
    // Health: the scan ran over the result, not over an empty panel.
    await expect(
      page.locator("[data-tool-panel] del, [data-tool-panel] ins").first(),
    ).toBeAttached();
    expect(found).toEqual([]);
  });
}

/** Two PDFs from page lists, through the page, compared. */
async function comparedPair(page: Page, left: string[][], right: string[][]) {
  await page.goto("/tools/compare-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles([
    { name: "v1.pdf", mimeType: "application/pdf", buffer: await pdf(left) },
    { name: "v2.pdf", mimeType: "application/pdf", buffer: await pdf(right) },
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

/**
 * The two ignore boxes, in a real browser (review of audit compare-pdf#4,
 * 2026-11-14): PROOF_LIMITS said this spec exercised them, and it never
 * ticked either. Each box re-compares without reading the files again, and
 * the box keeps focus — even after Next change was pressed at the last
 * change, which used to move focus to a heading on the next re-compare.
 */
test("the ignore boxes re-compare, and focus stays on the box", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const left = [1, 2, 3].map((p) => [
    "Acme Corp",
    ...body(["Alpha", "Bravo", "Charlie"][p - 1]!),
    `Page ${p} of 3`,
  ]);
  const right = left.map((lines, p) =>
    lines.map((line, i) =>
      i === lines.length - 1
        ? line.replace("of 3", "of 4")
        : p === 0 && i === 4
          ? line.toUpperCase()
          : p === 2 && i === 4
            ? line.replace("as agreed", "as amended")
            : line,
    ),
  );
  const changes = await comparedPair(page, left, right);
  const status = changes.getByRole("status");
  const count = async () =>
    Number(/of (\d+)/.exec((await status.textContent()) ?? "")?.[1]);
  const before = await count();
  // Health: the furniture, the case and the wording all differ.
  expect(before).toBeGreaterThanOrEqual(3);

  const next = changes.getByRole("button", { name: "Next change" });
  for (let i = 0; i <= before; i += 1) await next.click({ force: true });
  await expect(status).toHaveText(new RegExp(`^Change ${before} of ${before}`));

  const ignoreCase = changes.getByRole("checkbox", { name: "Ignore case" });
  await ignoreCase.focus();
  await page.keyboard.press("Space");
  await expect(ignoreCase).toBeChecked();
  await expect(status).toHaveText(new RegExp(`^Change 1 of ${before - 1}`));
  await expect(ignoreCase).toBeFocused();

  const furniture = changes.getByRole("checkbox", {
    name: "Ignore page headers and numbers",
  });
  await furniture.focus();
  await page.keyboard.press("Space");
  await expect(furniture).toBeChecked();
  await expect(status).toHaveText("Change 1 of 1 · page 3 → page 3");
  await expect(furniture).toBeFocused();
});

/** Every line of three pages changed: a list taller than its scroller. */
function manyChanges(extra = "") {
  const left = [body("Alpha"), body("Bravo"), body("Charlie")];
  const right = left.map((lines) =>
    lines.map((line, i) => (i % 2 === 0 ? `${line} revised${extra}` : line)),
  );
  return { left, right };
}

/**
 * A long unbroken token — a URL — wraps inside the list instead of widening
 * it (review of audit compare-pdf#4, 2026-11-14). The cells broke words with
 * `overflow-wrap: break-word`, which does not lower a table's min-content
 * width, so one 40-character URL made the list scroll sideways and clipped
 * every line in it, while the PAGE did not scroll — the check above passed.
 */
test("a long URL in a changed line wraps inside the list", async ({ page }) => {
  test.setTimeout(90_000);
  const url = `https://example.com/contracts/2026/${"msa-v3-".repeat(30)}final`;
  const { left, right } = manyChanges();
  right[0]![4] = `${right[0]![4]} ${url}`;
  const changes = await comparedPair(page, left, right);
  const list = changes.getByRole("group", { name: "List of changes" });
  await expect(
    list.getByText(url.slice(0, 30), { exact: false }),
  ).toBeAttached();
  const { scrollW, clientW } = await list.evaluate((el) => ({
    scrollW: el.scrollWidth,
    clientW: el.clientWidth,
  }));
  // Health: the list is narrower than the URL would be on one line.
  expect(clientW).toBeLessThan(url.length * 5);
  expect(scrollW).toBeLessThanOrEqual(clientW);
});

/**
 * The steps and the live line are never pinned under the site header
 * (review of audit compare-pdf#4, 2026-11-14). The bar was `sticky top-0`
 * under a header that is itself `sticky top-0 z-50`: once the page scrolled
 * past the list's top, the bar pinned at y=0, behind the header.
 */
for (const width of [SCREEN, 1280]) {
  test(`the changes bar is not pinned under the site header (${width} px)`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 812 });
    const { left, right } = manyChanges();
    const changes = await comparedPair(page, left, right);
    const bar = changes.locator(":scope > div").first();
    const next = changes.getByRole("button", { name: "Next change" });
    await expect(next).toBeVisible();
    const header = page.locator("header[data-masthead]");
    // Scroll the window so the region's top sits 150 px above the header's
    // bottom: a bar pinned at top-0 is then behind the header.
    const probe = await page.evaluate(
      async ({ regionSel }) => {
        const region = document.querySelector(regionSel)!;
        const headerBottom = document
          .querySelector("header[data-masthead]")!
          .getBoundingClientRect().bottom;
        const top = region.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: top - headerBottom + 150, behavior: "instant" });
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const barEl = region.firstElementChild as HTMLElement;
        const bar = barEl.getBoundingClientRect();
        return {
          headerBottom,
          sticky: getComputedStyle(barEl).position === "sticky",
          barTop: bar.top,
          regionTop: region.getBoundingClientRect().top,
        };
      },
      { regionSel: '[role="region"][data-chunk]' },
    );
    expect(await header.count()).toBe(1);
    if (width >= 640) {
      // Positive control: from sm the bar IS pinned, so this is not vacuous.
      expect(probe.sticky).toBe(true);
      expect(probe.barTop).toBeGreaterThanOrEqual(probe.headerBottom - 0.5);
      const box = (await next.boundingBox())!;
      const hit = await page.evaluate(
        ([x, y]) => {
          const el = document.elementFromPoint(x!, y!);
          return (
            el?.closest("button")?.getAttribute("aria-label") ?? el?.tagName
          );
        },
        [box.x + box.width / 2, box.y + box.height / 2],
      );
      expect(hit).toBe("Next change");
    } else {
      // On a phone the bar scrolls with its region, never pinned.
      expect(probe.sticky).toBe(false);
      // (Inside the region's 1 px border.)
      expect(Math.abs(probe.barTop - probe.regionTop)).toBeLessThanOrEqual(2);
    }
    expect(await bar.count()).toBe(1);
  });
}

/**
 * Next change shows the change, not only its heading (second review of
 * audit compare-pdf#4, 2026-11-14). The list scrolled to "nearest", so
 * from the 4th change on the heading sat on the list's bottom edge with its
 * rows hidden below it (0 of 2 visible at 1280 px), and at 375 px the list
 * itself was below the screen: Next changed the live line and nothing a
 * reader could see. After every press the focused heading and at least one
 * of its changed rows are on screen, inside the list.
 */
for (const width of [SCREEN, 1280]) {
  test(`Next change brings the change itself into view (${width} px)`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 812 });
    const lines = (p: number) =>
      Array.from(
        { length: 40 },
        (_, i) => `page ${p} line ${i + 1} stands as agreed`,
      );
    const left = [1, 2, 3, 4, 5, 6].map(lines);
    const right = left.map((page) =>
      page.map((line, i) =>
        i === 25 ? line.replace("agreed", "amended") : line,
      ),
    );
    const changes = await comparedPair(page, left, right);
    const status = changes.getByRole("status");
    await expect(status).toHaveText(/^Change 1 of 6/);
    const next = changes.getByRole("button", { name: "Next change" });
    for (let n = 2; n <= 6; n += 1) {
      await next.click();
      await expect(status).toHaveText(new RegExp(`^Change ${n} of 6`));
      const seen = await page.evaluate(() => {
        const heading = document.activeElement as HTMLElement;
        const list = heading.closest('[role="group"]')!;
        const header = document
          .querySelector("header[data-masthead]")!
          .getBoundingClientRect().bottom;
        const bar = list.previousElementSibling!.getBoundingClientRect();
        const pinned =
          getComputedStyle(list.previousElementSibling!).position === "sticky";
        const top = Math.max(header, pinned ? bar.bottom : header);
        const box = list.getBoundingClientRect();
        const inView = (r: DOMRect) =>
          r.top >= Math.max(top, box.top) - 1 &&
          r.bottom <= Math.min(window.innerHeight, box.bottom) + 1;
        const rows = [
          ...heading.closest("section")!.querySelectorAll("tr[data-kind]"),
        ];
        return {
          tag: heading.tagName,
          text: heading.textContent,
          heading: inView(heading.getBoundingClientRect()),
          rows: rows.filter((r) => inView(r.getBoundingClientRect())).length,
          of: rows.length,
        };
      });
      expect(seen.tag).toBe("H3");
      expect(seen.text).toBe(`Page ${n} → page ${n}`);
      expect(seen.heading, `change ${n}: heading in view`).toBe(true);
      expect(seen.of).toBe(2);
      expect(
        seen.rows,
        `change ${n}: changed rows in view`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
}
