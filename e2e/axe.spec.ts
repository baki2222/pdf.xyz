import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { getAllToolSlugs } from "../src/lib/tools";
import { GUIDE_META } from "../src/lib/guides/meta.generated";

/**
 * Every page a visitor lands on passes axe-core's WCAG 2.x A/AA rules, in
 * light and dark, in its idle state (no file loaded).
 *
 * ADDED 2026-11-07, after the wave-2 audit's critic named accessibility "essentially
 * unexamined". A one-off axe run on production then found exactly one
 * defect, on every page: the footer's category links sat inside `<summary>`
 * (nested-interactive) and were under 24px tall (target-size). Nothing
 * held the site to axe, so nothing would have caught the next one.
 *
 * THE SET IS DERIVED: every catalogue tool page, plus the routes that are not
 * tools. A tool added tomorrow is checked by existing. The positive
 * control below proves the rules are live: a run that finds nothing on a page
 * with a planted defect would make every pass here meaningless.
 */
const fromRoot = createRequire(join(process.cwd(), "package.json"));
const AXE = fromRoot.resolve("axe-core/axe.min.js");

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const PAGES = [
  "/",
  "/tools",
  "/workspace",
  "/privacy",
  `/guides/${GUIDE_META[0]!.slug}`,
  ...getAllToolSlugs().map((slug) => `/tools/${slug}`),
];

interface Violation {
  id: string;
  impact: string | null;
  nodes: string[];
}

async function violations(page: Page): Promise<Violation[]> {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (tags) => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            ctx: Document,
            opts: object,
          ) => Promise<{
            violations: {
              id: string;
              impact: string | null;
              nodes: { target: string[] }[];
            }[];
          }>;
        };
      }
    ).axe;
    const r = await axe.run(document, {
      runOnly: { type: "tag", values: tags },
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
    }));
  }, TAGS);
}

test.describe("accessibility: axe WCAG 2.x A/AA on every landing page", () => {
  test("health: the set holds every catalogue tool and the other routes", () => {
    expect(getAllToolSlugs().length).toBeGreaterThanOrEqual(50);
    expect(PAGES.length).toBe(getAllToolSlugs().length + 5);
  });

  test("POSITIVE CONTROL: a planted nested control and a tiny target are found", async ({
    page,
  }) => {
    await page.goto("/privacy");
    await page.evaluate(() => {
      const details = document.createElement("details");
      details.innerHTML =
        '<summary>Planted <a href="#x">link</a></summary><p>x</p>';
      const tiny = document.createElement("button");
      tiny.textContent = "x";
      tiny.setAttribute(
        "style",
        "width:8px;height:8px;padding:0;font-size:6px;position:absolute;top:0;left:0",
      );
      const near = tiny.cloneNode(true) as HTMLElement;
      near.style.left = "9px";
      document.body.append(details, tiny, near);
    });
    const ids = (await violations(page)).map((v) => v.id);
    expect(ids).toContain("nested-interactive");
    expect(ids).toContain("target-size");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`every landing page passes (${scheme})`, async ({ browser }) => {
      test.setTimeout(PAGES.length * 6_000);
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      const failures: string[] = [];
      for (const path of PAGES) {
        const response = await page.goto(path, { waitUntil: "load" });
        expect(response?.status(), path).toBe(200);
        for (const v of await violations(page))
          failures.push(
            `${path}: ${v.id} (${v.impact}) at ${v.nodes.join(" | ")}`,
          );
      }
      await context.close();
      expect(failures, failures.join("\n")).toEqual([]);
    });
  }
});
