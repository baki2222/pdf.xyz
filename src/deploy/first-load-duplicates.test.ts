// @vitest-environment node
/**
 * The root layout's chunk carries no module that another chunk the same page
 * loads up front also carries — beyond the duplicates both parents of the
 * design-batch-B merge already had. Read from the built chunks a browser
 * downloads (CLAUDE.md rule 5), by webpack module id.
 *
 * THE DEFECT THIS WAS WRITTEN AGAINST, measured 2026-10-10 on the merge of main
 * 552bed45 into design batch B 9b4affd4 (ae7f483b): the layout chunk grew
 * 18.6 -> 23.9 KB raw with its own copies of six modules — lucide's icon base
 * (`createLucideIcon`, `Icon`, `mergeClasses`), `cn()`, the Button and the
 * telemetry client — that `4032-*.js` ALSO carried, and every page loads
 * both: +2.0-2.3 KB gz on every page that is not a tool page. Neither parent
 * had it. A size budget saw only "heavier", and the ceilings were raised to
 * fit (bundle-budget.test.ts, the /tools and /workspace rows).
 *
 * WHY IT HAPPENED, recorded with the chunk sets webpack's SplitChunksPlugin
 * saw on all three builds (a plugin tapped before and after it): those
 * modules are shared by the layout (SiteHeader, WebVitals), `app/error.tsx`
 * and the tool route (its ErrorBoundary) — ~20.7 KB of source between them,
 * just over Next's 20,000-byte `minSize`. Webpack only offers a shared chunk
 * for a chunk SET that some module has exactly, and no module was imported
 * by exactly those three: the telemetry barrel was also imported by
 * `app/global-error.tsx`, a root webpack never splits. So the candidates were
 * PAIRS — {error, layout} at 21,034 bytes and {error, tool route} at 26,079
 * (the ErrorBoundary also brings `upload-disclosure`, `session-uploads` and
 * RotateCcw) — and the bigger pair wins. In each parent a group that included
 * the tool route had taken the shared modules first (main: the home page's
 * static upload zone shared them with the tool, status and workspace routes;
 * batch B: the unsplit tool route shared them with status and workspace), so
 * {error, tool route} fell under `minSize` and {error, layout} won. The merge
 * removed both (WP-05 moved the home page's upload zone into the lazy desk
 * island; #175 split the tool route), and the pair without the layout won.
 * Not the request cap, not HandoffSweep, not next/font.
 *
 * THE FIX IS IN THE IMPORT GRAPH: `global-error.tsx` imports the reporter
 * module rather than the barrel, so the barrel's chunk set is exactly
 * {layout, error, tool route} and webpack groups the three's common modules
 * once; and `error.tsx` no longer imports `Container`, the one module only it
 * and the layout shared — at 287 bytes it could never reach a shared chunk,
 * so every page downloaded it twice. This file holds the PROPERTY, not those
 * two lines: any other change that regroups the chunks fails here too.
 *
 * TWO TIERS, both bounded at what both parents measured (main 552bed45 and
 * batch B 9b4affd4, over all 88 pages that load the layout):
 *  - EVERY-PAGE: a duplicate whose other copy is in a chunk every layout page
 *    loads — downloaded twice on every page of the site. Both parents: exactly
 *    ONE, on every page: Next's own `next/navigation` re-export (190 bytes),
 *    which the layout and `app/not-found` each import. Tolerance 1, at most
 *    512 bytes (the tolerance is for a shim, not for a module).
 *  - PAGE: the other copy is in a chunk only some pages load. Both parents:
 *    at most THREE per page, 1,702 bytes (the tool pages: the category list,
 *    lucide's `X`, the live region; /tools: the category list, `X`, the
 *    category href). Tolerance 3, at most 2,048 bytes.
 * Each tolerance is held from below too: when the build stops needing it,
 * this fails and asks for the lower figure, so it can only shrink.
 *
 * Runs under `pnpm test:bundle` (it needs `.next`), never `pnpm test`.
 */
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { chunkFiles, prerenderedPages } from "../../scripts/page-weight";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const ROOT = process.cwd();
const NEXT_DIR = path.join(ROOT, ".next");
const APP_DIR = path.join(NEXT_DIR, "server", "app");

interface Tier {
  name: string;
  why: string;
  /** Most duplicated modules any page may carry in this tier. */
  modules: number;
  /** Most bytes (of the layout's copies) any page may carry in this tier. */
  bytes: number;
}

const EVERY_PAGE: Tier = {
  name: "every-page",
  why: "another chunk EVERY page loads carries it too, so every page of the site downloads it twice",
  modules: 1,
  bytes: 512,
};
const PAGE: Tier = {
  name: "page",
  why: "a chunk this page loads carries it too",
  modules: 3,
  bytes: 2048,
};

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
  /** The other first-load chunks that define the same module id. */
  alsoIn: string[];
}

/**
 * The layout's modules that another of `files` also defines. `tables` reads a
 * file's module table (injected so the positive control can feed a copy).
 */
function layoutDuplicates(
  files: string[],
  tables: (file: string) => ChunkModule[] = (f) => moduleTable(f),
): Duplicate[] {
  const layout = files.filter(isRootLayoutChunk);
  if (layout.length !== 1)
    throw new Error(
      `expected exactly one root layout chunk, found ${layout.length}: ${layout.join(", ")}`,
    );
  const others = files.filter((f) => f !== layout[0]);
  const ids = new Map(
    others.map((f) => [f, new Set(tables(f).map((m) => m.id))]),
  );
  return tables(layout[0]!)
    .map((m) => ({
      ...m,
      alsoIn: others.filter((f) => ids.get(f)!.has(m.id)),
    }))
    .filter((d) => d.alsoIn.length > 0);
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
  /** Chunk files every layout page loads. */
  everyPage: Set<string>;
}

let corpus: Corpus | undefined;
function getCorpus(): Corpus {
  if (corpus) return corpus;
  const all = prerenderedPages(NEXT_DIR);
  const pages = all.filter((html) =>
    chunkFiles(NEXT_DIR, html).some(isRootLayoutChunk),
  );
  const without = all.filter((html) => !pages.includes(html));
  const sets = pages.map((html) => new Set(chunkFiles(NEXT_DIR, html)));
  const everyPage = new Set(
    [...(sets[0] ?? [])].filter((f) => sets.every((s) => s.has(f))),
  );
  corpus = { pages, without, everyPage };
  return corpus;
}

function tiersOf(html: string): Map<Tier, Duplicate[]> {
  const { everyPage } = getCorpus();
  const dups = layoutDuplicates(chunkFiles(NEXT_DIR, html));
  return new Map([
    [EVERY_PAGE, dups.filter((d) => d.alsoIn.some((f) => everyPage.has(f)))],
    [PAGE, dups.filter((d) => !d.alsoIn.some((f) => everyPage.has(f)))],
  ]);
}

const describeDup = (d: Duplicate) =>
  `module ${d.id} (${d.bytes} B, also in ${d.alsoIn.map(name).join(" + ")}): ${d.excerpt}…`;

describe("the root layout's chunk carries no module another first-load chunk also carries", () => {
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
    // 88 on 2026-10-10 (50 tools, 22 guides, 8 categories, 8 others): a
    // plausibility bound both ways, so a walk that shrank or swallowed a
    // second build cannot pass.
    expect(pages.length).toBeGreaterThanOrEqual(60);
    expect(pages.length).toBeLessThanOrEqual(200);
  });

  it("health check: the module reader reads every chunk a page loads, and reads enough of them", () => {
    if (!built) return;
    const { pages, everyPage } = getCorpus();
    for (const html of pages) {
      const files = chunkFiles(NEXT_DIR, html);
      // moduleTable throws on a webpack chunk it reads nothing from; the
      // files it reads none from are the two that are not JSONP chunks at
      // all (`webpack-*.js`, the runtime, and `polyfills-*.js`).
      const unread = files.filter((f) => moduleTable(f).length === 0);
      expect(
        unread.map(name),
        `${html}: first-load files no module was read from`,
      ).toHaveLength(2);
      const total = files.reduce((sum, f) => sum + moduleTable(f).length, 0);
      // ~200-300 per page on 2026-10-10.
      expect(
        total,
        `${html}: modules read across its first load`,
      ).toBeGreaterThanOrEqual(100);
      const layout = files.find(isRootLayoutChunk)!;
      // 16-22 on 2026-10-10.
      expect(
        moduleTable(layout).length,
        `${html}: modules read from ${name(layout)}`,
      ).toBeGreaterThanOrEqual(8);
    }
    // The every-page set is the shared spine (runtime, framework, the layout,
    // error and not-found entries…), not empty and not a whole page's list.
    expect(everyPage.size).toBeGreaterThanOrEqual(6);
    expect(
      [...everyPage].some(isRootLayoutChunk),
      "the layout chunk is in every layout page's first load",
    ).toBe(true);
  });

  it("positive control: a layout module copied into another first-load chunk is reported, in the right tier", () => {
    if (!built) return;
    const { pages, everyPage } = getCorpus();
    const html = pages.includes("index.html") ? "index.html" : pages[0]!;
    const files = chunkFiles(NEXT_DIR, html);
    const layout = files.find(isRootLayoutChunk)!;
    const victim = moduleTable(layout).find((m) =>
      layoutDuplicates(files).every((d) => d.id !== m.id),
    )!;
    expect(
      victim,
      "the layout has a module no other chunk carries",
    ).toBeDefined();
    // A COPY of a real every-page chunk with the victim's definition pasted
    // into its table — the file on disk is never touched.
    const host = files.find(
      (f) => everyPage.has(f) && f !== layout && moduleTable(f).length > 0,
    )!;
    const original = readFileSync(host, "utf8");
    const table = moduleTable(host);
    const anchor = `${table[0]!.id}:`;
    const at = original.indexOf(anchor, original.indexOf("push("));
    expect(at, "the copy has somewhere to put the module").toBeGreaterThan(0);
    const copy = `${original.slice(0, at)}${victim.id}:(e,t,n)=>{},${original.slice(at)}`;
    const read = (f: string) =>
      f === host ? moduleTable(f, copy) : moduleTable(f);
    // The mutation landed: the copy's table has the victim, the file's does not.
    expect(read(host).map((m) => m.id)).toContain(victim.id);
    expect(moduleTable(host).map((m) => m.id)).not.toContain(victim.id);
    const found = layoutDuplicates(files, read).find((d) => d.id === victim.id);
    expect(found?.alsoIn, "the reader reports the copied module").toEqual([
      host,
    ]);
    expect(everyPage.has(found!.alsoIn[0]!)).toBe(true);
  });

  for (const tier of [EVERY_PAGE, PAGE]) {
    it(`${tier.name} tier: no page carries more than ${tier.modules} duplicated layout module(s) or ${tier.bytes} bytes of them`, () => {
      if (!built) return;
      const over = getCorpus()
        .pages.map((html) => ({ html, dups: tiersOf(html).get(tier)! }))
        .filter(
          ({ dups }) =>
            dups.length > tier.modules ||
            dups.reduce((s, d) => s + d.bytes, 0) > tier.bytes,
        )
        .map(
          ({ html, dups }) =>
            `${html}: ${dups.length} module(s), ${dups.reduce((s, d) => s + d.bytes, 0)} B — ${tier.why}:\n    ${dups.map(describeDup).join("\n    ")}`,
        );
      expect(
        over,
        `the root layout's chunk duplicates modules another first-load chunk carries (${tier.name} tier, tolerance ${tier.modules}). Find the module's importers: webpack can only share a module between the layout and another entry through a chunk SET some module has exactly (see this file's docblock). Do not raise the tolerance to fit.`,
      ).toEqual([]);
    });

    it(`${tier.name} tier: the tolerance is still needed (it can only shrink)`, () => {
      if (!built) return;
      const most = Math.max(
        ...getCorpus().pages.map((html) => tiersOf(html).get(tier)!.length),
      );
      expect(
        most,
        `no page needs the ${tier.name} tier's tolerance of ${tier.modules} any more — lower it to ${most}`,
      ).toBeGreaterThanOrEqual(tier.modules);
    });
  }
});
