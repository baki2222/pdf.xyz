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
 * THE SPLIT, RE-MEASURED — 2026-10-09, and at today's weight it IS the lever.
 * The 411 -> 418 above was measured while pdf-lib rode every tool page and the
 * bundler hoisted the runners' shared code into it. By 2026-10-09 pdf-lib sat
 * behind its own boundary and the route chunk `app/tools/[slug]/page-*.js` had
 * grown to 539 KB raw: all 27 runners and all 13 worker panels, on every tool
 * page — Rotate's first load carried the Translate panel. Each runner and panel
 * became a `next/dynamic` loader (`tool-runner.tsx`, `worker-panels.tsx`), SSR
 * kept on, and both builds (main f2b3db8b, and the split) were weighed with
 * `pnpm weigh:pages`, raw KB / gz KB:
 *
 *     row                        before         after          delta
 *     homepage                    635 / 202.6    636 / 203.4     +1 / +0.8
 *     rotate-pdf (client-side)   1239 / 371.1    774 / 250.5   -465 / -120.6
 *     merge-pdf (client-side)    1239 / 371.1    767 / 247.2   -472 / -123.9
 *     ocr-pdf (worker)           1239 / 371.1    779 / 250.5   -460 / -120.6
 *     summarize-pdf (AI)         1239 / 371.1    787 / 256.0   -452 / -115.1
 *     pdf-to-jpg (pdfjs)         1239 / 371.1    772 / 249.9   -467 / -121.2
 *     pdf-to-text (pdfjs)        1239 / 371.1    768 / 248.1   -471 / -123.0
 *     guide (merge)               625 / 198.5    627 / 199.3     +2 / +0.8
 *     404                         635 / 202.6    636 / 203.4     +1 / +0.8
 *     tools explorer              675 / 214.2    676 / 215.0     +1 / +0.8
 *     workspace                   732 / 234.0    734 / 234.6     +2 / +0.6
 *
 * Across all 50 tool pages: 1,239 / 371.1 each before; 765-815 raw and
 * 246.9-268.0 gz after (lightest split-pdf, heaviest markdown-to-pdf). The
 * +1-2 KB on every other page is real, and it is the price: webpack's runtime
 * (`webpack-*.js`, loaded by every page) carries the id -> file map of every
 * async chunk, 4,192 -> 5,508 bytes for the ~40 new ones. The server HTML did
 * not change on any of the 89 pages — identical markup once scripts, links
 * and React's useId values are set aside (the loader adds a tree level, so
 * the generated ids differ). WHICH panel a page carries is held by
 * `own-panel-first-load.test.ts`; this file holds how much.
 *
 * So this file measures and bounds. It does not claim the current weight is
 * good; it stops it getting worse without someone noticing, which is the thing
 * that was missing.
 *
 * TWO UNITS since 2026-10-09. `kb` is UNCOMPRESSED bytes on disk — roughly 3x
 * transfer size, fine for a regression budget, wrong as a user-facing figure;
 * do not quote it as page weight. `gzKb` is gzip -9 of each unique chunk,
 * summed — close to what a browser transfers, and the unit the redesign's
 * growth allowances are written in. Both come from the one weigher
 * (scripts/page-weight.ts), whose gz figure `page-weight.test.ts` holds to a
 * sum it computes itself. The chunk list comes from the prerendered HTML
 * `next build` writes, i.e. exactly what a browser would fetch; verified
 * against `curl` on the running server, which reported the same 18 and 12
 * chunks.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DESK_ISLAND_MARKER } from "@/components/intent/desk-island-chunk";
import { tools } from "@/lib/tools";
import {
  chunkFiles,
  chunkUrls,
  prerenderedPages,
  weighPage,
} from "../../scripts/page-weight";

const NEXT_DIR = path.join(process.cwd(), ".next");
const APP_DIR = path.join(NEXT_DIR, "server", "app");

// The weigher, the chunk reader and the page walk all live in
// scripts/page-weight.ts, shared with `pnpm weigh:pages` (the table a budget
// change is argued from; see the last test below) and with the lazy-chunk
// guard. Its history — the percent-encoded `[slug]` chunk that once weighed
// zero, and the miss that is now fatal — is documented there.
const weigh = (html: string) => weighPage(NEXT_DIR, html);
const chunkList = (html: string) => chunkUrls(NEXT_DIR, html);

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
 *
 * GZ CEILINGS ADDED 2026-10-09, re-anchored to a measurement rather than to the
 * plan. The redesign spec (G.1) budgeted in gzip — home 191.6 -> 200.0, tool
 * pages 302.4 -> 312.5 — from a one-off measurement nothing could re-run.
 * Weighed with the shared weigher on the build of 6337f4ed (the redesign's
 * branch point), every one of its baselines was stale:
 *
 *     page            planned gz   measured gz   ceiling = measured + allowance
 *     homepage           191.6        202.6         210.6  (+8)
 *     tool pages         302.4        371.2         381.2  (+10)
 *     guide              188.3        198.5         203.5  (+5)
 *     404                191.6        202.6         206.6  (+4)
 *     /tools               --         214.2         219.2  (+5)
 *     /workspace           --         234.0         238.0  (+4)
 *
 * The allowance is the redesign's whole growth programme for that page, not
 * per change; each package prints `pnpm weigh:pages` before and after and
 * names what grew. The plan's ceilings would have failed the day they landed
 * (371.2 > 312.5), and loosening them to fit would have been a budget chosen
 * to pass. The raw ceilings did NOT move: 675 / 1,280 / 665 already sit about
 * 40 KB over measured, and resetting them to the plan's 700 / 1,100 / 700
 * would fail the tool pages and re-open the margin the 40 KB catalogue leak
 * hid in. The 404, /tools and /workspace are new rows (raw: measured + ~40):
 * the 404 was in no budget, and /tools and /workspace were wrongly believed
 * not to be prerendered.
 *
 * The tool-page rows were RE-ANCHORED on 2026-10-09 to the build with every
 * panel split into its own chunk — raw and gz each measured + the same margin
 * (+40 raw, +10 gz), see the rows — and joined by a derived ceiling over all
 * 50 tool pages, which stopped weighing the same that day.
 *
 * EVERY ROW RE-MEASURED 2026-10-10, on the merge of main 552bed45 (#173 the
 * fallback faces, #175 the split) into design batch B 9b4affd4 (WP-04, -05,
 * -06). One weigher over four builds, raw KB / gz KB — base is the merge base
 * 1634c61a, where batch B left batch A:
 *
 *     row             base          main          batch B       merged
 *     homepage        635 / 202.5   636 / 203.3   649 / 207.1   650 / 207.9
 *     rotate-pdf     1239 / 371.3   777 / 251.3  1240 / 371.9   765 / 246.6
 *     ocr-pdf        1239 / 371.3   780 / 250.8  1240 / 371.9   773 / 247.4
 *     summarize-pdf  1239 / 371.3   788 / 256.2  1240 / 371.9   782 / 253.1
 *     guide           625 / 198.4   626 / 199.1   626 / 198.8   628 / 199.6
 *     404             635 / 202.5   636 / 203.3   630 / 200.1   632 / 200.9
 *     /tools          685 / 217.1   686 / 218.0   691 / 219.2   692 / 220.5
 *     /workspace      735 / 234.7   737 / 235.3   742 / 236.6   745 / 237.5
 *
 * (main and batch B weighed again 2026-10-10 — a fresh build of main, batch
 * B's review build — with the same figures; base as first measured.) Against
 * main + batch B - base, the homepage, guide and 404 are within 0.1 gz.
 * /tools and /workspace are +0.4 and +0.3: the webpack runtime's chunk map
 * lists both sides' async chunks (3.2 gz, against main's 3.0 and batch B's
 * 2.4), and their route code regrouped into one more shared chunk
 * (3889-*.js) — chunking, not duplication (below). The tool rows are 3.7-5.3
 * gz lighter (the weigher's other three tool pages 5.5-5.8): WP-06 took
 * WorkerPreview, the NotifyMe it rendered and the upload zone off the tool
 * route, which, split, no longer hides in a chunk every tool page loaded
 * anyway; and the tool route now shares one copy of the telemetry client,
 * the Button and cn() with the layout and the error boundary, where main's
 * route chunk carried its own (rotate-pdf's first load: 15 duplicated
 * modules, 15.9 KB raw, in main; 13, 10.7 KB, merged).
 *
 * THE MERGE FIRST WEIGHED 1.9-2.0 gz MORE on every non-tool row (656 / 209.9
 * home, 633 / 201.6 guide, 637 / 202.9 404, 697 / 222.4 /tools, 750 / 239.4
 * /workspace; tool rows +1.6), and the /tools and /workspace ceilings were
 * raised to fit. The excess was DUPLICATED bytes: the root layout's chunk
 * carried its own copies of lucide's icon base, cn(), the Button and the
 * telemetry client (5.3 KB raw), which 4032-*.js — loaded by every page —
 * also carried. Neither parent did. The cause was a chunk set no module had
 * (the layout + the error boundary + the tool route), and the fix was in the
 * import graph (global-error.tsx imports the reporter, not the barrel;
 * error.tsx no longer imports Container): -2.0 gz on the homepage, guide and
 * 404, -1.9 on /tools and /workspace, -1.6 on every weighed tool page. Why
 * webpack did it, and the guard that holds the layout to the parents' one
 * duplicated module, are in src/deploy/first-load-duplicates.test.ts.
 *
 * What the merge did to each ceiling is said on its row.
 *
 * WP-07, 2026-10-10 (design batch C, drop and paste anywhere), as
 * RE-REPAIRED after its second review. One weigher over four builds —
 * 8fd8048a (the package's base), 8655040d (first merged), c887e15c (the
 * first repair) and this one — gz KB, with raw KB for the last:
 *
 *     row             base    first    repair   now     raw now  vs base
 *     homepage        207.9   211.2    210.6    209.5     652     +1.6
 *     rotate-pdf      246.6   250.9    250.5    248.7     771     +2.1
 *     merge-pdf       243.1   247.1    246.7    245.1     764     +2.0
 *     ocr-pdf         247.4   251.4    251.4    249.6     779     +2.1
 *     summarize-pdf   253.1   257.1    257.1    255.2     787     +2.1
 *     pdf-to-jpg      245.5   249.9    249.4    247.6     768     +2.1
 *     pdf-to-text     243.8   248.2    247.7    245.9     764     +2.1
 *     guide           199.6   205.3    201.5    201.5     633     +1.9
 *     404             200.9   202.5    202.4    202.4     635     +1.5
 *     /tools          220.5   221.5    222.0    222.0     696     +1.5
 *     /workspace      237.5   241.6    241.2    239.6     750     +2.2
 *
 * WHAT WP-07 SPENDS, against G.1's allocations (exact bytes, this build):
 *  - THE LAYOUT, every page: the root layout's chunk 7,071 -> 8,503 B gz
 *    (+1.40 KB of the layout's +2.5), all of it `DropLayer`: the
 *    listeners, accepting the drag, routing a turn after the registry
 *    arrives. What it draws and where files go are chunks fetched on idle
 *    or with a file, which the webpack runtime's map lists (3,296 ->
 *    3,407 B gz, +0.11: the chunks WP-07 fetches later). Layout and map,
 *    +1.51, are the whole of the 404's and /tools' growth (+1.5 each).
 *  - THE TOOL PAGES, beyond the layout: 0.73 (rotate), 0.73 (ocr), 0.73
 *    (summarize), 0.62-0.73 on the other weighed tool pages — WP-07's 0.8
 *    is G.1's allocation; the repair before this spent 2.4-2.5. The sheet
 *    (`DropSheet`, now folded by the bundler into the runner kit's scope),
 *    its box and face, and `useDropBox` against the old Dropzone's body;
 *    the runtime's map; `ChosenFileTarget`'s lazy wrapper on worker pages
 *    (+0.1). What it took to get there, each measured on its own build:
 *    the sheet's drag states, claim and registration became a DOM engine
 *    in the registry's chunk (`@/lib/intent/drop-engine`, -0.8 gz); the
 *    open editor's and the chosen file's "replace" targets load with the
 *    first file (`@/components/tools/replace-boxes`, -0.1 each); the
 *    tool's name comes from the page (`data-tool-name`), not a client
 *    context (-0.1); the desk variant left the tool pages' sheet
 *    (`drop-desk.tsx`, -0.3), and with the guide's desk on it too, the
 *    sheet is the runner kit's alone and is concatenated into it (-0.04);
 *    the pre-hydration pick is adopted by the box, not an effect per
 *    picker (-0.04).
 *  - THE HOMEPAGE, beyond the layout: 0.17 (the map's 0.11 among it) —
 *    of the +8 allowance, 0.2 was left after the layout's 2.5 (WP-05 4.6,
 *    main 0.8). The ticket dialog reuses the desk's ticket and sheet, so
 *    webpack keeps what they share in a chunk of its own beside the island
 *    (two files, 4,202 + 2,991 B gz on this build; on the build that first
 *    split them, one file instead of two was 0.65 lighter — the cost of the
 *    reuse); what paid for it is the desk no longer carrying the sheet's
 *    face: its box is a module of its own (`drop-sheet-box.ts`, -0.5).
 *  - THE GUIDE: the desk loads after the page (`GuideDeskSlot`), +0.5
 *    beyond the layout.
 *  - /WORKSPACE: the drop panel as the page's target, +0.77 beyond the
 *    layout (the map's 0.11 among it).
 *
 * WP-08, 2026-10-10 (design batch C, every ending is a fork). One weigher
 * over two builds: 59d726fd (the package's base, WP-07's last commit; the
 * same figures WP-07 recorded above) and the package's final build. gz KB,
 * exact, with raw KB:
 *
 *     row             base     now      delta   raw base -> now
 *     homepage        209.46   209.63   +0.17    652 -> 653
 *     rotate-pdf      248.72   251.76   +3.04    771 -> 779
 *     merge-pdf       245.10   248.72   +3.62    764 -> 773
 *     ocr-pdf         249.57   252.25   +2.68    779 -> 787
 *     summarize-pdf   255.24   257.86   +2.62    787 -> 795
 *     pdf-to-jpg      247.6    250.98   +3.4     768 -> 777
 *     pdf-to-text     245.9    249.02   +3.1     764 -> 773
 *     guide           201.5    201.71   +0.2     633 -> 633
 *     404             202.4    202.61   +0.2     635 -> 636
 *     /tools          222.00   221.88   -0.12    696 -> 697
 *     /workspace      239.6    239.54   -0.1     750 -> 751
 *
 * WHAT WP-08 SPENDS, chunk by chunk (base -> now, B gz):
 *  - EVERY PAGE, +181: the root layout 8,503 -> 8,589 (+86: the consent
 *    banner publishing its height as `--sf-bottom-inset`, so a docked Run
 *    bar sits above it); the webpack runtime's map 3,407 -> 3,472 (+65:
 *    89 -> 94 on-demand chunks — the result's ending, fetched when a run
 *    starts, and the runner chunks regrouped around the new shared kit);
 *    the telemetry chunk 2,160 -> 2,190 (+30: the `encrypted-input` and
 *    `unreadable-input` reasons the spec adds, E.13).
 *  - THE TOOL PAGES, beyond that, +2.5 to +3.4 (WP-08's G.1 allocation is
 *    4.5): the runner kit's result (the receipt's slot and its loader,
 *    Back to adjust, `NO_ADJUST`/`NO_OUTPUT`), `ErrorNote`'s remedy and
 *    `@/lib/pdf/remedies`, `RunButton`'s progress line, `RunEnding`, the
 *    run outputs (`@/lib/intent/run-output`), the Run bar, the unsaved
 *    guard on seven editors, the hand-off reporting its trail; and on the
 *    route, `ToolRunProvider` and `TicketRail` (the route chunk itself
 *    went 5,602 -> 4,960 as its runner-side code regrouped). Worker pages
 *    carry the kit and the route as before, so they pay it too (+2.6-2.7)
 *    though only Compress's worker card uses its ending yet (WP-10).
 *  - NOT FIRST LOAD: the receipt (`OutputFacts`, its page count) and
 *    Continue with (`launchWithFiles` and the hand-off store with it) are
 *    one on-demand chunk (12 KB raw), `lazy-chunks.test.ts` holds it there.
 *  - /TOOLS and /WORKSPACE got LIGHTER (-0.1) though they pay the +0.18
 *    every page pays: their route code regrouped into fewer chunks.
 *
 * THE HOMEPAGE could not take it: the every-page +0.18 is the layout's
 * +0.09 (inside the layout's allowance) and +0.09 that is not (the map and
 * the reasons), and the row had 0.04 to spare (WP-07, below). G.1 gave
 * WP-08 4.5 on the tool pages and nothing on the homepage — written before
 * anyone had a measured cost for a lazy chunk's map entry. So WP-08 pays
 * for it FROM ITS OWN allocation: the homepage ceiling is raised 0.1 and
 * the three tool-page ceilings each LOWERED 0.1, the programme's total
 * allowance unchanged. On the rows.
 *
 * WP-08 REPAIR, 2026-10-11 (after the package's review). One weigher over
 * two builds: 50b2a243 (the figures above) and the repair's final build.
 * gz KB, exact, with raw KB:
 *
 *     row             before   now      delta   raw before -> now
 *     homepage        209.63   209.64   +0.01    653 -> 653
 *     rotate-pdf      251.76   252.06   +0.30    779 -> 780
 *     merge-pdf       248.72   249.02   +0.30    773 -> 774
 *     ocr-pdf         252.25   252.54   +0.29    787 -> 787
 *     summarize-pdf   257.86   258.15   +0.29    795 -> 796
 *     pdf-to-jpg      250.98   251.28   +0.30    777 -> 778
 *     pdf-to-text     249.02   249.32   +0.30    773 -> 774
 *     guide, 404, /tools, /workspace: unchanged (±0.01)
 *
 * WHAT THE REPAIR SPENDS, on the tool pages only (the runner kit and the
 * route are theirs): a finished run waits for its ending before it is
 * drawn (`endingReady`) and a result that outwaits it draws the ending
 * under Download; a worker panel's result card says why nothing follows
 * (`NO_CONTINUE`, read from the job the page now gives worker panels too);
 * the tool-run context counts "Bringing your files over…" so the job's row
 * is held from that frame (`useBringingFiles`, `TicketRail`'s slot). The
 * receipt's one-statement count, its stacked states, the mismatch part
 * and Continue with's size rules are all in the on-demand ending chunk,
 * not here. No ceiling changes: what is still to come fits under each
 * tool row with 1.2 / 1.5 / 1.6 to spare (was 1.5 / 1.8 / 1.9).
 *
 * WP-08 SECOND REPAIR, 2026-10-11 (the re-review: Compress PDF's CLS after
 * a pick). Same weigher, 4de768a2's build against the repair's: every row
 * above ±0 to the byte, the runner kit unchanged. Compress PDF, which no
 * row names (held by `EVERY_TOOL_PAGE`), 822,194 -> 822,877 bytes raw
 * (+683) and 263,237 -> 263,566 gz (+329): its stage held from the frame a
 * file arrives (`stageHoldPx`) and the ending fetched then, both in its
 * own runner's chunk.
 *
 * THE FIRST SCREEN, 2026-10-11 (page CLS after a pick held at eight sizes,
 * on every tool with an ending). Same weigher, 06ecd2da's build against
 * this one's, every tool page: +570 B raw / +223 B gz of script — the
 * runner stage's hold from a Run press (`stage-hold`, in the shared runner
 * kit). Compress PDF +210 / +35 in all: the same, less its own stage hold.
 * Every other page ±0 raw (-1 to -5 B gz: chunk names in the runtime).
 * The first screen's and the stage's rules are stylesheet, which this
 * weigher does not count.
 *
 * MAIN (#179) INTO BATCH C, AND ITS REVIEW'S REPAIRS, 2026-10-17. One
 * weigher over four builds, gz KB exact (raw KB):
 *
 *     row             36702d2c   main b94c1882   merge 94dc2b22   now
 *     rotate-pdf      252.36     246.70          252.40           252.53 (782)
 *     summarize-pdf   258.89     255.03          260.30           258.38 (797)
 *     compress-pdf    257.50     251.95          257.54           257.81 (805)
 *
 * Main's PowerPoint work added +1.4 to summarize-pdf (253.6 at the merge
 * base): `OfficeExportCoverageNotice` grew, and it shared a module with the
 * next-step link Summarize, PDF structure and table extraction import, so
 * webpack shipped it to all three. Merged, the AI row read "needs 3.17,
 * has 2.70" — red before any repair. The repairs cost +0.16 on every tool
 * page (the stage hold's fold and click/key rules, in the runner kit's
 * chunk: 9,741 -> 9,900 B gz) and +0.27 on Compress PDF (its no-saving
 * ending). Recovered by moving the coverage notice to a module of its own
 * (`office-export-coverage.tsx`): summarize-pdf 260.46 -> 258.38. No
 * ceiling changes.
 *
 * PR #180'S REVIEW REPAIRS, 2026-10-17. Same weigher, c7abb986's build
 * against the repairs', gz KB exact (raw KB):
 *
 *     row             before   now      delta
 *     rotate-pdf      252.53   253.32   +0.79   (782 -> 784)
 *     merge-pdf       249.48   250.33   +0.85
 *     ocr-pdf         253.08   253.93   +0.85
 *     summarize-pdf   258.38   259.25   +0.87   (797 -> 799)
 *     compress-pdf    257.81   259.32   +1.51   (805 -> 808)
 *     homepage, /tools, /workspace: unchanged (±0.03)
 *
 * On rotate-pdf, chunk by chunk (B gz): the runner kit's 9,900 -> 10,372
 * (+472: a result not yet downloaded registered for a paste's question,
 * focus moved to the file a hand-off carried, scroll keys read as the
 * wheel) and the route's 5,108 -> 5,505 (+397: the job row read from the
 * address before the first paint); the on-demand chunks regrouped, -58.
 * `@/lib/intent/unsaved` now loads with every runner (`downloadBlob` keeps
 * a result). No ceiling changes; every row still takes what is to come.
 *
 * ...AND THE RE-REVIEW'S, the same day: rotate-pdf had 0.01 KB gz left,
 * and its modifier keys alone read "needs 3.17, has 3.17". Recovered by
 * the job row reading its address without `@/lib/handoff/url` (which
 * carried the id module, crypto and all, into the route's chunk), with
 * every worker card's result registered and a Continue row no longer a
 * keep — both shorter, not longer. rotate-pdf 253.32 -> 253.26, merge-pdf
 * 250.33 -> 250.27, ocr-pdf 253.93 -> 253.64, summarize-pdf 259.25 ->
 * 258.95, compress-pdf 259.32 -> 259.26; homepage, /tools, /workspace ±0.
 *
 * WHAT IS STILL TO COME is held against every row by the test after
 * `BUDGETS`, with no shortfall recorded anywhere: a row that cannot take it
 * fails. The one row the layout's remaining growth could not reach was
 * /tools, from before WP-07 until the first-load duplicates went on
 * 2026-10-20 — `LAYOUT_CANNOT_REACH` keeps that history and holds any
 * future entry the same way.
 */
/**
 * Every tool page, not three of them. Until 2026-10-09 all 50 loaded the same
 * chunks, so three rows spoke for the rest; with each panel its own chunk they
 * range 765-815 KB raw / 246.9-268.0 gz, and a heavy runner on a page no row
 * names would grow unseen. Heaviest measured (markdown-to-pdf, 815 / 268.0) +
 * the same carried-over margin (+40 raw, +10 gz).
 *
 * RE-MEASURED 2026-10-10 on the merged build (see above): 756-811 raw /
 * 242.6-266.1 gz, lightest split-pdf, heaviest still markdown-to-pdf at
 * 811 / 266.1 (main 552bed45: 768-818 / 247.7-268.8). Same rule, same margin:
 * 855 / 278.0 -> 851 / 276.1. (The merge's first build, with the layout's
 * duplicated copies, measured 816 / 267.8 here and the row went to
 * 856 / 277.8; the copies are gone, so that figure would hand them out.)
 */
/*
 * LOWERED 2026-10-29 — the first-load wave (perf/first-load-wave2), and
 * something got LIGHTER on every page. main 08beadda and the wave, both
 * built and weighed with the shared weigher, raw KB / gz KB:
 *
 *     row             before         after          delta          ceiling (was)
 *     homepage        652 / 207.61   618 / 196.56   -34 / -11.05   641 / 199.6  (675 / 210.7)
 *     rotate-pdf      783 / 252.42   702 / 225.76   -81 / -26.66   724 / 229.8  (805 / 256.5)
 *     ocr-pdf         793 / 255.38   711 / 228.67   -82 / -26.70   731 / 230.5  (813 / 257.3)
 *     summarize-pdf   800 / 259.62   718 / 232.96   -82 / -26.66   740 / 236.3  (822 / 263.0)
 *     guide (merge)   632 / 199.98   601 / 189.85   -31 / -10.13   634 / 193.3  (665 / 203.5)
 *     404             636 / 201.10   602 / 190.04   -34 / -11.06   641 / 195.5  (675 / 206.6)
 *     /tools          688 / 218.03   652 / 205.50   -36 / -12.52   679 / 209.6  (715 / 222.2)
 *     /workspace      745 / 236.27   712 / 224.55   -33 / -11.72   739 / 229.2  (772 / 241.0)
 *     /status         708 / 224.75   677 / 214.63   -31 / -10.12   714 / 221.8  (745 / 232.0)
 *     all 50 tools    773-818 / 247.70-264.98  ->  695-735 / 221.84-239.04,
 *                     every one -77..-85 raw / -25.18..-28.28 gz
 *
 * What left, by module, measured from webpack's chunk graph on the build:
 *   every page   tailwind-merge (~8.5 gz): `cn()` is clsx now, and the 14
 *                override sites it resolved are written without the
 *                override (src/tests/class-conflicts.ts); Next's
 *                web-vitals library (~2.7 gz), which the layout imported
 *                to mount only with telemetry on (web-vitals-lazy.tsx).
 *   tool pages   the tool catalogue (~6.6 gz + the modules it carried): the
 *                hand-off, ticket-rail and remedy code read the five fields
 *                they need from `@/lib/tools/directory` (generated, tested
 *                against the catalogue); page copying and its structure walk
 *                (~9.5 gz) behind `engine.ts`'s call-time import, and the
 *                engine itself off the worker pages (`engine-errors.ts`,
 *                `rotation.ts`); the thumbnail, cover, raster and grayscale
 *                renderers (~2.3-2.7 gz) imported when a file arrives; the
 *                range parser and file helpers off the route chunk
 *                (`raster-format.ts`); Split's modes with the document.
 *
 * Each ceiling came down by exactly its row's saving (gz floored to the
 * tenth), so every row keeps the headroom it had — none of the ~11-27 KB gz
 * freed is handed out, and what the redesign still has to add (the test
 * after BUDGETS) is held against the same room as before. The tool rows'
 * old ceilings would have let a page regain the whole catalogue and
 * tailwind-merge unseen.
 *
 * EVERY_TOOL_PAGE by the same rule, the smallest saving across the 50
 * (-77 raw, translate-pdf; -25.18 gz, watermark-pdf): 851 / 276.1 ->
 * 774 / 250.9, over a heaviest of 735 / 239.04 (edit-pdf).
 *
 * The polyfills chunk (110 KB raw, 38.6 gz) is still in every row: the
 * weigher counts every chunk the HTML names, and this one is `noModule`,
 * so no browser that runs this app downloads it (a local `next start`
 * measured 165 KB of JS transferred for the homepage against 196.6 here).
 * That is a fact about the unit, not a saving, and nothing here claims it.
 */
const EVERY_TOOL_PAGE = { kb: 774, gzKb: 250.9 } as const;
const BUDGETS = [
  // TIGHTENED 700 -> 675 on 2026-10-08: the homepage weighs 635 KB once the
  // catalogue left it (b9ccf092). Same +40 KB margin as the tool pages; under
  // 700 the 40 KB catalogue leak fitted unnoticed, under 675 it cannot.
  //
  // MERGED 2026-10-10: 650 / 207.9, so 5.3 of the +8 gz allowance is spent
  // (202.6 -> 207.9) — batch B +4.6 (the desk and ticket +3.7 of it, WP-05),
  // main +0.8 (the split's runtime map, top of this file), -0.1 rounding.
  // Both ceilings unchanged: the allowance was never raised, and 2.7 gz of it
  // is left. (The merge's first build spent 7.3, 2.0 of it the layout's
  // duplicated copies — fixed, above the rows.)
  //
  // WP-07 raised this 210.6 -> 211.4 (211.2 measured, +3.3); its first
  // repair put it back at 210.6 with 210.56 measured, which left the rest
  // of the layout's allowance no room. Re-repaired: 209.5 measured
  // (209.46), +1.6 — the drop layer and the runtime's map (+1.51), the
  // desk's share of the ticket dialog's reuse, paid for by the desk dropping
  // the sheet's face (+0.06), itemised above the rows. Unchanged ceiling,
  // with room for the rest of the layout's allowance (the test after
  // `BUDGETS`: 0.04 to spare).
  //
  // RAISED 210.6 -> 210.7 by WP-08, paid from WP-08's own tool-page
  // allocation (the three tool rows below each lowered 0.1): 209.63
  // measured, +0.17 — the layout +0.09 and the map and telemetry reasons
  // +0.09 that every page pays (above the rows). With the layout's
  // remainder (1.02) still to come it has 0.05 to spare.
  //
  // LOWERED 675 / 210.7 -> 641 / 199.6 on 2026-10-29 (the wave, above).
  { name: "homepage", html: "index.html", kb: 641, gzKb: 199.6 },
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
  //
  // LOWERED 1280 -> 814 / 819 / 827 on 2026-10-09 (gz 381.2 -> 260.5 / 260.5
  // / 266.0), and something got LIGHTER: the open lever above, pulled. Every
  // runner and worker panel is now its own chunk, so a tool page loads its
  // own panel and no other tool's (table at the top of this file;
  // own-panel-first-load.test.ts holds WHICH). The three rows no longer weigh
  // the same, so each is measured + margin on its own:
  //
  //     row           before (raw / gz)   after (raw / gz)   ceiling (raw / gz)
  //     rotate-pdf      1239 / 371.1        774 / 250.5        814 / 260.5
  //     ocr-pdf         1239 / 371.1        779 / 250.5        819 / 260.5
  //     summarize-pdf   1239 / 371.1        787 / 256.0        827 / 266.0
  //
  // The margin, itemised — both halves CARRIED OVER, neither widened:
  //   +40 KB raw   the headroom the redesign programme had under 1280
  //                (1,280 - 1,239 = 41), shared by its remaining packages;
  //   +10.0 KB gz  the redesign's tool-page growth allowance (the "+10" in
  //                the gz table above), unchanged.
  // Nothing of the ~465 KB raw / ~120 KB gz this freed is handed out: under
  // 1280 a tool page could have regained 400 KB with nothing failing. A
  // package that needs more raises its row here and names what grew. The
  // other 47 tool pages are bounded by the derived check below.
  //
  // LOWERED again 2026-10-10, to the merged build by the same rule (measured
  // + 40 raw, + 10 gz, both carried over): the merged tool pages are lighter
  // than main's, because WP-06 took WorkerPreview, its NotifyMe and the
  // upload zone off the tool route (table above the rows). Keeping main's
  // figures would hand that out.
  //
  //     row           main 552bed45   merged        ceiling (was)
  //     rotate-pdf      777 / 251.3    765 / 246.6   805 / 256.6  (814 / 260.5)
  //     ocr-pdf         780 / 250.8    773 / 247.4   813 / 257.4  (819 / 260.5)
  //     summarize-pdf   788 / 256.2    782 / 253.1   822 / 263.1  (827 / 266.0)
  //
  // The merge's first build measured 769 / 248.2, 777 / 249.0 and
  // 786 / 254.7 here, and these rows went to 809 / 258.2, 817 / 259.0 and
  // 826 / 264.7; 1.6 gz of that was the layout's duplicated copies (above the
  // rows), fixed, and keeping those figures would hand the 1.6 out.
  //
  // WP-07 (2026-10-10): unchanged — 248.7, 249.6 and 255.2 measured
  // (248.72, 249.57, 255.24), 0.73 of WP-07's 0.8 beyond the layout on
  // each. What the rest of the programme still has to add fits under each
  // (the test after `BUDGETS`: 0.08, 0.03 and 0.06 to spare).
  //
  // WP-08 (2026-10-10): 251.76, 252.25 and 257.86 measured (+3.04, +2.68,
  // +2.62; itemised above the rows), within its 4.5. Each ceiling LOWERED
  // 0.1, to 256.5 / 257.3 / 263.0: the 0.1 WP-08 spent on every page, which
  // the homepage row could not take, comes out of WP-08's own allocation
  // here rather than out of the programme's. What is still to come (WP-11,
  // WP-12, the unallocated 0.4 and the layout's 1.02) fits under each with
  // 1.5 / 1.8 / 1.9 to spare.
  //
  // WP-08 repair (2026-10-11): 252.06, 252.54 and 258.15 (+0.30, +0.29,
  // +0.29; itemised above the rows). Unchanged ceilings; 1.2 / 1.5 / 1.6 to
  // spare.
  //
  // LOWERED 2026-10-29 by each row's saving (the wave, above): 805 / 256.5
  // -> 724 / 229.8, 813 / 257.3 -> 731 / 230.5, 822 / 263.0 -> 740 / 236.3.
  {
    name: "a client-side tool page",
    html: "tools/rotate-pdf.html",
    kb: 724,
    gzKb: 229.8,
  },
  {
    name: "a worker tool page",
    html: "tools/ocr-pdf.html",
    kb: 731,
    gzKb: 230.5,
  },
  {
    name: "an AI tool page",
    html: "tools/summarize-pdf.html",
    kb: 740,
    gzKb: 236.3,
  },
  // A content page. The homepage-class budget is deliberate and does double
  // duty as a leak detector: a guide must never pull the pdf-lib chunk or a
  // runner into a route whose job is prose.
  // TIGHTENED 700 -> 665 on 2026-10-08 (625 KB measured), for the same reason.
  //
  // MERGED 2026-10-10: 628 / 199.6, 1.1 of the +5 gz spent (main +0.7,
  // batch B +0.4). Unchanged. (The merge's first build spent 3.1, 2.0 of it
  // the layout's duplicated copies — fixed, above the rows.)
  //
  // WP-07 raised this 203.5 -> 205.5 (205.3 measured, +5.7, the desk and its
  // sheet the route's first client code); its repair put it back: 201.5
  // measured, +1.9 — the drop layer (+1.4) and the slot that swaps the desk
  // in after the page (+0.5), above the rows. Still the leak detector it
  // was: no runner, no pdf-lib, no catalogue (the desk reads its tool from
  // the server, and the hand-off code arrives with a file). Re-repaired:
  // the same 201.5.
  // LOWERED 665 / 203.5 -> 634 / 193.3 on 2026-10-29 (the wave, above).
  {
    name: "a guide page",
    html: "guides/how-to-merge-pdf-files.html",
    kb: 634,
    gzKb: 193.3,
  },
  // NEW 2026-10-09. The root 404 ships with EVERY route, which is why the
  // catalogue riding it reached every page (b9ccf092); it had no budget of its
  // own. Measured 635 KB / 202.6 gz, the same chunk set as the homepage.
  //
  // MERGED 2026-10-10: 632 / 200.9, none of the +4 gz spent and 1.7 under
  // the baseline — batch B took 2.4 off it (WP-05: the home route chunk the
  // 404 inherits lost the old upload zone), main added 0.8. Unchanged. (The
  // merge's first build measured 202.9; 2.0 of it the layout's duplicated
  // copies — fixed, above the rows.)
  // LOWERED 675 / 206.6 -> 641 / 195.5 on 2026-10-29 (the wave, above).
  { name: "the 404 page", html: "_not-found.html", kb: 641, gzKb: 195.5 },
  // NEW 2026-10-09. Both are prerendered (they read nothing from the request;
  // pages-static.test.ts holds them to that), so they are weighed here like
  // every other page rather than in a browser. Measured 675 / 214.2 and
  // 732 / 234.0; both legitimately carry the catalogue (see NEEDS_CATALOGUE).
  //
  // RAISED 2026-10-10 by the merge to 222.6 and 239.6, gz only, and
  // LOWERED the same day once the merge stopped duplicating the layout's
  // modules (above the rows): /workspace back to its allowance, /tools to
  // 1.5 over it. Each side used the allowance on its own: batch B left /tools
  // at exactly 219.2 and /workspace at 236.6 of 238.0 (WP-05's commit,
  // before it: "the last two had no headroom left"), and main added its own:
  //
  //   /tools      214.2 -> 220.5 gz, +6.3 of +5: +2.9 by the merge base
  //               (batch A, main to 1634c61a), batch B +2.1 (WP-04/06; the
  //               explorer's "Where it runs" filter and the cards' glyphs
  //               and formats among it), main +0.9 (the split's runtime
  //               map), +0.4 the merge's chunking (the runtime map lists
  //               both sides' async chunks; the route code regrouped).
  //               Ceiling 220.7 = merged + 0.2 gz, which is not allowance:
  //               the page measures 220.475, 0.025 from rounding to 220.4,
  //               and a gate on that edge fails on chunk-id churn between
  //               machines. Any growth a reader could notice is over it. The
  //               merge's first build measured 222.4, 1.9 of it the layout's
  //               duplicated copies.
  //   /workspace  234.0 -> 237.5 gz, +3.5 of +4: +0.7 by the merge base,
  //               batch B +1.9 (WP-04's suggestions read from the files and
  //               the hand-off, less WP-05's 1.4), main +0.6, +0.3 the
  //               merge's chunking. Within its allowance again, so the
  //               ceiling is the allowance, 238.0 (234.0 + 4), not raised:
  //               0.5 gz of the redesign's room is left. The merge's first
  //               build measured 239.4, 1.9 of it the duplicated copies.
  //
  // The raw ceilings did not move (692 and 745 measured).
  //
  // RAISED by WP-07, each to measured + 0.2 gz (above the rows, itemised),
  // and set again by its repair on its own build:
  //   /tools      220.7 -> 222.2 (696 / 222.0): the drop layer and the
  //               runtime's map, +1.5 — exactly the 404's growth. (221.7 on
  //               the first merge, where the route chunk absorbed 3889.)
  //               A drop on /tools opens the ticket dialog, fetched with the
  //               file; nothing of it is in this page's first load.
  //               Re-repaired: the same 222.0 (222.00), so the same 222.2.
  //               The layout's growth still to come cannot fit here, and
  //               could not at WP-07's base either (`LAYOUT_CANNOT_REACH`).
  //   /workspace  238.0 -> 241.4 (753 / 241.2, +3.7): the layer (+1.4), and
  //               the drop panel built on the one drop primitive and
  //               registered as the page's target (+2.3). LOWERED by the
  //               re-repair to 241.0: 750 / 239.6 measured (239.64, +2.2:
  //               the layer and the runtime's map +1.51, the panel +0.66),
  //               and 241.0 is the lowest one-decimal ceiling that takes
  //               the rest of the layout's allowance (1.10) on top with the
  //               0.2 these rows keep for chunk-id churn (239.64 + 1.10 +
  //               0.2 = 240.94) — 241.4 would have handed the 0.4
  //               recovered here to nobody in particular.
  // Both rows were past the redesign's allowance for them before WP-07
  // (/tools 219.2, /workspace 238.0).
  //
  // LOWERED 2026-10-29 (the wave, above): /tools 715 / 222.2 -> 679 / 209.6,
  // /workspace 772 / 241.0 -> 739 / 229.2.
  { name: "the tools explorer", html: "tools.html", kb: 679, gzKb: 209.6 },
  { name: "the workspace", html: "workspace.html", kb: 739, gzKb: 229.2 },
  // ADDED 2026-10-23. The status page had no row, and that is how it carried
  // pdf-lib and the tool catalogue unnoticed: 1,193 KB raw / 418.5 KB gz on
  // production, then 707 / 224.1 once alert-vocabulary.ts cut the chain
  // (lazy-chunks.test.ts holds the pdf-lib half). The homepage's margins: a
  // pdf-lib-sized return cannot fit under either ceiling.
  // LOWERED 745 / 232.0 -> 714 / 221.8 on 2026-10-29 (the wave, above).
  { name: "the status page", html: "status.html", kb: 714, gzKb: 221.8 },
] as const;

/**
 * WHAT THE REDESIGN STILL HAS TO ADD, row by row — so a package that spends
 * past its allocation fails here, not in the package after it.
 *
 * The spec's G.1 allocates each row's growth allowance among the packages
 * (tool pages: WP-07 0.8, WP-08 4.5, WP-11 1.5, WP-12 0.3, the layout 2.5;
 * WP-10 offsets itself). A ceiling alone cannot see an overspend: WP-07
 * once spent 2.4 of its 0.8 and every tool row still passed, because the
 * overspend was paid out of WP-08's share — which WP-08 would then have
 * found missing. So each row's headroom (ceiling − measured) is held
 * against the sum of what is still to come there: the packages not yet
 * landed (a package deletes its entry in the PR that lands it), what is
 * left of the layout's allowance, which every page pays (measured from the
 * layout chunk itself against its size at WP-07's base), and the 0.4 G.1
 * allocated to no one — taking it is a re-allocation, so it is held like
 * an allocation still to come. A row that cannot take it all FAILS: there
 * is no record of a shortfall to hide behind (WAS `SHORT_BY`, which held
 * WP-07's tool-row overrun as an "owner decision" and passed — WP-07
 * review, rule 2).
 */
const LAYOUT = {
  /**
   * What is LEFT of G.1's 2.5 KB gz for the root layout's growth, at the
   * base below. WAS 2.5 over 7,071 B (8fd8048a, WP-07's base); on 2026-10-29
   * the layout measured 9,457 B on main 08beadda — 2.33 of the 2.5 spent,
   * 0.17 left — and the wave took Next's web-vitals library out of it
   * (web-vitals-lazy.tsx): 6,754 B. The base moved to what is left, not to
   * a fresh 2.5: re-anchoring with the whole allowance would hand the layout
   * the 2.7 KB the wave freed.
   */
  allowanceKb: 0.17,
  /**
   * The root layout chunk on the wave's builds, 2026-10-29, bytes gz:
   * 6,753-6,754 measured, set 14 B under so chunk-id churn between machines
   * cannot trip the health check below (being under only makes the
   * remainder smaller).
   */
  baseBytes: 6_740,
};
/** G.1, tool pages: 10.0 − (0.8 + 4.5 + 1.5 + 0.3 + 2.5), held by no package. */
const UNALLOCATED = 0.4;
const TOOL_PAGES_TO_COME = {
  // WP-08 landed 2026-10-10 (its 4.5 deleted here, as the rule says).
  //
  // WP-10 and WP-11 landed 2026-10-21 (#195 and #194); their entries are
  // deleted, and what they spent is measured, not allocated (gz, weigher):
  //   WP-10, d0c0316f -> 952734ef:  rotate 251.6 -> 252.1, ocr 250.9 ->
  //     254.6, summarize 256.2 -> 259.6. G.1 gave WP-10 "~0", on the
  //     premise that 14 status fetches and 14 stage lists would dedupe;
  //     since #175 a page loads only its own panel, so there was one of
  //     each per page to begin with, and nothing to offset.
  //   WP-11 + WP-13, merged into WP-10 at 507b6383: rotate 252.1 -> 253.5,
  //     ocr 254.6 -> 255.1, summarize 259.6 -> 260.2 (one merge, one figure).
  // WP-14 (radius vocabulary) was allocated no tool-page growth in G.1, so
  // what is still to come here is WP-12's share and the 0.4 no one holds.
  "WP-12": 0.3,
  unallocated: UNALLOCATED,
};
/**
 * The table as it stood before WP-08 landed — the positive control below
 * does its arithmetic against THAT, so the control's numbers stay the
 * ones it was written with whatever lands after.
 */
const TOOL_PAGES_TO_COME_AT_WP07 = {
  "WP-08": 4.5,
  "WP-11": 1.5,
  ...TOOL_PAGES_TO_COME,
};
const STILL_TO_COME: Record<string, Record<string, number>> = {
  "tools/rotate-pdf.html": TOOL_PAGES_TO_COME,
  "tools/ocr-pdf.html": TOOL_PAGES_TO_COME,
  "tools/summarize-pdf.html": TOOL_PAGES_TO_COME,
};

/**
 * Rows the layout's remaining growth cannot reach, and why — never because
 * of the package that lists them. Each is held two ways: the layout's
 * remainder must STILL not fit there (an entry that stops being true fails
 * as stale, so it cannot outlive its reason), and nothing else is excused:
 * the row's packages still to come are held as on any row, and its growth
 * is its ceiling's to stop.
 */
const LAYOUT_CANNOT_REACH: Record<string, string> = {
  // "tools.html" was here from WP-07 until 2026-10-20: at its base (8fd8048a)
  // /tools was 220.49 under a 220.7 ceiling the batch-B reconcile set as
  // "measured + 0.2, which is not allowance", with the layout's whole 2.5
  // still to come — 2.3 short. Deleted when the first-load duplicates went
  // (first-load-duplicates.test.ts, next.config.mjs `rootShared`): /tools
  // fell 222.0 -> 216.4 gz with its ceiling unchanged, and the layout's
  // remainder fits there now, so the row is held to it like every other.
};

/** One row's headroom against what is still to come there, KB gz. */
function shortfall({
  html,
  ceiling,
  measured,
  layoutLeft,
  toCome,
}: {
  html: string;
  ceiling: number;
  measured: number;
  layoutLeft: number;
  toCome: Record<string, number>;
}) {
  const needed =
    Object.values(toCome).reduce((sum, kb) => sum + kb, 0) + layoutLeft;
  const left = ceiling - measured;
  return { html, needed, left, short: needed - left };
}

/** The root layout chunk a page loads, gzip -9 bytes. */
function layoutChunkGzBytes(html: string): number {
  const layout = weigh(html)!.sized.filter((c) =>
    /\/chunks\/app\/layout-[0-9a-f]+\.js$/.test(c.url),
  );
  expect(layout, `${html}: exactly one root layout chunk`).toHaveLength(1);
  return layout[0]!.gzBytes;
}

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

  it.each(BUDGETS)(
    "$name stays under $kb KB raw and $gzKb KB gz",
    ({ html, kb, gzKb }) => {
      if (!built) return;
      const weight = weigh(html);
      expect(weight, `${html} is not in the build output`).not.toBeNull();
      expect(
        weight!.kb,
        `${html} references ${weight!.chunks} chunks totalling ${weight!.kb} KB against a ${kb} KB budget. Check what was added: a new dependency pulled into a client component reaches every tool page. If the growth is deliberate, raise the budget here and say what grew.`,
      ).toBeLessThanOrEqual(kb);
      expect(
        weight!.gzKb,
        `${html} transfers ${weight!.gzKb} KB gz against a ${gzKb} KB gz ceiling (measured baseline + the redesign's allowance for this page). Print pnpm weigh:pages before and after, and name what grew.`,
      ).toBeLessThanOrEqual(gzKb);
    },
  );

  it("what the redesign still has to add fits what each row has left", () => {
    if (!built) return;
    const layout = layoutChunkGzBytes("index.html");
    // Health: the layout chunk was found and weighed, and has not shrunk
    // below the base it is measured from (a reader that found nothing would
    // credit every row the whole allowance; a layout that got lighter moves
    // the base, as on 2026-10-29).
    expect(layout).toBeGreaterThanOrEqual(LAYOUT.baseBytes);
    const layoutLeft = LAYOUT.allowanceKb - (layout - LAYOUT.baseBytes) / 1024;
    expect(
      layoutLeft,
      "the root layout grew past the redesign's whole allowance for it",
    ).toBeGreaterThanOrEqual(0);
    const rows = BUDGETS.map(({ html, gzKb }) => {
      // Exact, not the weigher's one decimal: rounded, a row 0.04 short
      // read as fitting (249.52 -> 249.5), and one 0.04 over its line read
      // as short — a cliff a chunk hash could cross between machines.
      const w = weigh(html)!;
      const measured = w.sized.reduce((sum, c) => sum + c.gzBytes, 0) / 1024;
      const toCome = STILL_TO_COME[html] ?? {};
      return {
        html,
        // Every package still to come, and the layout's remainder unless
        // it cannot reach this row (`LAYOUT_CANNOT_REACH`).
        fits: shortfall({
          html,
          ceiling: gzKb,
          measured,
          layoutLeft: html in LAYOUT_CANNOT_REACH ? 0 : layoutLeft,
          toCome,
        }),
        // The same, with the layout's remainder: for the stale check.
        withLayout: shortfall({
          html,
          ceiling: gzKb,
          measured,
          layoutLeft,
          toCome,
        }),
      };
    });
    // Health: every budgeted row was weighed, the tool rows with their
    // allocations among them, and every listed row is a budgeted one.
    expect(rows).toHaveLength(BUDGETS.length);
    for (const listed of [
      ...Object.keys(STILL_TO_COME),
      ...Object.keys(LAYOUT_CANNOT_REACH),
    ])
      expect(
        BUDGETS.some((b) => b.html === listed),
        `${listed} is not a budgeted row`,
      ).toBe(true);
    const short = rows
      .filter((r) => r.fits.short > 0)
      .map(
        (r) =>
          `${r.html}: needs ${r.fits.needed.toFixed(2)}, has ${r.fits.left.toFixed(2)}`,
      );
    expect(
      short,
      "rows that cannot take what the redesign still has to add — recover the weight, or bring the owner a re-allocation of G.1 to encode here",
    ).toEqual([]);
    const stale = rows
      .filter((r) => r.html in LAYOUT_CANNOT_REACH && r.withLayout.short <= 0)
      .map((r) => r.html);
    expect(
      stale,
      "LAYOUT_CANNOT_REACH names a row the layout's remainder now fits — delete the entry, so the row is held to it",
    ).toEqual([]);
  });

  it("positive control: the shortfall sum tells a row that fits from one that does not", () => {
    // WP-07 just within its 0.8 beyond the layout (246.6 + 1.4 layout +
    // 0.75): the rest of the programme and the unallocated 0.4 still fit.
    expect(
      shortfall({
        html: "x",
        ceiling: 256.6,
        measured: 248.75,
        layoutLeft: 1.1,
        toCome: TOOL_PAGES_TO_COME_AT_WP07,
      }).short,
    ).toBeLessThanOrEqual(0);
    // …and 0.15 past it, paid from what no package was given: short.
    expect(
      shortfall({
        html: "x",
        ceiling: 256.6,
        measured: 248.95,
        layoutLeft: 1.1,
        toCome: TOOL_PAGES_TO_COME_AT_WP07,
      }).short,
    ).toBeGreaterThan(0);
    // The repair before this one: 250.5 measured, 1.3 of WP-08's share
    // and the whole unallocated 0.4 gone.
    const over = shortfall({
      html: "x",
      ceiling: 256.6,
      measured: 250.5,
      layoutLeft: 1.1,
      toCome: TOOL_PAGES_TO_COME_AT_WP07,
    });
    expect(over.needed).toBeCloseTo(7.8, 5);
    expect(over.left).toBeCloseTo(6.1, 5);
    expect(over.short).toBeCloseTo(1.7, 5);
  });

  it(`every tool page stays under ${EVERY_TOOL_PAGE.kb} KB raw and ${EVERY_TOOL_PAGE.gzKb} KB gz`, () => {
    if (!built) return;
    // DERIVED: every catalogue slug's prerendered page, not a typed sample.
    const pages = tools.map((t) => `tools/${t.slug}.html`);
    const prerendered = new Set(prerenderedPages(NEXT_DIR));
    expect(
      pages.filter((html) => !prerendered.has(html)),
      "catalogue tools with no prerendered page",
    ).toEqual([]);
    // 50 on 2026-10-09; a floor so an emptied catalogue cannot pass.
    expect(pages.length).toBeGreaterThanOrEqual(40);
    const over = pages
      .map((html) => ({ html, w: weigh(html)! }))
      .filter(
        ({ w }) => w.kb > EVERY_TOOL_PAGE.kb || w.gzKb > EVERY_TOOL_PAGE.gzKb,
      )
      .map(({ html, w }) => `${html}: ${w.kb} KB raw / ${w.gzKb} KB gz`);
    expect(
      over,
      "tool pages over the every-tool-page ceiling — a runner or panel grew, or a static import pulled another tool's code in. Name what grew.",
    ).toEqual([]);
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
    // ONE exception, found by content, never by name: the home desk's own
    // chunk (WP-05). It is the home page's route code, split out on purpose
    // — the build files `next/link`'s client chunks under the home page's
    // chunk group, so /workspace and the 404 load whatever the home route
    // chunk holds (see hero-desk-island.tsx) — and it carries
    // DESK_ISLAND_MARKER, so nothing else can pass for it.
    const isDeskIsland = (url: string) =>
      readFileSync(
        path.join(NEXT_DIR, url.replace("/_next/", "")),
        "utf8",
      ).includes(DESK_ISLAND_MARKER);
    // …and the chunks the island's own `next/dynamic` load brings with it,
    // read from the build's loadable manifest: the entry whose files include
    // the island's chunk. WP-07 (2026-10-10): the ticket DIALOG reuses the
    // desk's sheet, ticket frame and ticket state, and webpack moved what the
    // two share into one chunk the island now loads beside its own — the
    // same code as before, in two files. Derived, so a chunk the island did
    // not bring is still caught.
    const loadable = JSON.parse(
      readFileSync(path.join(NEXT_DIR, "react-loadable-manifest.json"), "utf8"),
    ) as Record<string, { files: string[] }>;
    const islandLoads = Object.values(loadable).filter((entry) =>
      entry.files.some((f) => isDeskIsland(`/_next/${f}`)),
    );
    expect(islandLoads, "the desk island's loadable entry").toHaveLength(1);
    const withIsland = new Set(islandLoads[0]!.files.map((f) => `/_next/${f}`));
    const extras = chunkList("index.html")
      .filter(nonRoute)
      .filter((c) => !toolChunks.has(c));
    expect(
      extras.filter((c) => !withIsland.has(c)),
      `the homepage references shared chunks no tool page carries — landing-page-only machinery appeared:\n  ${extras.join("\n  ")}`,
    ).toEqual([]);
    // The exception is live, and exactly one chunk carries the island itself:
    // a stale exemption (the desk folded back into the route chunk) fails here.
    expect(extras.filter(isDeskIsland)).toHaveLength(1);
  });

  // A size budget cannot see WHAT rides along, only how much. On 2026-10-08
  // the 404's "Did you mean …?" (MissingPathSuggestion, a client component in
  // the ROOT not-found boundary) imported the catalogue search, and the root
  // not-found ships with every route: the whole catalogue (~32 KB raw) landed
  // in the homepage's and every guide's first load. Both stayed under their
  // 700 KB budgets, so nothing failed. This reads the CONTENT of the first-load
  // chunks instead: no tool's tagline may be in them on a page that does not
  // need it. Markers are derived from the catalogue — every tagline the
  // explorer's own first load carries verbatim (a template-literal tagline
  // such as PDF/A's is stored in pieces, so it cannot be a marker) — and the
  // explorer, which needs the catalogue, is the positive control.
  //
  // TOOL PAGES ARE CHECKED TOO since 2026-10-29. Until then every tool page
  // was exempt and rotate-pdf was the control, because the hand-off notice,
  // the ticket rail and the remedy builder read other tools' names and
  // formats from `@/lib/tools`. They read `@/lib/tools/directory` now (five
  // fields, generated from the catalogue), and the catalogue left every tool
  // page's first load: rotate-pdf 50 -> 0 taglines. The exemption would have
  // let it walk back unseen.
  it("ships the tool catalogue only on pages that need it", () => {
    if (!built) return;
    // Each page's first load is read ONCE, and each chunk file once across
    // all pages (most are shared). Until 2026-10-09 `carrying()` called
    // firstLoad() inside the marker filter — ~50 markers x ~89 pages, every
    // chunk re-read per marker, twice over for the stale check — and the test
    // ran 8.7-17.5 s against vitest's 5 s timeout. Same set, same reads, done
    // once.
    const chunkText = new Map<string, string>();
    const readChunk = (file: string) => {
      let text = chunkText.get(file);
      if (text === undefined) {
        text = readFileSync(file, "utf8");
        chunkText.set(file, text);
      }
      return text;
    };
    const pageText = new Map<string, string>();
    const firstLoad = (html: string) => {
      let text = pageText.get(html);
      if (text === undefined) {
        text = chunkFiles(NEXT_DIR, html).map(readChunk).join("\n");
        pageText.set(html, text);
      }
      return text;
    };
    const control = firstLoad("tools.html");
    const markers = tools
      .map((t) => t.tagline)
      .filter((tagline) => control.includes(tagline));
    // Positive control and health check in one: the explorer carries nearly
    // every tagline. Fewer means the reader went blind (wrong chunk set, a
    // catalogue that moved behind a boundary) and an empty list would pass.
    expect(
      markers.length,
      `positive control: the explorer's first load carries only ${markers.length} of ${tools.length} taglines`,
    ).toBeGreaterThanOrEqual(tools.length - 5);
    // The pages checked are DERIVED: every page the build prerendered. A typed
    // list (it was index.html and one guide) cannot see the next route that
    // starts carrying the catalogue. The pages that legitimately need it at
    // load are named, each with its reason, and an entry that stops carrying it
    // fails, so the list can only shrink toward the truth.
    const NEEDS_CATALOGUE: Record<string, string> = {
      "tools.html": "the /tools explorer filters the catalogue in the client",
      "workspace.html": "the workspace offers every tool for its files",
      // WAS "status.html" ("the status page lists every tool's live state").
      // It lists them from the SERVER render; the catalogue rode to the client
      // only on the alert-posture → observability-barrel chain that also
      // carried pdf-lib, and left with it (2026-10-23, alert-vocabulary.ts).
    };
    const pages = prerenderedPages(NEXT_DIR);
    // Health check, both ways: the walk sees the whole site (89 pages counted
    // on 2026-10-09: 50 tools, 22 guides, 8 categories and 9 others, one of
    // them _global-error), and has not swallowed a second build. The ceiling
    // is a plausibility bound, not a measurement.
    expect(pages.length).toBeGreaterThanOrEqual(60);
    expect(pages.length).toBeLessThanOrEqual(200);
    const carrying = (html: string) => {
      const text = firstLoad(html);
      return markers.filter((m) => text.includes(m)).length;
    };
    const leaks = pages
      .filter((html) => !(html in NEEDS_CATALOGUE))
      .map((html) => ({ html, taglines: carrying(html) }))
      .filter((row) => row.taglines > 0);
    expect(
      leaks,
      `pages that do not need the tool catalogue load it up front — a client component they render imports @/lib/tools (a tool page's runner reads other tools from @/lib/tools/directory)`,
    ).toEqual([]);
    const stale = Object.keys(NEEDS_CATALOGUE).filter(
      (html) => !pages.includes(html) || carrying(html) === 0,
    );
    expect(
      stale,
      "NEEDS_CATALOGUE names a page that no longer carries the catalogue — remove it",
    ).toEqual([]);
  });

  it("the weigher counts every chunk a page names — the flight payload included", () => {
    if (!built) return;
    // The weigher reads `/_next/static/chunks/…js` out of the HTML: the
    // <script> tags and the <link rel="preload">s a `next/dynamic` loader
    // emits. React's flight payload names each client reference's chunks too
    // — JSON-escaped, as `static/chunks/…js`, WITHOUT the `/_next/` — and the
    // browser fetches those as well, so a chunk named ONLY there would load
    // and weigh nothing. Checked over both builds on 2026-10-09 (main, and
    // the split): none was. This holds that over every page, rather than a
    // comment asserting it.
    const anyForm = /static\/chunks\/[^"'\\]+?\.js/g;
    const flightBlock = /self\.__next_f\.push\(\[[\s\S]*?\]\)/g;
    const blind: string[] = [];
    let flightNamed = 0;
    for (const html of prerenderedPages(NEXT_DIR)) {
      const text = readFileSync(path.join(APP_DIR, html), "utf8");
      const counted = new Set(
        chunkList(html).map((u) =>
          decodeURIComponent(u.replace("/_next/", "")),
        ),
      );
      for (const ref of text.match(anyForm) ?? []) {
        if (!counted.has(decodeURIComponent(ref)))
          blind.push(`${html}: ${ref}`);
      }
      for (const block of text.match(flightBlock) ?? [])
        flightNamed += (block.match(anyForm) ?? []).length;
    }
    // Positive control: the flight payload's own spelling IS being read, or
    // the empty list below would mean nothing.
    expect(
      flightNamed,
      "chunk names found inside flight payloads",
    ).toBeGreaterThan(100);
    expect(
      [...new Set(blind)],
      "chunks a page names that the weigher does not count",
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
    const rows = JSON.parse(out) as {
      html: string;
      kb: number;
      gzKb: number;
    }[];
    // A relationship, not a count: every page this suite budgets is a row the
    // table prints, so a budget change is argued from a figure the script
    // showed. (A count, "at least as many rows as budgets", was satisfied by a
    // table that printed seven tool pages and no guide.)
    const printed = rows.map((r) => r.html);
    for (const budget of BUDGETS) {
      expect(printed, `weigh:pages does not print ${budget.html}`).toContain(
        budget.html,
      );
    }
    for (const row of rows) {
      const w = weigh(row.html)!;
      expect(row.kb, row.html).toBe(w.kb);
      expect(row.gzKb, row.html).toBe(w.gzKb);
    }
  });
});
