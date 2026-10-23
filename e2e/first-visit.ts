import { expect, test, type Page } from "@playwright/test";
import { getAllToolSlugs } from "../src/lib/tools";
import { getRunnerKind } from "../src/lib/pdf/registry";

/**
 * A tool page as a FIRST-TIME visitor meets it (owner, 2026-10-23: "/tools
 * is still not user-friendly"), at one screen size: the tool's working
 * surface in the first screen, nothing stamped before a job, and a page a
 * reader can get to the end of.
 *
 * Measured on production and on 0504da27 the same day, before this change:
 *
 *     main, 1440 x 900   merge-pdf 3,969  pdf-to-word 4,653  compress-pdf 3,991  sign-pdf 4,082
 *     main,  390 x 844   merge-pdf 6,413  pdf-to-word 8,094  compress-pdf 6,317  sign-pdf 6,664
 *
 * (the footer, 1,209 and 1,927px, is not this page's and is not counted).
 * The pages kept every word; they showed it all at once — a stage list of
 * five unticked rows, the introduction's every paragraph, every FAQ answer.
 * `src/app/tools/tool-page-layout.test.ts` holds, on the served markup, that
 * the words are still there and which of them are one press away.
 *
 * Shared by `tool-page-first-visit.spec.ts` (1440, desktop project) and
 * `tool-page-first-visit.mobile.spec.ts` (390, the phone project), so the
 * two sizes ask exactly the same questions.
 */
export function firstVisitSuite(size: {
  width: number;
  height: number;
  /** The most `main` may measure on each of the four pages the owner reads. */
  mainCeiling: number;
}): void {
  const { width, height, mainCeiling } = size;

  test.describe(`${width}px: a first visit`, () => {
    test.use({ viewport: { width, height } });

    test(`health: every tool page is asked (${getAllToolSlugs().length})`, () => {
      expect(getAllToolSlugs().length).toBeGreaterThanOrEqual(45);
    });

    for (const slug of getAllToolSlugs()) {
      test(`/tools/${slug}: the panel, its drop area and its first control sit in the first screen`, async ({
        page,
      }) => {
        await page.goto(`/tools/${slug}`);
        const where = await surface(page);
        // Health: each was found.
        expect(where.panel, "no panel").not.toBeNull();
        expect(where.target, "no drop area or address field").not.toBeNull();
        expect(where.panel!, `panel top at ${width}`).toBeLessThan(
          height * 0.6,
        );
        expect(
          where.target!.bottom,
          `drop area at ${width}`,
        ).toBeLessThanOrEqual(height);
        if (!getRunnerKind(slug)) {
          // A worker panel's Run is drawn from the first paint. Where the
          // tool asks for something between the file and Run (a password,
          // a language, signers), the first of those questions is the next
          // control, so it is that one that must start on screen.
          expect(where.run, "no Run control").not.toBeNull();
          if (where.firstOption)
            expect(
              where.firstOption.top,
              `first option at ${width}`,
            ).toBeLessThan(height);
          else
            expect(where.run!.bottom, `Run at ${width}`).toBeLessThanOrEqual(
              height,
            );
        }
      });
    }

    for (const slug of [
      "merge-pdf",
      "pdf-to-word",
      "compress-pdf",
      "sign-pdf",
    ]) {
      test(`/tools/${slug}: the page is no taller than ${mainCeiling}px`, async ({
        page,
      }) => {
        await page.goto(`/tools/${slug}`);
        await page.evaluate(() => document.fonts.ready);
        const main = await page
          .locator("main")
          .evaluate((el) => Math.round(el.getBoundingClientRect().height));
        // Health: a page was measured, not an empty shell.
        expect(main).toBeGreaterThan(height * 0.8);
        expect(main, `${slug} main at ${width}`).toBeLessThanOrEqual(
          mainCeiling,
        );
      });
    }

    test("/tools/pdf-to-word: before a job no stage list is drawn; one press shows each step", async ({
      page,
    }) => {
      await page.goto("/tools/pdf-to-word");
      await expect(page.locator("[data-docket]")).toHaveCount(0);
      await expect(page.getByText("Auto-delete", { exact: true })).toBeHidden();
      const toggle = page.getByRole("button", {
        name: "What happens to your file",
      });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(
        page.getByText("Auto-delete", { exact: true }),
      ).toBeVisible();
    });

    test("/tools/merge-pdf: the FAQ's answers are closed, and one opens on a press", async ({
      page,
    }) => {
      await page.goto("/tools/merge-pdf");
      const faq = page.locator("[data-tool-faq] details");
      expect(await faq.count()).toBeGreaterThanOrEqual(5);
      for (const item of await faq.all())
        await expect(item).not.toHaveAttribute("open", /.*/);
      const first = faq.first();
      await first.locator("summary").click();
      await expect(first).toHaveAttribute("open", /.*/);
      await expect(first.locator("p").first()).toBeVisible();
    });
  });
}

/** Page-coordinate tops and bottoms of the panel, its drop area, its first question, and Run. */
async function surface(page: Page) {
  const panel = page.locator("[data-tool-panel]").first();
  await panel.waitFor({ state: "attached" });
  return page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top + window.scrollY),
        bottom: Math.round(r.bottom + window.scrollY),
      };
    };
    const root = document.querySelector("[data-tool-panel]");
    const target =
      root?.querySelector(
        '[data-page-drop-target], input[type="url"], textarea',
      ) ?? null;
    const run =
      root?.querySelector('[data-slot="worker-status"] button') ?? null;
    // A question the panel asks between the file and Run: a field, a
    // choice, a list — found by what it is, never by the tool's name.
    const firstOption =
      target && run
        ? ([
            ...(root?.querySelectorAll(
              'input:not([type="file"]):not([type="hidden"]), select, textarea, [role="radiogroup"]',
            ) ?? []),
          ].find(
            (el) =>
              !target.contains(el) &&
              target.compareDocumentPosition(el) &
                Node.DOCUMENT_POSITION_FOLLOWING &&
              el.compareDocumentPosition(run) &
                Node.DOCUMENT_POSITION_FOLLOWING,
          ) ?? null)
        : null;
    return {
      panel: box(root)?.top ?? null,
      target: box(target),
      run: box(run),
      firstOption: box(firstOption),
    };
  });
}
