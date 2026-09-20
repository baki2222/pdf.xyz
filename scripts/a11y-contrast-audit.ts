/**
 * Measure the real text/background contrast of every rendered string, in a real
 * browser, against the pixels actually painted behind it.
 *
 * WHY THIS DOES NOT WALK THE ANCESTORS' `background-color`
 * That is the cheap way to do this, and here it is wrong in the dangerous
 * direction. `src/app/globals.css` paints an ambient radial-gradient layer on
 * `body::before` at `z-index: -1`; every glass panel in the product is
 * translucent and sits ON TOP of it. An ancestor walk terminates at the opaque
 * `--color-ink` body colour and therefore reports a background DARKER than the
 * one on screen — which, for light text on a dark theme, reports MORE contrast
 * than the user gets. A checker that fails safe in the wrong direction is the
 * house speciality (see `ready: true`), so this measures pixels instead:
 *
 *   1. tag every element that owns visible text,
 *   2. make ALL text invisible without moving anything (`color: transparent`),
 *   3. screenshot the viewport, decode it, and read the pixels inside each
 *      text run's own client rects — which are now pure backdrop, gradient,
 *      backdrop-filter blur and all,
 *   4. take the LIGHTEST pixel under the run as the background, because for
 *      light-on-dark that is the worst case,
 *   5. composite the text colour's own alpha over that and apply WCAG 2.1 AA.
 *
 * WHAT IT CANNOT SEE
 * Only what the page renders in this environment. Worker panels that require a
 * live `/api/worker/status` render their pre-flight state locally, so their
 * post-run surfaces are not measured here. Treat the count as a floor, and pair
 * it with a source-level guard for the rest — this script measures colours in
 * situ, `muted-text-contrast.test.ts` proves none of the failing ones are left
 * in the tree.
 *
 * USAGE
 *   pnpm build && pnpm start --port 3100
 *   pnpm a11y:contrast                          # default route sample
 *   pnpm a11y:contrast --all-tools              # every /tools/<slug> too
 *   pnpm a11y:contrast --all-guides             # every /guides/<slug> too
 *   BASE=http://127.0.0.1:3100 pnpm a11y:contrast --json report.json
 *   A11Y_SCHEME=dark pnpm a11y:contrast         # audit the dark colour scheme
 *
 * NOTE: this script does NOT build or serve. It measures whatever already
 * answers on BASE — so serve the build you mean to audit yourself, and prove
 * it is that build (grep the response for a token only the new build can
 * produce) before trusting a number from here.
 *
 * A11Y_SCHEME exists because the redesign ships `prefers-color-scheme: dark`
 * token overrides: a surface the instrument cannot render is a surface it
 * cannot certify, so the scheme is part of the measurement, not a variant.
 * Anything other than "dark" (or unset) is a loud error rather than a silent
 * light-mode run reporting the wrong claim as checked.
 *
 * EXIT CODES
 *   0  every measured text run meets WCAG 2.1 AA (1.4.3)
 *   1  at least one run fails
 *   2  the run could not complete
 */

import { chromium, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import {
  compositeOver,
  contrastRatio,
  parseColor,
  relativeLuminance,
  requiredRatioAA,
  type Rgb,
} from "../src/lib/a11y/contrast";
import { decodePng } from "../src/lib/a11y/png";
import { getAllToolSlugs } from "../src/lib/tools";
import { getAllGuideSlugs } from "../src/lib/guides";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";

const SCHEME_INPUT = process.env.A11Y_SCHEME ?? "light";
if (SCHEME_INPUT !== "light" && SCHEME_INPUT !== "dark") {
  console.error(
    `A11Y_SCHEME must be "light" or "dark", got ${JSON.stringify(SCHEME_INPUT)}`,
  );
  process.exit(2);
}
const SCHEME: "light" | "dark" = SCHEME_INPUT;

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

/**
 * A representative sample rather than every route: the marketing surfaces, the
 * workspace, the status page, the legal pages, one tool page per processing
 * mode, and the guides. `--all-tools` / `--all-guides` widen it.
 *
 * THE GUIDES ENTRY IS DERIVED, AND THAT IS THE POINT. This list was hand-typed
 * and therefore could not see a route it did not name: the /guides section
 * shipped on 2026-09-17, three weeks into the redesign branch's life, and the
 * audit that gates "no text below AA" was still measuring twelve routes that
 * predated it — a clean bill of health over the wrong corpus (CLAUDE.md
 * rule 4). Taking the first slug from the catalogue means a renamed or removed
 * guide moves the audit with it, and a sixteenth guide is covered the day it
 * exists.
 */
const FIRST_GUIDE = getAllGuideSlugs()[0];
if (!FIRST_GUIDE) {
  throw new Error(
    "the guides catalogue is empty — refusing to audit a surface set that silently lost a section",
  );
}

const DEFAULT_ROUTES = [
  "/",
  "/tools",
  "/guides",
  `/guides/${FIRST_GUIDE}`,
  "/workspace",
  "/status",
  "/privacy",
  "/terms",
  "/tools/merge-pdf",
  "/tools/rotate-pdf",
  "/tools/compress-pdf",
  "/tools/ocr-pdf",
  "/tools/summarize-pdf",
  "/tools/protect-pdf",
];

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

type Candidate = {
  id: number;
  /** As authored/serialised by the browser, e.g. `oklch(0.554 0.046 257.417)`. */
  color: string;
  /**
   * The same colour resolved to sRGB BY THE BROWSER (2D canvas), not by this
   * script. Tailwind v4 emits oklch(), and Chromium serialises the computed
   * value in the same space — so a hand-rolled `rgb()`/hex parser returns null
   * for every muted colour in this product. The first version of this audit did
   * exactly that and then `continue`d, which reported 0 failures for the very
   * palette it was written to measure. Null here means UNRESOLVED, and an
   * unresolved colour is a loud error, never a pass.
   */
  resolved: string | null;
  fontSize: number;
  fontWeight: number;
  text: string;
  classes: string;
  tag: string;
};

type Finding = {
  route: string;
  viewport: string;
  selectorHint: string;
  text: string;
  color: string;
  background: string;
  fontSize: number;
  fontWeight: number;
  ratio: number;
  required: number;
};

function toCss({ r, g, b }: Rgb): string {
  const round = (n: number) => Math.round(n);
  return `rgb(${round(r)}, ${round(g)}, ${round(b)})`;
}

/**
 * Collect one entry per element that directly owns visible text, and stamp each
 * with `data-a11y-id` so rects can be re-read after every scroll without
 * re-matching.
 */
async function tagCandidates(page: Page): Promise<Candidate[]> {
  return page.evaluate(() => {
    const out: {
      id: number;
      color: string;
      resolved: string | null;
      fontSize: number;
      fontWeight: number;
      text: string;
      classes: string;
      tag: string;
    }[] = [];
    let id = 0;

    // Let the engine that painted the colour also convert it. A 2D canvas
    // accepts any CSS colour and hands back sRGB bytes, which is both simpler
    // and more trustworthy than reimplementing oklch → sRGB here.
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const cache = new Map<string, string | null>();

    const resolveColor = (css: string): string | null => {
      if (!ctx) return null;
      const cached = cache.get(css);
      if (cached !== undefined) return cached;

      // `fillStyle` silently KEEPS its previous value when handed something it
      // cannot parse, so assigning once and reading back cannot distinguish
      // "resolved" from "rejected". Assign after two different sentinels: only
      // a value the engine actually accepted lands on the same colour twice.
      ctx.fillStyle = "#ff00ff";
      ctx.fillStyle = css;
      const first = ctx.fillStyle;
      ctx.fillStyle = "#00ff00";
      ctx.fillStyle = css;
      const second = ctx.fillStyle;
      if (first !== second) {
        cache.set(css, null);
        return null;
      }

      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      const value = `rgba(${r}, ${g}, ${b}, ${(a ?? 255) / 255})`;
      cache.set(css, value);
      return value;
    };

    for (const el of Array.from(
      document.body.querySelectorAll<HTMLElement>("*"),
    )) {
      const ownText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? "")
        .join("")
        .trim();
      if (!ownText) continue;

      const style = getComputedStyle(el);
      if (
        style.visibility === "hidden" ||
        style.display === "none" ||
        Number(style.opacity) === 0
      ) {
        continue;
      }
      // `.sr-only` text is clipped to 1px and never seen; measuring it would
      // manufacture failures nobody can experience.
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;

      // Gradient headings paint their glyphs with `background-clip: text` and a
      // transparent `color`. There is no foreground colour to compare, so a
      // ratio computed from `rgba(0,0,0,0)` is meaningless — it says 1:1 for
      // text that is perfectly legible. Excluded on purpose, and counted.
      const clip =
        style.getPropertyValue("background-clip") ||
        style.getPropertyValue("-webkit-background-clip");
      const resolved = resolveColor(style.color);
      if (clip === "text" || resolved === "rgba(0, 0, 0, 0)") continue;

      el.setAttribute("data-a11y-id", String(id));
      out.push({
        id,
        color: style.color,
        resolved,
        fontSize: parseFloat(style.fontSize),
        fontWeight: Number(style.fontWeight) || 400,
        text: ownText.slice(0, 80),
        classes: el.getAttribute("class") ?? "",
        tag: el.tagName.toLowerCase(),
      });
      id++;
    }
    return out;
  });
}

/** Make every glyph invisible without reflowing anything. */
async function hideText(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        color: transparent !important;
        -webkit-text-fill-color: transparent !important;
        text-shadow: none !important;
        text-decoration-color: transparent !important;
        caret-color: transparent !important;
      }
      /* Gradient headings paint their background THROUGH the glyphs
         (background-clip: text), so transparency alone leaves them visible. */
      .gradient-text, [class*="bg-clip-text"] {
        background-image: none !important;
      }
    `,
  });
}

/**
 * Viewport-relative client rects of the element's own text runs — but only the
 * ones that are actually ON TOP at that point.
 *
 * The occlusion test is not defensive padding. This app has a `sticky top-0
 * z-50` header, so scrolling an element "into view" routinely parks it UNDER
 * the header, and the pixels above it are then the header's violet→blue CTA
 * gradient. The first version of this audit reported ~50 body paragraphs as
 * 1.1:1 against `rgb(130, 86, 255)` for exactly that reason: a real
 * measurement of the wrong thing, which is the same class of error as a check
 * that passes for the wrong reason, only inverted.
 */
type Rect = { x: number; y: number; width: number; height: number };

async function textRects(
  page: Page,
  ids: number[],
): Promise<Record<string, Rect[]>> {
  return page.evaluate((elementIds) => {
    const visible = (el: Element, r: DOMRect) => {
      const y = r.y + r.height / 2;
      for (const fraction of [0.15, 0.5, 0.85]) {
        const x = r.x + r.width * fraction;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !(hit === el || el.contains(hit))) return false;
      }
      return true;
    };

    const out: Record<
      string,
      { x: number; y: number; width: number; height: number }[]
    > = {};
    for (const elementId of elementIds) {
      const el = document.querySelector(`[data-a11y-id="${elementId}"]`);
      if (!el) continue;
      const rects: { x: number; y: number; width: number; height: number }[] =
        [];
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType !== Node.TEXT_NODE) continue;
        if (!(node.textContent ?? "").trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of Array.from(range.getClientRects())) {
          if (r.width >= 1 && r.height >= 1 && visible(el, r)) {
            rects.push({ x: r.x, y: r.y, width: r.width, height: r.height });
          }
        }
      }
      if (rects.length > 0) out[String(elementId)] = rects;
    }
    return out;
  }, ids);
}

/**
 * The lightest pixel under the given rects, in device-independent coordinates.
 * Returns null when no rect lies fully inside the captured image.
 */
function lightestPixel(
  png: { width: number; height: number; data: Uint8Array },
  rects: { x: number; y: number; width: number; height: number }[],
  scale: number,
): Rgb | null {
  let best: Rgb | null = null;
  let bestLuminance = -1;

  for (const rect of rects) {
    const x0 = Math.round(rect.x * scale);
    const y0 = Math.round(rect.y * scale);
    const x1 = Math.round((rect.x + rect.width) * scale);
    const y1 = Math.round((rect.y + rect.height) * scale);
    if (x0 < 0 || y0 < 0 || x1 > png.width || y1 > png.height) continue;
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;

    // Cap the work per rect; a text line box is a near-uniform backdrop, so a
    // coarse grid finds the same maximum as every pixel would.
    const stepX = Math.max(1, Math.floor((x1 - x0) / 24));
    const stepY = Math.max(1, Math.floor((y1 - y0) / 8));
    for (let y = y0; y < y1; y += stepY) {
      for (let x = x0; x < x1; x += stepX) {
        const i = (y * png.width + x) * 4;
        const pixel = {
          r: png.data[i] ?? 0,
          g: png.data[i + 1] ?? 0,
          b: png.data[i + 2] ?? 0,
        };
        const luminance = relativeLuminance(pixel);
        if (luminance > bestLuminance) {
          bestLuminance = luminance;
          best = pixel;
        }
      }
    }
  }

  return best;
}

async function auditRoute(
  page: Page,
  route: string,
  viewport: string,
): Promise<{
  findings: Finding[];
  measured: number;
  skipped: number;
  unresolved: string[];
}> {
  await page.goto(`${BASE}${route}`, { waitUntil: "load", timeout: 45_000 });
  // Client panels decide what to render after a `/api/worker/status` fetch;
  // give that a chance to settle, but never block the audit on it.
  await page
    .waitForLoadState("networkidle", { timeout: 8_000 })
    .catch(() => {});
  await page.evaluate(() => document.fonts.ready);

  const candidates = await tagCandidates(page);
  await hideText(page);

  const scale = await page.evaluate(() => window.devicePixelRatio || 1);

  const findings: Finding[] = [];
  const pending = new Set(candidates.map((c) => c.id));
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const unresolved = new Set<string>();
  let measured = 0;
  let unreachable = 0;

  /**
   * Bring the first still-unmeasured run to the MIDDLE of the viewport, then
   * measure everything else that happens to be visible in the same frame. A
   * plain top-to-bottom sweep leaves whatever lands in the top 64px permanently
   * under the sticky header, where the occlusion test correctly refuses to
   * measure it — so the run would be reported as "never in view" forever.
   */
  const guard = 200;
  for (let round = 0; pending.size > 0 && round < guard; round++) {
    const first = pending.values().next().value as number;
    await page.evaluate(
      ([elementId, isFirst]) => {
        if (isFirst) {
          window.scrollTo(0, 0);
          return;
        }
        document
          .querySelector(`[data-a11y-id="${elementId}"]`)
          ?.scrollIntoView({ block: "center", behavior: "instant" });
      },
      [first, round === 0] as [number, boolean],
    );
    // The ambient gradient is `position: fixed`, so it repaints on scroll.
    await page.waitForTimeout(90);

    const shot = await page.screenshot({ type: "png" });
    const png = decodePng(new Uint8Array(shot));

    const rectsById = await textRects(page, [...pending]);

    let progressed = false;
    for (const id of [...pending]) {
      const candidate = byId.get(id);
      if (!candidate) {
        pending.delete(id);
        continue;
      }
      const rects = rectsById[String(id)];
      if (!rects || rects.length === 0) continue;
      const background = lightestPixel(png, rects, scale);
      if (!background) continue;

      pending.delete(id);
      progressed = true;

      const parsed = candidate.resolved ? parseColor(candidate.resolved) : null;
      if (!parsed) {
        // Deliberately not counted as measured: a run whose colour could not be
        // read has not been checked, and must not be reported as compliant.
        unresolved.add(candidate.color);
        continue;
      }
      measured++;
      const foreground = compositeOver(parsed, background);
      const ratio = contrastRatio(foreground, background);
      const required = requiredRatioAA(
        candidate.fontSize,
        candidate.fontWeight,
      );
      if (ratio + 1e-9 < required) {
        findings.push({
          route,
          viewport,
          selectorHint: `${candidate.tag}.${candidate.classes.split(/\s+/).slice(0, 6).join(".")}`,
          text: candidate.text,
          color: candidate.color,
          background: toCss(background),
          fontSize: candidate.fontSize,
          fontWeight: candidate.fontWeight,
          ratio: Number(ratio.toFixed(3)),
          required,
        });
      }
    }

    // Nothing became measurable even with `first` centred: it is genuinely
    // unreachable (permanently occluded, or clipped out of the page box).
    if (!progressed) {
      pending.delete(first);
      unreachable++;
    }
  }

  return {
    findings,
    measured,
    skipped: pending.size + unreachable,
    unresolved: [...unresolved],
  };
}

async function main(): Promise<number> {
  // Widening is per-section and composable: each flag replaces its own
  // sampled member with the whole catalogue, and neither can shadow the other.
  let routes = DEFAULT_ROUTES;
  if (flag("all-tools")) {
    routes = [
      ...routes.filter((r) => !r.startsWith("/tools/")),
      ...getAllToolSlugs().map((slug) => `/tools/${slug}`),
    ];
  }
  if (flag("all-guides")) {
    routes = [
      ...routes.filter((r) => !r.startsWith("/guides/")),
      ...getAllGuideSlugs().map((slug) => `/guides/${slug}`),
    ];
  }

  const browser = await chromium.launch();
  const findings: Finding[] = [];
  const unresolved = new Set<string>();
  let measured = 0;
  let skipped = 0;

  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        reducedMotion: "reduce",
        colorScheme: SCHEME,
      });
      const page = await context.newPage();
      // tsx compiles this file with esbuild's `keepNames`, which rewrites named
      // arrow functions to `__name(fn, "fn")`. That helper exists in Node but
      // not in the page, so any `page.evaluate` closure containing one throws
      // `__name is not defined`. Supplied as a string so it is injected
      // verbatim rather than being transformed the same way.
      await context.addInitScript({
        content:
          "globalThis.__name = globalThis.__name || function (f) { return f; };",
      });
      // The consent banner is a fixed light-canvas overlay that renders until
      // a decision is stored. Left in place it PARKS ITSELF OVER whatever the
      // sweep scrolls to the bottom of the viewport, and the sampler then
      // reads the banner back as that text run background — measured
      // 2026-08-28: two stable "failures" whose real paint was the dark ink
      // band, both reporting the banner canvas #f4f6f8 behind them. Seeding
      // a stored decision is also the honest steady state: every visitor
      // after the first pageview has one. The banner own surface uses the
      // same canvas/fg tokens this audit already measures everywhere else.
      await context.addInitScript({
        content:
          'try { localStorage.setItem("pdfxyz.analytics-consent", "denied"); } catch {}',
      });
      for (const route of routes) {
        const result = await auditRoute(page, route, viewport.name);
        findings.push(...result.findings);
        measured += result.measured;
        skipped += result.skipped;
        for (const color of result.unresolved) unresolved.add(color);
        const failed = result.findings.length;
        console.log(
          `${viewport.name.padEnd(7)} ${route.padEnd(28)} measured=${String(result.measured).padStart(4)} fail=${String(failed).padStart(3)}`,
        );
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const jsonPath = option("json");
  if (jsonPath) {
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          base: BASE,
          scheme: SCHEME,
          measured,
          skipped,
          unresolved: [...unresolved],
          findings,
        },
        null,
        2,
      ),
    );
  }

  console.log(
    `\n[${SCHEME}] measured ${measured} text runs (${skipped} never fully in view), ${findings.length} below WCAG AA`,
  );

  if (unresolved.size > 0) {
    // An audit that cannot read a colour has not audited it. Saying so is the
    // whole difference between this and the version that reported the palette
    // clean because it could not parse `oklch()`.
    console.log(
      `\n${unresolved.size} text colour(s) COULD NOT BE RESOLVED — those runs were NOT checked:`,
    );
    for (const color of unresolved) console.log(`  ${color}`);
  }

  if (findings.length > 0) {
    const byColor = new Map<string, { count: number; worst: Finding }>();
    for (const finding of findings) {
      const entry = byColor.get(finding.color);
      if (!entry) {
        byColor.set(finding.color, { count: 1, worst: finding });
      } else {
        entry.count++;
        if (finding.ratio < entry.worst.ratio) entry.worst = finding;
      }
    }
    console.log("\nby text colour (worst instance shown):");
    for (const [color, { count, worst }] of [...byColor.entries()].sort(
      (a, b) => b[1].count - a[1].count,
    )) {
      console.log(
        `  ${color.padEnd(22)} x${String(count).padStart(4)}  worst ${worst.ratio}:1 (needs ${worst.required}) on ${worst.background} — ${worst.route} "${worst.text.slice(0, 40)}"`,
      );
    }
  }

  if (flag("report-only")) return 0;
  return findings.length === 0 && unresolved.size === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(2);
  });
