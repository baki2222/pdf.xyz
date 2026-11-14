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
