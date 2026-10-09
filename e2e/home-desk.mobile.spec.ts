import { test, expect } from "@playwright/test";
import { uploadFiles, waitForHydration, writeTempPdf } from "./helpers";

/**
 * The home desk on a phone (390×844, touch — this project's device): the
 * thing a visitor can use is on the first screen, whole, in both its states.
 *
 * Measured, not assumed: the desk's top edge under 320px and its bottom
 * under 750px (redesign WP-05), with the files' ticket in the SAME box as the
 * empty desk — the swap changes what is drawn, not the height, so nothing
 * under the desk moves when files arrive.
 */

const box = (page: import("@playwright/test").Page) =>
  page.locator("[data-desk-stack] > [data-live]").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top + window.scrollY),
      bottom: Math.round(r.bottom + window.scrollY),
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });

test("the desk is on the first screen, and the ticket takes its place at the same size", async ({
  page,
}) => {
  await page.goto("/");
  await waitForHydration(page.locator("[data-desk]"));
  const idle = await box(page);
  // Health: the phone viewport applied.
  expect(idle.width).toBe(390);
  expect(
    idle.top,
    "the desk starts below the first screen's top third",
  ).toBeLessThan(320);
  expect(idle.bottom, "the desk runs off the first screen").toBeLessThan(750);
  // Touch: no "drop them anywhere" — there is no pointer to drag with.
  await expect(
    page.getByText("or drop them anywhere on this page"),
  ).toBeHidden();

  await uploadFiles(page, [
    await writeTempPdf("contract.pdf", 3),
    await writeTempPdf("annex.pdf", 1),
  ]);
  const ticket = page.getByRole("region", {
    name: "What you can do with these files",
  });
  await expect(
    ticket.locator('[data-slot="suggestions"] ol > li').first(),
  ).toBeVisible();
  const withFiles = await box(page);
  expect(withFiles).toEqual(idle);
  expect(
    withFiles.scrollWidth,
    "the page scrolls sideways",
  ).toBeLessThanOrEqual(withFiles.width);
});

test("each task shows where its tool runs, and the legend says what the shapes mean", async ({
  page,
}) => {
  await page.goto("/");
  const tasks = page.getByRole("list", { name: "Start from a task" });
  const links = tasks.getByRole("link");
  await expect(links).toHaveCount(6);
  // The mode word is not drawn on a phone, but it is in each link's name.
  await expect(
    tasks.getByRole("link", {
      // The sr-only word is a separate box: the name puts a space before it.
      name: /^Make a scan searchable\s?, Secure worker$/,
    }),
  ).toBeVisible();
  for (const link of await links.all())
    expect(
      await link.locator("svg[aria-hidden]").count(),
    ).toBeGreaterThanOrEqual(2);
  await expect(page.getByText("uploads only when you start it")).toBeVisible();
});
