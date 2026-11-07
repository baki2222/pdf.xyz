/**
 * Webpage to PDF's scroll pass (audit webpage-to-pdf#4): images a site loads
 * only when they scroll into view — an IntersectionObserver, a scroll
 * handler — came out as blank boxes, because nothing scrolled the page.
 *
 * After the page's first time budget (`VIRTUAL_TIME_BUDGET_MS` in
 * `./native`), the renderer scrolls the window down one screen at a time,
 * at most {@link LAZY_SCROLL_MAX_STEPS} screens; after each step it waits for
 * two rendered frames (a scroll event and an IntersectionObserver callback
 * are delivered then, not by virtual time) and gives the page
 * {@link LAZY_SCROLL_STEP_MS} of virtual time; then it
 * scrolls back to the top and gives {@link LAZY_SCROLL_SETTLE_MS} more, so
 * what those steps started can finish. Virtual time waits for the page's
 * fetches (`pauseIfNetworkFetchesPending`), so an image requested at a step
 * is fetched before that step's time runs out.
 *
 * Bounded: the pass adds at most {@link LAZY_SCROLL_MAX_MS} of page time,
 * waits at most {@link LAZY_SCROLL_FRAME_WAIT_MS} of real time for frames
 * per step, and the job's own timeout still holds over the whole render. A page
 * taller than the steps reach is printed whole, but only its first
 * {@link LAZY_SCROLL_MAX_STEPS} screens were scrolled past.
 *
 * What it does NOT do: scroll an element that scrolls inside the page (an
 * app whose body never scrolls), or keep scrolling an endless feed — the
 * page height is read once, before the first step.
 *
 * Pure — no Node built-in — so the tool page's copy reads these numbers.
 */

/** The most screens the pass scrolls down. */
export const LAZY_SCROLL_MAX_STEPS = 20;
/** Virtual time the page gets after each step, in ms. */
export const LAZY_SCROLL_STEP_MS = 250;
/** Virtual time after scrolling back to the top, in ms. */
export const LAZY_SCROLL_SETTLE_MS = 1_000;
/**
 * Real time, in ms, the pass waits after each scroll for the page to render
 * two frames — when a scroll event and an IntersectionObserver callback are
 * delivered — before giving it the step's virtual time.
 */
export const LAZY_SCROLL_FRAME_WAIT_MS = 1_000;
/** Settles after two animation frames. */
export const LAZY_SCROLL_NEXT_FRAMES =
  "new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true))))";
/** The most page time the pass can add, in ms. */
export const LAZY_SCROLL_MAX_MS =
  LAZY_SCROLL_MAX_STEPS * LAZY_SCROLL_STEP_MS + LAZY_SCROLL_SETTLE_MS;

/** Evaluated once: the document's scroll height and the window's height. */
export const LAZY_SCROLL_MEASURE = `(() => {
  const root = document.scrollingElement || document.documentElement;
  return {
    height: Math.max(root ? root.scrollHeight : 0, document.body ? document.body.scrollHeight : 0),
    viewport: window.innerHeight,
  };
})()`;

/** The expression that scrolls the window to `y`. */
export const lazyScrollTo = (y: number): string =>
  `window.scrollTo(0, ${Math.max(0, Math.round(y))})`;

/**
 * Where the pass stops: one screen further each step, until the last
 * screen of the page is in view, at most {@link LAZY_SCROLL_MAX_STEPS}.
 * Nothing when the page fits in one screen or the figures are unusable.
 */
export function lazyScrollPositions(
  height: unknown,
  viewport: unknown,
): number[] {
  if (
    typeof height !== "number" ||
    typeof viewport !== "number" ||
    !Number.isFinite(height) ||
    !Number.isFinite(viewport) ||
    viewport <= 0
  )
    return [];
  const last = height - viewport;
  const out: number[] = [];
  for (let y = viewport; out.length < LAZY_SCROLL_MAX_STEPS; y += viewport) {
    if (y >= last) {
      if (last > 0) out.push(Math.round(last));
      break;
    }
    out.push(Math.round(y));
  }
  return out;
}
