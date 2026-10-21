import { expect, test } from "@playwright/test";

/**
 * The home page's account of how it works, as served.
 *
 * INVERTED 2026-10-21, history kept. Until then this file held the workflow
 * narrative (design spec D.2, WP-13): the heading "One file, many tools,
 * without picking it again.", three steps, and five `data-station` items in
 * chain order (merge-pdf, compress-pdf, page-numbers, sign-pdf, download),
 * each a hook for WP-12's scroll lighting (M19). The owner's plain redesign
 * replaced the section with three steps in a first-time visitor's words; the
 * narrative must not come back half-retired (a stale build, a dropped
 * import), so its heading and its stations are asserted ABSENT from the
 * served page, and the new steps present.
 */
const RETIRED_HEADING = "One file, many tools, without picking it again.";
const STEPS = ["Choose your files", "Pick a tool", "Download the result"];

test("the served home page says how it works in three plain steps", async ({
  request,
}) => {
  const res = await request.get("/");
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain("How it works");
  for (const step of STEPS) expect(html).toContain(step);
  expect(html).not.toContain(RETIRED_HEADING);
  expect(html).not.toMatch(/data-station=/);
});

test("the steps render in order, and the first one opens the desk", async ({
  page,
}) => {
  await page.goto("/");
  const section = page
    .getByRole("heading", { level: 2, name: "How it works" })
    .locator("xpath=ancestor::section[1]");
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole("heading", { level: 3 })).toHaveText(STEPS);
  await expect(
    section.getByRole("link", { name: "Choose files" }),
  ).toHaveAttribute("href", "#upload");
});
