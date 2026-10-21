import { expect, test } from "@playwright/test";

/**
 * The home page's workflow narrative, as served (design spec D.2, WP-13).
 *
 * `feature-claims.test.ts` holds the copy and its gates against a render in
 * the test process; this reads the HTML the server SENDS, so a section that
 * was correct and never reached the page (a stale build, a dropped import)
 * cannot pass. The stations carry `data-station` in chain order, and each
 * one carries the hook WP-12's scroll-driven lighting (M19) attaches to.
 */
const HEADING = "One file, many tools, without picking it again.";
const STEPS = [
  "Drop a file anywhere — the tab reads it, nothing uploads.",
  "Open the tool we suggest, with the reason we suggest it.",
  "Every PDF made in your browser offers the next tool, with the file already loaded.",
];

test("the served home page carries the final narrative", async ({
  request,
}) => {
  const res = await request.get("/");
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain(HEADING);
  for (const step of STEPS) expect(html).toContain(step);
});

test("the stations render in chain order, each a lighting hook", async ({
  page,
}) => {
  await page.goto("/");
  const section = page.locator("[data-workflow]");
  await section.scrollIntoViewIfNeeded();
  await expect(
    section.getByRole("heading", { level: 2, name: HEADING }),
  ).toBeVisible();
  const stations = await section
    .locator("[data-station]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-station")));
  expect(stations).toEqual([
    "merge-pdf",
    "compress-pdf",
    "page-numbers",
    "sign-pdf",
    "download",
  ]);
  // Each station is a hook WP-12's M19 lights: the class is present, and
  // nothing animates it yet.
  const hooked = await section
    .locator("[data-station].workflow-station")
    .count();
  expect(hooked).toBe(stations.length);
});
