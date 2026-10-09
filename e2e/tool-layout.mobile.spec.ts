import { expect, test, type Page } from "@playwright/test";
import { getAllToolSlugs, getToolsByCategory } from "../src/lib/tools";
import { categories } from "../src/lib/tools/categories";
import { categoryHref } from "../src/lib/tools/category-href";
import { getRunnerKind } from "../src/lib/pdf/registry";
import { processingSplit } from "../src/lib/tools/processing-split";
import { whereItRuns } from "../src/lib/tools/where-it-runs";
import { waitForHydration } from "./helpers";
import { panelDispatchArms } from "../src/tests/worker-panel-dispatch";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The working surface above the fold on a phone (390×844, the `mobile`
 * project). Each number is a page-coordinate measured in a real browser
 * after load, never inferred from class names.
 *
 * Measured on the build before WP-06 (2026-10-10, design/batch-b @ 8d4888a9):
 *
 *     /tools            first tool card at 724px
 *     /                 the toolbox section 3,678px tall
 *     /tools/word-to-pdf  the worker panel at 2,192px (under the whole intro)
 *     /tools/ocr-pdf      the worker panel at 2,511px
 *     /tools/merge-pdf    the runner panel at 342px (already above the fold)
 *
 * The redesign spec also asks for the word-to-pdf panel's DropSheet under
 * 420px. That drop zone does not exist yet: the Office panel mounts its
 * picker only once `/api/worker/status` answers ready, and a local build has
 * no worker. What this package controls is where the PANEL sits — head, then
 * panel, then the details — and that is what is held here; the DropSheet's
 * own position binds with the panel redesign that renders it on the server.
 */

/** Top of the first element matching `selector`, in page coordinates. */
async function topOf(page: Page, selector: string): Promise<number> {
  const el = page.locator(selector).first();
  await el.waitFor({ state: "attached" });
  return el.evaluate((node) =>
    Math.round(node.getBoundingClientRect().top + window.scrollY),
  );
}

test("/tools: the first tool card starts above 560px", async ({ page }) => {
  await page.goto("/tools");
  const top = await page
    .getByRole("main")
    .locator('a[href^="/tools/"]')
    .evaluateAll((links) => {
      const first = links.find((a) =>
        /^\/tools\/[a-z0-9-]+$/.test(a.getAttribute("href") ?? ""),
      );
      return first
        ? Math.round(first.getBoundingClientRect().top + window.scrollY)
        : null;
    });
  expect(top, "no tool card found on /tools").not.toBeNull();
  expect(top!).toBeLessThan(560);
});

test("/: the toolbox section is at most 1,100px tall, and still links every tool", async ({
  page,
}) => {
  await page.goto("/");
  const toolbox = page.locator("section#tools");
  const height = await toolbox.evaluate((el) =>
    Math.round(el.getBoundingClientRect().height),
  );
  expect(height).toBeLessThanOrEqual(1100);
  // Hidden on a phone is not removed: every tool is still linked in the HTML.
  const hrefs = await toolbox
    .locator('a[href^="/tools/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  const linked = new Set(hrefs);
  const missing = getAllToolSlugs().filter(
    (slug) => !linked.has(`/tools/${slug}`),
  );
  expect(missing).toEqual([]);
});

/*
 * WHAT THE TITLE CLAIMED AND THE TEST DID NOT (review of WP-06, 2026-10-10):
 * this test was named "…and a link to all of them" and asserted only the
 * heading's href. On a phone that heading is the card's sole way to the
 * category, and it looks like plain text — no arrow, no underline, no accent,
 * and touch has no hover — while "View all" is hidden below `sm`. So a card
 * showing 3 of 7 tools gave no visible way to the other 4, with this test
 * green. It now finds the link a reader sees, by its words, on screen.
 */
test("/: on a phone each toolbox card shows its first three tools and a visible link to all of them", async ({
  page,
}) => {
  await page.goto("/");
  const toolbox = page.locator("section#tools");
  for (const category of categories) {
    const count = getToolsByCategory(category.id).length;
    const heading = toolbox.getByRole("heading", {
      level: 3,
      name: new RegExp(`^${escapeRegExp(category.name)}`),
    });
    await expect(heading, category.id).toBeVisible();
    await expect(heading.getByRole("link"), category.id).toHaveAttribute(
      "href",
      categoryHref(category.id),
    );
    // The card is the heading's nearest ancestor that also holds the rows.
    const card = heading.locator(
      "xpath=ancestor::*[.//a[starts-with(@href, '/tools/') and not(contains(@href, '/category/'))]][1]",
    );
    const shown = await card
      .locator('a[href^="/tools/"]:not([href*="/category/"])')
      .evaluateAll(
        (links) =>
          links.filter((a) => (a as HTMLElement).offsetParent !== null).length,
      );
    expect(shown, category.id).toBe(Math.min(3, count));
    // The way to the rest: a link a reader SEES, saying how many there are
    // and naming the category, under the rows. Visible is the property: the
    // heading's link alone passed every check here while reading as text.
    const all = card
      .getByRole("link", { name: new RegExp(`^All ${count} `) })
      .filter({ visible: true });
    await expect(all, category.id).toHaveCount(1);
    await expect(all, category.id).toHaveAttribute(
      "href",
      categoryHref(category.id),
    );
    expect(
      (await all.textContent())?.toLowerCase(),
      `${category.id}: the link does not name its category`,
    ).toContain(category.name.toLowerCase());
    const [rows, link] = await Promise.all([
      card
        .locator('a[href^="/tools/"]:not([href*="/category/"])')
        .evaluateAll((links) =>
          Math.max(
            ...links
              .filter((a) => (a as HTMLElement).offsetParent !== null)
              .map((a) => a.getBoundingClientRect().bottom),
          ),
        ),
      all.evaluate((a) => a.getBoundingClientRect().top),
    ]);
    expect(
      link,
      `${category.id}: the link is not under the rows`,
    ).toBeGreaterThanOrEqual(rows - 1);
  }
});

/**
 * The /tools filter rows on a phone are single lines that scroll sideways.
 * A deep link's choice must be ON SCREEN once the page has applied it.
 *
 * WHAT SHIPPED (review of WP-06, 2026-10-10, 390x844, production build):
 * before WP-06 the chips wrapped, so the pressed one was always in view.
 * WP-06 made each row one sideways-scrolling line and nothing brought the
 * active chip into view: `?runs=ai` left the checked "AI 4" radio at
 * x=680, `?runs=secure-worker` at 516, `?category=ai` the "AI" chip at 884,
 * `?category=security` at 675 — all past the 390px screen. The reader saw
 * "All" and "All tools" looking unselected over a filtered grid.
 *
 * Every choice is a case, derived from the partition and the categories,
 * never typed. A choice that is on screen with the row unscrolled must leave
 * the row unscrolled, so its label stays in view (the control: `?category=
 * organize`, `?runs=never-uploads`); one that is not must be scrolled to,
 * sideways only, clear of the row's edge fade. The health check below proves
 * both kinds are in the set, so neither half passes for want of a case.
 */
const RUNS_OPTIONS = whereItRuns(processingSplit());
const FILTER_LINKS = [
  ...RUNS_OPTIONS.map((option) => ({
    query: `?runs=${option.id}`,
    group: () => ({ role: "radiogroup" as const, name: "Where it runs" }),
    active: "label:has(input:checked)",
  })),
  ...categories.map((category) => ({
    query: `?category=${category.id}`,
    group: () => ({ role: "group" as const, name: "Filter by category" }),
    active: 'button[aria-pressed="true"]',
  })),
];

/** Where the active control sits in its row, read in the browser. */
interface RowReading {
  /** Its edges in the viewport. */
  left: number;
  right: number;
  /** Its start and end in the row's scroll coordinates. */
  start: number;
  end: number;
  scrollLeft: number;
  clientWidth: number;
  /** The row's own inset: its scroll-padding. */
  padLeft: number;
  padRight: number;
  innerWidth: number;
  scrollY: number;
  /** The row's label, in the viewport. */
  label: { left: number; right: number } | null;
}

for (const link of FILTER_LINKS) {
  test(`/tools${link.query}: the chosen filter is on screen, and the row scrolls only when it must`, async ({
    page,
  }) => {
    await page.goto(`/tools${link.query}`);
    const { role, name } = link.group();
    const row = page.getByRole(role, { name });
    // Applied: the deep link's choice is the active control.
    await expect(row.locator(link.active)).toHaveCount(1);
    await waitForHydration(row.locator(link.active));
    const read = () =>
      row.evaluate((el, selector): RowReading => {
        const active = el.querySelector(selector)!;
        const box = active.getBoundingClientRect();
        const rowBox = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const label = el.firstElementChild?.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          start: box.left - rowBox.left + el.scrollLeft,
          end: box.right - rowBox.left + el.scrollLeft,
          scrollLeft: el.scrollLeft,
          clientWidth: el.clientWidth,
          padLeft: parseFloat(style.scrollPaddingLeft) || 0,
          padRight: parseFloat(style.scrollPaddingRight) || 0,
          innerWidth: window.innerWidth,
          scrollY: window.scrollY,
          label: label ? { left: label.left, right: label.right } : null,
        };
      }, link.active);
    // The reveal runs after hydration; give it a frame or two to land.
    await expect
      .poll(async () => {
        const r = await read();
        return r.left >= 0 && r.right <= r.innerWidth;
      })
      .toBe(true);
    const r = await read();
    expect(r.innerWidth, "the phone viewport did not apply").toBe(390);
    const fitsUnscrolled = r.end <= r.clientWidth - r.padRight;
    // Never a vertical scroll: revealing a chip must not move the page.
    expect(r.scrollY, "the page scrolled vertically").toBe(0);
    if (fitsUnscrolled) {
      // On screen as served: the row stays put and its label stays in view.
      expect(r.scrollLeft, "a choice already in view scrolled the row").toBe(0);
      expect(r.label, "the row has no label").not.toBeNull();
      expect(r.label!.left).toBeGreaterThanOrEqual(0);
      expect(r.label!.right).toBeLessThanOrEqual(r.innerWidth);
    } else {
      // Scrolled to, wholly, and clear of the fade at either end.
      expect(r.left, "under the row's left edge").toBeGreaterThanOrEqual(
        r.padLeft - 1,
      );
      expect(r.right, "under the row's right edge").toBeLessThanOrEqual(
        r.clientWidth - r.padRight + 1,
      );
    }
  });
}

test("health: the filter deep links include choices on screen as served and choices that need the row scrolled", async ({
  page,
}) => {
  // Measured here rather than read from the cases above (each runs in its own
  // worker): where every choice sits with the row unscrolled. Both kinds must
  // exist, or one half of the test above is checked over nothing.
  await page.goto("/tools");
  const positions = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="radiogroup"] label, [role="group"][aria-label="Filter by category"] button',
      ),
    ].map((el) => {
      const row = el.closest<HTMLElement>(
        '[role="radiogroup"], [role="group"]',
      )!;
      return {
        row: row.getAttribute("role"),
        text: el.textContent?.trim() ?? "",
        right: el.getBoundingClientRect().right,
        width: row.clientWidth,
      };
    }),
  );
  expect(positions.length).toBe(
    RUNS_OPTIONS.length + 1 + categories.length + 1,
  );
  const offScreen = positions.filter((p) => p.right > p.width);
  const onScreen = positions.filter((p) => p.right <= p.width);
  // The reviewer's cases: AI, last in each row, starts off screen in both.
  for (const role of ["radiogroup", "group"]) {
    expect(
      offScreen.filter((p) => p.row === role).map((p) => p.text),
      role,
    ).toContainEqual(expect.stringMatching(/^AI/));
    expect(
      onScreen.filter((p) => p.row === role),
      role,
    ).not.toEqual([]);
  }
});

for (const slug of ["merge-pdf", "word-to-pdf", "ocr-pdf"]) {
  test(`/tools/${slug}: the tool's panel starts above 400px`, async ({
    page,
  }) => {
    await page.goto(`/tools/${slug}`);
    expect(await topOf(page, "[data-tool-panel]")).toBeLessThan(400);
  });
}

test("every tool page fits a phone: its facts row never scrolls and the page never scrolls sideways", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const slugs = getAllToolSlugs();
  // Health: both layouts are in the set, so neither is checked vacuously.
  expect(slugs.some((slug) => getRunnerKind(slug))).toBe(true);
  expect(slugs.some((slug) => !getRunnerKind(slug))).toBe(true);
  const overflowing: string[] = [];
  for (const slug of slugs) {
    await page.goto(`/tools/${slug}`, { waitUntil: "domcontentloaded" });
    const fit = await page.evaluate(() => {
      const facts = document.querySelector("[data-tool-facts]");
      return {
        facts: facts ? facts.scrollWidth - facts.clientWidth : null,
        page:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      };
    });
    if (fit.facts === null) overflowing.push(`${slug}: no facts row`);
    else if (fit.facts > 0)
      overflowing.push(`${slug}: facts row ${fit.facts}px too wide`);
    if (fit.page > 0) overflowing.push(`${slug}: page ${fit.page}px too wide`);
  }
  expect(overflowing).toEqual([]);
});

/**
 * Every worker tool's status slot is ONE box on a phone: the same height
 * while it checks, when the check fails, when the worker is not enabled, and
 * when it is ready — so the answer moves nothing under it.
 *
 * Each panel reserves that height with a measured constant
 * (`STATUS_SLOT` in its module, per breakpoint — see `WorkerStatusSlot`). A
 * constant has no relationship to keep it right, so this is its second,
 * independent bound: every slug the registry routes (not one per panel —
 * Protect and Unlock share a panel and differ by a strength picker), at the
 * width each phone reserve was measured for (360) and the one every layout
 * is drawn at (390). A run area that outgrows its reserve fails here by
 * name, with the four heights.
 *
 * WHAT SHIPPED (review of WP-06, 2026-10-10): the checking box was a bare
 * `min-h-32` (128px) and the run area up to 718px, directly under the tool's
 * name on a phone; CLS 0.0582 on Protect PDF at 390 with a ready answer.
 */
const WORKER_SLUGS = panelDispatchArms().flatMap((arm) => arm.slugs);

declare global {
  interface Window {
    __releaseStatus?: () => void;
  }
}

type StatusStep = "hold-then-fail" | "local" | "ready";

/** Answer `/api/worker/status` by plan, in the page (no `page.route`). */
async function planStatus(page: Page, plan: StatusStep[]): Promise<void> {
  await page.addInitScript(
    ({ plan, ready }) => {
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      window.__releaseStatus = () => release();
      let asked = 0;
      const real = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
          location.href,
        );
        if (url.pathname !== "/api/worker/status") return real(input, init);
        const step = plan[Math.min(asked++, plan.length - 1)];
        if (step === "hold-then-fail") {
          await held;
          throw new TypeError("Failed to fetch");
        }
        if (step === "ready")
          return new Response(ready, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        return real(input, init);
      };
    },
    { plan, ready: JSON.stringify(READY_WORKER_STATUS) },
  );
}

const slotHeight = (page: Page) =>
  page
    .locator('[data-slot="worker-status"]')
    .evaluate((el) => Math.round(el.getBoundingClientRect().height * 10) / 10);

for (const width of [360, 390]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });

    test(`health: every routed worker slug is in the set (${WORKER_SLUGS.length})`, () => {
      expect(WORKER_SLUGS.length).toBe(
        getAllToolSlugs().filter((slug) => !getRunnerKind(slug)).length,
      );
    });

    for (const slug of WORKER_SLUGS) {
      test(`/tools/${slug} at ${width}px: the worker status slot is one box — checking, failed, not enabled, ready`, async ({
        page,
      }) => {
        const slot = page.locator('[data-slot="worker-status"]');
        // Checking → failed → (Check again) → this server's answer.
        await planStatus(page, ["hold-then-fail", "local"]);
        await page.goto(`/tools/${slug}`);
        await waitForHydration(slot);
        await expect(slot).toHaveAttribute("data-state", "loading");
        const loading = await slotHeight(page);
        await page.evaluate(() => window.__releaseStatus?.());
        await expect(slot).toHaveAttribute("data-state", "error");
        const failed = await slotHeight(page);
        await slot.getByRole("button", { name: /check again/i }).click();
        await expect(slot).toHaveAttribute("data-state", "off");
        const off = await slotHeight(page);
        // A ready deployment, on a fresh page.
        const ready = await page.context().newPage();
        await planStatus(ready, ["ready"]);
        await ready.goto(`/tools/${slug}`);
        await expect(
          ready.locator('[data-slot="worker-status"]'),
        ).toHaveAttribute("data-state", "run");
        const run = await slotHeight(ready);
        const widths = await ready.evaluate(() => ({
          inner: window.innerWidth,
          page: document.documentElement.scrollWidth,
        }));
        await ready.close();
        // Health: the width asked for, and a ready run area that fits it
        // (AI Extract's did not: 473px at 390, until this package).
        expect(widths).toEqual({ inner: width, page: width });
        const heights = { loading, failed, off, run };
        expect(loading, "no slot on screen").toBeGreaterThan(100);
        expect(
          Math.max(loading, failed, off, run) -
            Math.min(loading, failed, off, run),
          `${slug} at ${width}px: ${JSON.stringify(heights)} — re-measure this panel's STATUS_SLOT`,
        ).toBeLessThanOrEqual(1);
      });
    }
  });
}
