import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { makePdfBytes, makeScanPdfBytes, waitForHydration } from "./helpers";

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
 *  - LCP on `/`, at a desktop and two phone widths ({@link LCP_DEVICES}):
 *    the largest paint is the H1 (or inside it), and nothing in its lineage
 *    animates — the H1 is the promise, and an entrance animation on it would
 *    delay the paint the page is judged by. Motion is RECORDED
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
  sources: {
    selector: string;
    reserved: boolean;
    /** The `data-slot` it is in (or is), if any. */
    slot: string | null;
    move: string;
  }[];
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
          slot:
            elementOf(s.node)
              ?.closest("[data-slot]")
              ?.getAttribute("data-slot") ?? null,
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
  /** `window.innerWidth` when the record was read, in CSS px. */
  innerWidth: number;
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
  const { shifts, lcp, animated, motionSeen, innerWidth } = await page.evaluate(
    () => {
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
        innerWidth: window.innerWidth,
      };
    },
  );
  const counted = shifts.filter((s) => !s.hadRecentInput);
  return {
    status: res?.status() ?? null,
    cls: counted.reduce((sum, s) => sum + s.value, 0),
    counted,
    inReserved: shifts.filter((s) => s.sources.some((x) => x.reserved)),
    lcp,
    animated,
    motionSeen,
    innerWidth,
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

interface Route {
  name: string;
  url: (page: Page) => Promise<string>;
  status: number;
  /**
   * Health check, run when the measurement ends: the state the URL asks for
   * is the one on screen. A page that IGNORES its query measures perfectly
   * stable — `/tools?accepts=docx` read CLS 0.0000 on the build before WP-03
   * precisely because nothing applied `?accepts=` — so a route that exists to
   * hold a client-filled state must prove the state was filled.
   */
  applied?: (page: Page) => Promise<void>;
}

/**
 * The /tools explorer as a deep link fills it: the server sends the whole
 * catalogue, and the browser replaces it with the answer after hydration
 * (`?accepts=`) and after an on-demand chunk (`?q=`). Measured on the WP-03
 * build before this bound held them: `?accepts=docx` 0.2699 here (0.367 at
 * 390px), `?q=merge` 0.0546 — the surviving server-rendered cards moved up
 * as the sections above them went, the guides aside and the footer rose
 * into view, and the "Takes DOCX" chip pushed the count row sideways.
 */
const EXPLORER_DEEP_LINKS: Route[] = [
  {
    name: "tools explorer, ?accepts=docx",
    url: async () => "/tools?accepts=docx",
    status: 200,
    applied: async (page) => {
      await expect(
        page.getByRole("button", { name: /^Takes DOCX/ }),
      ).toBeVisible();
    },
  },
  {
    name: "tools explorer, ?q=merge",
    url: async () => "/tools?q=merge",
    status: 200,
    applied: async (page) => {
      await expect(
        page.getByRole("heading", {
          level: 2,
          name: "Best matches for “merge”",
        }),
      ).toBeVisible();
    },
  },
];

/**
 * The home page, the explorer (served, and as two deep links fill it), a
 * client and a worker tool page, a guide — the first one the guides index
 * links, so the route follows the catalogue rather than a typed slug — and
 * the 404.
 */
const ROUTES: Route[] = [
  { name: "home", url: async () => "/", status: 200 },
  { name: "tools explorer", url: async () => "/tools", status: 200 },
  ...EXPLORER_DEEP_LINKS,
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

/**
 * Where the home LCP is held: the project's desktop, the phone every layout
 * is drawn at (390, as the `mobile` project emulates it), and the narrowest
 * common phone (360).
 *
 * WHAT SLIPPED THROUGH: this test ran only in the `chromium` project, at
 * 1280x720. On 2026-10-09 the display type step (`--text-display-1`) took
 * the hero H1 from 48px to 40px on a phone, so it wrapped to two lines
 * instead of three, and the lede paragraph out-painted it: measured, the LCP
 * was the `p` at 360, 390, 480 and 640px and the H1 only from 768px up —
 * with this test green. An animation added to the lede would then have
 * delayed every phone's LCP with nothing red. Run against that build, the
 * two phone cases below fail on the `p` and the desktop case passes.
 *
 * The H1's lead at 390 is still thin — about 44,000 px² against the lede's
 * 42,400 with the fonts loaded — so the phone widths are the cases that keep
 * it honest.
 */
const LCP_DEVICES = [
  {
    name: "desktop",
    use: { viewport: { width: 1280, height: 720 } },
  },
  {
    name: "phone",
    use: {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    },
  },
  {
    name: "narrow phone",
    use: {
      viewport: { width: 360, height: 780 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    },
  },
] as const;

/** One route's warm measurement, held to the bound. */
async function expectStable(page: Page, route: Route, testInfo: TestInfo) {
  const url = await route.url(page);
  const m = await measure(page, url, "warm");
  expect(m.status).toBe(route.status);
  await route.applied?.(page);
  testInfo.annotations.push({ type: "cls", description: m.cls.toFixed(4) });
  if (m.counted.length > 0)
    testInfo.annotations.push({
      type: "shifts",
      description: report(m.counted),
    });
  expect(
    m.cls,
    `${url} at ${m.innerWidth}px: CLS ${m.cls.toFixed(4)} over ${m.counted.length} shift(s):\n${report(m.counted)}`,
  ).toBeLessThanOrEqual(MAX_CLS);
  expect(
    m.inReserved.length,
    `${url}: a reserved slot moved — reserve its height before it fills:\n${report(m.inReserved)}`,
  ).toBe(0);
  return m;
}

test.describe("layout stability through load, hydration and scroll", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(observe, RESERVED);
  });

  for (const route of ROUTES) {
    test(`${route.name}: CLS ≤ ${MAX_CLS} with fonts cached, and no shift inside a reserved slot`, async ({
      page,
    }, testInfo) => {
      await expectStable(page, route, testInfo);
    });
  }

  // The explorer's deep links at the phone widths too: there the toolbar
  // stacks, the category chips wrap to several rows, and a chip arriving in
  // the count row moved every one of them down.
  for (const device of LCP_DEVICES.filter((d) => d.name !== "desktop")) {
    test.describe(device.name, () => {
      test.use(device.use);
      for (const route of EXPLORER_DEEP_LINKS) {
        test(`${route.name} at ${device.use.viewport.width}px: CLS ≤ ${MAX_CLS} with fonts cached`, async ({
          page,
        }, testInfo) => {
          const m = await expectStable(page, route, testInfo);
          expect(m.innerWidth, "the viewport did not apply").toBe(
            device.use.viewport.width,
          );
        });
      }
    });
  }

  for (const device of LCP_DEVICES) {
    test.describe(device.name, () => {
      test.use(device.use);

      test(`home at ${device.use.viewport.width}px: the LCP is the H1, and nothing in its lineage animates`, async ({
        page,
      }, testInfo) => {
        const m = await measure(page, "/", "warm");
        testInfo.annotations.push({
          type: "lcp",
          description: m.lcp.map((e) => `${e.selector} ${e.size}`).join("; "),
        });
        // Health check: the width asked for is the width that painted. A
        // `use` that did not apply would measure the desktop page again and
        // pass for the wrong reason, which is how this test was blind until
        // 2026-10-09.
        expect(m.innerWidth, "the viewport did not apply").toBe(
          device.use.viewport.width,
        );
        // Health check: a browser that reported no LCP would pass any
        // assertion about which element it was.
        expect(
          m.lcp.length,
          "no largest-contentful-paint entry",
        ).toBeGreaterThan(0);
        const last = m.lcp[m.lcp.length - 1]!;
        expect(
          last.inH1,
          `the largest paint on / at ${m.innerWidth}px is ${last.selector}, not the H1 (entries: ${m.lcp
            .map((e) => `${e.selector} ${e.size}`)
            .join("; ")})`,
        ).toBe(true);
        expect(
          m.animated,
          `motion started on the H1, an ancestor or its words (${m.motionSeen} motion(s) recorded on the page)`,
        ).toEqual([]);
      });
    });
  }

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

/**
 * /workspace as files arrive: the page's client-filled slots are the staged
 * files and the suggestions for them (inline under the files on a phone, in
 * the aside on a wide screen). Files are DROPPED synthetically, which carries
 * no input flag — the same way a file chosen in the OS picker arrives, long
 * after the click that opened it — so every shift counts.
 *
 * WHAT SHIPPED (review, 2026-10-09): staging read CLS 0.0937 at 1280 and
 * 0.546 at 390 scrolled to the Add files button, against 0.0041 and 0.106 on
 * the build before. The suggestions' loading placeholder was a 90px box
 * between a ~570px panel and a ~400px list, so the aside and the batch queue
 * jumped twice; measured facts then reordered the list and grew the staged
 * rows. Nothing measured /workspace, so it shipped green.
 *
 * AND WHAT THE FIRST REPAIR LEFT, WITH THIS SPEC GREEN (review, later the
 * same day): the tools panel and the placeholder were one box, the list was
 * not — real rows wrap their facts and "SECURE WORKER · you'll add the
 * files…" to a second line, so the slot went 381 → 381 → 399 at 1280 and
 * 381 → 381 → 419 at 390, and the batch queue, Recent activity and the
 * privacy note moved. Every part of the old guard was built not to see it:
 * the box was compared before the list existed (its comment exempted the
 * list, "measured as CLS"); the CLS bound skipped the phone; the desktop was
 * measured at the top, where all that moved was under the fold; and the
 * window for the slots opened two frames AFTER the drop, while the drop
 * itself pushed the phone's pre-reserved slot 54px.
 *
 * So, for every case in {@link STAGING_CASES}:
 *  - the suggestions slot's height is recorded EVERY FRAME from before the
 *    drop until the list has settled, the recording must have seen the tools
 *    panel, the placeholder and the list in that order, and every frame must
 *    be the tools panel's height;
 *  - CLS from the drop on is held to {@link MAX_CLS} — the phone and a
 *    desktop scrolled so the aside's Recent activity is on screen included;
 *  - a shift sourced in the suggestions slot counts from the drop's own
 *    frame. A shift in the staged-files slot counts from the second window
 *    only: the drop adds the rows the visitor dropped, and the window is
 *    proved to open before the swap (the placeholder is up and the facts
 *    still "measuring…").
 *
 * NOT GATED, and why: the staged list's own height, where it is in view.
 * The drop replaces the empty state with one row per file, and what is under
 * it moves by the difference. Measured 2026-10-09 on this build: the phone
 * with the drop zone at the top read CLS 0.0103 (the suggestions slot 25px
 * down in the drop's frame), and the desktop case below 0.0173 with one file
 * and 0.0187 with three — two files come within 6px of the empty state,
 * which is why that case passes, at 0.0012. Holding that still would take a
 * staging tray of fixed height; the build before this redesign moved the
 * same way. Scrolled past the drop zone on a phone (the two phone cases)
 * nothing on screen moves for any number of files — three read CLS 0: the
 * summary under the list keeps its height (its chips line is held from the
 * start, and Clear all keeps its place), so the browser's scroll anchoring
 * absorbs the list.
 *
 * NOR the 360px phone, where the slot is not one box: the placeholder's and
 * the list's heading wraps beside its link (+16px against "POPULAR TOOLS"),
 * and a secure-worker row says where its file goes on a third line rather
 * than cut "uploads only when you start it" short (+18px) — tools 493 →
 * placeholder 509 → list 527, measured 2026-10-09 (see
 * src/app/workspace/row-lines.ts). What it pushes is the batch queue, below
 * the fold there; the CLS read 0.
 *
 * Chunks requested after the page has settled are held back
 * {@link LATE_CHUNK_MS}, as on a slow phone: the placeholder then paints for
 * certain, and the measured facts land after it, so both swaps are measured
 * every run rather than when the machine happens to be slow.
 */
const LATE_CHUNK_MS = 400;
const DESKTOP = { viewport: { width: 1280, height: 720 } };
const PHONE = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
};

/** Where the page is scrolled when the files land. */
type StagingScroll = "top" | "recent-activity" | "empty-state" | "add-files";

const STAGING_CASES = [
  // The aside's slot is in view at the top of the page; what it would push
  // (Recent activity, the privacy note) is under the fold.
  { name: "desktop, at the top", use: DESKTOP, scroll: "top" },
  // So also scrolled until Recent activity is mid-screen, the privacy note
  // under it: a slot that changes height moves both (+18px under the first
  // repair, which read CLS 0 at the top).
  {
    name: "desktop, Recent activity on screen",
    use: DESKTOP,
    scroll: "recent-activity",
  },
  // At the top the inline slot is below the fold, where no shift is reported
  // at all; scrolled, the staged files and the slot under them are both on
  // screen. Two positions, two different scroll anchors.
  {
    name: "phone, the empty state at the top",
    use: PHONE,
    scroll: "empty-state",
  },
  { name: "phone, Add files at the top", use: PHONE, scroll: "add-files" },
] as const satisfies readonly {
  name: string;
  use: object;
  scroll: StagingScroll;
}[];

/** The suggestions slot on screen, one frame: what it held and how tall. */
interface SlotFrame {
  kind: "tools" | "placeholder" | "list" | "none";
  h: number;
}

declare global {
  interface Window {
    __slotFrames?: SlotFrame[];
    __slotStop?: boolean;
  }
}

interface StagingMeasurement {
  innerWidth: number;
  /** Every shift from the drop on, and their sum. */
  cls: number;
  counted: ShiftRecord[];
  /**
   * Shifts that moved something in a slot: in the suggestions slot from the
   * drop's frame on, in any other slot after it.
   */
  inReserved: ShiftRecord[];
  /** Shifts before the second window opened: the drop's own frames. */
  dropFrames: ShiftRecord[];
  /** `[data-slot]` elements on screen once the facts were in. */
  slots: string[];
  /** The suggestions slot, each frame its content or height changed. */
  frames: SlotFrame[];
  /** Whether the element scrolled to was on screen when the files landed. */
  target: { inView: boolean; scrollY: number };
}

/** The slot's frames as `kind height`, for a failure message. */
const describeFrames = (frames: SlotFrame[]) =>
  frames.map((f) => `${f.kind} ${f.h}`).join(" → ");

/** The kinds in the order they appeared, repeats collapsed. */
const kindsSeen = (frames: SlotFrame[]) =>
  frames.map((f) => f.kind).filter((k, i, all) => i === 0 || all[i - 1] !== k);

/** The largest height difference from the first frame. */
const maxDrift = (frames: SlotFrame[]) =>
  Math.max(0, ...frames.map((f) => Math.abs(f.h - (frames[0]?.h ?? f.h))));

/**
 * Load /workspace with fonts cached, scroll as asked, drop a text PDF and a
 * scan on the drop zone, record the suggestions slot every frame, and wait
 * until the suggestions show what the probe measured.
 */
async function measureStaging(
  page: Page,
  scroll: StagingScroll,
): Promise<StagingMeasurement> {
  const files = [
    { name: "text.pdf", bytes: await makePdfBytes("text.pdf", 2) },
    { name: "scan.pdf", bytes: await makeScanPdfBytes(1) },
  ].map((f) => ({
    name: f.name,
    b64: Buffer.from(f.bytes).toString("base64"),
  }));

  await page.goto("/workspace", { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.goto("/workspace", { waitUntil: "load" });
  await waitForHydration(page.locator('input[type="file"]').first());
  await page.waitForLoadState("networkidle");
  await page.route(
    /\/_next\/static\/chunks\/.+\.js(?:\?.*)?$/,
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, LATE_CHUNK_MS));
      await route.continue();
    },
  );
  // Instant: the page scrolls smoothly by default, and a scroll still under
  // way when the files land moves everything for the wrong reason.
  const target =
    scroll === "empty-state"
      ? // The box the staged files replace, at the top.
        page.getByText(/no files staged yet/i).locator("xpath=..")
      : scroll === "add-files"
        ? page.getByRole("button", { name: "Add files" })
        : scroll === "recent-activity"
          ? page.getByRole("region", { name: /recent activity/i })
          : page.locator("main");
  if (scroll !== "top")
    await target.evaluate(
      (el, block) => {
        el.scrollIntoView({ block, behavior: "instant" });
      },
      scroll === "recent-activity" ? ("center" as const) : ("start" as const),
    );
  await page.waitForTimeout(300);
  // Health: the element scrolled to is wholly on screen (at the top, the
  // page is not scrolled at all).
  const placed = await target.evaluate((el, atTop) => {
    const r = el.getBoundingClientRect();
    return {
      inView: atTop
        ? window.scrollY === 0
        : r.top >= -1 && r.bottom <= window.innerHeight + 1,
      scrollY: window.scrollY,
    };
  }, scroll === "top");

  const dropped = await page.evaluate(() => window.__shifts?.length ?? -1);
  expect(dropped, "the shift recorder is not installed").toBeGreaterThanOrEqual(
    0,
  );
  // Every frame from here: what the slot on screen holds, and its height.
  await page.evaluate(() => {
    const frames: SlotFrame[] = [];
    window.__slotFrames = frames;
    window.__slotStop = false;
    const tick = () => {
      const slot = [
        ...document.querySelectorAll("[data-slot=suggestions]"),
      ].find((el) => el.getClientRects().length > 0);
      const panel = slot?.firstElementChild;
      const kind: SlotFrame["kind"] = !panel
        ? "none"
        : panel.getAttribute("aria-busy") === "true"
          ? "placeholder"
          : /suggested for your files/i.test(
                panel.querySelector("h2")?.textContent ?? "",
              )
            ? "list"
            : "tools";
      const h = Math.round((slot?.getBoundingClientRect().height ?? -1) * 10);
      const last = frames[frames.length - 1];
      if (!last || last.kind !== kind || last.h !== h / 10)
        frames.push({ kind, h: h / 10 });
      if (!window.__slotStop) requestAnimationFrame(tick);
    };
    tick();
  });
  const dataTransfer = await page.evaluateHandle((list) => {
    const dt = new DataTransfer();
    for (const { name, b64 } of list) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      dt.items.add(new File([bytes], name, { type: "application/pdf" }));
    }
    return dt;
  }, files);
  await page
    .locator("label")
    .filter({ hasText: /drop files here/i })
    .dispatchEvent("drop", { dataTransfer });

  // The drop's frame: the rows are in, the facts are still being measured,
  // and the suggestions slot shows its placeholder. Two frames on, the
  // second window opens — with the swap and the facts still ahead of it.
  const staged = page.getByRole("list", { name: /staged files/i });
  await expect(staged.getByText("measuring…").first()).toBeVisible();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setTimeout(resolve, 50)),
        ),
      ),
  );
  const filling = await page.evaluate(() => ({
    at: window.__shifts?.length ?? -1,
    placeholder: [
      ...document.querySelectorAll(
        '[data-slot=suggestions] [aria-busy="true"]',
      ),
    ].some((el) => el.getClientRects().length > 0),
    measuring: document.body.textContent?.includes("measuring…") ?? false,
  }));
  // Red here means one of two things, both fatal to what follows: the list
  // did not wait for the facts (no placeholder while they were measured —
  // measured 2026-10-09 by removing the wait: this fired, and without it a
  // shift inside the slot did), or the window opened after the swap.
  expect(
    filling,
    "the placeholder was not up while the facts were still measuring",
  ).toMatchObject({ placeholder: true, measuring: true });

  // The facts are in: the staged list counted both files' pages, and the
  // suggestions on screen show what the probe found in the scan.
  await expect(staged.getByText(/2 pages/)).toBeVisible();
  await expect(staged.getByText(/no selectable text/)).toBeVisible();
  const ocr = page
    .getByRole("link", { name: /^open ocr pdf/i })
    .filter({ visible: true });
  await expect(ocr).toContainText(/no selectable text on page 1/i, {
    timeout: 15_000,
  });
  await page.waitForTimeout(600);

  const read = await page.evaluate((from) => {
    window.__slotStop = true;
    const visible = (el: Element) => el.getClientRects().length > 0;
    return {
      shifts: (window.__shifts ?? []).slice(from),
      frames: window.__slotFrames ?? [],
      innerWidth: window.innerWidth,
      slots: [...document.querySelectorAll("[data-slot]")]
        .filter(visible)
        .map((el) => el.getAttribute("data-slot") ?? ""),
    };
  }, dropped);
  const counted = read.shifts.filter((s) => !s.hadRecentInput);
  const windowOpens = filling.at - dropped;
  return {
    innerWidth: read.innerWidth,
    cls: counted.reduce((sum, s) => sum + s.value, 0),
    counted,
    inReserved: read.shifts.filter((s, i) =>
      s.sources.some(
        (x) => x.reserved && (x.slot === "suggestions" || i >= windowOpens),
      ),
    ),
    dropFrames: read.shifts.slice(0, windowOpens),
    slots: read.slots,
    frames: read.frames,
    target: placed,
  };
}

test.describe("the workspace as files arrive", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(observe, RESERVED);
  });

  for (const c of STAGING_CASES) {
    test.describe(c.name, () => {
      test.use(c.use);

      test(`staging a text PDF and a scan at ${c.use.viewport.width}px: the suggestions slot keeps one height through tools, placeholder and list, nothing inside a slot moves, and CLS ≤ ${MAX_CLS}`, async ({
        page,
      }, testInfo) => {
        const m = await measureStaging(page, c.scroll);
        testInfo.annotations.push(
          { type: "cls", description: m.cls.toFixed(4) },
          { type: "slot", description: describeFrames(m.frames) },
        );
        if (m.counted.length > 0)
          testInfo.annotations.push({
            type: "shifts",
            description: report(m.counted),
          });
        // Health: the width asked for painted, the page was where the case
        // says, and the slots this measures were on screen — a page without
        // them would move nothing in them.
        expect(m.innerWidth, "the viewport did not apply").toBe(
          c.use.viewport.width,
        );
        expect(m.target.inView, `${c.scroll} was not on screen`).toBe(true);
        if (c.scroll !== "top")
          expect(m.target.scrollY, "the page did not scroll").toBeGreaterThan(
            0,
          );
        expect([...new Set(m.slots)].sort()).toEqual([
          "staged-files",
          "suggestions",
        ]);
        // Health: the recording saw the whole swap, in order — a recorder
        // that missed the list would hold every height it saw.
        expect(kindsSeen(m.frames), describeFrames(m.frames)).toEqual([
          "tools",
          "placeholder",
          "list",
        ]);
        expect(m.frames[0]!.h, "no suggestions slot on screen").toBeGreaterThan(
          100,
        );

        // One box: the tools panel, the placeholder and the list, every
        // frame. WAS 381 → 381 → 399 at 1280 and → 419 at 390.
        expect(
          maxDrift(m.frames),
          `the suggestions slot changed height: ${describeFrames(m.frames)}`,
        ).toBeLessThanOrEqual(1);
        expect(
          m.inReserved.length,
          `a slot moved while it filled in:\n${report(m.inReserved)}`,
        ).toBe(0);
        expect(
          m.cls,
          `staging CLS ${m.cls.toFixed(4)} over ${m.counted.length} shift(s):\n${report(m.counted)}`,
        ).toBeLessThanOrEqual(MAX_CLS);
      });
    });
  }

  test.describe("positive controls: the defects this replaced, injected, are measured", () => {
    /**
     * Inject a stylesheet once the document has a head, and prove it landed
     * — a control whose defect never reached the page passes for nothing
     * (the first version appended to a documentElement that did not exist
     * yet, and both controls read green-for-the-wrong-reason as zero).
     */
    async function inject(page: Page, css: string) {
      await page.addInitScript((text) => {
        const add = () => {
          const style = document.createElement("style");
          style.dataset.probe = "";
          style.textContent = text;
          document.head.append(style);
        };
        if (document.head) add();
        else document.addEventListener("DOMContentLoaded", add);
      }, css);
    }
    const landed = (page: Page) =>
      expect(page.locator("style[data-probe]")).toHaveCount(1);

    test.describe("desktop", () => {
      test.use(DESKTOP);

      // The placeholder cut back to its heading — the 90px box that shipped —
      // so the panel shrinks when the files arrive and grows when the list
      // replaces it. The aside below it jumps; this is what CLS sees.
      test("a placeholder shorter than the list", async ({ page }) => {
        await inject(
          page,
          'section[aria-busy="true"] > :not(:first-child){display:none !important}',
        );
        const m = await measureStaging(page, "top");
        await landed(page);
        expect(m.cls, report(m.counted)).toBeGreaterThan(MAX_CLS);
        expect(maxDrift(m.frames), describeFrames(m.frames)).toBeGreaterThan(
          100,
        );
      });

      // The defect the first repair shipped, at its size: one row of the
      // list 18px taller than the placeholder's (a line that wrapped), at
      // the position that sees the aside. CLS barely registers 18px at 1280
      // (the review measured +0.0022 a staging), so it is the per-frame box
      // that turns the real test red; the shift record shows this position
      // sees what moved under the slot at all — the top of the page read
      // CLS 0 with the slot 18px taller.
      test("a list taller than its placeholder", async ({ page }) => {
        await inject(
          page,
          "ol > li:first-child > a[data-suggestion]{padding-bottom:calc(0.625rem + 18px) !important}",
        );
        const m = await measureStaging(page, "recent-activity");
        await landed(page);
        expect(kindsSeen(m.frames)).toEqual(["tools", "placeholder", "list"]);
        const placeholder = m.frames.find((f) => f.kind === "placeholder")!;
        const list = m.frames.filter((f) => f.kind === "list").at(-1)!;
        expect(
          list.h - placeholder.h,
          describeFrames(m.frames),
        ).toBeGreaterThanOrEqual(17);
        // What the real test asserts, red.
        expect(maxDrift(m.frames)).toBeGreaterThan(1);
        // Recent activity and the privacy note moved, on screen.
        expect(report(m.counted)).toMatch(/aside\.flex > section/);
      });
    });

    test.describe("phone", () => {
      test.use(PHONE);

      // The staged row's facts line without its reserved second line: the
      // measured chips wrap, the row grows, and what is under it — or, with
      // the growth absorbed by scroll anchoring, the rows themselves — moves.
      test("a staged row whose facts change its height", async ({ page }) => {
        await inject(page, "[data-facts]{min-height:0 !important}");
        const m = await measureStaging(page, "empty-state");
        await landed(page);
        expect(
          m.inReserved.flatMap((s) => s.sources.map((x) => x.selector)),
          report(m.counted),
        ).not.toEqual([]);
      });

      // The summary without its held chips line: the drop grows it, the
      // browser's anchor on it cannot absorb that, and the drop's own frame
      // pushes the pre-reserved slot down — the shift the first repair's
      // window opened too late to see (CLS 0.04 measured).
      test("a drop that pushes the suggestions slot", async ({ page }) => {
        await inject(page, "span[data-chips]{display:none !important}");
        const m = await measureStaging(page, "empty-state");
        await landed(page);
        const inSlot = (s: ShiftRecord) =>
          s.sources.some((x) => x.slot === "suggestions");
        // In the drop's own frames, and counted as a slot that moved.
        expect(m.dropFrames.filter(inSlot), report(m.counted)).not.toEqual([]);
        expect(m.inReserved.filter(inSlot), report(m.counted)).not.toEqual([]);
        expect(m.cls, report(m.counted)).toBeGreaterThan(MAX_CLS);
      });
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
