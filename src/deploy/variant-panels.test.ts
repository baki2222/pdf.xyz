// @vitest-environment node
/**
 * A runner kind that several tools share picks each page's editor by the
 * page's slug (`if (slug === "booklet-pdf") return <BookletRunner />`). The
 * PROPERTY: a page on such a kind loads its OWN variant's editor and no
 * sibling's — read from the chunks the built page references, i.e. what a
 * browser downloads, not from how the imports are written.
 *
 * THE DEFECT THIS WAS WRITTEN AGAINST, measured on the build of main
 * 7d5f43dc (2026-11-10): Multiple Pages per Sheet's first load carried
 * Booklet's editor and engine (+3.1 KB gz when #307 landed) and Booklet's
 * carried Multiple Pages per Sheet's; Edit PDF Metadata's carried Remove
 * Annotations' panel (+3.6 KB when #308 landed) and both the other metadata
 * pages carried Edit PDF Metadata's editor and its engine. Every variant was
 * a static import of the kind's runner module, and the per-page guard
 * (`own-panel-first-load.test.ts`) could not see it: there the RUNNER
 * MODULE is the page's own panel, and all of it is legitimately in the
 * first load. Fixed by `lazyPanel` (`runner/lazy-panel.tsx`): each editor is
 * its own chunk, fetched beside the file's parse.
 *
 * THE CORPUS IS DERIVED (CLAUDE.md rule 4):
 *  - the slugs: every registry slug whose runner kind another slug shares;
 *  - the runner module: the one the page's dispatcher mounts for the kind
 *    (`ownPanelModules`, the same reader the per-page guard uses);
 *  - the variants, their HOSTS, EDITORS and own modules: read off that
 *    module by `src/tests/shared-kind-variants.ts` (its docblock has the
 *    rules and what is FATAL). In short: each `if (<slug> === "<slug>")`
 *    arm and the default after them, each read from the code of its OWN
 *    branch — never from the module its first JSX tag resolves to (as first
 *    written: an inline arm then resolved to `single-pdf-runner.tsx`, whose
 *    unrelated `import()` passed for Booklet's editor while the real one,
 *    imported statically, rode in Multiple Pages per Sheet's first load and
 *    this file's main assertion stayed green — review of 6376d6da). A
 *    variant's own modules are what its branch reaches and no sibling's
 *    does; its host (the drop box an arm returns as one element) is the one
 *    of them allowed in a sibling's first load;
 *  - then, from the build: an own module that some tool page OUTSIDE the
 *    kind loads up front is shared code and dropped — never an editor. The
 *    editors are NEVER subtracted: a static import of one is the defect,
 *    and subtracting it would let the defect certify itself.

 * Which module a chunk carries is decided by markers (`src/tests/chunk-
 * markers.ts`, the per-page guard's instrument): all of a module's markers
 * or none, a partial hit FATAL. An editor with fewer than two markers is
 * FATAL; a closure module with fewer than two is not checkable and is
 * counted, not asserted.
 *
 * Runs under `pnpm test:bundle` (it needs `.next`), never `pnpm test`.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getRunnerKind, supportedToolSlugs } from "@/lib/pdf/registry";
import { ROOT, ownPanelModules, rel } from "@/tests/tool-panel-modules";
import { readVariants } from "@/tests/shared-kind-variants";
import {
  markersOf,
  chunkText,
  sourceFiles,
  walkFiles,
} from "@/tests/chunk-markers";
import { chunkFiles, prerenderedPages } from "../../scripts/page-weight";

const NEXT_DIR = path.join(ROOT, ".next");
const APP_DIR = path.join(NEXT_DIR, "server", "app");
const CHUNKS_DIR = path.join(NEXT_DIR, "static", "chunks");
const MARKERS_PER_MODULE = 6;

interface Variant {
  kind: string;
  /** The drop box its arm returns, allowed in a sibling's first load. */
  host: string | null;
  slugs: string[];
  /** The editors it loads with `import()`. */
  editors: string[];
  /** The modules only this variant reaches, editors included, host not. */
  modules: string[];
}

/** The slugs of every kind that two or more registry slugs share. */
function sharedKinds(): Map<string, string[]> {
  const byKind = new Map<string, string[]>();
  for (const slug of supportedToolSlugs) {
    const kind = getRunnerKind(slug)!;
    byKind.set(kind, [...(byKind.get(kind) ?? []), slug]);
  }
  return new Map([...byKind].filter(([, slugs]) => slugs.length > 1));
}

interface Corpus {
  shared: Map<string, string[]>;
  variants: Variant[];
  markers: Map<string, string[]>;
}

let corpus: Corpus | undefined;
function getCorpus(): Corpus {
  if (corpus) return corpus;
  const shared = sharedKinds();
  const { bySlug } = ownPanelModules();
  const variants: Variant[] = [];
  for (const [kind, slugs] of shared) {
    const runners = [...new Set(slugs.map((s) => bySlug.get(s)?.file))];
    const runner = runners[0];
    if (runners.length !== 1 || !runner)
      throw new Error(
        `the "${kind}" kind's slugs mount ${runners.length} runner modules; expected one`,
      );
    variants.push(
      ...readVariants(kind, slugs, runner).map(
        ({ slugs: own, host, editors, modules }) => ({
          kind,
          host,
          slugs: own,
          editors,
          modules,
        }),
      ),
    );
  }
  const allSources = sourceFiles();
  const allChunks = walkFiles(CHUNKS_DIR, (n) => n.endsWith(".js"));
  const markers = new Map<string, string[]>();
  for (const v of variants)
    for (const m of v.modules)
      if (!markers.has(m))
        markers.set(m, markersOf(m, allSources, allChunks, MARKERS_PER_MODULE));
  // A module some tool page OUTSIDE the kind loads up front is shared code
  // (the shell, the site), so a sibling page loading it says nothing about
  // this variant: dropped. Never an editor. NOT "a module the variant's own
  // page loads", as first written: the kind's runner is in every one of its
  // pages, so a variant's engine imported statically by the runner — the
  // defect itself — is in the own page too, and that rule dropped it (a
  // namespace import of booklet.ts in n-up-runner.tsx stayed green under
  // it, 2026-11-10).
  const runnerPages = prerenderedPages(NEXT_DIR).flatMap((html) => {
    const slug = /^tools\/([^/]+)\.html$/.exec(html)?.[1];
    const kind = slug === undefined ? undefined : getRunnerKind(slug);
    return kind === undefined
      ? []
      : [{ kind, text: chunkFiles(NEXT_DIR, html).map(chunkText).join("\n") }];
  });
  for (const v of variants) {
    const loads = runnerPages
      .filter((p) => p.kind !== v.kind)
      .map((p) => p.text);
    if (loads.length < 20)
      throw new Error(
        `only ${loads.length} runner pages outside "${v.kind}" to tell shared code by — implausibly few`,
      );
    v.modules = v.modules.filter((m) => {
      if (v.editors.includes(m)) return true;
      const found = markers.get(m)!;
      return !(
        found.length >= 2 &&
        loads.some((text) => found.every((t) => text.includes(t)))
      );
    });
  }
  corpus = { shared, variants, markers };
  return corpus;
}

/** Kinds with two or more variants, each variant with its siblings. */
function multiVariant(): Variant[] {
  const { variants } = getCorpus();
  return variants.filter(
    (v) => variants.filter((w) => w.kind === v.kind).length > 1,
  );
}

/** Whether `text` carries `file`'s code: all its markers, none, or FATAL. */
function carries(text: string, file: string, site: string): boolean {
  const own = getCorpus().markers.get(file)!;
  const present = own.filter((m) => text.includes(m));
  if (present.length > 0 && present.length < own.length)
    throw new Error(
      `${site} carries ${present.length} of ${own.length} markers of ${rel(file)} — a marker is not unique to its module. Present: ${JSON.stringify(present)}`,
    );
  return own.length >= 2 && present.length === own.length;
}

const firstLoad = new Map<string, string[]>();
function firstLoadOf(slug: string): string[] {
  let files = firstLoad.get(slug);
  if (!files) {
    files = chunkFiles(NEXT_DIR, `tools/${slug}.html`);
    firstLoad.set(slug, files);
  }
  return files;
}

describe("a page on a shared runner kind loads its own editor, and no sibling's", () => {
  const built = existsSync(APP_DIR);

  it("has a build to measure", () => {
    expect(built, "no .next — run `pnpm build` first (CI does)").toBe(true);
  });

  it("health check: the shared-kind slugs and their variants", () => {
    if (!built) return;
    const { shared, variants } = getCorpus();
    const slugs = [...shared.values()].flat();
    // 9 slugs on 4 kinds on 2026-11-10 (image-to-pdf, pdf-to-image: one
    // panel each; metadata: 3 variants; n-up: 2). Floors so a collapsed
    // registry read cannot pass, ceilings so a widened one cannot either.
    expect(slugs.length).toBeGreaterThanOrEqual(6);
    expect(slugs.length).toBeLessThanOrEqual(40);
    // Every slug is in exactly one variant, both ways.
    expect(variants.flatMap((v) => v.slugs).sort()).toEqual([...slugs].sort());
    const multi = multiVariant();
    expect(new Set(multi.map((v) => v.kind)).size).toBeGreaterThanOrEqual(2);
    expect(multi.length).toBeGreaterThanOrEqual(5);
    // Every shared slug has a page to measure.
    const pages = new Set(prerenderedPages(NEXT_DIR));
    expect(slugs.filter((s) => !pages.has(`tools/${s}.html`))).toEqual([]);
  }, 30_000);

  it("positive control: every editor keeps two or more markers, all in a chunk its own page does not load up front", () => {
    if (!built) return;
    const { markers } = getCorpus();
    const allChunks = walkFiles(CHUNKS_DIR, (n) => n.endsWith(".js"));
    const problems: string[] = [];
    for (const v of multiVariant()) {
      const own = new Set(v.slugs.flatMap(firstLoadOf));
      for (const editor of v.editors) {
        const found = markers.get(editor)!;
        if (found.length < 2) {
          problems.push(`${rel(editor)}: ${found.length} marker(s)`);
          continue;
        }
        const lazy = allChunks.filter(
          (c) => !own.has(c) && carries(chunkText(c), editor, rel(c)),
        );
        if (lazy.length === 0)
          problems.push(`${rel(editor)}: in no lazy chunk`);
      }
    }
    expect(
      problems,
      "editors this reader cannot see, or that are not lazy on their own page",
    ).toEqual([]);
    // How much of the closure is checkable: reported, and bounded below so
    // a marker reader gone blind cannot pass on the editors alone.
    const checkable = multiVariant()
      .flatMap((v) => v.modules)
      .filter((m) => markers.get(m)!.length >= 2);
    expect(checkable.length).toBeGreaterThanOrEqual(
      multiVariant().flatMap((v) => v.editors).length,
    );
  });

  it("no page's first load carries a sibling variant's editor or engine", () => {
    if (!built) return;
    const multi = multiVariant();
    const found: Record<string, string[]> = {};
    for (const v of multi) {
      const siblings = multi.filter((w) => w.kind === v.kind && w !== v);
      for (const slug of v.slugs) {
        const files = firstLoadOf(slug);
        const text = files.map(chunkText).join("\n");
        const carried = siblings
          .flatMap((w) => w.modules)
          .filter((m) => carries(text, m, `tools/${slug}.html`))
          .map(rel);
        if (carried.length > 0) found[`tools/${slug}.html`] = carried;
      }
    }
    expect(
      found,
      "shared-kind pages loading a SIBLING tool's editor up front — a static import of a variant's editor (or of a module only it uses) from the kind's runner or a module it shares",
    ).toEqual({});
  });
});
