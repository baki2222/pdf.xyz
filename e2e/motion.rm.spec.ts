import { expect, test, type Page } from "@playwright/test";
import { uploadFiles, waitForHydration, writeTempPdf } from "./helpers";

/**
 * Reduced motion (spec WP-12, F.1 "every motion has a static end state"),
 * run by the `reduced-motion` project: `prefers-reduced-motion: reduce`.
 *
 * At every step a reader takes — load, a drag over the page, the drop, a run
 * and its result, on the home page and on Merge PDF — no animation with a
 * real duration is running. The reset in `globals.css` lands each one on its
 * end state, and a motion added outside `no-preference` (or a script's
 * `animate()` that never asked) shows up here as a running animation.
 *
 * One exception, by name: the spinner (`spin`), which says work is pending
 * and has no still frame that says so. The spec's predicate is "running with
 * a duration over 1ms"; this one also counts a running SCROLL-driven
 * animation, whose duration reads "auto" and would pass that predicate while
 * following the scrollbar.
 */
const EXCEPT = new Set(["spin"]);

async function running(page: Page, step: string): Promise<string[]> {
  return page.evaluate(
    ({ step, except }) =>
      document
        .getAnimations()
        .filter((a) => {
          if (a.playState !== "running") return false;
          // A scroll-driven animation's duration is "auto": it runs as far
          // as the scrollbar, so it is seen by its timeline instead.
          if (a.timeline !== document.timeline) return true;
          const d = a.effect?.getTiming().duration;
          return typeof d === "number" && d > 1;
        })
        .filter((a) => !except.includes((a as CSSAnimation).animationName))
        .map((a) => {
          const t = (a.effect as KeyframeEffect | null)
            ?.target as Element | null;
          const name =
            (a as CSSAnimation).animationName ??
            (a as CSSTransition).transitionProperty ??
            "script";
          return `${step}: ${t?.tagName.toLowerCase() ?? "?"} ${name}`;
        }),
    { step, except: [...EXCEPT] },
  );
}

/** A synthetic drag carrying a PDF, entered over `selector`. */
async function dragOver(page: Page, selector: string) {
  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(
      new File(["%PDF-1.7"], "held.pdf", { type: "application/pdf" }),
    );
    return dt;
  });
  const target = page.locator(selector).first();
  await target.dispatchEvent("dragenter", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer });
  return { target, dataTransfer };
}

test("nothing runs on the home page under reduced motion: load, drag, drop", async ({
  page,
}) => {
  const seen: string[] = [];
  await page.goto("/");
  const desk = page.locator("[data-desk]");
  await waitForHydration(desk);
  seen.push(...(await running(page, "load")));
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await page.waitForTimeout(150);
  seen.push(...(await running(page, "scrolled")));
  await page.evaluate(() => window.scrollTo(0, 0));

  const { dataTransfer } = await dragOver(page, "[data-desk]");
  await expect(page.locator("html")).toHaveAttribute("data-dragging", "");
  await page.waitForTimeout(50);
  seen.push(...(await running(page, "drag")));
  await page
    .locator("[data-desk]")
    .dispatchEvent("dragleave", { dataTransfer });

  await uploadFiles(page, [
    await writeTempPdf("first.pdf", 1),
    await writeTempPdf("second.pdf", 2),
  ]);
  const ticket = page.getByRole("region", {
    name: "What you can do with these files",
  });
  await expect(ticket).toBeVisible();
  seen.push(...(await running(page, "drop")));
  await expect(
    ticket.getByRole("link", { name: /^Open Merge PDF with 2 files$/ }),
  ).toBeVisible();
  seen.push(...(await running(page, "ticket")));

  expect(seen).toEqual([]);
});

test("nothing runs on Merge PDF under reduced motion: load, run, result", async ({
  page,
}) => {
  const seen: string[] = [];
  await page.goto("/tools/merge-pdf");
  await waitForHydration(page.locator('input[type="file"]').first());
  seen.push(...(await running(page, "load")));
  await uploadFiles(page, [
    await writeTempPdf("alpha.pdf", 2),
    await writeTempPdf("beta.pdf", 1),
  ]);
  await expect(page.getByText("beta.pdf")).toBeVisible();
  seen.push(...(await running(page, "staged")));
  await page.getByRole("button", { name: /merge 2 pdfs/i }).click();
  seen.push(...(await running(page, "run")));
  await expect(
    page.getByRole("heading", { name: /pdfs merged/i }),
  ).toBeVisible();
  seen.push(...(await running(page, "result")));
  // The masthead logo's P still reports the state — without moving.
  await expect(page.locator("header [data-activity]")).toHaveAttribute(
    "data-activity",
    "done",
  );
  seen.push(...(await running(page, "done")));
  expect(seen).toEqual([]);
});

test("positive control: an animation started with a real duration is seen", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() =>
    document.body.animate([{ opacity: 0.99 }, { opacity: 1 }], {
      duration: 10_000,
    }),
  );
  expect(await running(page, "control")).toEqual(["control: body script"]);
});

test("no view transition starts under reduced motion: a chip on /tools", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __vt: number };
    w.__vt = 0;
    const start = document.startViewTransition?.bind(document);
    if (start)
      document.startViewTransition = ((arg: never) => {
        w.__vt += 1;
        return start(arg);
      }) as typeof document.startViewTransition;
  });
  await page.goto("/tools");
  const chip = page
    .getByRole("group", { name: "Filter by category" })
    .getByRole("button")
    .nth(1);
  await waitForHydration(chip);
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(() => (window as unknown as { __vt: number }).__vt),
  ).toBe(0);
});
