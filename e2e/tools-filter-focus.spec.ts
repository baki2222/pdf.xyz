import { expect, test, type Locator, type Page } from "@playwright/test";
import { toolFamilies } from "../src/lib/tools/families";
import { waitForHydration } from "./helpers";

/**
 * The /tools filter chips and the "keep files on your device" checkbox (the
 * "Where it runs" radios until 2026-10-23), reached by keyboard:
 * the focus indicator a reader SEES — its colour against the page, whether
 * any of it is cut off — and whether the focused chip is on screen at all.
 *
 * WHAT SHIPPED (review of WP-06, 2026-10-10). The base build drew the site's
 * focus outline on these controls: 2px solid accent, 2px out, 7.40:1 against
 * the light canvas and 9.30:1 against the dark. WP-06 replaced it with a
 * half-strength ring (`ring-accent/50`): 2.41:1 in light, under WCAG 1.4.11's
 * 3:1, and 3.13:1 in dark. On a phone it was worse: the filter row scrolls
 * sideways, so it clips, and it was exactly as tall as a chip — the ring's
 * top and bottom were cut away, leaving two faint vertical edges. And a chip
 * tabbed to near the right edge stayed where it was, under the row's fade,
 * half off the screen ("To PDF" at x=321..406 on a 390px screen). No guard
 * saw any of it: the contrast audit measures text.
 *
 * So each case Tabs (and, inside the radio group, arrows) through every
 * control, and for each one reads, in the browser:
 *  - the indicator: the computed outline, or else a box-shadow ring; its
 *    colour composited over the page's own background, held to 3:1;
 *  - its box (the control grown by the outline's offset and width, or the
 *    ring's spread), held inside every ancestor that clips and inside the
 *    screen — unclipped on every side;
 *  - on a phone, the control itself inside its row's inset (the row's
 *    scroll-padding, which clears the fade at its ends).
 *
 * Health: every chip and the checkbox are visited, and a control with no
 * indicator at all fails rather than measuring nothing.
 *
 * 2026-10-23: one row of chips — the home page's families, "All" first —
 * and under it the checkbox, which never scrolls; the radio group and its
 * row are gone. The chips are still a sideways-scrolling line on a phone.
 */

/** "All" plus one chip per family. */
const CHIPS = toolFamilies().length + 1;
const CHIP_ROW = { name: "Filter tools by category" } as const;

interface FocusReading {
  name: string;
  kind: "outline" | "ring" | "none";
  color: string;
  /** WCAG contrast of the indicator, composited over the page background. */
  contrast: number;
  /** Pixels of the indicator cut off by a clipping ancestor or the screen. */
  clipped: { top: number; right: number; bottom: number; left: number };
  /** The control against its row's inset (phone rows only). */
  inset: { left: number; right: number } | null;
}

/** Runs in the page: the focused control's indicator, measured. */
function readFocus(): FocusReading {
  const focused = document.activeElement as HTMLElement | null;
  if (!focused) throw new Error("nothing has focus");
  // A radio is a visually hidden input: its label is what the reader sees.
  const control =
    focused instanceof HTMLInputElement && focused.type === "radio"
      ? (focused.closest("label") as HTMLElement)
      : focused;
  const style = getComputedStyle(control);
  const box = control.getBoundingClientRect();

  // The indicator: an outline first, else the widest non-inset box-shadow.
  let kind: FocusReading["kind"] = "none";
  let color = "transparent";
  let reach = 0;
  const outlineWidth = parseFloat(style.outlineWidth) || 0;
  if (style.outlineStyle !== "none" && outlineWidth > 0) {
    kind = "outline";
    color = style.outlineColor;
    reach = outlineWidth + (parseFloat(style.outlineOffset) || 0);
  } else if (style.boxShadow && style.boxShadow !== "none") {
    // `color x y blur spread` per layer, colour first as Chrome serialises.
    const layers = style.boxShadow.split(/,(?![^(]*\))/);
    for (const layer of layers) {
      if (/\binset\b/.test(layer)) continue;
      const colorMatch = layer.match(
        /^\s*((?:rgba?|oklab|oklch|color)\([^)]*\)|#\w+)/,
      );
      const lengths = layer
        .replace(colorMatch?.[0] ?? "", "")
        .trim()
        .split(/\s+/)
        .map((v) => parseFloat(v));
      const spread = lengths[3] ?? 0;
      if (colorMatch && spread > reach) {
        kind = "ring";
        color = colorMatch[1]!;
        reach = spread;
      }
    }
  }

  // Composite the indicator over the page's background, as painted.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const pageBg = getComputedStyle(document.body).backgroundColor;
  const paint = (fill: string) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = pageBg;
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  };
  const luminance = ([r, g, b]: number[]) => {
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
  };
  const a = luminance(paint(color));
  const b = luminance(paint(pageBg));
  const contrast =
    kind === "none" ? 0 : (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  // The indicator's box, against every clipping ancestor and the screen.
  const ind = {
    top: box.top - reach,
    right: box.right + reach,
    bottom: box.bottom + reach,
    left: box.left - reach,
  };
  const clip = {
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    left: 0,
  };
  let row: HTMLElement | null = null;
  for (let el = control.parentElement; el; el = el.parentElement) {
    const s = getComputedStyle(el);
    if (s.overflowX === "visible" && s.overflowY === "visible") continue;
    const r = el.getBoundingClientRect();
    // Overflow clips at the padding box.
    const left = r.left + el.clientLeft;
    const top = r.top + el.clientTop;
    clip.top = Math.max(clip.top, top);
    clip.left = Math.max(clip.left, left);
    clip.right = Math.min(clip.right, left + el.clientWidth);
    clip.bottom = Math.min(clip.bottom, top + el.clientHeight);
    if (!row && el.scrollWidth > el.clientWidth) row = el;
  }
  const over = (n: number) => Math.max(0, Math.round(n * 10) / 10);
  let inset: FocusReading["inset"] = null;
  if (row) {
    const r = row.getBoundingClientRect();
    const rs = getComputedStyle(row);
    inset = {
      left: box.left - (r.left + (parseFloat(rs.scrollPaddingLeft) || 0)),
      right:
        r.left +
        row.clientWidth -
        (parseFloat(rs.scrollPaddingRight) || 0) -
        box.right,
    };
  }
  return {
    name: (control.textContent ?? "").replace(/\s+/g, " ").trim(),
    kind,
    color,
    contrast: Math.round(contrast * 100) / 100,
    clipped: {
      top: over(clip.top - ind.top),
      right: over(ind.right - clip.right),
      bottom: over(ind.bottom - clip.bottom),
      left: over(clip.left - ind.left),
    },
    inset,
  };
}

/**
 * Focus every filter control, the way a keyboard does: Tab through the
 * chips, then on to the checkbox. Returns a reading per chip, and the
 * checkbox's reading last.
 */
async function visitFilters(page: Page): Promise<FocusReading[]> {
  const chips = page.getByRole("group", CHIP_ROW);
  const readings: FocusReading[] = [];
  // Two frames for the reveal, then until the control's own transitions end:
  // the chips' `transition-colors` animates the outline colour in, and read
  // mid-way it measured 1.31:1 — a reading of 150ms, not of the indicator.
  const settle = () =>
    page.evaluate(async () => {
      await new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      );
      const focused = document.activeElement as HTMLElement;
      const control =
        focused instanceof HTMLInputElement && focused.type === "radio"
          ? (focused.closest("label") as HTMLElement)
          : focused;
      await Promise.all(
        control.getAnimations().map((a) => a.finished.catch(() => undefined)),
      );
    });
  await page.getByRole("searchbox", { name: /search tools/i }).focus();
  for (let i = 0; i < CHIPS; i++) {
    await page.keyboard.press("Tab");
    await expect(chips.getByRole("button").nth(i)).toBeFocused();
    await settle();
    readings.push(await page.evaluate(readFocus));
  }
  await page.keyboard.press("Tab");
  await expect(page.getByRole("checkbox")).toBeFocused();
  await settle();
  readings.push(await page.evaluate(readFocus));
  return readings;
}

/** What each reading must satisfy, as one list of failures. */
function failures(readings: FocusReading[], phone: boolean): string[] {
  const out: string[] = [];
  for (const r of readings) {
    if (r.kind === "none") {
      out.push(`${r.name}: no focus indicator`);
      continue;
    }
    if (r.contrast < 3)
      out.push(
        `${r.name}: indicator ${r.color} is ${r.contrast}:1 against the page`,
      );
    const cut = Object.entries(r.clipped).filter(([, px]) => px > 0.5);
    if (cut.length)
      out.push(
        `${r.name}: indicator clipped ${cut.map(([side, px]) => `${px}px ${side}`).join(", ")}`,
      );
    if (phone) {
      if (!r.inset) out.push(`${r.name}: not in a scrolling row`);
      else if (r.inset.left < -1 || r.inset.right < -1)
        out.push(
          `${r.name}: not wholly revealed — ${Math.round(-Math.min(r.inset.left, r.inset.right))}px past the row's inset`,
        );
    }
  }
  return out;
}

const WIDTHS = [
  {
    name: "phone",
    phone: true,
    use: {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    },
  },
  {
    name: "desktop",
    phone: false,
    use: { viewport: { width: 1440, height: 900 } },
  },
] as const;

for (const scheme of ["light", "dark"] as const) {
  for (const width of WIDTHS) {
    test.describe(`${width.name}, ${scheme}`, () => {
      test.use({ ...width.use, colorScheme: scheme });

      test(`/tools at ${width.use.viewport.width}px, ${scheme}: every filter control shows a focus indicator of 3:1 or more, never clipped${width.phone ? ", and is scrolled wholly into view" : ""}`, async ({
        page,
      }) => {
        await page.goto("/tools");
        await waitForHydration(
          page.getByRole("searchbox", { name: /search tools/i }),
        );
        const readings = await visitFilters(page);
        // Health: every chip and the checkbox were visited, the chips in a
        // row that scrolls on a phone and wraps on a desktop.
        expect(readings).toHaveLength(CHIPS + 1);
        const chips = readings.slice(0, CHIPS);
        const box = readings[CHIPS]!;
        expect(
          chips.filter((r) => r.inset !== null).length,
          "phone rows scroll sideways; desktop rows wrap",
        ).toBe(width.phone ? chips.length : 0);
        expect(box.inset, "the checkbox is not in a scrolling row").toBeNull();
        expect(
          [...failures(chips, width.phone), ...failures([box], false)],
          readings
            .map(
              (r) =>
                `${r.name}: ${r.kind} ${r.color} ${r.contrast}:1 clipped ${JSON.stringify(r.clipped)} inset ${JSON.stringify(r.inset)}`,
            )
            .join("\n"),
        ).toEqual([]);
      });

      // The format chip a deep link adds ("Takes PDF ×") drew the same
      // half-strength ring; it sits in the search row, not a scrolling one.
      test(`/tools?accepts=pdf at ${width.use.viewport.width}px, ${scheme}: the format chip shows a focus indicator of 3:1 or more, never clipped`, async ({
        page,
      }) => {
        await page.goto("/tools?accepts=pdf");
        const chip = page.getByRole("button", { name: /^Takes PDF/ });
        await waitForHydration(chip);
        await page.getByRole("searchbox", { name: /search tools/i }).focus();
        await page.keyboard.press("Tab");
        await expect(chip).toBeFocused();
        await chip.evaluate((el) =>
          Promise.all(
            el.getAnimations().map((a) => a.finished.catch(() => undefined)),
          ),
        );
        const reading = await page.evaluate(readFocus);
        expect(reading.name).toMatch(/^Takes PDF/);
        expect(failures([reading], false), JSON.stringify(reading)).toEqual([]);
      });
    });
  }
}

/**
 * Positive controls: each defect that shipped, put back by a stylesheet and
 * read through the SAME measurement. A control whose defect never landed
 * proves nothing, so each first proves the stylesheet is in the page.
 */
test.describe("positive controls: the shipped indicator, injected, is measured", () => {
  test.use(WIDTHS[0].use);

  async function inject(page: Page, css: string): Promise<Locator> {
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
    return page.locator("style[data-probe]");
  }

  test("a half-strength ring, clipped by a chip-tall row, and a chip left past the edge", async ({
    page,
  }) => {
    // What WP-06 shipped: no outline, a 2px ring at accent/50, and a row
    // with no vertical room.
    const probe = await inject(
      page,
      [
        '[role="group"][aria-label="Filter tools by category"] button:focus-visible{outline:none !important;box-shadow:0 0 0 2px color-mix(in oklab, var(--sf-accent) 50%, transparent) !important}',
        '[role="group"][aria-label="Filter tools by category"]{padding-block:0 !important;margin-block:0 !important}',
      ].join("\n"),
    );
    await page.goto("/tools");
    await expect(probe).toHaveCount(1);
    await waitForHydration(
      page.getByRole("searchbox", { name: /search tools/i }),
    );
    const readings = await visitFilters(page);
    const found = failures(readings.slice(0, CHIPS), true).join("\n");
    expect(found).toMatch(/is 2\.\d+:1 against the page/);
    expect(found).toMatch(/clipped \d+(\.\d+)?px top/);
    // And a focused chip left where it was: the last one, its row put back
    // to the start after the focus — what no reveal on focus looked like.
    // (Back from the checkbox, which the walk ends on.)
    await page.keyboard.press("Shift+Tab");
    const last = page.getByRole("group", CHIP_ROW).getByRole("button").last();
    await expect(last).toBeFocused();
    await last.evaluate((el) => {
      el.closest<HTMLElement>('[role="group"]')!.scrollLeft = 0;
    });
    expect(failures([await page.evaluate(readFocus)], true).join("\n")).toMatch(
      /not wholly revealed — \d+px past the row's inset/,
    );
  });
});
