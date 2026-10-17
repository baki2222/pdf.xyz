/**
 * THE STAGE A RESULT IS DRAWN INTO, HELD FROM THE RUN PRESS.
 *
 * A tool page's first screen is the runner's (`data-first-screen` in
 * `app/tools/[slug]/page.tsx`), so at the top of the page nothing under the
 * runner is on screen to move. But a reader who scrolled down an editor to
 * press Run is looking at what follows it, and the result replaces the
 * editor long after the press's input window has closed. Measured on the
 * first-screen build before any hold, from the Run press to the ending:
 * Sign PDF 0.2765 at 1280 x 720, Edit PDF 0.8974 at 390 x 844, Merge PDF
 * 0.1221 at 390 x 844 (2026-10-11).
 *
 * So the press holds the runner's stage (`data-runner-stage`) at least as
 * tall as it is and at least to the bottom of the screen, in the press's
 * own handler. Three rules then decide its height, and each is tested:
 *
 *  1. HELD SPACE BELOW THE SCREEN IS GIVEN BACK — at the settle, and at
 *     every scroll and resize from the press on. The hold never reaches past
 *     the bottom of the screen once the run has settled (`fit`), and it
 *     never grows. Shrinking a stage whose bottom stays at or below the fold
 *     moves only what is below the fold, which nobody sees move. (Until
 *     2026-10-17 the editor's whole height was kept under a short result
 *     until the next press, and a wheel or a trackpad fires none: Edit PDF
 *     at 1440 x 900 left 949 px of blank panel, the whole screen of it after
 *     a 500 px wheel. `e2e/stage-hold.spec.ts` reads every frame from the
 *     result through a wheel down and back: at most 1 px held past the fold.)
 *
 *  2. WHAT IS LEFT — the band between a short result and the bottom of the
 *     screen, never more than one screen — goes at the reader's next CLICK
 *     or KEY after the run settled: inside that input's window, so its move
 *     is not counted as a layout shift. Never at a pointerdown: on a phone
 *     that is usually the start of a scroll, a touch that becomes a scroll
 *     fires no click, and Chromium counts a shift made during it
 *     (hadRecentInput = false) — Sign PDF at 390 x 844, 0.1135 per release
 *     on 36702d2c, 0.1339 on 94dc2b22. `e2e/stage-hold.mobile.spec.ts`
 *     drives the touch path (a tap, a CDP touch scroll) with that release
 *     as its control, and that a tap's release lands inside its window;
 *     `e2e/stage-hold.spec.ts` the same for a key and a mouse click.
 *     Chromium only: WebKit and a real iOS device are not run here.
 *     A KEY THAT SCROLLS (Space, Page Up/Down, the vertical arrows, Home,
 *     End) is not a release but a wheel: given back at its keydown, the
 *     band went and then the page scrolled past what came up into it —
 *     PageDown skipped 59 px of the About heading on Sign PDF at 1280 x 720
 *     (PR #180 review). `e2e/stage-hold.spec.ts` reads the About section's
 *     place in the document across four of those keys.
 *
 *  3. ONE HOLD AT A TIME, NOTHING LEFT BEHIND. A newer hold ends the older
 *     one's listeners; a hold whose stage has left the page (a runner
 *     unmounted mid-run, a client navigation) ends at the next event; one
 *     whose height something else changed steps aside (`./stage-hold.test.ts`).
 *
 * `e2e/continue-chain.spec.ts` measures every tool with an ending from its
 * Run press to its ending at eight sizes, and its control takes the hold
 * away.
 */
export const RUNNER_STAGE = "[data-runner-stage]";

/**
 * The keys that scroll the page (Space and Shift+Space, Page Up/Down, the
 * vertical arrows, Home, End): read as the wheel is, never as a release.
 */
const SCROLL_KEYS: ReadonlySet<string | undefined> = new Set([
  " ",
  "Spacebar",
  "PageDown",
  "PageUp",
  "ArrowDown",
  "ArrowUp",
  "Home",
  "End",
]);

/** The live hold of each document: a newer hold ends the older one. */
const live = new WeakMap<Document, () => void>();

/**
 * Holds the page's runner stage, if it has one (a tool page's workbench),
 * from now until the reader's next click or key after the returned
 * `settled()` is called. Call it in the press's own handler, before
 * anything is awaited.
 */
export function holdRunnerStage(doc: Document = document): () => void {
  const view = doc.defaultView;
  const stage = doc.querySelector<HTMLElement>(RUNNER_STAGE);
  if (!stage || !view) return () => {};
  live.get(doc)?.();

  const box = stage.getBoundingClientRect();
  let held = Math.ceil(Math.max(box.height, view.innerHeight - box.top));
  let applied = `${held}px`;
  stage.style.minHeight = applied;
  let settled = false;

  const end = () => {
    doc.removeEventListener("click", release, true);
    doc.removeEventListener("keydown", release, true);
    view.removeEventListener("scroll", fit);
    view.removeEventListener("resize", fit);
    if (live.get(doc) === end) live.delete(doc);
  };
  /** Still this hold's to change: on the page, and at the height it set. */
  const owned = () => {
    if (stage.isConnected && stage.style.minHeight === applied) return true;
    end();
    return false;
  };
  /** Rule 1: what the hold keeps below the bottom of the screen goes. */
  const fit = () => {
    if (!owned()) return;
    const fold = Math.ceil(
      view.innerHeight - stage.getBoundingClientRect().top,
    );
    if (fold >= held) return;
    held = fold;
    if (held <= 0) {
      end();
      stage.style.minHeight = "";
      return;
    }
    applied = `${held}px`;
    stage.style.minHeight = applied;
  };
  /** Rule 2: the band on screen goes inside a click's or a key's window. */
  const release = (event: Event) => {
    // A key that scrolls is a wheel: its scroll gives back what passes the
    // fold (`fit`), never the band — given back first, the scroll then
    // carried the reader past what came up into it.
    if (SCROLL_KEYS.has((event as KeyboardEvent).key)) return;
    if (!owned() || !settled) return;
    end();
    stage.style.minHeight = "";
  };

  doc.addEventListener("click", release, true);
  doc.addEventListener("keydown", release, true);
  view.addEventListener("scroll", fit, { passive: true });
  view.addEventListener("resize", fit, { passive: true });
  live.set(doc, end);
  return () => {
    settled = true;
    fit();
  };
}
