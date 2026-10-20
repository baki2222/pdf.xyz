// @vitest-environment node
/**
 * No module is defined by two chunks of the same page's first load — ANY two,
 * not only the root layout and another. A second copy is bytes every visitor
 * downloads and webpack then ignores (the runtime registers a module id once).
 * Read from the built chunks a browser downloads (CLAUDE.md rule 5), by
 * webpack module id, over every prerendered page the build produced.
 *
 * HISTORY 1, 2026-10-10 — the guard this file began as. On the merge of main
 * 552bed45 into design batch B 9b4affd4 (ae7f483b) the layout chunk grew
 * 18.6 -> 23.9 KB raw with its own copies of six modules — lucide's icon base
 * (`createLucideIcon`, `Icon`, `mergeClasses`), `cn()`, the Button and the
 * telemetry client — that `4032-*.js` ALSO carried, and every page loads
 * both: +2.0-2.3 KB gz on every page that is not a tool page. A size budget
 * saw only "heavier", and the ceilings were raised to fit. That was fixed in
 * the import graph (`global-error.tsx` imported the reporter, not the barrel;
 * `error.tsx` dropped `Container`) and this file held the root LAYOUT's
 * modules to two shrink-only tolerances: one every-page duplicate (Next's
 * `next/navigation` shim, 190 B) and three page duplicates (1,702 B).
 *
 * HISTORY 2, 2026-10-20 — that set was too narrow (CLAUDE.md rule 4: the
 * right predicate over the wrong set). It asked only "does the LAYOUT share a
 * module with another chunk", so a module copied between two NON-layout
 * chunks of one page was invisible. Measured on main 97e4b84e, all 89 pages:
 * every page carried 9-14 duplicated modules, 6.3-9.1 KB raw (one copy of
 * each counted), and the layout tiers saw at most 4 of them. On every page:
 * the telemetry client (1,784 + 1,701 + 674 + 319 + 198 B) in
 * `app/global-error` AND the shared chunk 4107 / `app/error`; lucide's icon
 * base (`Icon` 895 B, `createLucideIcon` 463 B, `mergeClasses` 120 B) in 4107
 * AND `app/not-found` (and a third time in the home, guide, guides-index,
 * tools and category page chunks); lucide's `ArrowRight` in `app/error` AND
 * `app/not-found`; Next's `next/navigation` shim in the layout AND
 * `app/not-found`. Per page: `cn()` (404 B) and the Button (913 B) in 4107 AND
 * the home page's preloaded desk chunk, /tools, /workspace, /status and
 * /privacy; the category list (1,138 B) in the layout AND 6165 on tool and
 * workspace pages; the LiveRegion (412 B) in the layout AND a tool page's
 * preloaded panel chunk.
 *
 * WHY: Next registers the root layout, `error`, `not-found` and
 * `global-error` as four separate entries, and every page loads all four.
 * SplitChunks only shares a module across exactly the chunk SET some group of
 * modules has, above Next's 20,000-byte `minSize`, so a module imported by
 * two of the four (plus some pages) lands in a shared chunk for a SUBSET of
 * its chunks and stays copied in the rest. The fix is the `rootShared` cache
 * group in next.config.mjs: a module that any root entry carries, and that
 * two or more chunks carry, goes to ONE chunk. It can add nothing to any
 * page's first load — every such module was already downloaded on every page
 * through the entry that carries it. This file holds the PROPERTY, not that
 * group: any other change that regroups the chunks fails here too.
 *
 * Tolerance: ZERO, at any size — the property, not a budget. No floor is
 * needed: after the fix no page has a single duplicated module, the 190-byte
 * Next shim included.
 *
 * Runs under `pnpm test:bundle` (it needs `.next`), never `pnpm test`.
 */
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { chunkFiles, prerenderedPages } from "../../scripts/page-weight";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const ROOT = process.cwd();
const NEXT_DIR = path.join(ROOT, ".next");
const APP_DIR = path.join(NEXT_DIR, "server", "app");

/** A webpack module as one chunk defines it. */
interface ChunkModule {
  id: string;
  /** Characters of its definition — the bytes a second copy costs, raw. */
  bytes: number;
  /** The start of its code, so a failure names something a person can read. */
  excerpt: string;
}

const tableCache = new Map<string, ChunkModule[]>();

/**
 * The modules a JSONP chunk defines: the keys of the object literal in its
 * top-level `(self.webpackChunk_N_E=…).push([[chunkIds], {id: factory, …}])`.
 * Parsed, not pattern-matched, and read off that one top-level statement, so
 * a nested object with numeric keys inside some module's code can never pass
 * for a module. A file with no such statement (the runtime, polyfills)
 * defines none; a JSONP chunk whose table yields nothing throws, because a
 * blind reader reports every page clean.
 */
function moduleTable(file: string, text?: string): ChunkModule[] {
  const cached = text === undefined ? tableCache.get(file) : undefined;
  if (cached) return cached;
  const source = text ?? readFileSync(file, "utf8");
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const out: ChunkModule[] = [];
  let jsonp = 0;
  for (const statement of sf.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    const call = statement.expression;
    if (
      !ts.isCallExpression(call) ||
      !ts.isPropertyAccessExpression(call.expression) ||
      call.expression.name.text !== "push" ||
      !call.expression.expression.getText(sf).includes("webpackChunk")
    )
      continue;
    jsonp++;
    const [entry] = call.arguments;
    const table =
      entry && ts.isArrayLiteralExpression(entry)
        ? entry.elements[1]
        : undefined;
    if (!table || !ts.isObjectLiteralExpression(table)) continue;
    for (const p of table.properties) {
      if (
        !p.name ||
        !(ts.isNumericLiteral(p.name) || ts.isStringLiteral(p.name))
      )
        continue;
      const start = p.getStart(sf);
      out.push({
        id: p.name.text,
        bytes: p.end - start,
        excerpt: source.slice(start, start + 90).replace(/\s+/g, " "),
      });
    }
  }
  if (jsonp > 0 && out.length === 0)
    throw new Error(
      `${path.relative(ROOT, file)} is a webpack chunk, but no module table was read from it — the reader is blind to this chunk's shape`,
    );
  if (text === undefined) tableCache.set(file, out);
  return out;
}

const SEP = /[\\/]/;
/**
 * The root layout's client chunk, by Next's own name for its client entry:
 * `static/chunks/app/layout-<hash>.js`. Nested layouts would be
 * `app/<segment>/layout-*`, so only the root one matches.
 */
const isRootLayoutChunk = (file: string): boolean => {
  const parts = file.split(SEP);
  return (
    parts.at(-2) === "app" &&
    parts.at(-3) === "chunks" &&
    /^layout-[0-9a-f]+\.js$/.test(parts.at(-1)!)
  );
};

interface Duplicate {
  id: string;
  bytes: number;
  excerpt: string;
  /** Every first-load chunk that defines this module id (two or more). */
  in: string[];
}

/**
 * The modules that two or more of `files` define. `tables` reads a file's
 * module table (injected so the positive control can feed a copy).
 */
function duplicates(
  files: string[],
  tables: (file: string) => ChunkModule[] = (f) => moduleTable(f),
): Duplicate[] {
  const where = new Map<string, { m: ChunkModule; in: string[] }>();
  for (const f of files)
    for (const m of tables(f)) {
      const seen = where.get(m.id);
      if (seen) seen.in.push(f);
      else where.set(m.id, { m, in: [f] });
    }
  return [...where.values()]
    .filter((w) => w.in.length > 1)
    .map((w) => ({
      id: w.m.id,
      bytes: w.m.bytes,
      excerpt: w.m.excerpt,
      in: w.in,
    }));
}

const name = (file: string) =>
  path
    .relative(path.join(NEXT_DIR, "static", "chunks"), file)
    .split(SEP)
    .join("/");

interface Corpus {
  /** Pages that load the root layout chunk. */
  pages: string[];
  /** Pages that do not (Next's own `_global-error` page renders without it). */
  without: string[];
}

let corpus: Corpus | undefined;
function getCorpus(): Corpus {
  if (corpus) return corpus;
  const all = prerenderedPages(NEXT_DIR);
  const pages = all.filter((html) =>
    chunkFiles(NEXT_DIR, html).some(isRootLayoutChunk),
  );
  const without = all.filter((html) => !pages.includes(html));
  corpus = { pages, without };
  return corpus;
}

/** Every prerendered page, `_global-error` included: it has a first load too. */
const allPages = () => {
  const { pages, without } = getCorpus();
  return [...pages, ...without];
};

const describeDup = (d: Duplicate) =>
  `module ${d.id} (${d.bytes} B, in ${d.in.map(name).join(" + ")}): ${d.excerpt}…`;

describe("no module is defined by two chunks of the same page's first load", () => {
  const built = existsSync(APP_DIR);

  it("has a build to measure", () => {
    // Skipping when `.next` is absent would read green in exactly the case
    // where nothing was checked.
    expect(built, "no .next — run `pnpm build` first (CI does)").toBe(true);
  });

  it("health check: every page but Next's own global-error page loads the layout, and the walk sees the site", () => {
    if (!built) return;
    const { pages, without } = getCorpus();
    // `_global-error` is the page Next renders for app/global-error.tsx, which
    // REPLACES the root layout — the one page that must not load it.
    expect(
      without,
      "prerendered pages that do not load the root layout chunk",
    ).toEqual(["_global-error.html"]);
    // Every catalogue tool page is in the set, by relationship, not count.
    const set = new Set(pages);
    expect(
      tools.map((t) => `tools/${t.slug}.html`).filter((html) => !set.has(html)),
      "catalogue tool pages missing from the walk",
    ).toEqual([]);
    // 88 on 2026-10-10 and 2026-10-20 (50 tools, 22 guides, 8 categories, 8
    // others): a plausibility bound both ways, so a walk that shrank or
    // swallowed a second build cannot pass.
    expect(pages.length).toBeGreaterThanOrEqual(60);
    expect(pages.length).toBeLessThanOrEqual(200);
  });

  it("health check: the module reader reads every chunk a page loads, and reads the bulk of each", () => {
    if (!built) return;
    for (const html of allPages()) {
      const files = chunkFiles(NEXT_DIR, html);
      // moduleTable throws on a webpack chunk it reads nothing from; the
      // files it reads none from are the two that are not JSONP chunks at
      // all (`webpack-*.js`, the runtime, and `polyfills-*.js`).
      const unread = files.filter((f) => moduleTable(f).length === 0);
      expect(
        unread.map(name),
        `${html}: first-load files no module was read from`,
      ).toHaveLength(2);
      // The definitions read must be the whole chunk but its JSONP wrapper
      // and entry bootstrap: a reader that kept only some keys of a table
      // would miss the copies in the rest. Most bytes outside the table on
      // 2026-10-20: ~380, in a 37 KB chunk; the smallest entries are ~190 B.
      for (const f of files.filter((f) => !unread.includes(f))) {
        const read = moduleTable(f).reduce((sum, m) => sum + m.bytes, 0);
        expect(
          statSync(f).size - read,
          `${html}: bytes of ${name(f)} not read as a module definition`,
        ).toBeLessThanOrEqual(1024);
      }
      const total = files.reduce((sum, f) => sum + moduleTable(f).length, 0);
      // ~200-300 per page on 2026-10-10.
      expect(
        total,
        `${html}: modules read across its first load`,
      ).toBeGreaterThanOrEqual(100);
    }
  });

  it("positive control: a module copied between two NON-layout first-load chunks is reported", () => {
    if (!built) return;
    // A tool page, and two chunks that are not the layout — the not-found
    // entry and the tool page's own entry: the pair the guard before
    // 2026-10-20 could not see.
    const html = `tools/${tools[0]!.slug}.html`;
    const files = chunkFiles(NEXT_DIR, html);
    const posix = (f: string) => f.split(SEP).join("/");
    const donor = files.find((f) =>
      posix(f).includes("/chunks/app/not-found-"),
    );
    const host = files.find((f) =>
      posix(f).includes("/chunks/app/tools/[slug]/page-"),
    );
    expect(
      donor,
      `${html}: the not-found entry is in its first load`,
    ).toBeDefined();
    expect(
      host,
      `${html}: the tool page entry is in its first load`,
    ).toBeDefined();
    const clean = new Set(duplicates(files).map((d) => d.id));
    const victim = moduleTable(donor!).find((m) => !clean.has(m.id));
    expect(
      victim,
      "the donor has a module no other chunk carries",
    ).toBeDefined();
    // A COPY of the host with the victim's definition pasted into its table —
    // the file on disk is never touched.
    const original = readFileSync(host!, "utf8");
    const anchor = `${moduleTable(host!)[0]!.id}:`;
    const at = original.indexOf(anchor, original.indexOf("push("));
    expect(at, "the copy has somewhere to put the module").toBeGreaterThan(0);
    const copy = `${original.slice(0, at)}${victim!.id}:(e,t,n)=>{},${original.slice(at)}`;
    const read = (f: string) =>
      f === host ? moduleTable(f, copy) : moduleTable(f);
    // The mutation landed: the copy's table has the victim, the file's does not.
    expect(read(host!).map((m) => m.id)).toContain(victim!.id);
    expect(moduleTable(host!).map((m) => m.id)).not.toContain(victim!.id);
    const found = duplicates(files, read).find((d) => d.id === victim!.id);
    expect(found?.in, "the reader reports the copied module").toEqual(
      files.filter((f) => f === donor || f === host),
    );
  });

  it("no page's first load defines any module twice", () => {
    if (!built) return;
    const over = allPages()
      .map((html) => ({ html, dups: duplicates(chunkFiles(NEXT_DIR, html)) }))
      .filter(({ dups }) => dups.length > 0)
      .map(
        ({ html, dups }) =>
          `${html}: ${dups.length} module(s), ${dups.reduce((s, d) => s + d.bytes, 0)} B:\n    ${dups
            .sort((x, y) => y.bytes - x.bytes)
            .map(describeDup)
            .join("\n    ")}`,
      );
    expect(
      over,
      "first-load chunks of one page define the same module, so every visitor downloads it twice. Find the module's importers and the chunks that hold it (this file's docblock: the four root entries). Do not add a tolerance to fit.",
    ).toEqual([]);
  });
});
