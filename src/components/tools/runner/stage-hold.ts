/**
 * THE STAGE A RESULT IS DRAWN INTO, HELD FROM THE RUN PRESS (2026-10-11).
 *
 * A tool page's first screen is the runner's (`data-first-screen` in
 * `app/tools/[slug]/page.tsx`), so at the top of the page nothing under the
 * runner is on screen to move. But a reader who scrolled down an editor to
 * press Run is looking at what follows it — the About section, under a short
 * editor or the bottom of a tall one — and the result replaces the editor
 * long after the press's input window has closed (a run, then the wait for
 * its ending). Measured on the first-screen build, from the Run press to the
 * ending, the reader scrolled where the press left them: Sign PDF 0.2765 at
 * 1280 x 720 (the editor 1,400 px, the result a third of it, About thrown
 * 412 px up), Edit PDF 0.8974 at 390 x 844, Merge PDF 0.1221 at 390 x 844
 * (the other way: a two-file editor, a taller result, About pushed down).
 *
 * So the press holds the runner's stage (`data-runner-stage`): at least as
 * tall as it is, and at least to the bottom of the screen as the reader sees
 * it. Whatever the hold moves, it moves in the frame after the press, inside
 * the press's own input window — what is under a short editor goes below the
 * screen as the run starts — and the result draws into the held stage: a
 * shorter one leaves the stage's height where it was, a taller one grows it
 * past the bottom of the screen, where nothing is seen to move.
 *
 * The space is given back at the reader's NEXT press once the run has
 * settled — Download, Back to adjust, Start over, a key — a press, so what
 * the release moves is inside that press's window too, and it is the
 * reader's act that changes the page, never the run's arrival.
 *
 * `e2e/continue-chain.spec.ts` measures every tool with an ending from its
 * Run press to its ending at eight sizes, and its control takes this hold
 * away.
 */
export const RUNNER_STAGE = "[data-runner-stage]";

const holds = new WeakMap<HTMLElement, object>();

/**
 * Holds the page's runner stage, if it has one (a tool page's workbench),
 * from now until the reader's next press after the returned `settled()` is
 * called. A newer hold supersedes an older one. Call it in the press's own
 * handler, before anything is awaited.
 */
export function holdRunnerStage(doc: Document = document): () => void {
  const view = doc.defaultView;
  const stage = doc.querySelector<HTMLElement>(RUNNER_STAGE);
  if (!stage || !view) return () => {};
  const box = stage.getBoundingClientRect();
  const px = Math.ceil(Math.max(box.height, view.innerHeight - box.top));
  stage.style.minHeight = `${px}px`;
  const token = {};
  holds.set(stage, token);
  let settled = false;
  const release = () => {
    if (!settled) return;
    doc.removeEventListener("pointerdown", release, true);
    doc.removeEventListener("keydown", release, true);
    if (holds.get(stage) !== token) return;
    holds.delete(stage);
    stage.style.minHeight = "";
  };
  doc.addEventListener("pointerdown", release, true);
  doc.addEventListener("keydown", release, true);
  return () => {
    settled = true;
  };
}
