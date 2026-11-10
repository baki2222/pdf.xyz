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
 *  - the variants: read off that module — the variable it binds to
 *    `useToolRun()?.slug`, each `if (<it> === "<slug>")` arm and the
 *    component the arm returns (followed to its module), plus the default
 *    for the slugs no arm names. A comparison this cannot read, an arm for
 *    a slug not on the kind, or two arms for one slug is FATAL;
 *  - a variant's editor: the `import()` targets under `src/components` of
 *    its host module (the arm's module, or the runner itself for the
 *    default). On a kind with two or more variants, a variant with no lazy
 *    editor is FATAL: its editor is static in a module every sibling loads.
 *  - a variant's modules: its editors, plus every module their value
 *    closure reaches that no sibling's closure reaches and that the
 *    variant's OWN page does not load up front, read from its bytes (the
 *    engines — booklet.ts, metadata.ts — that rode along with the editors).
 *    The editors themselves are NEVER subtracted: a static import of one is
 *    the defect, and subtracting it would let the defect certify itself.
 *
 * Which module a chunk carries is decided by markers (`src/tests/chunk-
 * markers.ts`, the per-page guard's instrument): all of a module's markers
 * or none, a partial hit FATAL. An editor with fewer than two markers is
 * FATAL; a closure module with fewer than two is not checkable and is
 * counted, not asserted.
 *
 * Runs under `pnpm test:bundle` (it needs `.next`), never `pnpm test`.
 */
import ts from "typescript";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getRunnerKind, supportedToolSlugs } from "@/lib/pdf/registry";
import {
  ROOT,
  SRC,
  ownPanelModules,
  parsedSource,
  rel,
  resolveComponent,
  resolveSpecifier,
  valueClosure,
} from "@/tests/tool-panel-modules";
import {
  isTestFile,
  markersOf,
  chunkText,
  sourceFiles,
  walkFiles,
} from "@/tests/chunk-markers";
import { chunkFiles, prerenderedPages } from "../../scripts/page-weight";

const NEXT_DIR = path.join(ROOT, ".next");
const APP_DIR = path.join(NEXT_DIR, "server", "app");
const CHUNKS_DIR = path.join(NEXT_DIR, "static", "chunks");
const COMPONENTS = path.join(SRC, "components") + path.sep;
const MARKERS_PER_MODULE = 6;

interface Variant {
  kind: string;
  /** The module that draws this variant's drop box. */
  host: string;
  slugs: string[];
  /** The editors it loads with `import()`. */
  editors: string[];
  /** Editors plus the modules only this variant reaches (see the docblock). */
  modules: string[];
}

const where = (sf: ts.SourceFile, node: ts.Node): string =>
  `${rel(sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;

/** The slugs of every kind that two or more registry slugs share. */
function sharedKinds(): Map<string, string[]> {
  const byKind = new Map<string, string[]>();
  for (const slug of supportedToolSlugs) {
    const kind = getRunnerKind(slug)!;
    byKind.set(kind, [...(byKind.get(kind) ?? []), slug]);
  }
  return new Map([...byKind].filter(([, slugs]) => slugs.length > 1));
}

/** `import("…")` targets of `file` that are components (not engines). */
function lazyEditors(file: string): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0])
    ) {
      const target = resolveSpecifier(file, n.arguments[0].text);
      if (target?.startsWith(COMPONENTS)) out.push(target);
    }
    ts.forEachChild(n, visit);
  };
  visit(parsedSource(file));
  return [...new Set(out)];
}

/** The variants of one shared kind, read off its runner module. */
function variantsOf(kind: string, slugs: string[], runner: string): Variant[] {
  const sf = parsedSource(runner);
  const slugVars = new Set<string>();
  const findVar = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isPropertyAccessExpression(n.initializer) &&
      n.initializer.name.text === "slug" &&
      ts.isCallExpression(n.initializer.expression) &&
      n.initializer.expression.expression.getText(sf) === "useToolRun"
    )
      slugVars.add(n.name.text);
    ts.forEachChild(n, findVar);
  };
  findVar(sf);
  if (slugVars.size > 1)
    throw new Error(
      `${rel(runner)} reads the page's slug ${slugVars.size} times`,
    );
  const arms = new Map<string, string>();
  if (slugVars.size === 1) {
    const [slugVar] = slugVars;
    const visit = (n: ts.Node): void => {
      if (
        ts.isBinaryExpression(n) &&
        [n.left, n.right].some(
          (s) => ts.isIdentifier(s) && s.text === slugVar,
        ) &&
        n.operatorToken.kind !== ts.SyntaxKind.EqualsToken
      ) {
        const other =
          ts.isIdentifier(n.left) && n.left.text === slugVar ? n.right : n.left;
        const ifStmt = n.parent;
        if (
          n.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken ||
          !ts.isStringLiteral(other) ||
          !ts.isIfStatement(ifStmt) ||
          ifStmt.expression !== n
        )
          throw new Error(
            `${where(sf, n)}: a comparison with the page's slug this reader cannot follow — write it \`if (${slugVar} === "<slug>") return <Runner />\``,
          );
        const slug = other.text;
        if (!slugs.includes(slug))
          throw new Error(
            `${where(sf, n)}: an arm for "${slug}", which is not on the "${kind}" kind`,
          );
        if (arms.has(slug))
          throw new Error(`${where(sf, n)}: a second arm for "${slug}"`);
        let tag: string | null = null;
        const findTag = (m: ts.Node): void => {
          if (tag) return;
          if (
            (ts.isJsxSelfClosingElement(m) || ts.isJsxOpeningElement(m)) &&
            /^[A-Z]/.test(m.tagName.getText(sf))
          ) {
            tag = m.tagName.getText(sf);
            return;
          }
          ts.forEachChild(m, findTag);
        };
        findTag(ifStmt.thenStatement);
        if (!tag)
          throw new Error(
            `${where(sf, n)}: the arm for "${slug}" returns no component`,
          );
        arms.set(slug, resolveComponent(runner, tag).file);
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  const variants: Variant[] = [...arms].map(([slug, host]) => ({
    kind,
    host,
    slugs: [slug],
    editors: lazyEditors(host),
    modules: [],
  }));
  const rest = slugs.filter((s) => !arms.has(s));
  if (rest.length > 0)
    variants.push({
      kind,
      host: runner,
      slugs: rest,
      editors: lazyEditors(runner),
      modules: [],
    });
  if (variants.length < 2) return variants;
  for (const v of variants)
    if (v.editors.length === 0)
      throw new Error(
        `${rel(v.host)} draws ${v.slugs.join(", ")} with no lazily loaded editor — on a kind its siblings share, a static editor is in every sibling's first load`,
      );
  // A variant's modules: its editors, and what only its editors reach. What
  // the page loads up front anyway is dropped later, by BYTES (getCorpus):
  // as first written this subtracted the route's static import closure, and
  // that closure is mostly SERVER modules — the page's copy imports
  // booklet.ts and metadata.ts for their labels — so both engines left the
  // corpus while neither ships to the browser except with its editor
  // (measured 2026-11-10: booklet-pdf's modules were its editor alone).
  const closures = variants.map(
    (v) => new Set(v.editors.flatMap((e) => valueClosure(e))),
  );
  variants.forEach((v, i) => {
    const others = new Set(
      closures.filter((_, j) => j !== i).flatMap((c) => [...c]),
    );
    v.modules = [
      ...new Set([
        ...v.editors,
        ...[...closures[i]!].filter(
          (m) => !others.has(m) && !isTestFile(m) && m !== runner,
        ),
      ]),
    ];
  });
  return variants;
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
    variants.push(...variantsOf(kind, slugs, runner));
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
