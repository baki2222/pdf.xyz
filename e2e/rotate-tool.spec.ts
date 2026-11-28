import { test, expect } from "@playwright/test";
import { attachConsoleGuard, writeTempPdf, uploadFiles } from "./helpers";
import { injectAxe } from "./axe-inject";

/**
 * End-to-end proof that the single-file rotate runner works entirely in the
 * browser: we generate a multi-page PDF, stage it, rotate every page, apply the
 * change, and get a downloadable result — all under the production CSP, which
 * also has to permit the pdfjs worker + wasm that render the page previews.
 */
test("rotate spins every page client-side and yields a download", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  const source = await writeTempPdf("spin.pdf", 4);

  await page.goto("/tools/rotate-pdf");

  await uploadFiles(page, source);

  // The editor mounts once the PDF is parsed: the file header names the doc.
  await expect(page.getByText("spin.pdf")).toBeVisible();

  // Nothing has changed yet, so applying is a no-op and stays disabled.
  const applyButton = page.getByRole("button", { name: /apply rotation/i });
  await expect(applyButton).toBeDisabled();

  // ...and being unavailable must not take it away from the keyboard. This is
  // the half of the run-trigger fix that only a real browser can prove: jsdom
  // neither blurs an element when it becomes disabled nor refuses to dispatch a
  // click at one, so the unit tests can pin the attributes but not the
  // consequence. A blocked trigger and a mid-run trigger are the same `blocked`
  // branch of `RunButton`, and the mid-run one cannot be caught here — a
  // client-side rotate finishes faster than an assertion can land.
  await applyButton.focus();
  await expect(applyButton).toBeFocused();

  // All pages are selected by default; rotate them a quarter turn right.
  await page.getByRole("button", { name: "Right", exact: true }).click();

  await expect(applyButton).toBeEnabled();
  await applyButton.click();

  await expect(
    page.getByRole("heading", { name: /pdf rotated/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /download rotated pdf/i }),
  ).toBeVisible();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
});

/**
 * A page's own Left/Right buttons, pressed from the keyboard in a real
 * browser. Found by the 2026-11-18 after-upload axe sweep on production
 * (nested-interactive): the buttons sat inside the page tile, itself a
 * role=button that cancels Enter and Space to toggle its selection, so Enter
 * on "Rotate page 1 right" deselected page 1 and turned nothing. The unit
 * test models the browser's activation; this one is the browser.
 */
test("a page's rotate buttons work from the keyboard and leave its selection alone", async ({
  page,
}) => {
  const source = await writeTempPdf("keys.pdf", 2);
  await page.goto("/tools/rotate-pdf");
  await uploadFiles(page, source);
  await expect(page.getByText("keys.pdf")).toBeVisible();

  const tile = (n: number) =>
    page.getByRole("button", { name: `Page ${n}`, exact: true });
  // The rotation badge: "90" + U+00B0, drawn inside the tile once turned.
  const turned = (deg: number) => `${deg}°`;

  // Health check: both tiles are there, and nothing nests a button in one.
  await expect(tile(1)).toBeVisible();
  await expect(tile(2)).toBeVisible();
  const nesting = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('[role="button"]'));
    return {
      tiles: tiles.length,
      nested: tiles.filter((t) => t.querySelector('button, [role="button"]'))
        .length,
    };
  });
  expect(nesting.tiles).toBeGreaterThanOrEqual(2);
  expect(nesting.nested).toBe(0);
  // The rule the production sweep failed, run by axe itself on the loaded
  // page (e2e/axe.spec.ts holds its positive control for this rule).
  await injectAxe(page);
  const axeNested = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            ctx: Document,
            opts: object,
          ) => Promise<{ violations: { nodes: { target: string[] }[] }[] }>;
        };
      }
    ).axe;
    const r = await axe.run(document, {
      runOnly: { type: "rule", values: ["nested-interactive"] },
    });
    return r.violations.flatMap((v) => v.nodes.map((n) => n.target.join(" ")));
  });
  expect(axeNested).toEqual([]);

  await expect(tile(1)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Rotate page 1 right" }).focus();
  await page.keyboard.press("Enter");
  await expect(tile(1)).toContainText(turned(90));
  await expect(tile(1)).toHaveAttribute("aria-pressed", "true");
  await expect(tile(2)).not.toContainText(turned(90));

  await page.getByRole("button", { name: "Rotate page 2 left" }).focus();
  await page.keyboard.press("Space");
  await expect(tile(2)).toContainText(turned(270));
  await expect(tile(2)).toHaveAttribute("aria-pressed", "true");

  // The tile itself still selects from the keyboard.
  await tile(1).focus();
  await page.keyboard.press("Enter");
  await expect(tile(1)).toHaveAttribute("aria-pressed", "false");
  await expect(tile(1)).toContainText(turned(90));

  // A pointer still reaches them (they are laid over the tile, not under it):
  // Playwright's click refuses a button another element would intercept.
  await page.getByRole("button", { name: "Rotate page 1 left" }).click();
  await expect(tile(1)).not.toContainText(turned(90));
  await expect(tile(1)).toHaveAttribute("aria-pressed", "false");

  // ...and they sit where they did inside it: within the tile's box, below
  // its "Page N" label, not over the label or the page preview. Measured in
  // one evaluate, so a scroll still settling after the click above cannot
  // move the tile between two reads.
  const layout = await page.evaluate(() =>
    [1, 2].map((n) => {
      const tileEl = document.querySelector(
        `[role="button"][aria-label="Page ${n}"]`,
      );
      const labelEl = Array.from(tileEl?.querySelectorAll("span") ?? []).find(
        (s) => s.textContent === `Page ${n}`,
      );
      const rect = (el: Element | null | undefined) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      return {
        n,
        tile: rect(tileEl),
        label: rect(labelEl),
        buttons: ["left", "right"].map((side) =>
          rect(
            document.querySelector(`[aria-label="Rotate page ${n} ${side}"]`),
          ),
        ),
      };
    }),
  );
  for (const { n, tile: box, label, buttons } of layout) {
    expect(box && label, `tile ${n} and its label are laid out`).toBeTruthy();
    // Health check: both buttons were found, so the loop below is not empty.
    expect(buttons.filter(Boolean), `tile ${n}'s buttons`).toHaveLength(2);
    for (const b of buttons) {
      expect(b!.top).toBeGreaterThanOrEqual(label!.bottom);
      expect(b!.bottom).toBeLessThanOrEqual(box!.bottom);
      expect(b!.left).toBeGreaterThanOrEqual(box!.left);
      expect(b!.right).toBeLessThanOrEqual(box!.right);
    }
  }
});
