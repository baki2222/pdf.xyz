import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { textPdf } from "./ai-results-fixture";
import { fileInput, waitForHydration } from "./helpers";

/**
 * PDF to Markdown's preview on the served build (sweep finding F2,
 * 2026-11-18): after Create Markdown on a 2-page PDF the preview box is
 * taller than its max-h-72, and a keyboard must be able to reach it with Tab
 * and scroll it with the arrow keys. The desktop pass is
 * pdf-to-markdown-preview.spec.ts, the phone pass its .mobile twin.
 */

const fromRoot = createRequire(join(process.cwd(), "package.json"));
const AXE = fromRoot.resolve("axe-core/axe.min.js");

export async function denyConsent(page: Page) {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
}

/** Upload a 2-page text PDF, press Create Markdown, return the preview. */
export async function createMarkdown(page: Page): Promise<Locator> {
  const pages = [1, 2].map((p) =>
    Array.from(
      { length: 60 },
      (_, i) => `Page ${p} line ${i + 1} lorem ipsum dolor sit amet`,
    ),
  );
  await page.goto("/tools/pdf-to-markdown");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "two-pages.pdf",
    mimeType: "application/pdf",
    buffer: await textPdf(pages),
  });
  await page.getByRole("button", { name: /Create Markdown/ }).click();
  await expect(page.getByText("Markdown created", { exact: true })).toBeVisible(
    {
      timeout: 30_000,
    },
  );
  // Found by what it shows, not by its name, so a nameless box still fails
  // on the keyboard steps below rather than here. The box holds the whole
  // Markdown as one text node, so the smallest element with this text is it.
  const preview = page.getByText("Page 2 line 60 lorem", { exact: false });
  await expect(preview).toBeVisible();
  return preview;
}

/**
 * Tab from the control just before the preview reaches the preview, and
 * ArrowDown then scrolls it.
 */
export async function expectTabThenScroll(page: Page, preview: Locator) {
  // Health: the box really scrolls, or this proves nothing.
  const sizes = await preview.evaluate((el) => ({
    scroll: el.scrollHeight,
    client: el.clientHeight,
    top: el.scrollTop,
  }));
  expect(sizes.scroll).toBeGreaterThan(sizes.client);
  expect(sizes.top).toBe(0);

  // Focus the last tabbable element before the preview in document order,
  // then press Tab once, as a keyboard user would.
  const focusedBefore = await preview.evaluate((box) => {
    const all = [
      ...document.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]",
      ),
    ].filter(
      (el) =>
        el.tabIndex >= 0 &&
        el !== box &&
        el.getClientRects().length > 0 &&
        box.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING,
    );
    const before = all.at(-1);
    before?.focus();
    return before ? before.outerHTML.slice(0, 80) : null;
  });
  expect(focusedBefore).not.toBeNull();
  await page.keyboard.press("Tab");
  await expect(preview).toBeFocused();
  await expect(preview).toHaveAccessibleName("Markdown preview");

  await page.keyboard.press("ArrowDown");
  await expect
    .poll(() => preview.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
}

/** axe's scrollable-region-focusable rule on the page as it stands. */
export async function scrollableRegionViolations(
  page: Page,
): Promise<string[]> {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            ctx: Document,
            opts: object,
          ) => Promise<{
            violations: { id: string; nodes: { target: string[] }[] }[];
            passes: { id: string; nodes: unknown[] }[];
          }>;
        };
      }
    ).axe;
    const r = await axe.run(document, {
      runOnly: { type: "rule", values: ["scrollable-region-focusable"] },
    });
    return r.violations.flatMap((v) =>
      v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`),
    );
  });
}
