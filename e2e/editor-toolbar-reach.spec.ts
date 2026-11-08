import { expect, test } from "@playwright/test";
import { uploadFiles, writeTempPdf } from "./helpers";

/**
 * Every editor tool can be reached at every width.
 *
 * From `sm` the toolbar does not scroll: its groups wrap, and the strip
 * around it clips anything that sticks out (`overflow-x: clip`). A group
 * that cannot wrap its own tools therefore loses the ones past the edge,
 * silently. On 2026-11-08 wave 3 put nine tools in the Markup group (852px
 * of buttons), and at 768px Note and Comment were cut off and could not be
 * pressed. PR #288's CI caught it only because continue-chain happened to
 * press Note at 768 x 1024. This asks the question for every tool, for the
 * editor's tools, at the widths around the breakpoint.
 *
 * On a phone (below `sm`) the strip scrolls sideways instead. There a tool
 * past the edge is reachable by scrolling, so the check there is that the
 * strip really scrolls to it.
 */
const TOOLS = ["annotate-pdf", "edit-pdf"] as const;
const WIDTHS = [640, 768, 1024, 1280] as const;

for (const slug of TOOLS) {
  for (const width of WIDTHS) {
    test(`${slug} at ${width}px: every editor tool sits inside the toolbar's visible box`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tools/${slug}`);
      await uploadFiles(page, await writeTempPdf("reach.pdf", 1));
      const toolbar = page.getByRole("toolbar", { name: "Editor tools" });
      await expect(toolbar).toBeVisible({ timeout: 30_000 });
      const report = await toolbar.evaluate((strip) => {
        const clip = strip.parentElement!.getBoundingClientRect();
        return [...strip.querySelectorAll("button")].map((b) => {
          const r = b.getBoundingClientRect();
          return {
            name: b.getAttribute("title") ?? b.textContent?.trim() ?? "",
            inside: r.left >= clip.left - 0.5 && r.right <= clip.right + 0.5,
            left: Math.round(r.left),
            right: Math.round(r.right),
            clip: [Math.round(clip.left), Math.round(clip.right)],
          };
        });
      });
      // Health: the editor's tool buttons were measured, not an empty strip.
      expect(report.length).toBeGreaterThan(8);
      expect(
        report.filter((b) => !b.inside),
        `tools past the toolbar's edge at ${width}px`,
      ).toEqual([]);
    });
  }

  test(`${slug} on a phone: the strip scrolls to its last tool`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/tools/${slug}`);
    await uploadFiles(page, await writeTempPdf("reach.pdf", 1));
    const toolbar = page.getByRole("toolbar", { name: "Editor tools" });
    await expect(toolbar).toBeVisible({ timeout: 30_000 });
    const last = toolbar.locator("button").last();
    await last.scrollIntoViewIfNeeded();
    const inside = await toolbar.evaluate((strip) => {
      const clip = strip.parentElement!.getBoundingClientRect();
      const r = [...strip.querySelectorAll("button")]
        .at(-1)!
        .getBoundingClientRect();
      return r.left >= clip.left - 0.5 && r.right <= clip.right + 0.5;
    });
    expect(inside, "the last tool could not be scrolled into view").toBe(true);
  });
}
