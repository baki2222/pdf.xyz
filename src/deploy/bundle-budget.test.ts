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
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { chunkUrls, weighPage } from "../../scripts/page-weight";

const NEXT_DIR = path.join(process.cwd(), ".next");
const APP_DIR = path.join(NEXT_DIR, "server", "app");

/** The unique chunk URLs a prerendered page references. */
function chunkList(htmlRelPath: string): string[] {
  return chunkUrls(NEXT_DIR, htmlRelPath);
}

/**
 * Unique chunks a prerendered page references, and their total size on disk.
 * The weigher lives in scripts/page-weight.ts, shared with `pnpm weigh:pages`
 * (the table a budget change is argued from); see the last test below. Its
 * history: the percent-encoded `[slug]` chunk that once weighed zero, and the
 * miss that is now fatal, are documented there.
 */
function weigh(htmlRelPath: string): { chunks: number; kb: number } | null {
  return weighPage(NEXT_DIR, htmlRelPath);
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
  // TIGHTENED 700 -> 675 on 2026-10-08: the homepage weighs 635 KB once the
  // catalogue left it (b9ccf092). Same +40 KB margin as the tool pages; under
  // 700 the 40 KB catalogue leak fitted unnoticed, under 675 it cannot.
  { name: "homepage", html: "index.html", kb: 675 },
  // LOWERED 1200 → 1100 on 2026-09-17, and this time something got LIGHTER:
  // jszip left the tool pages' load-time graph (a 129 KB chunk that rode
  // every page via the static import in src/lib/pdf/browser.ts, now fetched
  // at first ZIP-producing run — see loadJsZip there). Measured with weigh()
  // over both artifacts: 1176 → 1060 KB. The tighter figure is the guard:
  // under the old 1200, a static jszip import could have quietly returned
  // (1060 + 129 = 1189 fits); under 1100 it cannot.
  //
  // RAISED 1100 → 1280 on 2026-10-08, and something DID get heavier: the
  // wave-1 integration branch (322 commits over main 40242277). Both builds
  // weighed with the one shared weigher (scripts/page-weight.ts):
  //
  //     every tool page   1061 KB -> 1241 KB   (+180 KB)
  //     homepage           607 KB ->  675 KB   (+68 KB; budget 700, passes)
  //
  // CORRECTED the same day after an adversarial review rebuilt main and the
  // branch: (1) +40 KB of the homepage's +68 was the WHOLE CATALOGUE riding the
  // root 404's "Did you mean" (b9ccf092 made it lazy: homepage 635 KB, tool
  // pages 1239 KB, guide 625 KB); (2) the catalogue chunk grew 26.1 -> 37.7 KB,
  // about +12 KB, not the +7 below; (3) the items below explain ~139 of the
  // ~178 KB; the other ~40 KB is NOT itemised — the Next 16.3.6 upgrade is a
  // likely share (shared vendor 218 -> 236 KB) but was not measured apart.
  //
  // Matched module by module across the two builds, the growth is:
  //   +57 KB  ToolRunner — the 28 client runners webpack concatenates into
  //           one module; the lane fixes (column order in PDF to Text and
  //           Markdown, refusals that name their cause, telemetry on every
  //           run path, ...).
  //   +25 KB  a new module that carries bookmarks, form fields and links
  //           across page copies (merge keeps forms and bookmarks; dropped
  //           pages no longer ride inside page-tool outputs, L01).
  //   ~+20 KB new client helpers: the selectable-text probe that refuses a
  //           scanned PDF before upload (pdfHasSelectableText), the encryption
  //           verdict sentences, the lost-connection / Keep waiting job
  //           helper, the refusal-to-next-tool links, the options size bound.
  //   ~+12 KB worker panels (HTML render, Request Signatures, PDF structure).
  //   +7 KB   the tool catalogue (per-tool copy and facts).
  //   rest    Next 16.2.9 -> 16.3.6 (29bf276b, published critical/high
  //           advisories) and React with it: shared vendor 218 -> 236 KB.
  // None of it is a library that came back: pdf-lib (411 KB) and jszip
  // (129 KB) are still behind their dynamic boundaries, and either returning
  // statically would overshoot 1280 by far. WHY UP FRONT: per-tool code rides
  // the static ToolRunner dispatch, and splitting that dispatch was measured
  // WORSE (see the top of this file). Re-measuring that trade at today's
  // weight is the open lever; this raise does not claim the weight is good.
  // The margin (+39 KB) is the same as the old 1060 -> 1100 one.
  { name: "a client-side tool page", html: "tools/rotate-pdf.html", kb: 1280 },
  { name: "a worker tool page", html: "tools/ocr-pdf.html", kb: 1280 },
  { name: "an AI tool page", html: "tools/summarize-pdf.html", kb: 1280 },
  // A content page. The homepage-class budget is deliberate and does double
  // duty as a leak detector: a guide must never pull the pdf-lib chunk or a
  // runner into a route whose job is prose.
  // TIGHTENED 700 -> 665 on 2026-10-08 (625 KB measured), for the same reason.
  { name: "a guide page", html: "guides/how-to-merge-pdf-files.html", kb: 665 },
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

  // A size budget cannot see WHAT rides along, only how much. On 2026-10-08
  // the 404's "Did you mean …?" (MissingPathSuggestion, a client component in
  // the ROOT not-found boundary) imported the catalogue search, and the root
  // not-found ships with every route: the whole catalogue (~32 KB raw) landed
  // in the homepage's and every guide's first load. Both stayed under their
  // 700 KB budgets, so nothing failed. This reads the CONTENT of the first-load
  // chunks instead: no tool's tagline may be in them on a page that renders no
  // tool UI. Markers are derived from the catalogue — every tagline a tool
  // page's own first load carries verbatim (a template-literal tagline such as
  // PDF/A's is stored in pieces, so it cannot be a marker) — and that tool
  // page, which needs the catalogue, is the positive control.
  it("ships the tool catalogue only on pages that need it", () => {
    if (!built) return;
    const firstLoad = (html: string) =>
      chunkList(html)
        .map((url) =>
          readFileSync(
            path.join(NEXT_DIR, decodeURIComponent(url.replace("/_next/", ""))),
            "utf8",
          ),
        )
        .join("\n");
    const control = firstLoad("tools/rotate-pdf.html");
    const markers = tools
      .map((t) => t.tagline)
      .filter((tagline) => control.includes(tagline));
    // Positive control and health check in one: the tool page carries nearly
    // every tagline. Fewer means the reader went blind (wrong chunk set, a
    // catalogue that moved behind a boundary) and an empty list would pass.
    expect(
      markers.length,
      `positive control: rotate-pdf's first load carries only ${markers.length} of ${tools.length} taglines`,
    ).toBeGreaterThanOrEqual(tools.length - 5);
    // The pages checked are DERIVED: every page the build prerendered. A typed
    // list (it was index.html and one guide) cannot see the next route that
    // starts carrying the catalogue. The pages that legitimately need it at
    // load are named, each with its reason, and an entry that stops carrying it
    // fails, so the list can only shrink toward the truth.
    const NEEDS_CATALOGUE: Record<string, string> = {
      "tools.html": "the /tools explorer filters the catalogue in the client",
      "workspace.html": "the workspace offers every tool for its files",
      "status.html": "the status page lists every tool's live state",
    };
    const isToolPage = (html: string) =>
      tools.some((t) => html === `tools/${t.slug}.html`);
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(path.join(dir, entry.name))
          : entry.name.endsWith(".html")
            ? [
                path
                  .relative(APP_DIR, path.join(dir, entry.name))
                  .split(path.sep)
                  .join("/"),
              ]
            : [],
      );
    const pages = walk(APP_DIR);
    // Health check: the walk sees the whole site (89 pages on 2026-10-08).
    expect(pages.length).toBeGreaterThanOrEqual(60);
    const carrying = (html: string) =>
      markers.filter((m) => firstLoad(html).includes(m)).length;
    const leaks = pages
      .filter((html) => !isToolPage(html) && !(html in NEEDS_CATALOGUE))
      .map((html) => ({ html, taglines: carrying(html) }))
      .filter((row) => row.taglines > 0);
    expect(
      leaks,
      `pages that render no tool UI load the tool catalogue up front — a client component they render imports @/lib/tools`,
    ).toEqual([]);
    const stale = Object.keys(NEEDS_CATALOGUE).filter(
      (html) => !pages.includes(html) || carrying(html) === 0,
    );
    expect(
      stale,
      "NEEDS_CATALOGUE names a page that no longer carries the catalogue — remove it",
    ).toEqual([]);
  });

  it("pnpm weigh:pages prints the weights this budget measures", () => {
    if (!built) return;
    // The table a budget change is argued from. It once kept its own copy of
    // the weigher and never learned the [slug] decode, so on the same build
    // it printed 715 KB for a tool page this suite measured at 1,241 KB. Run
    // the real script (node + the tsx CLI, as the repo's other spawned
    // scripts are) and hold every page it prints to weighPage.
    const out = execFileSync(
      process.execPath,
      [
        path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
        path.join(process.cwd(), "scripts", "weigh-pages.ts"),
        "--json",
      ],
      { encoding: "utf8" },
    );
    const rows = JSON.parse(out) as { html: string; kb: number }[];
    // Health check: a script that printed nothing would agree vacuously.
    expect(rows.length).toBeGreaterThanOrEqual(BUDGETS.length);
    const tool = rows.find((r) => r.html === "tools/rotate-pdf.html");
    expect(tool, "weigh:pages no longer prints a tool page").toBeDefined();
    for (const row of rows) {
      expect(row.kb, row.html).toBe(weigh(row.html)!.kb);
    }
  });
});
