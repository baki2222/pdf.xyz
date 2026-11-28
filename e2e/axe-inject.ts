import type { Page } from "@playwright/test";
import { createRequire } from "node:module";
import { join } from "node:path";

/**
 * The one way e2e puts axe-core on a page. Each `axe.run` waits first until
 * the page has stopped scrolling.
 *
 * Why: `html { scroll-behavior: smooth }` (src/app/globals.css) turns a
 * `fill()` or a focus into a scroll of about 400 ms. Run mid-scroll, axe
 * reads rects that are still moving under the sticky header. On main
 * 8f379e1a (CI run 46131553554) that produced
 * `target-size: button[data-box-id="4"]` in
 * request-signatures-placement.spec.ts on all three attempts, from a box
 * that is 24 px and clear on a still page. Two independent reproductions
 * failed 2-6 runs in 20-30, and passed 30/30 with reduced motion.
 *
 * Only the root scrolls smoothly (the motion contract in
 * src/lib/motion/contract.ts pins that CSS), so the window's scroll
 * position is the thing to wait on. The wait counts animation frames, not
 * a clock: STILL_FRAMES unchanged frames in a row, and an error after
 * SETTLE_FRAME_LIMIT frames, so a page that never settles fails by name
 * rather than passing.
 *
 * The scroll position each run started at is kept in
 * `window.__axeRunScrollY`, for the spec that proves the wait
 * (axe-settle.spec.ts).
 */
const AXE = createRequire(join(process.cwd(), "package.json")).resolve(
  "axe-core/axe.min.js",
);

/** Animation frames in a row with the scroll position unchanged. */
export const STILL_FRAMES = 3;

/** Frames to wait for that before failing: about 4 s at 60 Hz. */
export const SETTLE_FRAME_LIMIT = 240;

export async function injectAxe(page: Page): Promise<void> {
  await page.addScriptTag({ path: AXE });
  await page.evaluate(
    ([still, limit]) => {
      type Run = (...args: unknown[]) => Promise<unknown>;
      const w = window as unknown as {
        axe: { run: Run; __waitsForStill?: true };
        __axeRunScrollY?: number[];
      };
      if (w.axe.__waitsForStill) return;
      const run = w.axe.run.bind(w.axe) as Run;
      const frame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      w.axe.run = async (...args: unknown[]) => {
        let last = `${window.scrollX},${window.scrollY}`;
        let held = 0;
        for (let n = 0; held < still; n++) {
          if (n >= limit)
            throw new Error(
              `axe: the page was still scrolling after ${limit} frames`,
            );
          await frame();
          const now = `${window.scrollX},${window.scrollY}`;
          held = now === last ? held + 1 : 0;
          last = now;
        }
        (w.__axeRunScrollY ??= []).push(window.scrollY);
        return run(...args);
      };
      w.axe.__waitsForStill = true;
    },
    [STILL_FRAMES, SETTLE_FRAME_LIMIT] as const,
  );
}
