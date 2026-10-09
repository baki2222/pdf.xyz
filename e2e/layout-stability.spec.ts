import { expect, test, type Page } from "@playwright/test";
import { waitForHydration } from "./helpers";

/**
 * Layout stability, measured in a real browser through load, hydration and a
 * slow scroll to the bottom — the instrument the redesign's client islands
 * (a desk that swaps content, recents and sample slots, a mobile run dock)
 * are held to before any of them exists.
 *
 *  - CLS: the SUM of every layout shift not caused by input, which is never
 *    less than the session-window CLS a browser reports, so ≤ 0.01 here is
 *    the stricter bound.
 *  - Reserved slots: ZERO shifts may be sourced inside `[data-desk]`,
 *    `[data-slot]` or `[data-run-dock]`. None of those exist on 2026-10-09,
 *    so this part binds from the package that adds the first one; the CLS
 *    bound binds today.
 *  - LCP on `/`: the largest paint is the H1 (or inside it), and nothing in
 *    its lineage animates — the H1 is the promise, and an entrance animation
 *    on it would delay the paint the page is judged by.
 *
 * Observation is installed with `addInitScript`, so it runs before the page's
 * own code, and every shift records where it came from as a selector at the
 * moment it happened (the nodes can be gone by the time the test reads them).
 * A failure prints those selectors, how far each moved, and whether the web
 * fonts had loaded. The positive controls at the bottom inject a shift, a
 * moving reserved slot, a bigger paint and an animation, and go through the
 * SAME measurement as the real pages.
 *
 * FONT TIMING IS CHOSEN, NEVER LEFT TO CHANCE. Every shift measured on
 * 2026-10-09 was a `display: swap` font replacing its fallback, and whether
 * that lands after first paint depended on CPU contention: the same 404 read
 * CLS 0.0000 in one run and 0.0300 in the next. A measurement that flips with
 * the machine's load is not an instrument, so each run fixes the timing:
 *
 *  - WARM (the gate, every run): the route is visited once so its fonts are
 *    cached, then measured. What moves then is layout code — the client
 *    islands this spec exists for — and the figure repeats on any machine.
 *  - LATE (`FONTS_LATE=1`, on demand): every font response is held back
 *    {@link FONT_DELAY_MS}, so the swap always lands after first paint — a
 *    first visit on a slow connection. NOT a CI gate, because what a swap
 *    moves depends on the fallback face, and the fallback is a platform font
 *    (`adjustFontFallback: "Arial"` resolves to a different face, or none, on
 *    Linux). Measured on Windows Chromium 2026-10-09: home 0.0004, /tools
 *    0.0007, merge 0.0006, OCR 0.0041-0.0076, the first guide 0.0164 and the
 *    404 0.0335 — the last two are the display-face headings re-wrapping.
 *    Those two are a real first-visit defect, recorded in {@link LATE_FONT_DEFECTS}.
 */

const MAX_CLS = 0.01;
const FONT_DELAY_MS = 400;
const FONTS_LATE = !!process.env.FONTS_LATE;

/**
 * Routes whose first-visit CLS exceeds the bound when fonts arrive late, with
 * the reason. Measured, not fixed here: WP-01 changes nothing visible but the
 * reduced-motion reset, and the headings involved are the type work of the
 * next package. Under `FONTS_LATE=1` these are expected to fail (and the run
 * goes red the day one stops failing, so the record cannot go stale).
 */
const LATE_FONT_DEFECTS: Record<string, string> = {
  "a guide":
    "the guide H1 (display face) wraps differently in the fallback: its intro moves up 28-84px when the face swaps in",
  "404":
    "the 404's centred column re-centres when the display face swaps in: CLS 0.0335",
};
const RESERVED = "[data-desk], [data-slot], [data-run-dock]";

interface ShiftRecord {
  value: number;
  hadRecentInput: boolean;
  /** ms since navigation, and whether every web font had loaded by then. */
  at: number;
  fonts: string;
  sources: { selector: string; reserved: boolean; move: string }[];
}

interface LcpRecord {
  selector: string;
  inH1: boolean;
  size: number;
}

declare global {
  interface Window {
    __shifts?: ShiftRecord[];
    __lcp?: LcpRecord[];
  }
}

/** Runs in the page, before its own scripts. */
function observe(reserved: string) {
  const describe = (node: Node | null | undefined): string => {
    const start =
      node instanceof Element ? node : (node?.parentElement ?? null);
    if (!start) return String(node?.nodeName ?? "?");
    const parts: string[] = [];
    let el: Element | null = start;
    while (el && parts.length < 4) {
      let part = el.tagName.toLowerCase();
      if (el.id) part += `#${el.id}`;
      const cls = (el.getAttribute("class") ?? "").trim().split(/\s+/)[0];
      if (cls) part += `.${cls}`;
      parts.unshift(part);
      el = el.parentElement;
    }
    return parts.join(" > ");
  };
  const elementOf = (node: Node | null | undefined): Element | null =>
    node instanceof Element ? node : (node?.parentElement ?? null);
  window.__shifts = [];
  window.__lcp = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as unknown as {
      value: number;
      hadRecentInput: boolean;
      startTime: number;
      sources?: {
        node?: Node | null;
        previousRect: DOMRectReadOnly;
        currentRect: DOMRectReadOnly;
      }[];
    }[]) {
      window.__shifts!.push({
        value: entry.value,
        hadRecentInput: entry.hadRecentInput,
        at: Math.round(entry.startTime),
        fonts: document.fonts.status,
        sources: (entry.sources ?? []).map((s) => ({
          selector: describe(s.node),
          reserved: elementOf(s.node)?.closest(reserved) != null,
          move: `${Math.round(s.currentRect.x - s.previousRect.x)},${Math.round(s.currentRect.y - s.previousRect.y)} ${Math.round(s.previousRect.width)}->${Math.round(s.currentRect.width)}w`,
        })),
      });
    }
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as unknown as {
      element?: Element | null;
      size: number;
    }[]) {
      window.__lcp!.push({
        selector: describe(entry.element),
        inH1: entry.element?.closest("h1") != null,
        size: entry.size,
      });
    }
  }).observe({ type: "largest-contentful-paint", buffered: true });
}

interface Measurement {
  status: number | null;
  cls: number;
  counted: ShiftRecord[];
  inReserved: ShiftRecord[];
  lcp: LcpRecord[];
  /** Animations whose target contains the H1 or sits inside it. */
  animated: string[];
}

type FontTiming = "warm" | "late";

/**
 * Load, wait for hydration, scroll slowly to the bottom, then read the record.
 * `warm` visits the route once first, so its fonts are cached when the
 * measured load paints; `late` holds every font response back.
 */
async function measure(
  page: Page,
  url: string,
  fonts: FontTiming,
): Promise<Measurement> {
  if (fonts === "warm") {
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
  } else {
    await page.route(/\.woff2(?:\?.*)?$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, FONT_DELAY_MS));
      await route.continue();
    });
  }
  const res = await page.goto(url, { waitUntil: "load" });
  await waitForHydration(page.locator("main"));
  await page.waitForLoadState("networkidle");
  // 300px every 60ms, like a reader, so lazy content and scroll-linked rules
  // react at every position.
  for (let step = 0; step < 200; step++) {
    const atBottom = await page.evaluate(() => {
      window.scrollBy(0, 300);
      return (
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 1
      );
    });
    await page.waitForTimeout(60);
    if (atBottom) break;
  }
  await page.waitForTimeout(500);
  const { shifts, lcp, animated } = await page.evaluate(() => {
    const h1 = document.querySelector("main h1");
    return {
      shifts: window.__shifts ?? [],
      lcp: window.__lcp ?? [],
      animated: h1
        ? document
            .getAnimations()
            .map((a) => (a.effect as KeyframeEffect | null)?.target ?? null)
            .filter(
              (t): t is Element =>
                t instanceof Element && (t.contains(h1) || h1.contains(t)),
            )
            .map((t) => t.tagName.toLowerCase() + (t.id ? `#${t.id}` : ""))
        : ["(no h1)"],
    };
  });
  const counted = shifts.filter((s) => !s.hadRecentInput);
  return {
    status: res?.status() ?? null,
    cls: counted.reduce((sum, s) => sum + s.value, 0),
    counted,
    inReserved: shifts.filter((s) => s.sources.some((x) => x.reserved)),
    lcp,
    animated,
  };
}

function report(records: ShiftRecord[]): string {
  return records
    .map(
      (s) =>
        `  ${s.value.toFixed(4)} at ${s.at}ms, fonts ${s.fonts}${s.hadRecentInput ? " (input)" : ""}: ${s.sources
          .map(
            (x) =>
              `${x.selector} [${x.move}]${x.reserved ? " [RESERVED SLOT]" : ""}`,
          )
          .join(" | ")}`,
    )
    .join("\n");
}

/**
 * The home page, the explorer, a client and a worker tool page, a guide — the
 * first one the guides index links, so the route follows the catalogue rather
 * than a typed slug — and the 404.
 */
const ROUTES: {
  name: string;
  url: (page: Page) => Promise<string>;
  status: number;
}[] = [
  { name: "home", url: async () => "/", status: 200 },
  { name: "tools explorer", url: async () => "/tools", status: 200 },
  {
    name: "client tool page",
    url: async () => "/tools/merge-pdf",
    status: 200,
  },
  { name: "worker tool page", url: async () => "/tools/ocr-pdf", status: 200 },
  {
    name: "a guide",
    url: async (page) => {
      await page.goto("/guides");
      const href = await page
        .locator('main a[href^="/guides/"]')
        .first()
        .getAttribute("href");
      expect(href, "the guides index links no guide").toMatch(/^\/guides\/.+/);
      return href!;
    },
    status: 200,
  },
  { name: "404", url: async () => "/this-page-does-not-exist", status: 404 },
];

test.describe("layout stability through load, hydration and scroll", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(observe, RESERVED);
  });

  for (const route of ROUTES) {
    test(`${route.name}: CLS ≤ ${MAX_CLS} with fonts cached, and no shift inside a reserved slot`, async ({
      page,
    }, testInfo) => {
      const url = await route.url(page);
      const m = await measure(page, url, "warm");
      expect(m.status).toBe(route.status);
      testInfo.annotations.push({ type: "cls", description: m.cls.toFixed(4) });
      if (m.counted.length > 0)
        testInfo.annotations.push({
          type: "shifts",
          description: report(m.counted),
        });
      expect(
        m.cls,
        `${url}: CLS ${m.cls.toFixed(4)} over ${m.counted.length} shift(s):\n${report(m.counted)}`,
      ).toBeLessThanOrEqual(MAX_CLS);
      expect(
        m.inReserved.length,
        `${url}: a reserved slot moved — reserve its height before it fills:\n${report(m.inReserved)}`,
      ).toBe(0);
    });
  }

  test("home: the LCP is the H1, and nothing in its lineage animates", async ({
    page,
  }) => {
    const m = await measure(page, "/", "warm");
    // Health check: a browser that reported no LCP would pass any assertion
    // about which element it was.
    expect(m.lcp.length, "no largest-contentful-paint entry").toBeGreaterThan(
      0,
    );
    const last = m.lcp[m.lcp.length - 1]!;
    expect(
      last.inH1,
      `the largest paint on / is ${last.selector}, not the H1 (entries: ${m.lcp
        .map((e) => `${e.selector} ${e.size}`)
        .join("; ")})`,
    ).toBe(true);
    expect(
      m.animated,
      "an animation targets the H1, an ancestor or its words",
    ).toEqual([]);
  });

  test.describe("positive controls: each defect, injected, is measured", () => {
    test("a late block above the content, and a reserved slot whose child moves", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        // After hydration and outside React's tree, so nothing reconciles it
        // away. The slot is fixed, so only its own child moves inside it, and
        // the two moves are frames apart: a shift names at most five sources,
        // by impact, and the banner's would crowd the probe out.
        window.addEventListener("load", () =>
          setTimeout(() => {
            const slot = document.createElement("div");
            slot.setAttribute("data-slot", "");
            slot.style.cssText = "position:fixed;top:0;left:0;z-index:99";
            slot.innerHTML = '<p id="probe-child">probe</p>';
            document.body.append(slot);
            setTimeout(() => {
              const spacer = document.createElement("div");
              spacer.style.height = "120px";
              slot.prepend(spacer);
            }, 200);
            setTimeout(() => {
              const banner = document.createElement("div");
              banner.style.height = "300px";
              document.querySelector("main")?.prepend(banner);
            }, 400);
          }, 100),
        );
      });
      const m = await measure(page, "/", "warm");
      expect(m.cls).toBeGreaterThan(MAX_CLS);
      expect(
        m.inReserved.flatMap((s) => s.sources.map((x) => x.selector)).join(" "),
        report(m.counted),
      ).toContain("p#probe-child");
    });

    test("a paint bigger than the H1, and an animation on its ancestor", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        window.addEventListener("load", () => {
          const big = document.createElement("p");
          big.id = "probe-big";
          big.style.cssText =
            "position:fixed;top:0;left:0;margin:0;font-size:140px;line-height:1;z-index:99";
          big.textContent = "A much larger paint than the heading";
          document.body.append(big);
          document
            .querySelector("main h1")
            ?.parentElement?.animate([{ opacity: 0.99 }, { opacity: 1 }], {
              duration: 120_000,
            });
        });
      });
      const m = await measure(page, "/", "warm");
      expect(m.lcp.at(-1)?.inH1).toBe(false);
      expect(m.lcp.at(-1)?.selector).toContain("p#probe-big");
      expect(m.animated.length).toBeGreaterThan(0);
    });
  });
});

test.describe("first visit: fonts arrive after first paint (FONTS_LATE=1)", () => {
  test.skip(
    !FONTS_LATE,
    "on demand: the fallback face is a platform font, so the figure is not comparable across CI and a workstation",
  );
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(observe, RESERVED);
  });

  for (const route of ROUTES) {
    test(`${route.name}: first-visit CLS ≤ ${MAX_CLS}`, async ({
      page,
    }, testInfo) => {
      const defect = LATE_FONT_DEFECTS[route.name];
      // Expected to fail while the defect stands; Playwright reports the day it
      // passes, so the record cannot outlive the fix.
      test.fail(defect !== undefined, defect);
      const m = await measure(page, await route.url(page), "late");
      testInfo.annotations.push({ type: "cls", description: m.cls.toFixed(4) });
      expect(
        m.cls,
        `CLS ${m.cls.toFixed(4)} with fonts late:\n${report(m.counted)}`,
      ).toBeLessThanOrEqual(MAX_CLS);
    });
  }
});
