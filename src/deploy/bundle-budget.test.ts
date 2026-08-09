// @vitest-environment node
/**
 * A budget on what a page makes a user download — and the record of a fix that
 * was measured and then NOT shipped.
 *
 * Nothing here measured performance, and a tool page transfers roughly 411 KB
 * gzip against 188 KB for the homepage. Every tool page transferred an
 * IDENTICAL amount, which looked like proof that each one shipped all 28 runners
 * and all 13 worker panels. It is not.
 *
 * WHAT THE MEASUREMENT ACTUALLY SAID
 * Converting every runner and panel to `next/dynamic` — 40 static imports gone,
 * SSR deliberately kept so the pre-hydration dropzone survived — was built and
 * weighed against the unchanged build with one script over both artifacts:
 *
 *     rotate-pdf     411 KB -> 418 KB   (worse)
 *     merge-pdf      411 KB -> 415 KB   (worse)
 *     ocr-pdf        411 KB -> 407 KB
 *     summarize-pdf  411 KB -> 407 KB
 *
 * It made the two most-used client-side tools BIGGER, because `dynamic()` adds
 * per-chunk overhead and the bundler was already hoisting the shared code. The
 * change was reverted. An earlier, sloppier measurement taken against a running
 * dev server had shown "502 -> 448 KB"; it was not controlled, and it was wrong.
 *
 * WHERE THE WEIGHT ACTUALLY IS — the chunk list for `/tools/rotate-pdf`:
 *
 *     412 KB  1558-*.js        <- shared vendor (pdf-lib)
 *     217 KB  3994-*.js        <- shared vendor
 *     195 KB  21d093b1-*.js    <- React
 *     131 KB  483-*.js
 *     110 KB  polyfills-*.js
 *      ...    13 more chunks, all small
 *
 * Two chunks are half the page. Per-tool code lives in the small ones, so no
 * amount of splitting the dispatchers can reach it. The real lever is loading
 * pdf-lib when a file is PICKED rather than when the page loads — a much larger
 * change, not attempted here.
 *
 * THE LEVER WAS PULLED — 2026-08-09, measured with `pnpm weigh:pages` over both
 * artifacts:
 *
 *     every tool page   1185 KB -> 774 KB   (-411 KB, the pdf-lib chunk)
 *     homepage           598 KB -> 598 KB   (unchanged)
 *
 * Not by splitting runners (see above — measured worse) but by one dynamic
 * boundary exactly on pdf-lib itself (`src/lib/pdf/pdf-lib.ts`): every op
 * module takes the engine through `loadPdfLib()` at call time, type imports
 * stay static and erase, and the Dropzone warms the chunk the moment files
 * arrive. The two class-heavy modules (`forms`, `extract-images`) flip the
 * boundary instead: their runners import them dynamically in handlers. The
 * budgets below were tightened to sit just above the NEW weight, so the old
 * weight coming back — one careless static `import { PDFDocument }` anywhere
 * a page reaches — fails this suite rather than shipping unnoticed.
 *
 * So this file measures and bounds. It does not claim the current weight is
 * good; it stops it getting worse without someone noticing, which is the thing
 * that was missing.
 *
 * Sizes are UNCOMPRESSED bytes on disk — roughly 3x transfer size. Fine for a
 * regression budget, wrong as a user-facing figure. Do not quote them as page
 * weight. The chunk list comes from the prerendered HTML `next build` writes,
 * i.e. exactly what a browser would fetch; verified against `curl` on the
 * running server, which reported the same 18 and 12 chunks.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const NEXT_DIR = path.join(process.cwd(), ".next");
const APP_DIR = path.join(NEXT_DIR, "server", "app");

/** Unique chunks a prerendered page references, and their total size on disk. */
function weigh(htmlRelPath: string): { chunks: number; kb: number } | null {
  const html = path.join(APP_DIR, htmlRelPath);
  if (!existsSync(html)) return null;
  const urls = [
    ...new Set(
      readFileSync(html, "utf8").match(/\/_next\/static\/chunks\/[^"']+?\.js/g) ?? [],
    ),
  ];
  let bytes = 0;
  for (const url of urls) {
    const file = path.join(NEXT_DIR, url.replace("/_next/", ""));
    if (existsSync(file)) bytes += statSync(file).size;
  }
  return { chunks: urls.length, kb: Math.round(bytes / 1024) };
}

/**
 * Budgets sit just above what the current build produces, so they fail on a real
 * regression rather than on noise. Raising one is a decision, not a fix: say in
 * the same diff what got heavier and why it has to load up front.
 */
const BUDGETS = [
  { name: "homepage", html: "index.html", kb: 700 },
  { name: "a client-side tool page", html: "tools/rotate-pdf.html", kb: 850 },
  { name: "a worker tool page", html: "tools/ocr-pdf.html", kb: 850 },
  { name: "an AI tool page", html: "tools/summarize-pdf.html", kb: 850 },
] as const;

describe("client bundle budget", () => {
  const built = existsSync(APP_DIR);

  it("has a build to measure", () => {
    // Skipping silently when `.next` is absent would make this read green in
    // exactly the situation where it checks nothing.
    expect(
      built,
      "no .next/server/app — run `pnpm build` before this suite (CI does)",
    ).toBe(true);
  });

  it.each(BUDGETS)("$name stays under $kb KB", ({ html, kb }) => {
    if (!built) return;
    const weight = weigh(html);
    expect(weight, `${html} is not in the build output`).not.toBeNull();
    expect(
      weight!.kb,
      `${html} references ${weight!.chunks} chunks totalling ${weight!.kb} KB against a ${kb} KB budget. Check what was added: a new dependency pulled into a client component reaches every tool page. If the growth is deliberate, raise the budget here and say what grew.`,
    ).toBeLessThanOrEqual(kb);
  });

  it("keeps the homepage clear of the tool pages' weight", () => {
    if (!built) return;
    const home = weigh("index.html");
    const tool = weigh("tools/rotate-pdf.html");
    if (!home || !tool) return;
    // The homepage does not touch pdf-lib and must not start. This is a shape
    // check, not a budget: the gap closing means tool machinery reached the
    // landing page, which is the one page most visitors ever see.
    expect(
      home.kb * 1.5,
      `the homepage (${home.kb} KB) has grown close to a tool page (${tool.kb} KB) — something tool-specific is now imported by a component the landing page renders`,
    ).toBeLessThan(tool.kb);
  });
});
