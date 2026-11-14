// @vitest-environment node
/**
 * A tool page's first-load JavaScript carries ITS OWN panel — and no other
 * tool's. Read from the built HTML and the chunks it references, i.e. what a
 * browser actually downloads, not from how the imports are written.
 *
 * THE DEFECT THIS WAS WRITTEN AGAINST, measured 2026-10-09 on the build of
 * main f2b3db8b: every one of the 50 prerendered tool pages loaded the route
 * chunk `app/tools/[slug]/page-*.js`, 539 KB raw, which held EVERY tool's UI.
 * `tool-runner.tsx` statically imported 27 runner modules into one `switch`,
 * and the page statically imported 13 worker panels; App Router puts every
 * client module a route imports into that route's one client entry. So
 * `pnpm weigh:pages` reported rotate, merge, OCR and Summarize at the same
 * 1,239 KB raw / 371.1 KB gz, and Rotate's first load carried the Translate
 * panel. A size budget cannot see that — only how much, never whose.
 *
 * HOW "WHICH MODULE IS IN WHICH CHUNK" IS DECIDED: by distinctive strings read
 * off each panel module's own source and searched for in the shipped chunk
 * bytes. Chosen over the two alternatives because both describe the AUTHOR'S
 * artifact, not the bytes a reader receives (CLAUDE.md rule 5):
 *  - webpack module ids: the runners were scope-hoisted into ONE concatenated
 *    module, so a runner had no id of its own to look for;
 *  - Next's manifests (`react-loadable-manifest`, the client-reference
 *    manifest) record what a dynamic boundary or a client reference was MEANT
 *    to load, and say nothing about a module that rides along statically —
 *    which is exactly the defect.
 * A string literal (or a line of JSX text, which compiles to one) survives
 * minification verbatim and lives wherever its module's code lives. A marker
 * must be: in the module's own code (not a type, an import specifier or a
 * directive), 9+ characters with no quote, backtick, backslash or control
 * character, in NO other source file under src/, and present in the built
 * client chunks. Self-checked: within any one chunk a module's markers appear
 * ALL together or not at all (a module's code is never split across chunks),
 * so a "marker" that some other code also emits is FATAL rather than a false
 * finding, and a module with fewer than two markers is FATAL rather than
 * vacuously "carried" by every chunk.
 *
 * THE CORPUS IS DERIVED, both halves (CLAUDE.md rule 4):
 *  - the pages: every `tools/<slug>.html` the build prerendered, held equal to
 *    the catalogue in both directions;
 *  - the panel modules and which page owns which: read from the dispatchers
 *    the page mounts (`src/tests/tool-panel-modules.ts`) — registry kind →
 *    runner `case`, else the worker-panel registry the page indexes
 *    (`WORKER_PANELS[tool.slug]`, each route's loader followed to its panel
 *    module; WAS the page's `tool.slug ===` arms until WP-06) — and cross-checked
 *    against the files: every `*-worker-panel.tsx`, and every `*-runner.tsx`
 *    that is neither the dispatcher nor a shared base a mounted runner
 *    imports, must be in it.
 *
 * Runs under `pnpm test:bundle` (it needs `.next`), never `pnpm test`.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { ANNOTATION_GROUP_LABEL } from "@/lib/pdf/annotation-kinds";
import { annotationGroup } from "@/lib/pdf/annotation-groups";
import { DYNAMIC_XFA_MESSAGE } from "@/lib/pdf/flatten";
import { DYNAMIC_XFA_REMOVE_MESSAGE } from "@/lib/pdf/remove-annotations";
import { chunkFiles, prerenderedPages } from "../../scripts/page-weight";
import {
  ROOT,
  SRC,
  ownPanelModules,
  rel,
  resolveSpecifier,
  runnerDispatcher,
  valueClosure,
  type PanelModule,
} from "@/tests/tool-panel-modules";
import {
  chunkText,
  isTestFile as isTest,
  markersOf,
  readCached as read,
  sourceFiles as sources,
  walkFiles as walk,
} from "@/tests/chunk-markers";

const NEXT_DIR = path.join(ROOT, ".next");
const APP_DIR = path.join(NEXT_DIR, "server", "app");
const CHUNKS_DIR = path.join(NEXT_DIR, "static", "chunks");

const MARKERS_PER_MODULE = 6;

interface Corpus {
  pages: { html: string; slug: string; own: PanelModule | null }[];
  modules: PanelModule[];
  markers: Map<string, string[]>;
}

let corpus: Corpus | undefined;
function getCorpus(): Corpus {
  if (corpus) return corpus;
  const { bySlug, modules } = ownPanelModules();
  const slugs = new Set(tools.map((t) => t.slug));
  const pages = prerenderedPages(NEXT_DIR)
    .filter((html) => /^tools\/[^/]+\.html$/.test(html))
    .map((html) => html.slice("tools/".length, -".html".length))
    .filter((slug) => slugs.has(slug))
    .map((slug) => ({
      html: `tools/${slug}.html`,
      slug,
      own: bySlug.get(slug) ?? null,
    }));

  const allSources = sources();
  const allChunks = walk(CHUNKS_DIR, (n) => n.endsWith(".js"));
  const markers = new Map<string, string[]>();
  // In no other source file — other panel modules and shared bases
  // included — and still carried by the client build (`markersOf`, moved to
  // `src/tests/chunk-markers.ts` on 2026-11-10 so variant-panels.test.ts
  // reads chunks with the same instrument).
  for (const mod of modules)
    markers.set(
      mod.file,
      markersOf(mod.file, allSources, allChunks, MARKERS_PER_MODULE),
    );
  corpus = { pages, modules, markers };
  return corpus;
}

/**
 * The panel modules a chunk file carries. All of a module's markers, or none:
 * a partial hit means a "marker" that something else also emits, and the
 * instrument — not the build — is wrong, so it throws. So does a module with
 * fewer than two markers, which every chunk would otherwise "carry" (`[]`
 * is all-present).
 */
const chunkCarries = new Map<string, string[]>();
function carriedBy(chunk: string): string[] {
  const hit = chunkCarries.get(chunk);
  if (hit) return hit;
  const { modules, markers } = getCorpus();
  const text = chunkText(chunk);
  const carried: string[] = [];
  for (const mod of modules) {
    const own = markers.get(mod.file)!;
    if (own.length < 2)
      throw new Error(
        `${rel(mod.file)} has ${own.length} marker(s) in the build — this reader cannot see it (see the positive control)`,
      );
    const present = own.filter((m) => text.includes(m));
    if (present.length === own.length) carried.push(mod.file);
    else if (present.length > 0)
      throw new Error(
        `${rel(chunk)} carries ${present.length} of ${own.length} markers of ${rel(mod.file)} — a marker is not unique to its module, so this reader cannot say what the chunk carries. Present: ${JSON.stringify(present)}; absent: ${JSON.stringify(own.filter((m) => !present.includes(m)))}`,
      );
  }
  chunkCarries.set(chunk, carried);
  return carried;
}

/** The panel modules a page loads up front, as repo-relative files. */
function carriedAtLoad(html: string): string[] {
  const files = new Set(chunkFiles(NEXT_DIR, html).flatMap(carriedBy));
  return [...files].map(rel).sort();
}

describe("a tool page's first load carries its own panel, and no other tool's", () => {
  const built = existsSync(APP_DIR);

  it("has a build to measure", () => {
    // Skipping when `.next` is absent would read green in exactly the case
    // where nothing was checked.
    expect(built, "no .next — run `pnpm build` first (CI does)").toBe(true);
  });

  it("health check: the pages are the catalogue, both ways", () => {
    if (!built) return;
    const { pages } = getCorpus();
    const prerendered = prerenderedPages(NEXT_DIR)
      .filter((html) => /^tools\/[^/]+\.html$/.test(html))
      .map((html) => html.slice("tools/".length, -".html".length))
      .sort();
    const catalogue = tools.map((t) => t.slug).sort();
    expect(prerendered, "tools/<slug>.html pages vs the catalogue").toEqual(
      catalogue,
    );
    expect(pages.map((p) => p.slug).sort()).toEqual(catalogue);
    // A plausibility bound, not a measurement: 50 tools on 2026-10-09.
    expect(pages.length).toBeGreaterThanOrEqual(40);
    expect(pages.length).toBeLessThanOrEqual(120);
    // Budget, not assertion (2026-10-30): up to 3.7 s on CI's slower 4-vCPU
    // runners in the Bundle budget step (12 logs, 10-24..10-30), against
    // vitest's 5-second default. The work is the same; the runner is not.
    // `src/tests/timeout-headroom.ts` names the next test past half its budget
    // on every CI run.
  }, 30_000);

  it("health check: the panel modules are every panel file, read off both dispatchers", () => {
    if (!built) return;
    const { modules, pages } = getCorpus();
    const runners = modules.filter((m) => m.dispatch === "runner");
    const workers = modules.filter((m) => m.dispatch === "worker");
    // 27 runner modules and 13 worker panels on 2026-10-09; floors so a
    // collapsed parse cannot pass, ceilings so a widened one cannot either.
    expect(runners.length).toBeGreaterThanOrEqual(20);
    expect(runners.length).toBeLessThanOrEqual(60);
    expect(workers.length).toBeGreaterThanOrEqual(10);
    expect(workers.length).toBeLessThanOrEqual(40);
    // Every module is some page's own panel (ownPanelModules throws on a dead
    // arm), and most pages own one (all 50 did on 2026-10-09).
    for (const mod of modules)
      expect(mod.slugs.length, rel(mod.file)).toBeGreaterThan(0);
    expect(pages.filter((p) => p.own).length).toBeGreaterThanOrEqual(40);

    // Cross-checked against the FILES, so a third dispatcher (or an arm shape
    // the reader skips) cannot drop a panel unseen. A `*-runner.tsx` that no
    // dispatcher mounts must be the dispatcher itself or a shared base some
    // mounted runner imports.
    const corpusFiles = new Set(modules.map((m) => m.file));
    const dispatcher = runnerDispatcher().file;
    const panelFiles = walk(path.join(SRC, "components", "tools"), (n) =>
      /-(worker-panel|runner)\.tsx$/.test(n),
    ).filter((f) => !isTest(path.basename(f)));
    const importedByCorpus = new Set(
      [...corpusFiles].flatMap((file) =>
        [...read(file).matchAll(/from\s+"([^"]+)"/g)]
          .map((m) => resolveSpecifier(file, m[1]!))
          .filter((f): f is string => f !== null),
      ),
    );
    // Since 2026-11-08 (batch plan P1) the settings batch's base,
    // `batch/settings-batch-runner.tsx`, is reached from five runners
    // through their `next/dynamic` loaders and a batch module each: two
    // hops, one of them an `import()`. It is reached by value from a mounted
    // panel, so it is not dead; the walk below says so for it alone.
    const loadedByCorpus = new Set(
      [...corpusFiles].flatMap((file) => valueClosure(file)),
    );
    const unseen = panelFiles.filter(
      (f) =>
        f !== dispatcher &&
        !corpusFiles.has(f) &&
        !importedByCorpus.has(f) &&
        !(path.basename(path.dirname(f)) === "batch" && loadedByCorpus.has(f)),
    );
    expect(
      unseen.map(rel),
      "panel files no dispatcher mounts and no mounted panel imports — the dispatch reader missed an arm, or the file is dead",
    ).toEqual([]);
    expect(panelFiles.length).toBeGreaterThanOrEqual(corpusFiles.size);
  });

  it("positive control: every panel module keeps markers that survive into the build", () => {
    if (!built) return;
    const { modules, markers } = getCorpus();
    // Two at least, so the all-or-nothing check in carriedBy() has teeth.
    const thin = modules
      .filter((m) => markers.get(m.file)!.length < 2)
      .map((m) => `${rel(m.file)} (${markers.get(m.file)!.length})`);
    expect(
      thin,
      "panel modules with fewer than 2 markers in the build — this reader cannot see them",
    ).toEqual([]);
  });

  it("positive control: every page's first load carries its own panel", () => {
    if (!built) return;
    // Also the health check of the whole reader: chunk list → files → markers.
    // A page whose own panel is not found is either a page that lost it (the
    // panel would hydrate late, from a request nothing preloaded) or a reader
    // gone blind; both must be red.
    const missing = getCorpus()
      .pages.filter((p) => p.own)
      .filter((p) => !carriedAtLoad(p.html).includes(rel(p.own!.file)))
      .map((p) => `${p.html}: ${rel(p.own!.file)}`);
    expect(
      missing,
      "tool pages whose own panel is not in their first load",
    ).toEqual([]);
  });

  it("no tool page's first load carries another tool's panel", () => {
    if (!built) return;
    const foreign: Record<string, string[]> = {};
    for (const page of getCorpus().pages) {
      const own = page.own ? rel(page.own.file) : null;
      const extra = carriedAtLoad(page.html).filter((f) => f !== own);
      if (extra.length > 0) foreign[page.html] = extra;
    }
    expect(
      foreign,
      "tool pages loading OTHER tools' panels up front — a panel module is reachable through a static import from the route (the dispatcher, the page, or a module they share)",
    ).toEqual({});
  });

  it("pages that are not tool pages load no panel at all", () => {
    if (!built) return;
    const isTool = new Set(getCorpus().pages.map((p) => p.html));
    const carrying: Record<string, string[]> = {};
    for (const html of prerenderedPages(NEXT_DIR)) {
      if (isTool.has(html)) continue;
      const carried = carriedAtLoad(html);
      if (carried.length > 0) carrying[html] = carried;
    }
    expect(carrying, "non-tool pages loading a tool panel up front").toEqual(
      {},
    );
  });

  /*
   * Splitting a panel off must not move it out of the server HTML. Two reads
   * of the HTML a crawler, or a reader before hydration, receives.
   */
  it("no tool page bails its panel out of the server render", () => {
    if (!built) return;
    // `next/dynamic` with `ssr: false` (or a loader that throws while the page
    // is prerendered) leaves Next's bailout template, and React marks a
    // boundary it gave up on with `<!--$!-->`; the slot is then empty until
    // the chunk arrives.
    const bailed = getCorpus()
      .pages.filter((p) => {
        const html = read(path.join(APP_DIR, p.html));
        return (
          html.includes("BAILOUT_TO_CLIENT_SIDE_RENDERING") ||
          html.includes("<!--$!-->")
        );
      })
      .map((p) => p.html);
    expect(bailed, "tool pages whose panel is client-rendered only").toEqual(
      [],
    );
  });

  it("every runner page server-renders its file input (the pre-hydration upload path)", () => {
    if (!built) return;
    // A file picked before hydration is adopted from the server-rendered
    // `<input type="file">` (e2e/pre-hydration-upload.spec.ts proves it on
    // one page); a runner that stopped rendering on the server would take
    // that input with it. Worker panels open on a capability check and render
    // no input until the worker answers, so they are not in this set.
    const runnerPages = getCorpus().pages.filter(
      (p) => p.own?.dispatch === "runner",
    );
    expect(runnerPages.length).toBeGreaterThanOrEqual(20);
    const without = runnerPages
      .filter((p) => !read(path.join(APP_DIR, p.html)).includes('type="file"'))
      .map((p) => p.html);
    expect(without, "runner pages with no server-rendered file input").toEqual(
      [],
    );
  });
});

/*
 * A shared LEAF rides only with the code that uses it (review round 1,
 * 2026-11-10). webpack keeps a module's exports per MODULE, not per page:
 * a constant table added to a leaf that other pages load first ships on all
 * of them. Two did. Remove Annotations' kind labels went into
 * offered-kinds.ts (in the first load of sign, annotate, edit, create-forms,
 * grayscale, split and compress, +156 to +170 B gzip each), and Overlay
 * imported its two flags from the module holding the XFA reader
 * (overlay-pdf and n-up-pdf, +293 B each). The panel-marker test above
 * could not see either: neither leaf is a panel. The rule below is a
 * relationship, not a page list: a leaf's marker may appear only in a first
 * load that also carries code which USES the leaf.
 */
describe("a shared leaf rides only with the code that uses it", () => {
  const built = existsSync(APP_DIR);
  const RIDES = [
    {
      leaf: "annotation-kinds.ts (Remove Annotations' kind labels)",
      marker: ANNOTATION_GROUP_LABEL["redaction-marks"],
      // annotation-groups.ts's own sentence: the table that uses the labels.
      users: [annotationGroup("redaction-marks").consequence],
    },
    {
      leaf: "annot-flags.ts (the XFA reader)",
      marker: "NeedsRendering",
      users: [DYNAMIC_XFA_MESSAGE, DYNAMIC_XFA_REMOVE_MESSAGE],
    },
  ];
  const loads = () =>
    prerenderedPages(NEXT_DIR).map((html) => ({
      html,
      text: chunkFiles(NEXT_DIR, html).map(read).join("\n"),
    }));

  /*
   * WAS "in some first load" until 2026-11-10. Then Remove Annotations'
   * editor became a lazy chunk (`runner/lazy-panel.tsx`) and its kind labels
   * left every first load, which is the point; the control was asking where
   * the leaf ships, when what it must prove is that this reader SEES the
   * marker in shipped bytes at all. It now looks in every built chunk, first
   * load or lazy, so a marker the minifier rewrote still turns it red.
   */
  it("positive control: each leaf's marker and a user's marker are in the built chunks", () => {
    if (!built) return;
    expect(loads().length).toBeGreaterThan(50);
    const chunks = walk(CHUNKS_DIR, (n) => n.endsWith(".js")).map(chunkText);
    for (const ride of RIDES) {
      expect(
        chunks.some((c) => c.includes(ride.marker)),
        ride.leaf,
      ).toBe(true);
      expect(
        chunks.some((c) => ride.users.some((u) => c.includes(u))),
        ride.leaf,
      ).toBe(true);
    }
  });

  it("no first load carries a leaf without code that uses it", () => {
    if (!built) return;
    const all = loads();
    const stray = RIDES.flatMap((ride) =>
      all
        .filter(
          (p) =>
            p.text.includes(ride.marker) &&
            !ride.users.some((u) => p.text.includes(u)),
        )
        .map((p) => `${p.html}: ${ride.leaf}`),
    );
    expect(stray).toEqual([]);
  });
});
