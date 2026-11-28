import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getAllToolSlugs } from "../src/lib/tools";
import { getRunnerKind } from "../src/lib/pdf/registry";
import { fileInput, waitForHydration } from "./helpers";
import { injectAxe } from "./axe-inject";

/**
 * The editor's page view, reached and scrolled from the keyboard.
 *
 * The 2026-11-18 after-upload sweep found, on production, that the page view
 * of Edit, Annotate and Sign PDF scrolls but can never take keyboard focus
 * (`tabIndex={-1}`): someone without a mouse could see page 1 and nothing
 * after it, and axe reported scrollable-region-focusable.
 *
 * THE SET IS DERIVED, never typed. A tool is in it when the chain a visitor's
 * browser walks reaches the element: catalogue slug → runner kind
 * (registry) → the `case` in tool-runner.tsx → the runner module it loads →
 * that module imports the editor session → the session loads the editor →
 * the editor renders `data-editor-viewport`. Every link is FATAL when it
 * resolves to nothing, so a rename fails loudly instead of shrinking the set.
 */

const RUNNER_DIR = join(process.cwd(), "src/components/tools/runner");
const VIEWPORT_ATTR = "data-editor-viewport";

function resolveModule(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  const found = [`${base}.tsx`, `${base}.ts`].find((f) => existsSync(f));
  if (!found) throw new Error(`${from}: "${spec}" resolves to no file`);
  return found;
}

/** Does `file` (or a module it imports relatively, transitively) render the viewport? */
function rendersViewport(file: string, seen = new Set<string>()): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  // Comments are not edges: a docblock that quotes `import("./x")` is prose.
  const source = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  if (source.includes(`${VIEWPORT_ATTR}=""`)) return true;
  // Static imports of values and lazy `import("./…")`; `import type` is
  // erased at runtime and is not an edge.
  const specs = [
    ...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"(\.\.?\/[^"]+)"/gm),
    ...source.matchAll(/\bimport\(\s*"(\.\.?\/[^"]+)"\s*\)/g),
  ].map((m) => m[1]!);
  return specs.some((s) => rendersViewport(resolveModule(file, s), seen));
}

/** kind → runner module, read from tool-runner.tsx's switch and its loaders. */
function runnerModules(): Map<string, string> {
  const dispatcher = join(RUNNER_DIR, "tool-runner.tsx");
  const source = readFileSync(dispatcher, "utf8");
  const loaders = new Map(
    [
      ...source.matchAll(
        /const (\w+) = dynamic\(\(\) =>\s*import\("(\.\/[^"]+)"\)/g,
      ),
    ].map((m) => [m[1]!, resolveModule(dispatcher, m[2]!)]),
  );
  const out = new Map<string, string>();
  const body = source.slice(source.indexOf("switch (kind)"));
  let pending: string[] = [];
  for (const m of body.matchAll(/case "([^"]+)":|return <(\w+)/g)) {
    if (m[1]) pending.push(m[1]);
    else {
      const file = loaders.get(m[2]!);
      if (!file) throw new Error(`tool-runner.tsx: <${m[2]}> has no loader`);
      for (const kind of pending) out.set(kind, file);
      pending = [];
    }
  }
  return out;
}

export function editorViewportSlugs(): string[] {
  const modules = runnerModules();
  // Health: the dispatcher parse saw the whole switch, not two arms.
  if (modules.size < 25)
    throw new Error(`tool-runner.tsx parsed to ${modules.size} arms`);
  return getAllToolSlugs().filter((slug) => {
    const kind = getRunnerKind(slug);
    if (!kind) return false;
    const file = modules.get(kind);
    if (!file) throw new Error(`${slug}: kind "${kind}" has no runner arm`);
    return rendersViewport(file);
  });
}

/** Three Letter pages: taller than the page view at desktop AND on a phone. */
async function threePages(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++)
    doc
      .addPage([612, 792])
      .drawText(`KEYBOARD PAGE ${i}`, { x: 72, y: 720, size: 18, font });
  return Buffer.from(await doc.save());
}

/**
 * Open `slug` on a three-page PDF and prove the page view is a keyboard
 * stop: Tab from the toolbar reaches it, it has a name, PageDown scrolls it,
 * and axe's scrollable-region-focusable finds nothing on it.
 */
export async function proveViewportKeyboard(page: Page, slug: string) {
  await page.goto(`/tools/${slug}`);
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "three-pages.pdf",
    mimeType: "application/pdf",
    buffer: await threePages(),
  });
  const viewport = page.locator(`[${VIEWPORT_ATTR}]`);
  await expect(page.locator('[data-editor-page="2"]')).toBeAttached({
    timeout: 30_000,
  });
  const toolbar = page.getByRole("toolbar", { name: "Editor tools" });
  await expect(toolbar).toBeVisible({ timeout: 30_000 });

  // (1) Precondition, FATAL: the view really overflows. Without it every
  // assertion below could pass on a region that has nothing to scroll.
  await expect
    .poll(() => viewport.evaluate((v) => v.scrollHeight - v.clientHeight))
    .toBeGreaterThan(100);

  // (2) Tab from the toolbar reaches the page view, which has a name. The
  // direction depends on the layout: at desktop the view follows the
  // toolbar; on a phone the toolbar is docked AFTER it (measured
  // 2026-11-18), so Shift+Tab is the way back. Either way it must be a stop
  // in the sequential order, which tabIndex={-1} never is.
  const walk = async (key: "Tab" | "Shift+Tab") => {
    await toolbar.locator("button").first().focus();
    // Sign PDF opens with its signature panel between the two (some 50
    // stops), so the bound is generous; it only has to be finite.
    for (let i = 0; i < 150; i++) {
      await page.keyboard.press(key);
      if (await viewport.evaluate((v) => document.activeElement === v))
        return true;
    }
    return false;
  };
  const reached = (await walk("Tab")) || (await walk("Shift+Tab"));
  expect(reached, "Tab from the toolbar never reached the page view").toBe(
    true,
  );
  await expect(viewport).toHaveAccessibleName("Page view");
  await expect(viewport).toHaveAttribute("role", "region");
  // Keyboard focus shows the ring.
  expect(
    await viewport.evaluate((v) => getComputedStyle(v).outlineStyle),
  ).not.toBe("none");

  // (3) PageDown scrolls it.
  const before = await viewport.evaluate((v) => v.scrollTop);
  await page.keyboard.press("PageDown");
  await expect
    .poll(() => viewport.evaluate((v) => v.scrollTop))
    .toBeGreaterThan(before);

  // (4) axe, only this rule, only this element.
  await injectAxe(page);
  const found = await page.evaluate(async (sel) => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            ctx: object,
            opts: object,
          ) => Promise<{
            violations: { id: string }[];
            passes: { id: string }[];
          }>;
        };
      }
    ).axe;
    const r = await axe.run(
      { include: [sel] },
      { runOnly: { type: "rule", values: ["scrollable-region-focusable"] } },
    );
    return {
      violations: r.violations.map((v) => v.id),
      passes: r.passes.map((v) => v.id),
    };
  }, `[${VIEWPORT_ATTR}]`);
  // Health: the rule ran on the element (a pass, not "inapplicable").
  expect(found.violations).toEqual([]);
  expect(found.passes).toEqual(["scrollable-region-focusable"]);
}

/** A mouse click on the page view focuses it without drawing the ring. */
export async function proveNoRingOnClick(page: Page) {
  const viewport = page.locator(`[${VIEWPORT_ATTR}]`);
  // Blur first, so the click is what moves focus, then click the wash at
  // the view's edge (the page sheet sits inside its padding), on screen.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await viewport.scrollIntoViewIfNeeded();
  const box = (await viewport.boundingBox())!;
  await page.mouse.click(box.x + 3, box.y + 40);
  expect(
    await viewport.evaluate((v) => [
      document.activeElement === v,
      getComputedStyle(v).outlineStyle,
    ]),
  ).toEqual([true, "none"]);
}
