import { test, expect } from "@playwright/test";
import { fileInput, makePdfBytes, waitForHydration } from "./helpers";
import {
  HANDWRITING_STYLES,
  SIGNATURE_STYLES,
  SIGNATURE_STYLE_LABEL,
} from "../src/lib/pdf/offered-kinds";

/**
 * The typed signature's Style options on a 375 px phone (audit sign-pdf#1):
 * every option a 44 px target, all of them inside the screen, and none of
 * them changing size when its handwriting face arrives. The styles are read
 * from the model, so a style added there is measured here.
 */
const MIN = 44;
const SCREEN = 375;

test.use({ viewport: { width: SCREEN, height: 812 } });

test("every Style option is a 44 px target inside a 375 px screen, and keeps its box when the face lands", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/tools/sign-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "contract.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await makePdfBytes("contract", 1)),
  });
  await page.getByRole("tab", { name: "Type" }).click();
  await page.getByLabel("Your name").fill("Ada Lovelace");
  const group = page.getByRole("radiogroup", { name: "Style" });
  await group.scrollIntoViewIfNeeded();

  const boxes = async () => {
    const out: { name: string; x: number; w: number; h: number }[] = [];
    for (const s of SIGNATURE_STYLES) {
      const radio = group.getByRole("radio", {
        name: SIGNATURE_STYLE_LABEL[s],
        exact: true,
      });
      const b = (await radio.boundingBox())!;
      out.push({ name: s, x: b.x, w: b.width, h: b.height });
    }
    return out;
  };

  const before = await boxes();
  expect(before).toHaveLength(SIGNATURE_STYLES.length);
  for (const b of before) {
    expect(b.w, `${b.name} width`).toBeGreaterThanOrEqual(MIN - 0.5);
    expect(b.h, `${b.name} height`).toBeGreaterThanOrEqual(MIN - 0.5);
    expect(b.x, `${b.name} left edge`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w, `${b.name} right edge`).toBeLessThanOrEqual(SCREEN + 1);
  }

  // Wait for every face, then measure again: nothing moved or grew.
  await page.waitForFunction(() => document.fonts.status === "loaded");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          [...document.fonts].filter(
            (f) => f.family.includes("pdfxyz-hand-") && f.status === "loaded",
          ).length,
      ),
    )
    .toBe(HANDWRITING_STYLES.length);
  expect(await boxes()).toEqual(before);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(SCREEN);
});
