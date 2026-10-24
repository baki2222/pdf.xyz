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
import { RESULT_ENDING_CHUNK } from "@/components/intent/result-ending-chunk";
import { DROP_ENGINE_MARK } from "@/lib/intent/drop-engine";
import { tools } from "@/lib/tools";
import { SEARCH_ENGINE_CHUNK } from "@/lib/tools/search-tools";
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
 * What the ticket costs the visitor who brings a file: every chunk the desk
 * fetches for it, read from the desk's own chunk (the `Promise.all` of chunk
 * loads in front of the ticket's import), minus the catalogue (counted and
 * shared above) and minus what the home page already loaded.
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
 */
const TICKET_FETCH_GZ_KB = 23.5;

describe("the ticket's on-demand fetch is bounded", () => {
  const built = existsSync(path.join(NEXT_DIR, "server", "app"));

  it(`everything the desk fetches for the ticket, beyond the catalogue and the page, stays under ${TICKET_FETCH_GZ_KB} KB gz`, () => {
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
    const counted = files.filter(
      (f) => !isCatalogue(f) && !onPage.has(path.resolve(f)),
    );
    // Positive control: the catalogue was among the loads and was excluded.
    expect(files.some(isCatalogue)).toBe(true);
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
