import { test, expect } from "@playwright/test";
import { fileInput, waitForHydration } from "./helpers";
import {
  addOutline,
  blankPages,
  fitDest,
} from "../src/tests/bookmark-fixtures";

/**
 * Edit PDF Bookmarks' rows on a 375 px phone, three levels deep: every
 * control a thumb presses — the expand button, the title and page fields,
 * "More actions" and each button it discloses — is a 44 px target inside the
 * screen, and the page does not scroll sideways.
 */
const MIN = 44;
const SCREEN = 375;

test.use({ viewport: { width: SCREEN, height: 812 } });

async function nested(): Promise<Buffer> {
  const doc = await blankPages(3);
  addOutline(doc, [
    {
      title: "A chapter with a long title that has to wrap on a phone",
      dest: fitDest(doc, 0),
      open: true,
      kids: [
        {
          title: "A section",
          dest: fitDest(doc, 1),
          open: true,
          kids: [{ title: "A subsection", dest: fitDest(doc, 2) }],
        },
      ],
    },
  ]);
  return Buffer.from(await doc.save());
}

test("every bookmark control is a 44 px target inside a 375 px screen", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/tools/edit-pdf-bookmarks");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "nested.pdf",
    mimeType: "application/pdf",
    buffer: await nested(),
  });
  const deepest = page.getByRole("textbox", { name: "Title, level 3, 1 of 1" });
  await expect(deepest).toHaveValue("A subsection");
  await page
    .getByRole("button", { name: "More actions for “A subsection”" })
    .click();
  const actions = page.getByRole("group", {
    name: "Actions for “A subsection”",
  });
  await expect(actions).toBeVisible();
  const row = page.locator("li", { has: deepest }).last();
  const targets = [
    deepest,
    page.getByRole("textbox", { name: "Page for “A subsection”" }),
    page.getByRole("button", { name: "More actions for “A subsection”" }),
    page.getByRole("button", { name: "Bookmarks inside “A section”" }),
    ...(await actions.getByRole("button").all()),
  ];
  expect(targets.length).toBeGreaterThanOrEqual(11);
  for (const target of targets) {
    await target.scrollIntoViewIfNeeded();
    const b = (await target.boundingBox())!;
    const label =
      (await target.getAttribute("aria-label")) ??
      (await target.inputValue().catch(() => "?"));
    expect(b.height, `${label} height`).toBeGreaterThanOrEqual(MIN - 0.5);
    expect(b.width, `${label} width`).toBeGreaterThanOrEqual(MIN - 0.5);
    expect(b.x, `${label} left edge`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, `${label} right edge`).toBeLessThanOrEqual(
      SCREEN + 1,
    );
  }
  await expect(row).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(SCREEN);
});
