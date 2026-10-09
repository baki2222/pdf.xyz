/**
 * Does THIS worker image write a .pptx with the chain PowerPoint needs?
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * When this was written (2026-09-27) the web tier auto-deployed from `main`
 * and the worker image was built by hand. `publish.yml` now deploys both tiers
 * on every push to main, but merging is still not shipping: a publish can
 * fail (#167's did, on 2026-10-09) and leave production's worker behind main.
 * The fix that gave PDF to PowerPoint its slide master, layout and theme
 * changes nothing a user downloads until an image carrying it is running, and
 * nothing on the web tier could tell whether one is. The catalogue
 * has promised "an editable PowerPoint slide" per page all along, so the
 * question is the 2026-08-21 one again (`translate/capability.ts`): does the
 * running image do what the copy says?
 *
 * ── WHAT IT RUNS ─────────────────────────────────────────────────────────────
 *
 * The real `runPdfOfficeExport`, the function the processor calls, over a
 * synthetic three-page extraction (the middle page empty, since an empty page
 * once meant an empty `a:txBody`), then `inspectPptxPackage` over the bytes it
 * returned. It reads the engine's OUTPUT, not the generator's source, so an
 * engine that stopped writing a part fails here however its code is arranged.
 * Since 2026-10-09 the engine also runs that inspector itself and refuses to
 * deliver a deck that fails it, so `false` here means the same thing whether
 * the probe or the engine saw the problem first.
 *
 * ── WHAT A PASS DOES AND DOES NOT MEAN ──────────────────────────────────────
 *
 * A pass means this image's engine writes the structural chain and every
 * relationship in it resolves. It does NOT mean PowerPoint opens the file;
 * there is no PowerPoint on a Linux worker. That property was measured on
 * Windows with `scripts/prove-pptx-opens.ts`: on 2026-09-27 for the writer of
 * that day, and again on 2026-10-09 for the one that replaced it
 * (`./pptx-package`, behind the engine's delivery inspection). PowerPoint 16.0
 * build 20430 opened a real 3-page job as 3 slides with 1 master and read
 * every page's text back, reopened a deck it saved itself, and refused the
 * pre-fix package (0x80070570). The extractor on that host was Xpdf 4.00's
 * `pdftotext`, not the worker's poppler; the writer is the same either way.
 *
 * This probe says whether the running image's engine writes decks that pass
 * the inspection the measured one passed. It cannot tell two such writers
 * apart, and the name, `pptxPresentationChain`, promises no more than that.
 *
 * An image built before this module publishes no such key, the reader parses
 * the absence as `false`, and the old image does not have to cooperate.
 */

import { runPdfOfficeExport } from "./engine";
import { inspectPptxPackage } from "./pptx-inspect";

const PROOF_PAGES = ["Capability probe\nFirst page", "", "Third page"].map(
  (text, index) => ({
    pageNumber: index + 1,
    text,
    characterCount: text.length,
  }),
);
const PROOF_TEXT = PROOF_PAGES.map((page) => page.text).join("\n\n");

/**
 * Does this image's PDF to PowerPoint engine write a package whose master →
 * layout → theme chain is present and resolves, one slide per page?
 *
 * `run` is injectable so the negative control can hand it the package the
 * engine wrote before the fix; the daemon always uses the real engine.
 */
export async function provesPptxPresentationChain(
  run: typeof runPdfOfficeExport = runPdfOfficeExport,
): Promise<boolean> {
  try {
    const result = await run(
      "pdf-to-powerpoint",
      new Uint8Array([1, 2, 3, 4]),
      {
        extract: async () => ({
          pageCount: PROOF_PAGES.length,
          pages: PROOF_PAGES,
          text: PROOF_TEXT,
          characterCount: PROOF_TEXT.length,
          hasText: true,
        }),
      },
    );
    if (!result.ok) return false;
    const { problems, counts } = await inspectPptxPackage(result.output);
    return (
      problems.length === 0 &&
      counts.slides === PROOF_PAGES.length &&
      counts.masters >= 1 &&
      counts.layouts >= 1 &&
      counts.themes >= 1
    );
  } catch {
    // A throw is an answer: this image cannot do it.
    return false;
  }
}
