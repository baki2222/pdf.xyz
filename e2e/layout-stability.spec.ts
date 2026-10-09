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
 *    on it would delay the paint the page is judged by. Motion is RECORDED
 *    as it starts (CSS animations, CSS transitions, `Element.animate()`),
 *    not sampled at the end: a finished `fill: none` animation is gone from
 *    `getAnimations()` long before the measurement reads it.
 *
 * Observation is installed with `addInitScript`, so it runs before the page's
 * own code, and every shift records where it came from as a selector at the
 * moment it happened (the nodes can be gone by the time the test reads them).
 * A failure prints those selectors, how far each moved, and whether the web
 * fonts had loaded. The positive controls at the bottom inject a shift, a
 * moving reserved slot, a bigger paint and an animation, and go through the
 * SAME measurement as the real pages; the animations among them are short
 * and over before the read, so they pass only through the recorder.
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

/**
 * One motion, recorded the moment it STARTED: a CSS animation
 * (`animationstart`), a CSS transition (`transitionstart`) or a script
 * animation (`Element.prototype.animate`). `lineage` is whether its target
 * contains the H1 or sits inside it, judged then if the H1 was already parsed
 * and otherwise at read time (the element is kept for that).
 */
interface MotionRecord {
  kind: "animation" | "transition" | "animate()";
  name: string;
  selector: string;
  /** ms since navigation. */
  at: number;
  lineage: boolean | null;
}

declare global {
  interface Window {
    __shifts?: ShiftRecord[];
    __lcp?: LcpRecord[];
    __h1Motion?: MotionRecord[];
    __motionTargets?: Element[];
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
  // Motion is recorded WHILE IT HAPPENS. An end-of-run `getAnimations()` scan
  // cannot see an entrance animation: with the default `fill: none` it has
  // finished and left the list long before load, hydration, a scroll and a
  // settle are over — measured 2026-10-09, a 600 ms animation on the H1's
  // parent read as "nothing animates". All motion is recorded here, with its
  // target, and the test keeps the ones in the H1's lineage.
  window.__h1Motion = [];
  window.__motionTargets = [];
  const note = (
    target: EventTarget | null,
    kind: MotionRecord["kind"],
    name: string,
  ) => {
    if (!(target instanceof Element)) return;
    const h1 = document.querySelector("main h1");
    window.__h1Motion!.push({
      kind,
      name,
      selector: describe(target),
      at: Math.round(performance.now()),
      lineage: h1 ? target.contains(h1) || h1.contains(target) : null,
    });
    window.__motionTargets!.push(target);
  };
  document.addEventListener(
    "animationstart",
    (e) => note(e.target, "animation", e.animationName),
    true,
  );
  document.addEventListener(
    "transitionstart",
    (e) => note(e.target, "transition", e.propertyName),
    true,
  );
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (
    this: Element,
    ...args: Parameters<Element["animate"]>
  ) {
    const [, options] = args;
    note(
      this,
      "animate()",
      typeof options === "object" && options?.id ? options.id : "",
    );
    return animate.apply(this, args);
  };
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
  /**
   * Motion whose target contains the H1 or sits inside it: every one the
   * recorder saw START, plus any still running at the end.
   */
  animated: string[];
  /** Every motion the recorder saw start, anywhere on the page. */
  motionSeen: number;
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
  const { shifts, lcp, animated, motionSeen } = await page.evaluate(() => {
    const h1 = document.querySelector("main h1");
    const inLineage = (t: Element) =>
      h1 != null && (t.contains(h1) || h1.contains(t));
    const motion = window.__h1Motion ?? [];
    const targets = window.__motionTargets ?? [];
    // What the recorder saw start, in the lineage — judged when it started,
    // or now if the H1 was not parsed yet then.
    const recorded = motion
      .filter((m, i) => m.lineage ?? inLineage(targets[i]!))
      .map((m) => `${m.kind} ${m.name} on ${m.selector} at ${m.at}ms`);
    // And what is still running now (an infinite or long animation that the
    // recorder would also have seen start; kept as a second reading).
    const running = document
      .getAnimations()
      .map((a) => (a.effect as KeyframeEffect | null)?.target ?? null)
      .filter((t): t is Element => t instanceof Element && inLineage(t))
      .map(
        (t) =>
          `still running on ${t.tagName.toLowerCase()}${t.id ? `#${t.id}` : ""}`,
      );
    return {
      shifts: window.__shifts ?? [],
      lcp: window.__lcp ?? [],
      animated: h1 ? [...recorded, ...running] : ["(no h1)"],
      motionSeen: motion.length,
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
    motionSeen,
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
      `motion started on the H1, an ancestor or its words (${m.motionSeen} motion(s) recorded on the page)`,
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

    // The animation controls are SHORT and `fill: none`, like a real entrance:
    // each is over long before the measurement reads, so they pass only
    // through the recorder. The control used to be a 120 s animation, still
    // running at the end — which an end-of-run `getAnimations()` scan sees, so
    // it could not fail on the realistic case (2026-10-09: a 600 ms version
    // read 0). Each asserts that nothing was still running, which is what
    // makes it a control of the recorder rather than of the end scan.
    test("a paint bigger than the H1, and a short script animation on its ancestor", async ({
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
              duration: 300,
              fill: "none",
              id: "probe-fade",
            });
        });
      });
      const m = await measure(page, "/", "warm");
      expect(m.lcp.at(-1)?.inH1).toBe(false);
      expect(m.lcp.at(-1)?.selector).toContain("p#probe-big");
      expect(m.animated.join("\n")).toContain("animate() probe-fade on");
      expect(
        m.animated.filter((a) => a.startsWith("still running")),
        "the probe animation was still running when read — it no longer tests the recorder",
      ).toEqual([]);
    });

    test("a short CSS entrance animation and a transition on the H1", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        window.addEventListener("load", () => {
          const style = document.createElement("style");
          style.textContent =
            "@keyframes probe-rise{from{opacity:.5;transform:translateY(8px)}to{opacity:1;transform:none}}";
          document.head.append(style);
          const h1 = document.querySelector<HTMLElement>("main h1");
          if (!h1) return;
          h1.style.animation = "probe-rise 300ms ease-out";
          // A transition needs a style change after the transition is set.
          h1.style.transition = "letter-spacing 200ms";
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              h1.style.letterSpacing = "0.01em";
            }),
          );
        });
      });
      const m = await measure(page, "/", "warm");
      const seen = m.animated.join("\n");
      expect(seen).toMatch(/animation probe-rise on .*\bh1\b/);
      expect(seen).toMatch(/transition letter-spacing on .*\bh1\b/);
      expect(
        m.animated.filter((a) => a.startsWith("still running")),
        "a probe was still running when read — it no longer tests the recorder",
      ).toEqual([]);
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
