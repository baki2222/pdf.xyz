import { expect, test, type Page } from "@playwright/test";

/**
 * A fallback face takes the room the real face will take.
 *
 * The web fonts load with `display: swap`, so on a first visit the page is
 * painted in a FALLBACK face and repainted when the real one arrives. If the
 * fallback sets a line wider or narrower than the real face, paragraphs and
 * headings re-wrap at the swap and everything below them moves. That is the
 * first-visit CLS that `layout-stability.spec.ts` measures with the fonts
 * held back.
 *
 * WHAT WAS WRONG, measured 2026-10-09 on production (1440 px, 574 strings
 * from ten pages): next/font's `adjustFontFallback: "Arial"` derives ONE
 * `size-adjust` per face from the font file's average glyph width, which is
 * not English prose. Arial then set Geist's body text 4.0% WIDER than Geist
 * at weight 400, and the display face's headings 6.9% wider at 500. And
 * because that single face declares no weight, every 600/700 heading fell
 * back to Arial REGULAR synthesised bold rather than Arial Bold. The 404 and
 * the first guide re-wrapped by a line at 1440 px: CLS 0.0232 and 0.0217
 * when the fonts arrive late.
 *
 * WHAT IS HELD HERE: for every (real face, fallback face, weight) the site
 * renders, the fallback sets the site's OWN text within {@link TOLERANCE}
 * of the real face's width. It holds the stylesheet as SERVED, not the
 * source: the faces are found from each element's computed `font-family`
 * and the `@font-face` rules the page actually has. The corpus is the text
 * those pages actually render, so it is not a sample anyone chose.
 *
 * Geist Mono had no metric fallback at all. Its stack fell through to
 * whatever monospace the platform has. That happens to be right on Windows and
 * Linux (Courier New and Liberation Mono advance 0.6 em, as Geist Mono does:
 * 0.9998), but nothing declared or tested it.
 *
 * A fallback only works where its `local()` face exists. Arial, Liberation
 * Sans and Arimo share their advance widths, as do Courier New, Liberation
 * Mono and Cousine, and the CI image installs the Liberation faces with
 * Chromium (`playwright install --with-deps`). So the same numbers hold on
 * Windows, macOS, ChromeOS and the Linux runner, and this spec FAILS rather
 * than skips when no face resolves. Android ships none of them and falls
 * through to its system face, unadjusted; that is stated, not covered.
 */

/** |fallback width / real width − 1|, summed over a group's text. */
const TOLERANCE = 0.015;

/**
 * Pages whose rendered text is the corpus: the home page, the explorer, a
 * client tool page and a worker one, the guides index, the first guide it
 * links, and the 404. The two that re-wrapped are among them.
 */
const PAGES: (string | ((page: Page) => Promise<string>))[] = [
  "/",
  "/tools",
  "/tools/merge-pdf",
  "/tools/ocr-pdf",
  "/guides",
  async (page) => {
    await page.goto("/guides");
    const href = await page
      .locator('main a[href^="/guides/"]')
      .first()
      .getAttribute("href");
    expect(href, "the guides index links no guide").toMatch(/^\/guides\/.+/);
    return href!;
  },
  "/this-page-does-not-exist",
];

interface Group {
  real: string;
  fallback: string;
  weight: string;
  realWidth: number;
  fallbackWidth: number;
  elements: number;
}

interface PageReading {
  groups: Group[];
  /** Real faces some element uses that no local() face follows. */
  unfollowed: string[];
  /** Fallback faces that resolved to no installed font, at a weight. */
  unresolved: string[];
}

/**
 * Runs in the page. Groups every element that holds its own text by the real
 * face, the first local() face after it in its stack, and its weight; sets
 * that text in each face alone, at the element's size, spacing and numeric
 * features, and sums the widths.
 */
async function read(probeSelector: string | null): Promise<PageReading> {
  await document.fonts.ready;
  const localFaces = new Set<string>();
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of [...rules])
      if (
        rule instanceof CSSFontFaceRule &&
        /local\(/.test(rule.style.getPropertyValue("src"))
      )
        localFaces.add(
          rule.style
            .getPropertyValue("font-family")
            .replace(/["']/g, "")
            .trim(),
        );
  }
  const scope = probeSelector
    ? document.querySelectorAll(probeSelector)
    : document.querySelectorAll(
        "h1, h2, h3, h4, p, li, a, button, dt, dd, label, span, figcaption, summary",
      );
  const groups = new Map<string, Group>();
  const unfollowed = new Set<string>();
  const host = document.createElement("div");
  host.style.cssText =
    "position:absolute;visibility:hidden;left:-99999px;top:0;white-space:nowrap";
  document.body.appendChild(host);
  const width = (family: string, style: CSSStyleDeclaration, text: string) => {
    const span = document.createElement("span");
    span.style.fontFamily = `"${family}"`;
    span.style.fontWeight = style.fontWeight;
    span.style.fontSize = style.fontSize;
    span.style.fontStyle = style.fontStyle;
    span.style.letterSpacing = style.letterSpacing;
    span.style.fontVariantNumeric = style.fontVariantNumeric;
    span.style.fontFeatureSettings = style.fontFeatureSettings;
    span.textContent = text;
    host.appendChild(span);
    const w = span.getBoundingClientRect().width;
    span.remove();
    return w;
  };
  for (const el of [...scope]) {
    const text = [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 3) continue;
    const style = getComputedStyle(el);
    const stack = style.fontFamily
      .split(",")
      .map((f) => f.replace(/["']/g, "").trim());
    const real = stack[0];
    // A stack that starts with a platform font has no swap to measure.
    if (
      real === undefined ||
      ![...document.fonts].some((f) => f.family.replace(/["']/g, "") === real)
    )
      continue;
    const fallback = stack.slice(1).find((f) => localFaces.has(f));
    if (!fallback) {
      unfollowed.add(real);
      continue;
    }
    const key = `${real}|${fallback}|${style.fontWeight}`;
    const g = groups.get(key) ?? {
      real,
      fallback,
      weight: style.fontWeight,
      realWidth: 0,
      fallbackWidth: 0,
      elements: 0,
    };
    g.realWidth += width(real, style, text);
    g.fallbackWidth += width(fallback, style, text);
    g.elements += 1;
    groups.set(key, g);
  }
  host.remove();
  const unresolved: string[] = [];
  for (const g of groups.values()) {
    const faces = await document.fonts.load(`${g.weight} 16px "${g.fallback}"`);
    if (!faces.some((f) => f.status === "loaded"))
      unresolved.push(`${g.fallback} @${g.weight}`);
  }
  return {
    groups: [...groups.values()],
    unfollowed: [...unfollowed],
    unresolved,
  };
}

function merge(into: Map<string, Group>, groups: Group[]): void {
  for (const g of groups) {
    const key = `${g.real}|${g.fallback}|${g.weight}`;
    const have = into.get(key);
    if (!have) into.set(key, { ...g });
    else {
      have.realWidth += g.realWidth;
      have.fallbackWidth += g.fallbackWidth;
      have.elements += g.elements;
    }
  }
}

const ratio = (g: Group) => g.fallbackWidth / g.realWidth;

test.describe("fallback faces", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("set the site's own text within 1.5% of the real face, at every weight it uses", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const all = new Map<string, Group>();
    const unfollowed = new Set<string>();
    const unresolved = new Set<string>();
    for (const entry of PAGES) {
      const url = typeof entry === "string" ? entry : await entry(page);
      await page.goto(url);
      const r = await page.evaluate(read, null);
      merge(all, r.groups);
      r.unfollowed.forEach((f) => unfollowed.add(f));
      r.unresolved.forEach((f) => unresolved.add(f));
    }
    const groups = [...all.values()];
    const table = groups
      .map(
        (g) =>
          `${g.real} → ${g.fallback} @${g.weight}: ${g.elements} elements, ` +
          `fallback/real ${ratio(g).toFixed(4)}`,
      )
      .join("\n");
    // The measured table travels with every run, green or red: a re-fit of
    // globals.css's size-adjust values is computed from it.
    await testInfo.attach("fallback widths", {
      body: table,
      contentType: "text/plain",
    });
    console.log(`fallback widths:\n${table}`);

    // HEALTH. Every web face the pages render is followed by a local() face,
    // and each of those resolves to an installed font. Otherwise the widths
    // below were measured in whatever the browser fell back to.
    expect(
      [...unfollowed],
      `no local() fallback follows these faces:\n${table}`,
    ).toEqual([]);
    expect(
      [...unresolved],
      "these fallback faces resolved to no installed font (Arial, Liberation Sans or Arimo)",
    ).toEqual([]);

    // The corpus is what the pages render, so bound its size: a selector or
    // stack change that quietly stopped finding the body text or the
    // headings would leave a few buttons passing for the whole site.
    // Three web faces: body, display, mono. Measured on production 2026-10-09
    // (ten pages): 456 body elements at 400, 41 display headings.
    const families = [...new Set(groups.map((g) => g.real))];
    expect(families.length, `faces measured:\n${table}`).toBe(3);
    const body = groups
      .filter((g) => g.weight === "400")
      .sort((a, b) => b.elements - a.elements)[0];
    expect(
      body?.elements ?? 0,
      `the body text was not found:\n${table}`,
    ).toBeGreaterThan(150);
    for (const family of families)
      expect(
        groups
          .filter((g) => g.real === family)
          .reduce((n, g) => n + g.elements, 0),
        `too little ${family} text to measure:\n${table}`,
      ).toBeGreaterThan(15);

    const off = groups
      .filter((g) => Math.abs(ratio(g) - 1) > TOLERANCE)
      .map(
        (g) =>
          `${g.real} → ${g.fallback} @${g.weight}: fallback/real ${ratio(g).toFixed(4)} over ${g.elements} elements`,
      );
    expect(
      off,
      `these fallbacks set the site's text a different width from the real face, so it re-wraps when the face swaps in:\n${table}`,
    ).toEqual([]);
  });

  test("the measurement sees a mis-sized fallback (positive control)", async ({
    page,
  }) => {
    await page.goto("/");
    // A fallback 8% too wide, put through the SAME reader as the real pages.
    // A reader that returned no groups, or ratios of 1 whatever it measured,
    // would pass the test above for every stylesheet.
    await page.addStyleTag({
      content:
        '@font-face{font-family:"Probe Wide";src:local("Arial"),local("ArialMT"),local("Liberation Sans"),local("LiberationSans"),local("Arimo");size-adjust:108%}',
    });
    const real = await page.evaluate(() =>
      (getComputedStyle(document.body).fontFamily.split(",")[0] ?? "")
        .replace(/["']/g, "")
        .trim(),
    );
    await page.evaluate((family) => {
      const p = document.createElement("p");
      p.id = "font-probe";
      p.style.fontFamily = `"${family}", "Probe Wide"`;
      p.textContent =
        "Combine PDFs into one, in any order. Nothing is uploaded unless a tool says so.";
      document.body.appendChild(p);
    }, real);
    const r = await page.evaluate(read, "#font-probe");
    expect(r.unresolved, "the probe's local() face did not resolve").toEqual(
      [],
    );
    expect(r.groups).toHaveLength(1);
    const [probe] = r.groups as [Group];
    expect(probe.fallback).toBe("Probe Wide");
    expect(Math.abs(ratio(probe) - 1)).toBeGreaterThan(TOLERANCE);
  });
});
