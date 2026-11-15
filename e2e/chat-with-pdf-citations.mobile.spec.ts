import { test, expect, type Page } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import {
  askThreeFills,
  axeViolations,
  citationBoxes,
  mockChatWorker,
} from "./chat-citations-fixture";

/**
 * Citations on a 375px touch phone (audit #30, review 2026-11-15).
 *
 * WHAT THE REVIEW FOUND: each citation button wore `tap-y`, which grows a
 * one-line button to 44px with a NEGATIVE block margin — "without moving
 * what is around it". In a wrapping answer with a ~23px line, the 44px boxes
 * of markers on neighbouring lines overlapped by about 20px, and the later
 * one painted on top: a tap on the centre of the "[p.1]" glyphs opened
 * "Page 3 of 3". Markers were also 26-30px wide. Desktop clicks were right,
 * so nothing but a touch tap on a stacked answer could see it.
 *
 * The tap below is aimed at the GLYPHS (a Range over the button's text), not
 * the button's box: the box is what the defect made wrong. The control is
 * the same tap with nothing cited on the line below.
 */

test.use({ viewport: { width: 375, height: 812 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

const QUESTION = "Where is the rent?";

/** The centre of `label`'s text glyphs, in viewport pixels. */
async function glyphCentre(page: Page, label: string) {
  const button = page.getByRole("button", { name: label });
  await expect(button).toBeVisible({ timeout: 20_000 });
  return button.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

async function tapOpens(page: Page, label: string): Promise<string> {
  const { x, y } = await glyphCentre(page, label);
  await page.touchscreen.tap(x, y);
  const heading = page.getByRole("dialog").getByRole("heading");
  await expect(heading).toBeVisible();
  const text = (await heading.textContent()) ?? "";
  await page.getByRole("button", { name: "Close" }).tap();
  await expect(page.getByRole("dialog")).toBeHidden();
  return text;
}

test("a tap on a marker opens its own page when the next line cites another", async ({
  page,
}) => {
  await mockChatWorker(page, QUESTION, "Rent [p.1]\nRent [p.3]", [1, 3]);
  await askThreeFills(page, QUESTION);
  expect(await tapOpens(page, "Show page 1 of your PDF")).toBe("Page 1 of 3");
  expect(await tapOpens(page, "Show page 3 of your PDF")).toBe("Page 3 of 3");
});

test("control: the same tap with nothing cited below", async ({ page }) => {
  await mockChatWorker(page, QUESTION, "Rent [p.1]\nRent is more text", [1]);
  await askThreeFills(page, QUESTION);
  expect(await tapOpens(page, "Show page 1 of your PDF")).toBe("Page 1 of 3");
});

test("every citation is a 44px target that overlaps no other, and axe passes", async ({
  page,
}) => {
  const answer =
    "Forms: [p.2] and [p.1, p.3] and [p.3, 2] and [pp. 2-3]. Close: [p.2] [p.3].\nRent [p.1]\nRent [p.3]";
  await mockChatWorker(page, QUESTION, answer, [1, 2, 3]);
  await askThreeFills(page, QUESTION);
  await expect(
    page.getByRole("button", { name: "Show page 1 of your PDF" }),
  ).toBeVisible({ timeout: 20_000 });

  const boxes = await citationBoxes(page);
  expect(boxes.length).toBe(8);
  for (const box of boxes) {
    expect(box.height, box.text).toBeGreaterThanOrEqual(44);
    expect(box.width, box.text).toBeGreaterThanOrEqual(44);
  }
  // No two boxes share a pixel: overlap is what sent a tap to the wrong page.
  const rects = await page
    .getByRole("button", { name: /^Show pages? / })
    .evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return [r.left, r.top, r.right, r.bottom] as const;
      }),
    );
  const overlaps: string[] = [];
  rects.forEach((a, i) =>
    rects.slice(i + 1).forEach((b, j) => {
      const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
      const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      if (w > 0.5 && h > 0.5) overlaps.push(`${i} x ${i + 1 + j}`);
    }),
  );
  expect(overlaps).toEqual([]);
  // Nothing wider than the screen.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
  expect(await axeViolations(page)).toEqual([]);
});
