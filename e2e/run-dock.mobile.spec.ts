import { test, expect, type Page } from "@playwright/test";
import { uploadFiles, writeTempPdf } from "./helpers";

/**
 * On a phone the run is never a scroll away from its options (redesign
 * WP-08, `RunBar`): the runner's action row docks to the bottom of the
 * screen while the runner is in view — the same button, not a copy — above
 * the consent banner while that is open. And it never hides the control
 * the keyboard is on (WCAG 2.4.11): the page's scroll padding is the dock's
 * height plus the banner's, both published at runtime.
 *
 * Watermark PDF at 390px: its options are taller than the screen, and the
 * consent banner is left OPEN — the worst case, both covering the bottom.
 */

const PANEL = "[data-tool-panel]";

/**
 * Is the dock held off its place in the runner — docked — right now? Its
 * bottom above the bottom of the column it closes means sticky moved it.
 */
async function docked(page: Page): Promise<boolean> {
  return page.locator("[data-run-dock]").evaluate((el) => {
    const parent = el.parentElement!.getBoundingClientRect();
    return el.getBoundingClientRect().bottom < parent.bottom - 1;
  });
}

/** Resolve once the page has not scrolled for two frames running. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = window.scrollY;
        let still = 0;
        const tick = () => {
          still = window.scrollY === last ? still + 1 : 0;
          last = window.scrollY;
          if (still >= 2) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** Where the bottom of the screen starts being covered: the dock or the banner. */
async function coveredFrom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const tops = [
      document.querySelector("[data-run-dock]"),
      document.querySelector('section[aria-label="Analytics consent"]'),
    ]
      .filter((el): el is Element => el !== null)
      .map((el) => el.getBoundingClientRect().top);
    return Math.min(window.innerHeight, ...tops);
  });
}

test.beforeEach(async ({ page }) => {
  const file = await writeTempPdf("mark.pdf", 2);
  await page.goto("/tools/watermark-pdf");
  await uploadFiles(page, file);
  await expect(page.getByText("mark.pdf", { exact: true })).toBeVisible();
  // The banner is open, and says how much of the screen it covers.
  await expect(
    page.getByRole("region", { name: "Analytics consent" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue("--sf-bottom-inset"),
      ),
    )
    .toMatch(/^\d+(?:\.\d+)?px$/);
});

test("the Run button stays on screen, above the banner, while the options scroll", async ({
  page,
}) => {
  const dock = page.locator("[data-run-dock]");
  const run = dock.getByRole("button", { name: /add watermark/i });
  await expect(run).toBeVisible();
  // The same button the runner renders — one, docked, not a copy.
  await expect(
    page.getByRole("button", { name: /add watermark/i }),
  ).toHaveCount(1);
  expect(await dock.evaluate((el) => getComputedStyle(el).position)).toBe(
    "sticky",
  );

  // At the top of the options, and halfway down them: the button is in
  // the viewport each time, and clear of the banner.
  // From the top of the tool's panel down, 120px at a time, for as long as
  // the runner's own end is still under the covered part of the screen:
  // the button is held in view, above the banner, the whole way.
  await page
    .locator(PANEL)
    .evaluate((el) =>
      el.scrollIntoView({ block: "start", behavior: "instant" }),
    );
  let steps = 0;
  for (;;) {
    // Where the docked bar's bottom sits: the banner's top (its inset), or
    // the screen's bottom without one.
    const { runnerEnd, line } = await page
      .locator("[data-run-dock]")
      .evaluate((el) => ({
        runnerEnd: el.parentElement!.getBoundingClientRect().bottom,
        line:
          document
            .querySelector('section[aria-label="Analytics consent"]')
            ?.getBoundingClientRect().top ?? window.innerHeight,
      }));
    if (runnerEnd <= line + 1) break;
    // Held at the screen's bottom, not sitting at the end of the options.
    expect(await docked(page)).toBe(true);
    const box = (await run.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    const banner = await page
      .getByRole("region", { name: "Analytics consent" })
      .boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(banner!.y);
    steps += 1;
    // `instant`: the page scrolls smoothly by default, and a measure taken
    // mid-glide is a measure of nothing.
    await page.evaluate(() =>
      window.scrollBy({ top: 120, behavior: "instant" }),
    );
  }
  // Health: it was docked for at least one position (the runner's end below
  // the covered line at the panel's top), so the loop checked something.
  expect(steps).toBeGreaterThanOrEqual(1);
});

test("CONTROL: past the runner, the bar is back in its place, not pinned over the page", async ({
  page,
}) => {
  // Scrolled to the page's end, the runner is above the fold: a bar still
  // docked there would cover unrelated content. The same measure that says
  // "docked" above says "in place" here, so it can tell the two apart.
  await page.evaluate(() =>
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "instant",
    }),
  );
  expect(await docked(page)).toBe(false);
});

test("tabbing through the options, no focused control is under the dock or the banner", async ({
  page,
}) => {
  // From the top of the panel, forward to the Run button.
  await page
    .locator(PANEL)
    .evaluate((el) => el.scrollIntoView({ behavior: "instant" }));
  await page.locator(`${PANEL} input, ${PANEL} button`).first().focus();
  const seen: string[] = [];
  const covered: string[] = [];
  for (let i = 0; i < 60; i++) {
    const where = await page.evaluate((panel) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !el.closest(panel)) return null;
      const r = el.getBoundingClientRect();
      return {
        name:
          el.getAttribute("aria-label") ??
          el.textContent?.trim().slice(0, 40) ??
          el.tagName,
        bottom: r.bottom,
        inDock: el.closest("[data-run-dock]") !== null,
        run: el.hasAttribute("data-run-trigger"),
      };
    }, PANEL);
    if (!where) break;
    seen.push(where.name);
    if (!where.inDock && where.bottom > (await coveredFrom(page)) + 0.5)
      covered.push(`${where.name} (bottom ${where.bottom})`);
    if (where.run) break;
    await page.keyboard.press("Tab");
    // The page scrolls a focused control into view SMOOTHLY: measure once
    // the glide has stopped, not halfway through it.
    await settled(page);
  }
  // Health: the walk went through the options and reached Run.
  expect(seen.length).toBeGreaterThanOrEqual(5);
  expect(seen.at(-1)).toMatch(/add watermark/i);
  expect(
    covered,
    "focused controls hidden under the dock or the banner",
  ).toEqual([]);
});
