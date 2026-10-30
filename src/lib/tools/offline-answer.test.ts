// @vitest-environment node
/**
 * "Does X work offline?" — answered from the fetches each tool's runner can
 * actually make, with every fetch site DISCOVERED rather than named.
 *
 * ── HISTORY ─────────────────────────────────────────────────────────────────
 *
 *  1. Every in-browser page (FAQPage JSON-LD) and six guides said "a dropped
 *     connection does not interrupt work in progress". False for Text to PDF on
 *     a Bengali file: `embedDrawingFont` fetches a Noto face mid-run.
 *  2. The fix added "One exception: drawing text in a script outside the
 *     Western European alphabet fetches a matching font…", and a guard that
 *     discovered `embedDrawingFont` callers and nothing else. "One exception"
 *     is an exclusivity claim, and it was false too: every pdfjs `getDocument`
 *     spreads `PDFJS_DOCUMENT_DEFAULTS`, so pdfjs fetches its JPEG 2000 / JBIG2
 *     decoders and CJK character maps from our origin mid-render
 *     (`src/lib/pdf/wasm-assets.ts`). The guard certified the exclusivity over
 *     a corpus missing half its members — the right predicate over the wrong
 *     set (house rule 4).
 *
 * ── WHAT THIS CHECKS ────────────────────────────────────────────────────────
 *
 *  - Fetch sites are discovered: every `fetch(` call and every
 *    `*.getDocument(` call in any declaration a runner reaches. Each is
 *    classified by what it fetches; a reached site nobody classified is FATAL,
 *    so the next fetch cannot sit outside the answer the way pdfjs did.
 *  - Reachability is a REFERENCE graph at declaration granularity, rooted at
 *    the component the dispatcher renders for the runner kind. Loading a module
 *    adds nothing; only a declaration that a reached declaration names does.
 *    `import type` edges are erased and not followed.
 *  - The served offline answer (the page's FAQPage JSON-LD) and every in-browser
 *    guide that talks about working offline must name EXACTLY the fetch
 *    classes their runner reaches — missing one is the defect above, naming
 *    one the runner cannot reach is a false claim in the other direction.
 *  - The exclusivity/no-interruption wording is banned, with the shipped
 *    sentences as the corpus in both directions (house rule 1).
 *
 * ── WHAT IT CANNOT CATCH ────────────────────────────────────────────────────
 *
 *  - A reference is not a call. A function that is named and never invoked
 *    counts as reached (over-approximation), as does a nested closure that is
 *    built and never run. Identifiers are resolved by name within a file, so a
 *    local variable shadowing a top-level declaration adds a false edge.
 *  - Lazily loaded JS chunks (`import()` of pdf-lib, jszip, fontkit) are also
 *    network fetches. They are not document-dependent in the same way and are
 *    covered by ENGINE_ARRIVES_FACT ("parts of the engine are fetched the
 *    first time a step needs them"), which this file does not re-derive.
 *  - A `getDocument` is classified by what ITS declaration does with the
 *    document. One that opened a document and handed it to another
 *    declaration to render would be under-classified — so a document that
 *    leaves its declaration without being evaluated there is UNCLASSIFIED,
 *    which is fatal below, not a quiet empty set.
 *
 * ── AMENDED 2026-09-27, at the merge with L12 ───────────────────────────────
 *
 *  This classified every `getDocument` that spreads PDFJS_DOCUMENT_DEFAULTS as
 *  a character-map fetch "on any parse". L12 (c27ec09) added
 *  `classifyPdfAccess`, which opens a document only to read its metadata and
 *  is reached from every single-PDF runner — and 13 pages were then told they
 *  fetch a character map mid-run. They do not: pdf.js fetches a CMap in its
 *  PartialEvaluator, when a FONT is loaded, which happens only when page
 *  content is evaluated (a render, an operator list, text content, a save
 *  that regenerates appearances). Reading /Info and XMP loads no font. So the
 *  class now needs the property that causes the fetch, as image-decoder
 *  already needed a render.
 */
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { getRunnerKind } from "@/lib/pdf/registry";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";
import { guides } from "@/lib/guides/catalog";
import type { Guide } from "@/lib/guides/types";
import {
  MID_RUN_FETCH_SENTENCE,
  midRunFetches,
  type MidRunFetch,
} from "./tool-facts";
import {
  renderToolPages,
  type RenderedToolPage,
} from "@/tests/rendered-tool-pages";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const RUNNER_DIR = join(SRC, "components", "tools", "runner");
const DISPATCHER = join(RUNNER_DIR, "tool-runner.tsx");

const CLASSES = Object.keys(MID_RUN_FETCH_SENTENCE) as MidRunFetch[];

/* ------------------------------------------------------------------ *
 *  Declaration-level reference graph
 * ------------------------------------------------------------------ */

type NodeId = string; // `${file}#${declaration name}`

interface Binding {
  readonly file: string;
  readonly name: string;
}

interface Mod {
  readonly decls: Map<string, TS.Node>;
  /** Local name → where it comes from. VALUE imports only. */
  readonly imports: Map<string, Binding>;
  readonly reExports: Map<string, Binding>;
  readonly stars: string[];
}

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // a package, not our tree
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not this shape; try the next
    }
  }
  return null;
}

const mods = new Map<string, Mod>();

function mod(file: string): Mod {
  const hit = mods.get(file);
  if (hit) return hit;
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const m: Mod = {
    decls: new Map(),
    imports: new Map(),
    reExports: new Map(),
    stars: [],
  };
  mods.set(file, m);
  for (const st of sf.statements) {
    if (
      (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) &&
      st.name
    ) {
      m.decls.set(st.name.text, st);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name)) m.decls.set(d.name.text, d);
    } else if (
      ts.isImportDeclaration(st) &&
      ts.isStringLiteral(st.moduleSpecifier)
    ) {
      const clause = st.importClause;
      // `isTypeOnly` on the node, never the keyword in the text: an
      // `import type` edge is erased at runtime and must not add reach.
      if (!clause || clause.isTypeOnly) continue;
      const target = resolveImport(file, st.moduleSpecifier.text);
      if (!target) continue;
      if (clause.name)
        m.imports.set(clause.name.text, { file: target, name: "default" });
      const nb = clause.namedBindings;
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          if (el.isTypeOnly) continue;
          m.imports.set(el.name.text, {
            file: target,
            name: (el.propertyName ?? el.name).text,
          });
        }
      } else if (nb && ts.isNamespaceImport(nb)) {
        m.imports.set(nb.name.text, { file: target, name: "*" });
      }
    } else if (
      ts.isExportDeclaration(st) &&
      !st.isTypeOnly &&
      st.moduleSpecifier &&
      ts.isStringLiteral(st.moduleSpecifier)
    ) {
      const target = resolveImport(file, st.moduleSpecifier.text);
      if (!target) continue;
      if (!st.exportClause) m.stars.push(target);
      else if (ts.isNamedExports(st.exportClause))
        for (const el of st.exportClause.elements)
          if (!el.isTypeOnly)
            m.reExports.set(el.name.text, {
              file: target,
              name: (el.propertyName ?? el.name).text,
            });
    }
  }
  return m;
}

function isExported(node: TS.Node): boolean {
  const st = ts.isVariableDeclaration(node) ? node.parent.parent : node;
  return (
    ts.canHaveModifiers(st) &&
    (ts.getModifiers(st) ?? []).some(
      (x) => x.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

function exportedNames(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const m = mod(file);
  const out = new Set<string>(m.reExports.keys());
  for (const [name, node] of m.decls) if (isExported(node)) out.add(name);
  for (const s of m.stars) for (const n of exportedNames(s, seen)) out.add(n);
  return out;
}

/** A name exported by `file`, followed through imports and re-exports. */
function resolveExport(
  file: string,
  name: string,
  seen = new Set<string>(),
): NodeId[] {
  const key = `${file}#${name}`;
  if (seen.has(key)) return [];
  seen.add(key);
  const m = mod(file);
  if (name === "*")
    return [...exportedNames(file)].flatMap((n) =>
      resolveExport(file, n, seen),
    );
  if (m.decls.has(name)) return [key];
  const imp = m.imports.get(name) ?? m.reExports.get(name);
  if (imp) return resolveExport(imp.file, imp.name, seen);
  return m.stars.flatMap((s) => resolveExport(s, name, seen));
}

const split = (id: NodeId): [string, string] => {
  const i = id.lastIndexOf("#");
  return [id.slice(0, i), id.slice(i + 1)];
};

const declOf = (id: NodeId): TS.Node | undefined => {
  const [file, name] = split(id);
  return mod(file).decls.get(name);
};

/** `const { a } = await import(x)` and `import(x).then(({ a }) => …)`. */
function destructuredNames(call: TS.CallExpression): string[] | null {
  const names = (p: TS.ObjectBindingPattern) =>
    p.elements.map((e) => ((e.propertyName ?? e.name) as TS.Identifier).text);
  const p = call.parent;
  if (ts.isAwaitExpression(p)) {
    const d = p.parent;
    return ts.isVariableDeclaration(d) && ts.isObjectBindingPattern(d.name)
      ? names(d.name)
      : null;
  }
  if (
    ts.isPropertyAccessExpression(p) &&
    p.name.text === "then" &&
    ts.isCallExpression(p.parent)
  ) {
    const cb = p.parent.arguments[0];
    const param =
      cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))
        ? cb.parameters[0]
        : undefined;
    return param && ts.isObjectBindingPattern(param.name)
      ? names(param.name)
      : null;
  }
  return null;
}

/** Every declaration the body of `id` names, and every dynamic import it makes. */
function edges(id: NodeId): NodeId[] {
  const [file, self] = split(id);
  const m = mod(file);
  const node = m.decls.get(self);
  if (!node) return [];
  const out: NodeId[] = [];
  const visit = (n: TS.Node): void => {
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const arg = n.arguments[0];
      const target =
        arg && ts.isStringLiteral(arg) ? resolveImport(file, arg.text) : null;
      if (target) {
        // A dynamic import that is not destructured may use any export.
        const wanted = destructuredNames(n) ?? [...exportedNames(target)];
        for (const w of wanted) out.push(...resolveExport(target, w));
      }
    }
    if (ts.isIdentifier(n) && n.text !== self) {
      const p = n.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(p) && p.name === n) ||
        (ts.isPropertyAssignment(p) && p.name === n) ||
        (ts.isJsxAttribute(p) && p.name === n) ||
        (ts.isBindingElement(p) && p.propertyName === n);
      if (!isPropertyName) {
        if (m.decls.has(n.text)) out.push(`${file}#${n.text}`);
        else {
          const imp = m.imports.get(n.text);
          if (imp) out.push(...resolveExport(imp.file, imp.name));
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

function reach(root: NodeId): Set<NodeId> {
  const seen = new Set<NodeId>([root]);
  const queue = [root];
  while (queue.length) {
    for (const e of edges(queue.shift()!))
      if (!seen.has(e)) {
        seen.add(e);
        queue.push(e);
      }
  }
  return seen;
}

/* ------------------------------------------------------------------ *
 *  Fetch sites — discovered and classified
 * ------------------------------------------------------------------ */

interface Site {
  readonly id: NodeId;
  readonly text: string;
  /** What this site fetches mid-run; empty when it fetches nothing. */
  readonly classes: readonly MidRunFetch[];
  /** False = a fetch nobody has classified. Fatal when reached. */
  readonly classified: boolean;
}

/**
 * The pdf.js calls that evaluate page content — the only path by which pdf.js
 * loads a font (and so a CMap) or decodes an image. Page methods and the
 * document's save, which regenerates annotation appearances.
 */
const EVALUATES_CONTENT = new Set([
  "render",
  "getOperatorList",
  "getTextContent",
  "streamTextContent",
  "saveDocument",
]);

/**
 * Whether a document loaded in `node` (`const x = await <task>.promise`) is
 * handed out of it — returned, passed to a call, or put in an object — so
 * that some OTHER declaration could evaluate it.
 */
function documentLeaves(node: TS.Node): boolean {
  const loaded = new Set<string>();
  const findLoaded = (n: TS.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isAwaitExpression(n.initializer) &&
      ts.isPropertyAccessExpression(n.initializer.expression) &&
      n.initializer.expression.name.text === "promise"
    )
      loaded.add(n.name.text);
    ts.forEachChild(n, findLoaded);
  };
  findLoaded(node);
  let leaves = false;
  const isLoaded = (e: TS.Node | undefined) =>
    !!e && ts.isIdentifier(e) && loaded.has(e.text);
  const visit = (n: TS.Node): void => {
    if (ts.isReturnStatement(n) && isLoaded(n.expression)) leaves = true;
    if (ts.isCallExpression(n) && n.arguments.some(isLoaded)) leaves = true;
    if (ts.isShorthandPropertyAssignment(n) && loaded.has(n.name.text))
      leaves = true;
    if (ts.isPropertyAssignment(n) && isLoaded(n.initializer)) leaves = true;
    ts.forEachChild(n, visit);
  };
  visit(node);
  return leaves;
}

/**
 * The network fetches inside one declaration.
 *
 * `getDocument` is classified by the PROPERTY that makes pdfjs fetch: the
 * options it spreads carry a non-null `cMapUrl` (character maps — fetched when
 * a font is loaded, so only when the declaration evaluates page content) and
 * `wasmUrl` (image decoders — reached only when the declaration renders a
 * page). Unset those options and the classes go away with them. A document
 * that is evaluated nowhere here but LEAVES the declaration is unclassified.
 */
function sitesIn(id: NodeId): Site[] {
  const node = declOf(id);
  if (!node) return [];
  const found: Site[] = [];
  let renders = false;
  let evaluates = false;
  const scan = (n: TS.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      EVALUATES_CONTENT.has(n.expression.name.text)
    ) {
      evaluates = true;
      if (n.expression.name.text === "render") renders = true;
    }
    ts.forEachChild(n, scan);
  };
  scan(node);
  const visit = (n: TS.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isIdentifier(callee) && callee.text === "fetch") {
        const arg = n.arguments[0];
        const font =
          arg &&
          ts.isCallExpression(arg) &&
          ts.isIdentifier(arg.expression) &&
          arg.expression.text === "fontPackUrl";
        found.push({
          id,
          text: n.getText(),
          classes: font ? ["drawing-font"] : [],
          classified: !!font,
        });
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "getDocument"
      ) {
        const opts = n.arguments[0];
        const spreadsDefaults =
          !!opts &&
          ts.isObjectLiteralExpression(opts) &&
          opts.properties.some(
            (p) =>
              ts.isSpreadAssignment(p) &&
              ts.isIdentifier(p.expression) &&
              p.expression.text === "PDFJS_DOCUMENT_DEFAULTS",
          );
        const classes: MidRunFetch[] = [];
        if (spreadsDefaults && PDFJS_DOCUMENT_DEFAULTS.cMapUrl && evaluates)
          classes.push("character-map");
        if (spreadsDefaults && PDFJS_DOCUMENT_DEFAULTS.wasmUrl && renders)
          classes.push("image-decoder");
        found.push({
          id,
          text: n.getText(),
          classes,
          classified: evaluates || !documentLeaves(node),
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** slug → the dispatcher's component for its runner kind, as a graph node. */
function runnerRoot(slug: string): NodeId {
  const kind = getRunnerKind(slug);
  if (!kind) throw new Error(`${slug} mounts no runner`);
  const dispatch = readFileSync(DISPATCHER, "utf8");
  const arm = new RegExp(
    `case\\s+"${kind}":[\\s\\S]{0,200}?<([A-Z][A-Za-z]*)`,
  ).exec(dispatch);
  if (!arm) throw new Error(`no dispatcher arm renders kind "${kind}"`);
  const [root] = resolveExport(DISPATCHER, arm[1]!);
  if (!root) throw new Error(`cannot resolve ${arm[1]} from the dispatcher`);
  return root;
}

interface Reached {
  readonly size: number;
  readonly sites: readonly Site[];
  readonly classes: ReadonlySet<MidRunFetch>;
}

const reachedCache = new Map<string, Reached>();
function reachedBy(slug: string): Reached {
  const hit = reachedCache.get(slug);
  if (hit) return hit;
  const nodes = reach(runnerRoot(slug));
  const sites = [...nodes].flatMap(sitesIn);
  const r: Reached = {
    size: nodes.size,
    sites,
    classes: new Set(sites.flatMap((s) => s.classes)),
  };
  reachedCache.set(slug, r);
  return r;
}

const inBrowser = () =>
  tools.filter((t) => capabilityForMode(t.processing) === "in-browser");

const rel = (id: NodeId) => id.slice(SRC.length + 1).replace(/\\/g, "/");

/* ------------------------------------------------------------------ *
 *  The ban, with its corpus
 * ------------------------------------------------------------------ */

/**
 * Sentences the product shipped that claimed the connection could not matter
 * mid-run, or that one fetch was the only one. Verbatim.
 */
const SHIPPED_EXCLUSIVITY = [
  "After that, the processing itself runs entirely on your device, and a dropped connection does not interrupt work in progress.",
  "After that, the filling itself runs entirely on your device, and a dropped connection does not interrupt a run that is already underway.",
  "From there, the work itself happens on your device, so a connection that drops mid-build does not interrupt work already in progress.",
  "One exception: drawing text in a script outside the Western European alphabet fetches a matching font the first time it is needed, and that step needs a connection.",
];

const EXCLUSIVITY_BANS = [
  /\b(?:does|do|will)(?: not|n['’]t) interrupt\b/i,
  /\b(?:one|the only|a single) exception\b/i,
];

const bannedIn = (text: string) =>
  EXCLUSIVITY_BANS.filter((re) => re.test(text)).map(String);

/* ------------------------------------------------------------------ */

let pages: Map<string, RenderedToolPage>;
beforeAll(() => {
  pages = renderToolPages();
}, 180_000);

describe("the fetch-site graph is healthy", () => {
  it("discovers the pdfjs and font sites, with positive and negative controls", () => {
    const all = new Map<string, Site>();
    for (const t of inBrowser())
      for (const s of reachedBy(t.slug).sites) all.set(`${s.id} ${s.text}`, s);
    const ids = new Set([...all.values()].map((s) => rel(s.id)));
    // Positive controls: each class has the site the wasm-assets docblock and
    // unicode-font name. The raster site moved from rasterizePdf into
    // capturePdfPages when L08 (85ee451) made rasterizePdf a thin wrapper.
    expect(ids).toContain("lib/pdf/render.ts#capturePdfPages");
    expect(ids).toContain("lib/pdf/render.ts#createThumbnailRenderer");
    // The text site moved from extractPdfText into readPageTextItems when L10
    // (ed6a206) gave extractPdfText and extractPdfLines one shared
    // `getDocument` call; extractPdfText is now a wrapper around it.
    expect(ids).toContain("lib/pdf/text.ts#readPageTextItems");
    expect(ids).toContain("lib/pdf/unicode-font.ts#fetchFromOrigin");
    const classesOf = (id: string) =>
      [...all.values()].filter((s) => rel(s.id) === id)[0]?.classes ?? [];
    expect([...classesOf("lib/pdf/render.ts#capturePdfPages")].sort()).toEqual([
      "character-map",
      "image-decoder",
    ]);
    // NEGATIVE control, and the site that made this distinction necessary: a
    // document opened only for its metadata is discovered, classified, and
    // fetches nothing (L12's classifyPdfAccess).
    const access = [...all.values()].find(
      (s) => rel(s.id) === "lib/pdf/encryption.ts#classifyPdfAccess",
    );
    expect(access, "the metadata-only site is not discovered").toBeDefined();
    expect(access!.classified).toBe(true);
    expect(access!.classes).toEqual([]);
    expect(classesOf("lib/pdf/text.ts#readPageTextItems")).toEqual([
      "character-map",
    ]);
    expect(classesOf("lib/pdf/unicode-font.ts#fetchFromOrigin")).toEqual([
      "drawing-font",
    ]);
    // Budget, not assertion (2026-10-30): up to 2.7 s on CI's slower 4-vCPU
    // runners in the full unit run (26 logs, 10-24..10-30), against vitest's
    // 5-second default. The work is the same; the runner is not.
    // `src/tests/timeout-headroom.ts` names the next test past half its budget
    // on every CI run.
  }, 30_000);

  it("each runner's graph is plausibly sized, and the controls land where they must", () => {
    const sizes = inBrowser().map((t) => [t.slug, reachedBy(t.slug).size]);
    // A BFS bug collapses a graph to its root; every runner imports a kit,
    // hooks and an engine, so fewer than 40 declarations is a broken walk.
    expect(sizes.filter(([, n]) => (n as number) < 40)).toEqual([]);
    expect(inBrowser().length).toBeGreaterThanOrEqual(25);
    const has = (slug: string) => [...reachedBy(slug).classes].sort();
    expect(has("pdf-to-jpg")).toEqual(["character-map", "image-decoder"]);
    expect(has("pdf-to-text")).toEqual(["character-map"]);
    expect(has("text-to-pdf")).toEqual(["drawing-font"]);
    // Negative control: Flatten is pdf-lib alone. (It was Split until
    // 2026-10-25, when "By text" began reading pages through pdf.js — which
    // this walk saw at once, so Split now reaches the character map.)
    expect(has("flatten-pdf")).toEqual([]);
    expect(has("split-pdf")).toEqual(["character-map"]);
    // Every class is reached by some tool, and none by every tool.
    for (const c of CLASSES) {
      const n = inBrowser().filter((t) => reachedBy(t.slug).classes.has(c));
      expect(n.length, c).toBeGreaterThan(0);
      expect(n.length, c).toBeLessThan(inBrowser().length);
    }
  });

  it("no in-browser runner reaches a fetch nobody classified", () => {
    const unclassified = inBrowser().flatMap((t) =>
      reachedBy(t.slug)
        .sites.filter((s) => !s.classified)
        .map((s) => `${t.slug}: ${rel(s.id)} ${s.text}`),
    );
    expect(unclassified).toEqual([]);
  });
});

describe("the offline answer names every mid-run fetch the runner reaches", () => {
  it("the table in tool-facts agrees with the discovered graph, both ways", () => {
    const wrong = inBrowser().flatMap((t) => {
      const want = [...reachedBy(t.slug).classes].sort();
      const said = [...midRunFetches(t.slug)].sort();
      return JSON.stringify(want) === JSON.stringify(said)
        ? []
        : [
            `${t.slug}: code reaches ${want.join(",")}; table says ${said.join(",")}`,
          ];
    });
    expect(wrong).toEqual([]);
  });

  it("every in-browser page SERVES exactly the fetches its runner reaches", () => {
    expect(pages.size).toBe(tools.length);
    const wrong = inBrowser().flatMap((t) => {
      const p = pages.get(t.slug);
      const offline = p?.faq.find((e) => /\boffline\b/i.test(e.question));
      if (!offline) return [`${t.slug}: no offline answer served`];
      const reached = reachedBy(t.slug).classes;
      return CLASSES.flatMap((c) => {
        const named = offline.answer.includes(MID_RUN_FETCH_SENTENCE[c]);
        if (reached.has(c) && !named) return [`${t.slug}: omits ${c}`];
        if (!reached.has(c) && named) return [`${t.slug}: claims ${c}`];
        return [];
      }).concat(bannedIn(offline.answer).map((b) => `${t.slug}: matches ${b}`));
    });
    expect(wrong).toEqual([]);
  });

  it("every in-browser guide that talks about offline use names the same fetches", () => {
    const guideText = (g: Guide) =>
      [
        g.description,
        ...g.intro,
        ...g.steps,
        ...g.sections.flatMap((s) => [s.heading, ...s.body]),
        ...g.faq.flatMap((f) => [f.question, f.answer]),
      ].join(" ");
    const subjects = guides.filter((g) => {
      const primary = tools.find((t) => t.slug === g.tools[0]);
      return (
        !!primary &&
        capabilityForMode(primary.processing) === "in-browser" &&
        /\boffline\b/i.test(guideText(g))
      );
    });
    // Positive controls and a floor: a discovery that quietly shrinks passes
    // every assertion below.
    const slugs = subjects.map((g) => g.tools[0]);
    expect(slugs).toContain("markdown-to-pdf");
    expect(slugs).toContain("sign-pdf");
    expect(slugs).toContain("merge-pdf");
    expect(subjects.length).toBeGreaterThanOrEqual(7);
    const wrong = subjects.flatMap((g) => {
      const text = guideText(g);
      const reached = reachedBy(g.tools[0]!).classes;
      return CLASSES.flatMap((c) => {
        const named = text.includes(MID_RUN_FETCH_SENTENCE[c]);
        if (reached.has(c) && !named) return [`${g.slug}: omits ${c}`];
        if (!reached.has(c) && named) return [`${g.slug}: claims ${c}`];
        return [];
      }).concat(bannedIn(text).map((b) => `${g.slug}: matches ${b}`));
    });
    expect(wrong).toEqual([]);
  });

  it("the exclusivity ban catches every shipped sentence, and every pattern catches one", () => {
    for (const s of SHIPPED_EXCLUSIVITY) expect(bannedIn(s), s).not.toEqual([]);
    for (const re of EXCLUSIVITY_BANS)
      expect(
        SHIPPED_EXCLUSIVITY.some((s) => re.test(s)),
        String(re),
      ).toBe(true);
  });
});
