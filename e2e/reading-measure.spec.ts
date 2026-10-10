import { expect, test, type Page } from "@playwright/test";

/**
 * Long-form copy is set at a reading measure: 60 to 75 characters a line.
 *
 * `src/app/guides/guide-page.test.tsx` holds the MECHANISM: the guides and
 * the policy pages put a max-width and a reading size on the body copy's own
 * element. This spec holds the PROPERTY that mechanism exists for, in the
 * browser, in the real face: the characters each line actually holds.
 *
 * WHAT SHIPPED, measured 2026-10-09: the measure was `max-w-[70ch]`, and
 * that guard was green. But `ch` is the advance of the digit zero, which in
 * Geist is 0.664 em, while Geist prose averages 0.46 em a character. So
 * "70ch" was a 744 px column holding about 100 characters a line, the
 * defect the measure was introduced to fix. And because the fallback face
 * has a different zero (Arial's is 0.556 em), the column itself narrowed
 * during a first visit and widened when Geist arrived: the first guide's
 * late-font CLS of 0.0166, with every paragraph moving up 28-84 px.
 *
 * Measured at 1440 px, where the measure binds. On a phone the column is
 * narrower than the measure, so the screen decides the line, not this
 * class. Only full lines count: a paragraph's last line is as short as its
 * text happens to be.
 */

const MIN_CHARS = 60;
const MAX_CHARS = 75;

interface Reading {
  url: string;
  paragraphs: number;
  fullLines: number;
  meanChars: number;
  worst: { chars: number; text: string }[];
}

/** Runs in the page: characters on each full line of each body paragraph. */
function measureLines(selector: string): Omit<Reading, "url"> {
  const lineLengths: number[] = [];
  const perParagraph: { chars: number; text: string }[] = [];
  let paragraphs = 0;
  for (const p of document.querySelectorAll<HTMLElement>(selector)) {
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const chars: { node: Text; offset: number }[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n as Text;
      for (let i = 0; i < text.data.length; i++)
        chars.push({ node: text, offset: i });
    }
    if (chars.length < 120) continue;
    const range = document.createRange();
    const tops: number[] = [];
    for (const c of chars) {
      range.setStart(c.node, c.offset);
      range.setEnd(c.node, c.offset + 1);
      const rect = range.getClientRects()[0];
      tops.push(rect ? Math.round(rect.top) : NaN);
    }
    const lines: number[] = [];
    let current = 0;
    let top = tops[0];
    for (const t of tops) {
      if (Number.isNaN(t)) continue;
      if (top !== undefined && Math.abs(t - top) > 4) {
        lines.push(current);
        current = 0;
        top = t;
      }
      current++;
    }
    lines.push(current);
    const full = lines.slice(0, -1);
    if (full.length < 2) continue;
    paragraphs++;
    lineLengths.push(...full);
    perParagraph.push({
      chars: Math.round(full.reduce((a, b) => a + b, 0) / full.length),
      text: (p.textContent ?? "").trim().slice(0, 60),
    });
  }
  const meanChars =
    lineLengths.reduce((a, b) => a + b, 0) / Math.max(1, lineLengths.length);
  perParagraph.sort(
    (a, b) =>
      Math.abs(b.chars - (60 + 75) / 2) - Math.abs(a.chars - (60 + 75) / 2),
  );
  return {
    paragraphs,
    fullLines: lineLengths.length,
    meanChars,
    worst: perParagraph.slice(0, 3),
  };
}

/** Every guide the index links, and both policy pages. */
async function pages(page: Page): Promise<string[]> {
  await page.goto("/guides");
  const hrefs = await page
    .locator('main a[href^="/guides/"]')
    .evaluateAll((as) => [
      ...new Set(as.map((a) => a.getAttribute("href") ?? "")),
    ]);
  return [
    ...hrefs.filter((h) => /^\/guides\/.+/.test(h)),
    "/privacy",
    "/terms",
  ];
}

test.describe("reading measure", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test(`long-form lines hold ${MIN_CHARS}-${MAX_CHARS} characters`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const urls = await pages(page);
    // The guides index lists the catalogue: 22 guides on 2026-10-09.
    expect(
      urls.length,
      "the guides index links too few guides",
    ).toBeGreaterThan(10);
    const readings: Reading[] = [];
    for (const url of urls) {
      await page.goto(url);
      await page.evaluate(() => document.fonts.ready);
      readings.push({ url, ...(await page.evaluate(measureLines, "main p")) });
    }
    const table = readings
      .map(
        (r) =>
          `${r.url}: ${r.paragraphs} paragraphs, ${r.fullLines} full lines, ` +
          `${r.meanChars.toFixed(1)} chars/line; furthest: ` +
          r.worst.map((w) => `${w.chars} "${w.text}…"`).join(" | "),
      )
      .join("\n");
    console.log(`reading measure:\n${table}`);

    // HEALTH: every page has body paragraphs long enough to wrap. A selector
    // that found nothing would report no line outside the range.
    expect(
      readings.filter((r) => r.paragraphs < 2).map((r) => r.url),
      `pages with fewer than two wrapping paragraphs:\n${table}`,
    ).toEqual([]);

    const off = readings
      .filter((r) => r.meanChars < MIN_CHARS || r.meanChars > MAX_CHARS)
      .map((r) => `${r.url}: ${r.meanChars.toFixed(1)} chars/line`);
    expect(
      off,
      `long-form copy outside a ${MIN_CHARS}-${MAX_CHARS} character measure:\n${table}`,
    ).toEqual([]);
  });

  test("the line counter counts (positive control)", async ({ page }) => {
    await page.goto("/");
    // A paragraph forced to 300 px and one forced to 1200 px, through the SAME
    // counter: one must read short, one long, or the counter is blind.
    await page.evaluate(() => {
      const text =
        "Combine PDFs into one, in any order, and nothing is uploaded unless a tool says so. ".repeat(
          6,
        );
      for (const w of [300, 1200]) {
        const p = document.createElement("p");
        p.className = `probe-${w}`;
        p.style.cssText = `width:${w}px;font-size:16px`;
        p.textContent = text;
        document.body.appendChild(p);
      }
    });
    const narrow = await page.evaluate(measureLines, ".probe-300");
    const wide = await page.evaluate(measureLines, ".probe-1200");
    expect(narrow.paragraphs).toBe(1);
    expect(wide.paragraphs).toBe(1);
    expect(narrow.meanChars).toBeLessThan(MIN_CHARS);
    expect(wide.meanChars).toBeGreaterThan(MAX_CHARS);
  });
});
