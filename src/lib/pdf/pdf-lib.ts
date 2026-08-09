/**
 * The ONE dynamic boundary in front of `pdf-lib` — the heaviest chunk any tool
 * page ships (~412 KB uncompressed, a third of the page), and the reason a
 * visitor who only READS a tool page used to pay for the engine they had not
 * asked to run yet.
 *
 * Every operation module under `src/lib/pdf/` gets its pdf-lib VALUES through
 * {@link loadPdfLib} at call time; only type-level imports (`import type`)
 * remain at module top, which erase at build time. That moves the engine out of
 * every tool page's initial chunk list while keeping module APIs untouched —
 * the same shape `page-count.ts` has used since it was written, generalized.
 *
 * Why not `next/dynamic` on the runners: measured in #45 — per-runner dynamic()
 * added chunk overhead and the shared baseline dominated, so the two most-used
 * tools got BIGGER. The weight is pdf-lib itself; this boundary sits exactly on
 * it and nothing else.
 *
 * {@link warmPdfLib} starts the download without awaiting it. The Dropzone
 * calls it the moment files arrive, so by the time a hand moves from the picker
 * to the run button the chunk is usually already here. Deliberately fire-and-
 * forget and error-swallowing: a failed warm-up must never surface — the real
 * `await` inside the operation will retry and report through the op's own
 * error path.
 */

/** The whole pdf-lib module, for helpers that thread it through sync code. */
export type PdfLibModule = typeof import("pdf-lib");

let loaded: Promise<PdfLibModule> | null = null;

/** Load (once) and return the pdf-lib module. */
export function loadPdfLib(): Promise<typeof import("pdf-lib")> {
  loaded ??= import("pdf-lib");
  return loaded;
}

/** Begin fetching pdf-lib without waiting for it (call on file pick). */
export function warmPdfLib(): void {
  void loadPdfLib().catch(() => {
    // Swallowed: the operation's own await is the surface that reports errors,
    // and a warm-up failure (offline blip) may well succeed on the retry.
    loaded = null;
  });
}
