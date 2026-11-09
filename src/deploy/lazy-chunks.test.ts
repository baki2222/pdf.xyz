// @vitest-environment node
/**
 * The heavy libraries stay behind their dynamic boundaries — read from what
 * each page actually loads, not from how the code is written.
 *
 * A size budget cannot say WHAT rides along, only how much, and the margin on
 * a tool page is ~40 KB raw while pdf-lib alone is ~436 KB: a static import
 * would trip the budget, but the budget would then say "something got heavier"
 * and never "pdf-lib is back". On a page with a looser budget (the status page
 * is in none) the library can ride along with nothing saying so at all, and
 * one does today. So this file reads the CONTENT of every page's first-load
 * chunks for a string only that library's own code carries.
 *
 * THE PAGE SET IS DERIVED: every page the build prerendered
 * (`prerenderedPages()`), minus a per-library allowlist where each entry says
 * why that page may load the library up front. An entry whose page stopped
 * loading it fails, so an allowlist can only shrink toward the truth — the
 * same idiom as the catalogue test in bundle-budget, which this file does NOT
 * duplicate (the catalogue's markers are derived from the catalogue itself
 * there, and that check stays where it is).
 *
 * Runs under `pnpm test:bundle` (it needs `.next`), never `pnpm test`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { DESK_ISLAND_MARKER } from "@/components/intent/desk-island-chunk";
import { TICKET_CHUNK_MARKER } from "@/components/intent/ticket-chunk";
import { TICKET_DIALOG_CHUNK_MARKER } from "@/components/intent/ticket-dialog-chunk";
import { PALETTE_CHUNK_MARKER } from "@/components/intent/palette-chunk";
import { REPLACE_BOXES_CHUNK } from "@/components/tools/replace-boxes";
import { BATCH_VIEW_LOADED } from "@/components/tools/runner/batch/batch-view";
import { RESULT_ENDING_CHUNK } from "@/components/intent/result-ending-chunk";
import { DROP_ENGINE_MARK } from "@/lib/intent/drop-engine";
import { tools } from "@/lib/tools";
import { SEARCH_ENGINE_CHUNK } from "@/lib/tools/search-tools";
import { STOPPED_WAITING } from "@/lib/workers/job-polling";
import { NO_UPLOAD_SLOT } from "@/lib/workers/slot-upload";
import { UTIF_PAKO_UNUSED } from "@/lib/pdf/utif-pako-unused";
import { toolRunInfoFor } from "@/lib/tools/tool-run-info";
import {
  carriesTable,
  flightText,
  RUN_ROW_MAX_BYTES,
  runRowsIn,
  SLUG_LITERALS_MAX,
  slugLiteralsIn,
  toolTables,
} from "@/tests/tool-tables-markers";
import { chunkFiles, prerenderedPages } from "../../scripts/page-weight";

const ROOT = process.cwd();
const NEXT_DIR = path.join(ROOT, ".next");
const CHUNKS_DIR = path.join(NEXT_DIR, "static", "chunks");

interface LazyLibrary {
  what: string;
  /**
   * A string the library's own code carries and ours does not (checked below):
   * an error message or identity string minification cannot rename.
   */
  marker: string;
  /** Why it must not load with the page. */
  why: string;
  /** Pages that may load it up front, each with its reason. Derived pages minus these are checked. */
  allowedAtLoad: Record<string, string>;
}

const LAZY: LazyLibrary[] = [
  {
    what: "pdf-lib",
    // pdf-lib's default Producer/Creator metadata string.
    marker: "pdf-lib (https://github.com/Hopding/pdf-lib)",
    why: "every op takes it through loadPdfLib() at call time, and the Dropzone warms it when files arrive (2026-08-09: -411 KB on every tool page)",
    // WAS `"status.html"`, a KNOWN DEFECT entry (184 KB gz on production,
    // 2026-10-23). The chain: alert-posture.tsx → the observability barrel →
    // snapshot.ts → compression/engine → pdf-lib, for two string arrays.
    // Fixed by moving them to `observability/alert-vocabulary.ts`, which
    // imports nothing; this entry then failed as stale, as designed.
    allowedAtLoad: {},
  },
  {
    what: "pdfjs",
    // pdf.js's own error when its worker cannot start.
    marker: "Setting up fake worker failed",
    why: "rendering and text extraction import pdfjs-dist on first use; it is the largest library the site ships",
    allowedAtLoad: {},
  },
];

function walkJs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkJs(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });
}

function ourSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Test fixtures quote pdf-lib output verbatim and never ship.
        if (entry.name !== "tests") walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test."))
        out.push(full);
    }
  };
  walk(path.join(ROOT, "src"));
  return out;
}

const textCache = new Map<string, string>();
function read(file: string): string {
  let text = textCache.get(file);
  if (text === undefined) {
    text = readFileSync(file, "utf8");
    textCache.set(file, text);
  }
  return text;
}

/** Does the page load a chunk carrying the marker, up front? */
function carriesAtLoad(html: string, marker: string): boolean {
  return chunkFiles(NEXT_DIR, html).some((file) => read(file).includes(marker));
}

describe("heavy libraries are not first-load on any page", () => {
  const built = existsSync(path.join(NEXT_DIR, "server", "app"));

  it("has a build to measure", () => {
    // Skipping when `.next` is absent would read green in exactly the case
    // where nothing was checked.
    expect(built, "no .next — run `pnpm build` first (CI does)").toBe(true);
  });

  it("health check: a real table over a real build", () => {
    if (!built) return;
    // The table grows as the redesign adds lazy chunks of its own (the ticket,
    // the palette); two is pdf-lib and pdfjs.
    expect(LAZY.length).toBeGreaterThanOrEqual(2);
    expect(walkJs(CHUNKS_DIR).length).toBeGreaterThanOrEqual(1);
    const pages = prerenderedPages(NEXT_DIR);
    expect(pages.length).toBeGreaterThanOrEqual(60);
    expect(pages.length).toBeLessThanOrEqual(200);
  });

  it.each(LAZY)(
    "positive control: the build ships $what, and the marker is the library's own",
    ({ marker }) => {
      if (!built) return;
      // Present somewhere in the build. Without this, a library upgrade that
      // reworded the marker would turn every absence below into a vacuous pass.
      const carrying = walkJs(CHUNKS_DIR).filter((f) =>
        read(f).includes(marker),
      );
      expect(carrying.length).toBeGreaterThanOrEqual(1);
      // …in a library-sized chunk (pdf-lib ~436 KB, pdfjs ~420 KB raw), so a
      // stub of ours that happened to quote it cannot stand in for the library.
      expect(
        Math.max(...carrying.map((f) => statSync(f).size)),
      ).toBeGreaterThan(100 * 1024);
      // …and never in our source, where it would make a page "carry the
      // library" without loading it, or keep the control above green after
      // the library chunk lost the string.
      const quoting = ourSources().filter((f) => read(f).includes(marker));
      expect(quoting.map((f) => path.relative(ROOT, f))).toEqual([]);
    },
  );

  it.each(LAZY)(
    "no page loads $what up front, except the reasoned allowlist",
    ({ what, marker, why, allowedAtLoad }) => {
      if (!built) return;
      const pages = prerenderedPages(NEXT_DIR);
      const leaks = pages
        .filter((html) => !(html in allowedAtLoad))
        .filter((html) => carriesAtLoad(html, marker));
      expect(
        leaks,
        `these pages load ${what} with the page (${why}). A component they render imports it statically, or imports a module that does.`,
      ).toEqual([]);
      const stale = Object.keys(allowedAtLoad).filter(
        (html) => !pages.includes(html) || !carriesAtLoad(html, marker),
      );
      expect(
        stale,
        `the allowlist names a page that no longer loads ${what} up front — delete the entry`,
      ).toEqual([]);
    },
  );
});

/**
 * Our own on-demand modules stay on demand.
 *
 * A library is found by a string its own code carries; our modules carry no
 * such string, so each exports one and renders it (`data-chunk`), which keeps
 * it through minification. The marker is therefore IN our source, once, by
 * design — the opposite of the library rule above, so these are a table of
 * their own.
 *
 * The search engine is the first entry (2026-10-09): the ranking, the synonym
 * groups, the task aliases and the unsupported-format answers. Statically
 * imported by the `/tools` explorer it cost that page 6.9 KB gz up front, 1.9
 * over the page's ceiling; fetched on demand it costs nothing until someone
 * searches.
 */
const OUR_LAZY: LazyLibrary[] = [
  {
    what: "the catalogue search engine",
    marker: SEARCH_ENGINE_CHUNK,
    why: "the /tools explorer fetches it for a query, or as the search field is approached; the 404 fetches it for its Did you mean",
    allowedAtLoad: {},
  },
  // WP-05 (2026-10-10): the job ticket — its view, the ranking, the facts
  // measuring, the hand-off launch. The home desk fetches it as a file
  // approaches (a drag entering, the pointer or focus reaching the desk) or
  // arrives, and for the names of recent tools; no page loads it up front.
  {
    what: "the job ticket",
    marker: TICKET_CHUNK_MARKER,
    why: "the home desk fetches it when a file approaches or arrives; a visitor who never brings one never downloads it",
    allowedAtLoad: {},
  },
  // WP-07 (2026-10-10): the ticket dialog — what a page does with files that
  // are not its own (no target, a target at work, a target that opens none
  // of them). The drop layer that opens it is in EVERY page's first load,
  // so a static import there would put the dialog, and through it the
  // ticket and the catalogue, on every page; it fetches it on a drag no
  // target will take, or when such files land. No page may load it up front.
  {
    what: "the ticket dialog",
    marker: TICKET_DIALOG_CHUNK_MARKER,
    why: "the drop layer fetches it only for files the page's own target does not take",
    allowedAtLoad: {},
  },
  // WP-07 re-review (2026-10-10): what makes a drop box take a file — its
  // drag states, its claim on a release, its registration — is the drop
  // engine, in the registry's chunk. Every tool page's zone, the home desk
  // and the workspace's panel render a box, and as first merged each
  // carried its engine: 2.4 KB gz on every tool page against WP-07's 0.8.
  // The box asks for it as it mounts; the layer, on idle.
  {
    what: "the drop engine",
    marker: DROP_ENGINE_MARK,
    why: "a drop box fetches its engine with the registry as it mounts, and the drop layer on idle",
    allowedAtLoad: {},
  },
  // WP-07 re-review (2026-10-10): the "replace" targets — an open editor's,
  // a chosen file's — exist only once a file has arrived, and load with it.
  {
    what: "the replace targets",
    marker: REPLACE_BOXES_CHUNK,
    why: "the open editor and a worker panel's chosen file fetch them as they first appear, with the file",
    allowedAtLoad: {},
  },
  // WP-08 (2026-10-10): the end of a run — the receipt that re-opens and
  // counts the output, and "Continue with", which carries it on (the
  // hand-off launch and the page count come with them). Everything in the
  // runner kit is in every tool page's first load; these are fetched as a
  // run starts (Compress PDF's as its file arrives) and drawn when it ends,
  // so no page may load them up front.
  {
    what: "the result's ending",
    marker: RESULT_ENDING_CHUNK,
    why: "the runner kit fetches it when a run starts, Compress PDF when its file arrives; a visit that never brings a file never downloads it",
    allowedAtLoad: {},
  },
  // WP-09 (2026-10-21): the command palette — its index (every tool, task,
  // guide, page and action), the ranked search over it, and the dialog. The
  // header's trigger is in every page's first load; it fetches the palette
  // on hover, focus, Ctrl or Meta going down, or the shortcut itself.
  {
    what: "the command palette",
    marker: PALETTE_CHUNK_MARKER,
    why: "the header's trigger fetches it on approach (hover, focus, Ctrl/Meta) or when it is opened; a visitor who never opens it never downloads it",
    allowedAtLoad: {},
  },
  // 2026-10-30 (perf/lazy-slot-upload): a worker job's run — the shared
  // upload with its retry and telemetry (#223), the poll, the error reader.
  // #223 put them in one chunk every worker tool page and the status page
  // loaded up front (8146-*.js, 2.5 KB gz with the stage helpers); a
  // panel's chosen file, or Compress PDF's deep run becoming possible,
  // fetches it now (`@/lib/workers/job-run-lazy`), and a run awaits that
  // same fetch. Each module is found by a sentence of its own that its code
  // returns, not by a marker of the gathering module: a static import of
  // `./slot-upload` or `./job-polling` directly — the shape #223 shipped —
  // would carry neither a `job-run` export nor this table's attention.
  {
    what: "the shared slot upload",
    marker: NO_UPLOAD_SLOT,
    why: "a worker panel fetches it when its file is chosen, Compress PDF when its deep run becomes possible, and every worker client awaits it as its run starts; a visit that never brings a file never downloads it",
    allowedAtLoad: {},
  },
  {
    what: "the worker job's poll",
    marker: STOPPED_WAITING,
    why: "it arrives with the upload, on the same fetch, and runs only once a job exists",
    allowedAtLoad: {},
  },
  // Batch plan P0b (2026-11-08): the batch view — its rows, controls, live
  // region, ZIP button and the batch limits. Compress PDF imported its batch
  // statically, so every visit to Compress loaded it (the batch's progress
  // label was in its first load, measured on the build before this entry);
  // the runner now reaches it through `next/dynamic` once a second file
  // arrives, and no page may load it up front.
  {
    what: "the batch view",
    marker: BATCH_VIEW_LOADED,
    why: "a runner fetches it when two or more files arrive; a visit with one file, or none, never downloads it",
    allowedAtLoad: {},
  },
  // Sign PDF's handwriting faces (audit sign-pdf#1, 2026-11-09). As first
  // written, the editor's object model (`editor/model.ts`, first-load on
  // Sign, Edit, Annotate and Create Forms) built typed signatures itself, so
  // the name normalisation, the style predicates and each face's ink reach
  // rode in those pages' first load (+480 B gzip on Sign PDF), and the Sign
  // runner imported the `signPdf` engine whose `import()` of the face table
  // was one more async chunk in every page's webpack runtime. Typed
  // signatures are built in `editor/typed-signature.ts`, which only the
  // lazily loaded editor imports; the face table rides in the export's
  // chunk. Each module is found by a string of its own code.
  {
    what: "the handwriting face table and coverage",
    marker: "DancingScript_400Regular.ttf",
    why: "the editor and its export read it once a file is open; the signature panel, a placed typed signature and the export are its only readers",
    allowedAtLoad: {},
  },
  {
    what: "the handwriting faces on screen",
    marker: "pdfxyz-hand-",
    why: "the signature panel's previews and a placed typed signature register the faces, both inside the editor, which loads once a file is open",
    allowedAtLoad: {},
  },
  {
    what: "the typed signature's name normalisation",
    marker: 'normalize("NFC").replace(/\\p{Zs}/gu,',
    why: "it runs when a typed signature is built, in the signature panel or the editor, never before a file is open",
    allowedAtLoad: {},
  },
  // WP-05 review (2026-10-10): the home desk's own island. It IS first-load
  // on the home page, which renders it; the reason it sits behind a
  // `next/dynamic` boundary (`hero-desk-island.tsx`) is that every other
  // page renders a Link from the server, and without the boundary they all
  // loaded the home page's chunk. So: exactly one page may load it, and the
  // stale-entry check below is the positive control that it still does.
  {
    what: "the home desk",
    marker: DESK_ISLAND_MARKER,
    why: "only the home page renders the desk; the island boundary keeps it out of the chunk every page that renders a Link loads",
    allowedAtLoad: {
      "index.html": "the home page renders the desk",
    },
  },
];

describe("our on-demand modules are not first-load on any page", () => {
  const built = existsSync(path.join(NEXT_DIR, "server", "app"));

  it("health check: a real table", () => {
    expect(OUR_LAZY.length).toBeGreaterThanOrEqual(1);
    for (const entry of OUR_LAZY) {
      expect(entry.marker.length, entry.what).toBeGreaterThanOrEqual(12);
    }
  });

  it.each(OUR_LAZY)(
    "positive control: the build ships $what, and exactly one module defines its marker",
    ({ marker }) => {
      if (!built) return;
      expect(
        walkJs(CHUNKS_DIR).filter((f) => read(f).includes(marker)).length,
      ).toBeGreaterThanOrEqual(1);
      const defining = ourSources().filter((f) => read(f).includes(marker));
      expect(defining).toHaveLength(1);
    },
  );

  it.each(OUR_LAZY)(
    "no page loads $what up front, except the reasoned allowlist",
    ({ what, marker, why, allowedAtLoad }) => {
      if (!built) return;
      const pages = prerenderedPages(NEXT_DIR);
      const leaks = pages
        .filter((html) => !(html in allowedAtLoad))
        .filter((html) => carriesAtLoad(html, marker));
      expect(
        leaks,
        `these pages load ${what} with the page (${why}). A component they render imports it statically, or imports a module that does.`,
      ).toEqual([]);
      const stale = Object.keys(allowedAtLoad).filter(
        (html) => !pages.includes(html) || !carriesAtLoad(html, marker),
      );
      expect(stale).toEqual([]);
    },
  );
});

/**
 * One catalogue, however many on-demand surfaces read it (addendum WP-05 #13,
 * "a check, not a sentence"). The /tools explorer loads the catalogue with
 * the page; the ticket fetches it on demand; a second copy inside the
 * ticket's chunk would cost every desk visitor the catalogue twice over and
 * no budget would say so, because no page loads the ticket up front. So the
 * chunks are found by CONTENT — the tools' own taglines — and exactly one
 * may carry them. (The palette joins this rule when it exists, WP-09.)
 */
describe("the catalogue ships in one chunk, shared by every surface that reads it", () => {
  const built = existsSync(path.join(NEXT_DIR, "server", "app"));

  it("exactly one chunk carries the catalogue, and /tools loads it up front", () => {
    if (!built) return;
    const taglines = tools.map((t) => t.tagline);
    // Health: the markers are real and plenty.
    expect(taglines.length).toBeGreaterThanOrEqual(40);
    const carrying = walkJs(CHUNKS_DIR).filter((f) => {
      const text = read(f);
      return (
        taglines.filter((tagline) => text.includes(tagline)).length >=
        taglines.length - 5
      );
    });
    expect(carrying.map((f) => path.relative(NEXT_DIR, f))).toHaveLength(1);
    // Positive control: the explorer's first load is that chunk.
    expect(
      chunkFiles(NEXT_DIR, "tools.html").map((f) => path.resolve(f)),
    ).toContain(path.resolve(carrying[0]!));
  });

  it("the ticket's chunk does not carry its own copy", () => {
    if (!built) return;
    const ticket = walkJs(CHUNKS_DIR).filter((f) =>
      read(f).includes(TICKET_CHUNK_MARKER),
    );
    expect(ticket.length).toBe(1);
    const taglines = tools.map((t) => t.tagline);
    const text = read(ticket[0]!);
    expect(taglines.filter((tagline) => text.includes(tagline))).toEqual([]);
  });

  it("the palette's chunk does not carry its own copy", () => {
    if (!built) return;
    const palette = walkJs(CHUNKS_DIR).filter((f) =>
      read(f).includes(PALETTE_CHUNK_MARKER),
    );
    expect(palette.length).toBe(1);
    const taglines = tools.map((t) => t.tagline);
    const text = read(palette[0]!);
    expect(taglines.filter((tagline) => text.includes(tagline))).toEqual([]);
  });
});

/**
 * No tool page loads a table of every tool (2026-11-09,
 * perf/per-tool-first-load).
 *
 * THE DEFECT, measured on main 89486c09: every one of the 56 tool pages
 * loaded the tool directory (every tool's name, mode, formats and outputs;
 * ~1 KB gz, and in FIVE chunks), the runner registry, the runner kind →
 * hand-off mode table and the worker batch slugs; the 21 worker pages also
 * the runner kind → file ceiling table and the worker engines' tool lists.
 * Each page used ONE row of them — its own — which the server page already
 * had. Now the page computes that row on the server (`toolRunInfoFor`) and
 * hands it over as data, and the tables load only where a page looks up
 * OTHER tools (the ticket, the palette, the workspace, a guide's desk, a
 * result's next steps). A size budget could not say this: it sees "the page
 * got lighter or heavier", never "the directory is back", and an analyst's
 * rebuild showed cutting one importer only moved the directory, the
 * registry and the capability together into a new shared chunk (-7 B).
 * This reads the CONTENT of every tool page's first-load chunks, so a
 * table that moves to a new chunk is still found.
 *
 * Each table is recognised by its own rows, derived from the module that
 * defines it (`@/tests/tool-tables-markers`); the pages are every
 * `tools/<slug>.html` the build prerendered, held to the catalogue.
 */
describe("no tool page loads a table of every tool", () => {
  const built = existsSync(path.join(NEXT_DIR, "server", "app"));
  const TABLES = toolTables();
  const toolPages = () =>
    prerenderedPages(NEXT_DIR).filter((html) =>
      /^tools\/[^/]+\.html$/.test(html),
    );

  it("health check: every tool's page is walked, and every table has its rows", () => {
    expect(TABLES.length).toBe(6);
    for (const table of TABLES) {
      // A table whose rows came back empty would be "absent" everywhere.
      expect(table.rowsIn("").of, table.what).toBeGreaterThanOrEqual(3);
      expect(carriesTable(table, ""), table.what).toBe(false);
    }
    if (!built) return;
    const pages = toolPages();
    expect(pages).toEqual(tools.map((t) => `tools/${t.slug}.html`).sort());
    expect(pages.length).toBeGreaterThanOrEqual(50);
    expect(pages.length).toBeLessThanOrEqual(120);
  });

  it.each(TABLES)(
    "positive control: the build ships $what, and the reader finds it",
    (table) => {
      if (!built) return;
      // Present somewhere — the pages that look up other tools still load
      // it. Without this, a build that wrote the rows another way would
      // turn every absence below into a vacuous pass.
      const carrying = walkJs(CHUNKS_DIR).filter((f) =>
        carriesTable(table, read(f)),
      );
      expect(
        carrying.map((f) => path.basename(f)),
        `${table.what} is in no chunk of the build: its rows are no longer written the way @/tests/tool-tables-markers reads them`,
      ).not.toEqual([]);
    },
  );

  it.each(TABLES)("no tool page loads $what up front", (table) => {
    if (!built) return;
    const leaks = toolPages().filter((html) =>
      chunkFiles(NEXT_DIR, html).some((f) => carriesTable(table, read(f))),
    );
    expect(
      leaks,
      `these tool pages load ${table.what} with the page. A first-load module reads another tool by slug — give the page its own row from the server (toolRunInfoFor, @/lib/tools/tool-run-info) or fetch the table where the cross-tool lookup runs.`,
    ).toEqual([]);
  });

  /*
   * The six tests above name six shapes. This one is the property in the
   * title, shape-blind (`SLUG_LITERALS_MAX`, @/tests/tool-tables-markers):
   * no first-load chunk of a tool page quotes more than a handful of the
   * catalogue's slugs. Main 89486c09 fails it on all 56 pages (one chunk
   * quoted 56 of 56); a name map or slug array in any shape fails it too.
   */
  it("health check and positive control: the slug count sees a table in any shape", () => {
    const slugs = tools.map((t) => t.slug);
    expect(slugs.length).toBeGreaterThanOrEqual(50);
    // Two shapes none of the six markers recognises (CLAUDE.md rule 1).
    const nameMap = `{${tools.map((t) => `"${t.slug}":"${t.name}"`).join(",")}}`;
    const slugArray = `[${slugs.map((s) => `"${s}"`).join(",")}]`;
    for (const text of [nameMap, slugArray]) {
      expect(TABLES.some((table) => carriesTable(table, text))).toBe(false);
      expect(slugLiteralsIn(text).length).toBeGreaterThan(SLUG_LITERALS_MAX);
    }
    if (!built) return;
    // And in the build: the chunks that DO carry the directory are seen.
    const most = Math.max(
      ...walkJs(CHUNKS_DIR).map((f) => slugLiteralsIn(read(f)).length),
    );
    expect(most).toBeGreaterThanOrEqual(slugs.length - 2);
  });

  it(`no first-load chunk of a tool page quotes more than ${SLUG_LITERALS_MAX} tool slugs`, () => {
    if (!built) return;
    const over: string[] = [];
    let walked = 0;
    for (const html of toolPages()) {
      for (const f of chunkFiles(NEXT_DIR, html)) {
        walked++;
        const quoted = slugLiteralsIn(read(f));
        if (quoted.length > SLUG_LITERALS_MAX)
          over.push(`${html} ${path.basename(f)}: ${quoted.length}`);
      }
    }
    // Health: every page's chunks were read (~15-20 each).
    expect(walked).toBeGreaterThanOrEqual(toolPages().length * 8);
    expect(
      over,
      "a tool page's first load quotes most of the catalogue's slugs: a table of every tool, in a shape the six markers above do not know. Give the page its own row from the server (toolRunInfoFor) instead.",
    ).toEqual([]);
  });

  /*
   * The bytes that left the JS went somewhere: the page's own row now
   * travels in the prerendered DOCUMENT, as the props of ToolRunProvider in
   * React's flight data. No chunk budget sees that, and the first cut put a
   * 21-row converter table there (~400 B gz of HTML on every PDF-taking
   * worker page). So read the document the visitor receives: every tool
   * page carries its row, the row is the server's answer, and it stays
   * within RUN_ROW_MAX_BYTES.
   */
  it("every tool page's document carries its own run row, at most RUN_ROW_MAX_BYTES", () => {
    if (!built) return;
    const pages = toolPages();
    const problems: string[] = [];
    for (const html of pages) {
      const slug = html.slice("tools/".length, -".html".length);
      const tool = tools.find((t) => t.slug === slug)!;
      const flight = flightText(
        read(path.join(NEXT_DIR, "server", "app", html)),
      );
      const rows = runRowsIn(flight, slug);
      if (rows.length === 0) {
        problems.push(`${slug}: no run row in the document`);
        continue;
      }
      for (const row of rows) {
        if (row !== JSON.stringify(toolRunInfoFor(tool)))
          problems.push(`${slug}: the document's row is not toolRunInfoFor's`);
        if (row.length > RUN_ROW_MAX_BYTES)
          problems.push(`${slug}: ${row.length} B > ${RUN_ROW_MAX_BYTES}`);
      }
    }
    expect(pages.length).toBe(tools.length);
    expect(problems).toEqual([]);
  });
});

/**
 * What the ticket costs the visitor who brings a file: every chunk the desk
 * fetches for it, read from the desk's own chunk (the `Promise.all` of chunk
 * loads in front of the ticket's import), minus what the home page already
 * loaded. Until 2026-10-29 also minus the catalogue (see the last note).
 *
 * A REGRESSION BOUND, set just above the measurement, not the plan's number.
 * The redesign planned 16 KB gz (G.1) against a 7.4 KB catalogue and before
 * the ranking, the facts and the hand-off store existed; measured on
 * 2026-10-10 the fetch is 19.2 KB gz — the view 6.9, the ranking/evidence/
 * facts chunk it shares with the workspace 6.3, and the hand-off store and
 * its helpers 6.2, which every tool page already loads up front (so a visitor
 * who has opened a tool has them cached). A bound of 16 would fail the day it
 * was written, and a bound chosen to pass is no bound; this one fails the
 * day the ticket grows, and raising it is a decision that says what grew.
 *
 * RAISED 21 -> 22 on 2026-10-10, and the ticket did NOT grow: what moved is
 * the line between the catalogue (not counted) and the rest. On the merge of
 * main (#175, the split) into this batch the count read 21.35 KB gz against
 * 19.73 on batch B's last build. Every module the fetch carries, read off
 * both builds' chunks, catalogue included: 93,965 bytes before, 93,969 after
 * (+4, the processing glyph). But two of them, pdf-to-image's format tables
 * (src/lib/pdf/pdf-to-image.ts) and the PDF file checks (src/lib/pdf/files.ts),
 * left the catalogue's chunk for a new shared one (with the format list and
 * the glyph) once #175 gave every runner its own chunk, and so moved into
 * the count: +1.6. The whole fetch, catalogue included, went 31.8 -> 32.25
 * gz, the cost of one more chunk. 22 sits just above 21.35, as 21 sat above
 * the 19.2 it was written against.
 *
 * RAISED 22 -> 23 on 2026-10-10 by WP-07, and this time the ticket DID grow,
 * for a reason: the ticket dialog opens it on pages that load nothing of the
 * desk (/tools, a category page, a tool beside a file it cannot open). Its
 * chunk went 7,406 -> 8,613 B gz: the format table (2,310 B raw) and the
 * recents store (1,398), which a desk visitor already had from the page, now
 * ship inside it — webpack keeps in a lazy chunk whatever not every parent
 * has — and the unsaved-work question launches ask first (290). Measured
 * 22.54 over the desk's fetch. The cost lands on the home page, which loads
 * the first two with the desk and so fetches them twice; on every other page
 * they are the dialog's first copy.
 *
 * RAISED 23 -> 23.5 on 2026-10-24, by a move, not new code. The How-it-works
 * steps left the client catalogue (`tools/catalog-how.ts`), and the modules
 * only those steps imported (the raster and signature-request constants)
 * left the catalogue's chunk with them, so the ticket now fetches them as
 * chunks of their own — counted here, where the catalogue is not. Measured
 * on both builds: excluding the catalogue 22.56 -> 23.29; INCLUDING it
 * 35.12 -> 32.58, so the ticket's whole fetch fell by 2.5 KB gz.
 *
 * THE CATALOGUE IS COUNTED since 2026-10-29, and the bound is the whole
 * fetch: 23.5 excluding it -> 32.5 including it, which is TIGHTER than the
 * 32.6 the old bound allowed. Three of the four raises above were the line
 * between "the catalogue" and "the rest" moving while the visitor's download
 * did not, and it moved again: the first-load wave took the catalogue off
 * every tool page, and the modules it used to share a chunk with (the
 * page-range parser, the file-name checks, the catalogue's own accessors)
 * left that chunk for counted ones. Measured with this reader over main
 * 08beadda and the wave: excluding the catalogue 23.29 -> 25.36, INCLUDING
 * it 32.63 -> 32.02. A line a refactor moves is no bound; what a visitor
 * fetches is. (`directory.generated.ts`, the tool names the hand-off check
 * reads, is ~1 KB gz of that 32.02 and repeats what the catalogue says.)
 *
 * RAISED 32.5 -> 32.8 on 2026-10-30, for four new tools, which the ticket
 * offers like every other: their catalogue entries (the catalogue chunk,
 * gzip -9, 6,859 -> 7,276 B with the four entries already cut to the fields
 * a page reads — no seoTitle, cardSummary or next, three keywords each) and
 * their directory rows (+56 B). Measured 32.68 on the branch.
 *
 * RAISED 32.8 -> 33.0 on 2026-11-04, for OpenDocument and RTF input to the
 * three Office to PDF tools. The ticket reads a dropped file's first bytes
 * (`intent/sniff.ts`), and that recogniser now reads an OpenDocument file's
 * stored `mimetype` exactly, from the ZIP header's own lengths, instead of
 * trusting an `.odt` name; with the four formats' rows in the format tables
 * and their catalogue `accept` and copy, the eight counted chunks went
 * 33,764 -> 33,928 B (gzip -9, main 03124c1a vs the branch; +128 of it the
 * sniff/format chunk, +32 the catalogue). Measured 32.92 on the branch,
 * after dropping the five new keywords the search already finds by format
 * (`tools.test.ts`, "finds the Office to PDF tool by each format").
 *
 * RAISED 33.0 -> 33.07 on 2026-11-06, for Next 16.3.6 -> 16.4.5 (a security
 * floor: dependency-floors.test.ts), by exactly what it added and nothing
 * more. The branch changes no source; the eight counted chunks went
 * 33,716 -> 33,784 B (gzip -9, main c25058fe vs the branch, both built on
 * one machine from an empty .next), +68 B of framework output in our own
 * chunks. CI measured the branch at 33.003 against 33.0. The same rule as
 * `NEXT_16_4_5_BYTES` in bundle-budget.test.ts: the row keeps its headroom.
 *
 * RAISED 33.07 -> 33.2 on 2026-11-06, for EPUB to PDF, the 56th tool, which
 * the ticket offers like every other: its catalogue entry, the EPUB rows in
 * the format tables, and the sniff that reads an EPUB's stored `mimetype`
 * (a `.docx` renamed `.epub` is refused by its contents). The eight counted
 * chunks went 33,784 -> 33,917 B (+133, gzip -9, main 33ad8bd9 vs the
 * branch, one machine, empty .next): 33.07 + 133/1024 = 33.20.
 *
 * RAISED 33.2 -> 33.21 on 2026-11-08, for batch P1 (PR #292): five tools
 * (Rotate, Flatten, Page Numbers, Watermark, Split in Half) now take a
 * batch, so the catalogue the ticket loads lists "ZIP" among their outputs,
 * as Compress and PDF to JPG already do, and the handoff modes read "batch".
 * Measured on one machine, both builds from an empty .next: the eight
 * counted chunks went 33,982 -> 33,990 B (+8: the catalogue chunks 7599 ->
 * 7605 and 3926 -> 3928, the other six byte-identical; main 9266c59d vs the
 * branch). 33.2 + 8/1024 = 33.208. CI measured the branch at >= 33.2.
 *
 * RAISED 33.21 -> 33.215 on 2026-11-08, for batch P2: five more tools
 * (Grayscale, PDF to JPG, PDF to PNG, Extract Images, Text to PDF) list
 * "ZIP" among their outputs, and their modes read "batch". One machine,
 * both from an empty .next (main 4fd0a6f1 vs the branch): 33,990 -> 33,995
 * B (+5). 33.21 + 5/1024 = 33.2149. Why not leave it: this machine reads
 * 7 to 16 B under CI (PR #292 failed CI at >= 33.2 from 33,990 here, and
 * passed under 33.21), so 33,995 here can be 34,011 on CI, over 33.21.
 *
 * RAISED 33.215 -> 33.236 on 2026-11-08, for batch P3. No new code reaches
 * the ticket. P3 widened next.config.mjs's BATCH_IMPORT to `./runner/batch/`
 * so the worker batch loader's shared code stays in the one batch chunk, and
 * webpack re-split the ticket's modules. One machine, both from an empty
 * .next (main 3d118978 vs the branch): 33,995 -> 34,016 B (+21).
 *   - +16: the same modules (raw 20,308 -> 20,304 B) cut differently between
 *     two chunks (906 + 7855 -> 8933 + 6873); gzip does not compress across
 *     the cut.
 *   - +5: one more chunk id in a loader list (3472, the existing
 *     "went on to" history module, now merged with 1091/6329).
 * 33.215 + 21/1024 = 33.2355. CI's 7-16 B bracket keeps 34,016 here under
 * 34,033 B there.
 *
 * RAISED 33.236 -> 33.298 on 2026-11-09, for batch P6: a hand-off to a
 * worker batch carries every file (`handoff/capability.ts`), so the module
 * the ticket loads to decide what a launch carries now holds the thirteen
 * worker batch slugs. Typed there, not read from `WORKER_BATCH_TOOLS`,
 * because that registration and the batch limits behind it would ride
 * every tool page's first load (the capability module does); the type
 * import is erased. One machine, both from an empty .next (c92c74f8 vs the
 * branch): 34,016 -> 34,079 B (+63). The slug list alone measures +51 B
 * gzip -9 in the ticket's chunk that holds it (6873), the rest the new
 * branch in `stagedMode` and the chunks it re-cut. 33.236 + 63/1024 = 33.2975;
 * CI's 7-16 B bracket keeps 34,079 here under 34,097 B there.
 *
 * RAISED 33.298 -> 33.359 on 2026-11-09, for the P6 review's fix: a hand-off
 * to a worker batch carries the longest prefix that fits one hand-off
 * (`handoffPayload` in `handoff/index.ts`, which the ticket loads to decide
 * what a launch carries), so a set past 300 MB no longer fails where staging
 * carried its first file. The byte loop and its runner check are new code
 * in that chunk (6873). One machine, each from an empty .next: 34,079 B
 * (P6's figure above) -> 34,141 B on the branch with the fix (+62). 33.298 + 62/1024 =
 * 33.3585; CI's 7-16 B bracket keeps 34,141 here under 34,159 B there.
 *
 * RAISED 33.359 -> 33.366 on 2026-11-09, because the line above was false.
 * The "7-16 B bracket" was a guess made from two PRs, and CI went past it on
 * the first run that tested it. PR #302's merged head 62f1eb69 (P6 + main at
 * #301) measured 34,141 B on this machine (Windows, from an empty .next) and
 * 34,166 B on CI (Linux): a 25 B gap on the same tree. CI failed at
 * 33.365234375 against 33.359. No new code goes into the ticket here: the
 * bound now covers CI's own reading of this tree, 34,166 B, with 1 B to spare
 * (33.366 KB is 34,167.8 B). The gap between machines is not a constant, so
 * the next raise must be measured on CI, not on this machine plus a margin.
 *
 * RAISED 33.366 -> 33.6 on 2026-11-09, for perf/per-tool-first-load, which
 * took the tool directory, the runner registry, the hand-off mode tables
 * and the worker batch slugs off every tool page's first load (~1.9 KB gz
 * on each client tool page, ~3.5 KB on each worker page; "no tool page
 * loads a table of every tool", above). The ticket still loads all of them
 * — it looks up OTHER tools — and now also carries what replaced the
 * lookups on the receiving page: the launch writes each tool's display name
 * into the hand-off record (`toolNames`, record version 2) and into the
 * departure, the claim fetches the directory for a version-1 record, and
 * the shared helpers were split into modules of their own so the tool pages
 * could leave the tables behind (`capability-core`, `session`,
 * `input-kind`, `ceiling-message`), which webpack re-cut into different
 * chunks (6873/8933/955/7638/7673 -> 7384/8268/2422/6011/5878). One
 * machine (Windows), both from an empty .next, main 89486c09 vs the branch:
 * the eight counted chunks went 34,141 -> 34,371 B gzip -9 (+230; raw
 * 97,932 -> 98,910). NOT measured on CI: the one CI reading of a tree this
 * machine also read was 25 B higher, so 33.6 KB (34,406 B) leaves 35 B over
 * this machine's figure — if CI reads more than that, measure CI's figure
 * and set the bound from it, as the note above says.
 *
 * RAISED 33.6 -> 33.77 on 2026-11-09, for PDF Booklet Maker, the 57th tool:
 * the ticket looks up OTHER tools, so it carries the new tool's directory
 * row, its runner-registry row and its name. One machine (Windows), both
 * from an empty .next, main cec860f0 (a detached worktree) vs the branch:
 * the eight counted chunks went 34,371 -> 34,541 B gzip -9 (+170; the
 * changed chunks are 7384 and 5320, which hold the directory and the
 * registry). NOT measured on CI: 33.77 KB (34,580 B) keeps the same 35 B
 * over this machine's figure as the raise above, for CI's ~25 B gap.
 *
 * RAISED 33.77 -> 33.84 on 2026-11-10, for PDF Viewer, the 58th tool and
 * the first new runner kind ('view') since the per-tool first load: the
 * ticket carries its directory row, its registry row and its name, as for
 * Booklet above. One machine (Windows), both from an empty .next, main
 * ad23525e (a detached worktree, E:/wviewer-base) vs the branch: the eight
 * counted chunks went 34,544 -> 34,614 B gzip -9 (+70; 7384 +28, 5320 -30,
 * and the editor's page-layout and zoom steps moving to a shared module
 * re-cut 6011/5878 into 6011/7047). NOT measured on CI: 33.84 KB (34,652 B)
 * keeps 38 B over this machine's figure, for CI's ~25 B gap.
 */
const TICKET_FETCH_GZ_KB = 33.84;

describe("the ticket's on-demand fetch is bounded", () => {
  const built = existsSync(path.join(NEXT_DIR, "server", "app"));

  it(`everything the desk fetches for the ticket, beyond the page, stays under ${TICKET_FETCH_GZ_KB} KB gz`, () => {
    if (!built) return;
    const all = walkJs(CHUNKS_DIR);
    const idOf = (f: string) => /^(\d+)[-.]/.exec(path.basename(f))?.[1];
    // Which file a loaded id is: the one whose JSONP header DECLARES it, not
    // the one whose name starts with it. A named chunk (next.config.mjs's
    // `root-shared`) keeps a numeric id but is written `<name>-<hash>.js`, and
    // a merged chunk declares several ids under the first one's name.
    const declares = (f: string, id: string) =>
      (/\.push\(\[\[([\d,]+)\]/.exec(read(f).slice(0, 200))?.[1] ?? "")
        .split(",")
        .includes(id);
    const ticket = all.filter((f) => read(f).includes(TICKET_CHUNK_MARKER));
    expect(ticket).toHaveLength(1);
    const ticketId = idOf(ticket[0]!);
    expect(ticketId, "the ticket's chunk has no numeric id").toBeTruthy();
    // The load in front of the ticket's import, in the chunk that imports it.
    const loads = all
      .flatMap((f) =>
        [
          ...read(f).matchAll(/Promise\.all\(\[((?:\w+\.e\(\d+\),?)+)\]\)/g),
        ].map((m) => [...m[1]!.matchAll(/\.e\((\d+)\)/g)].map((x) => x[1]!)),
      )
      .filter((ids) => ids.includes(ticketId!));
    // Health: found, and more than the ticket alone.
    expect(loads.length, "no chunk loads the ticket").toBeGreaterThanOrEqual(1);
    const ids = new Set(loads.flat());
    expect(ids.size).toBeGreaterThanOrEqual(2);
    const files = [...ids].map((id) => {
      const f = all.find((c) => declares(c, id));
      expect(f, `chunk ${id} is not on disk`).toBeTruthy();
      return f!;
    });
    const taglines = tools.map((t) => t.tagline);
    const isCatalogue = (f: string) =>
      taglines.filter((t) => read(f).includes(t)).length >= taglines.length - 5;
    const onPage = new Set(
      chunkFiles(NEXT_DIR, "index.html").map((f) => path.resolve(f)),
    );
    const counted = files.filter((f) => !onPage.has(path.resolve(f)));
    // Positive control: the catalogue was among the loads, and is counted.
    expect(counted.some(isCatalogue)).toBe(true);
    const gz =
      counted.reduce(
        (sum, f) => sum + gzipSync(readFileSync(f), { level: 9 }).length,
        0,
      ) / 1024;
    expect(
      gz,
      `the ticket's fetch is ${gz.toFixed(1)} KB gz over ${counted.map((f) => path.basename(f)).join(", ")}`,
    ).toBeLessThan(TICKET_FETCH_GZ_KB);
  });
});

/**
 * WP-09: what opening the palette costs, read the same way as the ticket's
 * fetch above — every chunk in the `Promise.all` in front of the palette's
 * import, minus the catalogue (shared, counted once, above) and minus what
 * the page already loaded. G.1 budgets it at 12 KB gz; that is the PLAN's
 * number, and it is the bound, because the palette was written to it.
 *
 * Measured on every page kind whose first load differs (the home page, a
 * tool page, a guide, the 404), because "what the page already loaded" is
 * per page: a page that already has the search engine pays less.
 */
const PALETTE_FETCH_GZ_KB = 12;

function onDemandFetch(marker: string, page: string) {
  const all = walkJs(CHUNKS_DIR);
  const idOf = (f: string) => /^(\d+)[-.]/.exec(path.basename(f))?.[1];
  const declares = (f: string, id: string) =>
    (/\.push\(\[\[([\d,]+)\]/.exec(read(f).slice(0, 200))?.[1] ?? "")
      .split(",")
      .includes(id);
  const own = all.filter((f) => read(f).includes(marker));
  expect(own, `exactly one chunk carries ${marker}`).toHaveLength(1);
  const ownId = idOf(own[0]!);
  expect(ownId, "the chunk has no numeric id").toBeTruthy();
  const loads = all
    .flatMap((f) =>
      [...read(f).matchAll(/Promise\.all\(\[((?:\w+\.e\(\d+\),?)+)\]\)/g)].map(
        (m) => [...m[1]!.matchAll(/\.e\((\d+)\)/g)].map((x) => x[1]!),
      ),
    )
    .filter((ids) => ids.includes(ownId!));
  expect(loads.length, "no chunk loads it").toBeGreaterThanOrEqual(1);
  const ids = new Set(loads.flat());
  const files = [...ids].map((id) => {
    const f = all.find((c) => declares(c, id));
    expect(f, `chunk ${id} is not on disk`).toBeTruthy();
    return f!;
  });
  const taglines = tools.map((t) => t.tagline);
  const isCatalogue = (f: string) =>
    taglines.filter((t) => read(f).includes(t)).length >= taglines.length - 5;
  const onPage = new Set(
    chunkFiles(NEXT_DIR, page).map((f) => path.resolve(f)),
  );
  const counted = files.filter(
    (f) => !isCatalogue(f) && !onPage.has(path.resolve(f)),
  );
  const gz =
    counted.reduce(
      (sum, f) => sum + gzipSync(readFileSync(f), { level: 9 }).length,
      0,
    ) / 1024;
  return { files, counted, gz, catalogueAmong: files.some(isCatalogue) };
}

describe("the palette's on-demand fetch is bounded", () => {
  const built = existsSync(path.join(NEXT_DIR, "server", "app"));

  it("positive control: the same reader measures the ticket's fetch, catalogue excluded", () => {
    if (!built) return;
    const ticket = onDemandFetch(TICKET_CHUNK_MARKER, "index.html");
    expect(ticket.catalogueAmong).toBe(true);
    expect(ticket.gz).toBeGreaterThan(5);
  });

  it.each([
    "index.html",
    "tools/rotate-pdf.html",
    "guides/how-to-merge-pdf-files.html",
    "_not-found.html",
  ])(`from %s it stays under ${PALETTE_FETCH_GZ_KB} KB gz`, (page) => {
    if (!built) return;
    const fetch = onDemandFetch(PALETTE_CHUNK_MARKER, page);
    // Health: the palette reads the catalogue, and it was found and excluded.
    expect(fetch.catalogueAmong).toBe(true);
    expect(fetch.counted.length).toBeGreaterThanOrEqual(1);
    expect(
      fetch.gz,
      `the palette's fetch from ${page} is ${fetch.gz.toFixed(2)} KB gz over ${fetch.counted.map((f) => path.basename(f)).join(", ")}`,
    ).toBeLessThanOrEqual(PALETTE_FETCH_GZ_KB);
  });
});

/**
 * PAKO STAYS WITH ITS OWNER. UTIF (`tiff.ts`, TIFF input since 2026-11-04)
 * requires pako for a Deflate decoder `tiff.ts` never calls. Bundled, it is
 * the same pako module pdf-lib uses, so webpack moved pako OUT of pdf-lib's
 * chunk into one shared by both: the same bytes, one more request wherever
 * pdf-lib loads, one more entry in the runtime every page loads.
 * `next.config.mjs` (`utifPakoStub`) points UTIF's request at
 * `utif-pako-unused.ts`.
 *
 * Read from the built chunks, by strings each library's own code carries:
 * every chunk holding pako's inflate also holds pdf-lib or JSZip (which
 * bundles a pako of its own), and the stub is in the build — the check the
 * first version of the hook lacked: its directory test never matched, the
 * stub was never used, and the bundle stayed as it was.
 */
describe("pako stays inside the chunks of the libraries that use it", () => {
  const built = existsSync(path.join(NEXT_DIR, "server", "app"));
  /** pako's inflate error (zlib's own message). */
  const PAKO = "invalid distance too far back";
  const JSZIP = "Corrupted zip : CRC32 mismatch";
  /** A UTIF method name, kept by minification as a property. */
  const UTIF = "_decodeG4";

  it("every chunk with pako carries pdf-lib or JSZip, and UTIF's chunks carry the stub instead", () => {
    if (!built) return;
    const all = walkJs(CHUNKS_DIR);
    const pako = all.filter((f) => read(f).includes(PAKO));
    const utif = all.filter((f) => read(f).includes(UTIF));
    const stub = all.filter((f) => read(f).includes(UTIF_PAKO_UNUSED));
    // Health: each library is in the build, so an empty list below is a
    // finding, not a blind reader.
    expect(pako.length, "pako's inflate is in no chunk").toBeGreaterThanOrEqual(
      2,
    );
    expect(utif.length, "UTIF is in no chunk").toBeGreaterThanOrEqual(1);
    expect(
      all.some((f) => read(f).includes(LAZY[0]!.marker)),
      "pdf-lib is in no chunk",
    ).toBe(true);
    expect(
      all.some((f) => read(f).includes(JSZIP)),
      "JSZip is in no chunk",
    ).toBe(true);

    const orphaned = pako.filter(
      (f) => !read(f).includes(LAZY[0]!.marker) && !read(f).includes(JSZIP),
    );
    expect(
      orphaned.map((f) => path.basename(f)),
      "a chunk carries pako without the library that uses it",
    ).toEqual([]);
    expect(
      stub.map((f) => path.basename(f)),
      'the stub is in no chunk: UTIF\'s require("pako") was not redirected',
    ).not.toEqual([]);
    expect(
      stub.filter((f) => read(f).includes(PAKO)).map((f) => path.basename(f)),
      "the stub shares a chunk with pako",
    ).toEqual([]);
  });
});
