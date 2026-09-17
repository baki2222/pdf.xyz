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

/** The unique chunk URLs a prerendered page references. */
function chunkList(htmlRelPath: string): string[] {
  const html = path.join(APP_DIR, htmlRelPath);
  if (!existsSync(html)) return [];
  return [
    ...new Set(
      readFileSync(html, "utf8").match(
        /\/_next\/static\/chunks\/[^"']+?\.js/g,
      ) ?? [],
    ),
  ];
}

/** Unique chunks a prerendered page references, and their total size on disk. */
function weigh(htmlRelPath: string): { chunks: number; kb: number } | null {
  const html = path.join(APP_DIR, htmlRelPath);
  if (!existsSync(html)) return null;
  const urls = [
    ...new Set(
      readFileSync(html, "utf8").match(
        /\/_next\/static\/chunks\/[^"']+?\.js/g,
      ) ?? [],
    ),
  ];
  let bytes = 0;
  const unweighed: string[] = [];
  for (const url of urls) {
    // decodeURIComponent, because a dynamic route is percent-encoded in the
    // HREF and NOT on disk: `/tools/%5Bslug%5D/page-*.js` is `[slug]` in
    // `.next`. Without it `existsSync` was false for the LARGEST chunk on every
    // tool page, which was then counted in `chunks` and added ZERO bytes.
    const file = path.join(
      NEXT_DIR,
      decodeURIComponent(url.replace("/_next/", "")),
    );
    if (existsSync(file)) bytes += statSync(file).size;
    // A counted chunk that is not weighed is the defect above, and decoding
    // only fixes today's spelling of it. The PROPERTY is that `chunks` and
    // `kb` describe the same set, so a miss is fatal rather than silent.
    else unweighed.push(url);
  }
  if (unweighed.length > 0) {
    throw new Error(
      `bundle-budget: ${unweighed.length} referenced chunk(s) were counted but not found on disk, so their bytes went uncounted: ${unweighed.join(", ")}`,
    );
  }
  return { chunks: urls.length, kb: Math.round(bytes / 1024) };
}

/**
 * Budgets sit just above what the current build produces, so they fail on a real
 * regression rather than on noise. Raising one is a decision, not a fix: say in
 * the same diff what got heavier and why it has to load up front.
 *
 * RE-ANCHORED 2026-08-21, and NOTHING GOT HEAVIER -- the weigher started telling
 * the truth. `weigh()` did `existsSync` on a percent-encoded path, so the
 * `/tools/%5Bslug%5D/page-*.js` chunk -- the LARGEST on every tool page -- was
 * counted in `chunks` and contributed ZERO bytes. Measured on the same build,
 * before and after the one-line decode:
 *
 *     tool pages   774 KB reported  ->  1,156 KB actual   (382 KB invisible)
 *     homepage     unaffected (not a dynamic route)
 *
 * So the 850 KB figure was never a 850 KB budget; it was "850 KB minus the
 * biggest chunk", and the pages had been over it the whole time with nothing
 * able to say so. The new figure is the true measurement plus the same small
 * margin the old one had. A future raise is still a decision that must name
 * what grew -- this one names an instrument that was wrong.
 */
const BUDGETS = [
  { name: "homepage", html: "index.html", kb: 700 },
  { name: "a client-side tool page", html: "tools/rotate-pdf.html", kb: 1200 },
  { name: "a worker tool page", html: "tools/ocr-pdf.html", kb: 1200 },
  { name: "an AI tool page", html: "tools/summarize-pdf.html", kb: 1200 },
  // A content page. The homepage-class budget is deliberate and does double
  // duty as a leak detector: a guide must never pull the pdf-lib chunk or a
  // runner into a route whose job is prose.
  { name: "a guide page", html: "guides/how-to-merge-pdf-files.html", kb: 700 },
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
    // The homepage does not touch the PDF machinery and must not start. This
    // used to be a ratio (tool ≥ 1.5× home), written when the gap was a leak
    // signal — and the 2026-08-09 pdf-lib deferral broke it from the GOOD
    // direction: tool pages fell toward the homepage, which is the outcome the
    // ratio could not tell from the homepage rising toward tool pages. The
    // honest invariant now is direct: the homepage must reference NO chunk
    // that only tool pages need, expressed as (a) the homepage stays strictly
    // lighter than a tool page, and (b) the homepage's chunk set adds nothing
    // beyond the shared baseline — every homepage chunk also appears on a tool
    // page, so a tool-only chunk can never ride along with the landing page.
    // The absolute ceilings above do the size bounding.
    expect(
      home.kb,
      `the homepage (${home.kb} KB) now outweighs a tool page (${tool.kb} KB) — something tool-specific is imported by a component the landing page renders`,
    ).toBeLessThan(tool.kb);
    // Route chunks (`chunks/app/**`) are each page's own by construction; the
    // machinery a leak would ride in on is the shared/vendor kind.
    const nonRoute = (c: string) => !c.includes("/chunks/app/");
    const toolChunks = new Set(
      chunkList("tools/rotate-pdf.html").filter(nonRoute),
    );
    const extras = chunkList("index.html")
      .filter(nonRoute)
      .filter((c) => !toolChunks.has(c));
    expect(
      extras,
      `the homepage references shared chunks no tool page carries — landing-page-only machinery appeared:\n  ${extras.join("\n  ")}`,
    ).toEqual([]);
  });
});
