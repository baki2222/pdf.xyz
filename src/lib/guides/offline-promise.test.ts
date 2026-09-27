// @vitest-environment node
/**
 * A GUIDE THAT PROMISES "A DROPPED CONNECTION DOES NOT INTERRUPT WORK IN
 * PROGRESS" MUST BE ABOUT A TOOL WHOSE RUN FETCHES NOTHING.
 *
 * The Edit PDF guide shipped (400df68) with the offline paragraph the merge,
 * split, and rotate guides carry: "After that, the work runs entirely on your
 * device, so a dropped connection does not interrupt work already in
 * progress." True for merge, whose run is pdf-lib and nothing else. False for
 * Edit PDF: applying Bengali or Chinese text runs
 *
 *   editPdf -> embedStampFont -> embedDrawingFont -> loadPackBytes
 *     -> fetchFromOrigin -> fetch(fontPackUrl(pack))
 *
 * and a dead connection at that moment ends the run with "The Bengali font
 * could not be loaded ... Check your connection and try again." The sentence
 * right before it even said the tool fetches a font — the two sentences
 * disagreed on the same page. Sign PDF's guide carried the same paragraph over
 * the same chain (a typed name goes through `embedDrawingFont`), unnoticed.
 *
 * WHY NOTHING CAUGHT IT. The claim was checked against the runner and the
 * engine module, and the fetch lives one module further down. Every guide
 * guard asked "does the copy match the capability" — in-browser, worker,
 * hybrid — and "in-browser" is true of both merge and edit. Whether the RUN
 * touches the network is a property of the call chain, which nothing read.
 *
 * WHAT THIS READS. The chain itself, discovered rather than named:
 *
 *   guide.tools[0] -> registry kind -> the dispatcher's `case "<kind>":`
 *     -> every declaration reachable from that clause -> any `fetch(...)`
 *
 * The dispatcher is not named either: it is whichever declaration, among the
 * bindings the tool-page ROUTE imports, switches over every registry kind.
 *
 * ── WHY DECLARATIONS AND NOT MODULES ─────────────────────────────────────────
 *
 * A module graph was measured first and WIDENED the set: create-forms, fill-
 * forms, crop, flatten, overlay, grayscale and redact all "reach"
 * unicode-font.ts, because they import `loadPdf` from stamp.ts and stamp.ts
 * imports the font module. Loading a module is not running a function; that
 * graph would have demanded a font caveat on the Fill Forms guide, whose run
 * draws no text at all. So nodes here are top-level DECLARATIONS and an edge is
 * a reference from one declaration's body to another.
 *
 * ── WHAT IT CANNOT SEE, said plainly ─────────────────────────────────────────
 *
 *  - **A reference is not a call.** A function passed around and never invoked
 *    still counts — an over-approximation, the direction that makes this RED.
 *  - **Fetches a library performs from a URL we hand it.** pdf.js fetches CMaps
 *    and decoder wasm from the `cMapUrl`/`wasmUrl` in `wasm-assets.ts`; there is
 *    no `fetch(` of ours on that path, so a tool whose run is pdf.js rendering
 *    is judged fetch-free here. That is a narrowing, stated rather than hidden.
 *  - **Dynamic `import()`** of a module is an edge to every export of it
 *    (over-approximation). Top-level statements of a module are not followed.
 *  - **Bare identifiers only**, like the spend-probe reachability guard; a
 *    method call on an object is a different binding without a type checker.
 */
import { describe, expect, it } from "vitest";
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { PDFDocument } from "pdf-lib";
import { guides } from "./catalog";
import type { Guide } from "./types";
import { getRunnerKind, supportedToolSlugs } from "@/lib/pdf/registry";
import { editPdf, type EditOp } from "@/lib/pdf/edit";
import { resetFontCache, setFontByteSource } from "@/lib/pdf/unicode-font";

/** The compiler as a library — same reason as client-bundle-node-free.test.ts. */
const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const ROOT = resolve(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");
/** The Next.js route that renders every tool page — the convention, not a list. */
const TOOL_ROUTE = join(SRC, "app", "tools", "[slug]", "page.tsx");

const rel = (f: string): string => relative(ROOT, f).split(sep).join("/");

/* ------------------------------------------------------------------ *
 *  The copy side
 * ------------------------------------------------------------------ */

/** Every string a reader (or a crawler, via JSON-LD) receives from a guide. */
function copyStrings(guide: Guide): string[] {
  return [
    guide.title,
    guide.description,
    ...guide.keywords,
    ...guide.intro,
    ...guide.steps,
    ...guide.sections.flatMap((s) => [s.heading, ...s.body]),
    ...guide.faq.flatMap((f) => [f.question, f.answer]),
  ];
}

/** The unconditional promise: the run survives the network going away. */
const OFFLINE_PROMISE =
  /\bdropped connection (?:does not|doesn't|will not|won't|cannot|can't|never) (?:interrupt|stop|break)/i;
/** The guide talks about working without a network at all. */
const OFFLINE_TOPIC =
  /\boffline\b|\bdropped connection\b|\bconnection drops\b/i;
/** A sentence that says the run itself downloads something and needs a connection. */
const discloses = (text: string): boolean =>
  /\bdownload/i.test(text) && /\bneeds? a connection\b/i.test(text);

/* ------------------------------------------------------------------ *
 *  The code side: a declaration-level reference graph
 * ------------------------------------------------------------------ */

interface Mod {
  file: string;
  /** local top-level name -> the node whose subtree is its body */
  decls: Map<string, TS.Node>;
  /** local binding -> where it comes from ("*" = namespace, "default") */
  imports: Map<string, { file: string; name: string }>;
  /** exported name -> local name */
  exports: Map<string, string>;
  reexports: Array<{ file: string; names: Map<string, string> | "*" }>;
}

function resolveSpec(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // a package: not our tree
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

const hasModifier = (node: TS.Node, kind: TS.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

function bindingNames(name: TS.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((e) =>
    ts.isBindingElement(e) ? bindingNames(e.name) : [],
  );
}

const modules = new Map<string, Mod>();

function load(file: string): Mod {
  const cached = modules.get(file);
  if (cached) return cached;
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const mod: Mod = {
    file,
    decls: new Map(),
    imports: new Map(),
    exports: new Map(),
    reexports: [],
  };
  const declare = (name: string, node: TS.Node, stmt: TS.Node) => {
    mod.decls.set(name, node);
    if (hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
      mod.exports.set(
        hasModifier(stmt, ts.SyntaxKind.DefaultKeyword) ? "default" : name,
        name,
      );
    }
  };
  for (const stmt of sf.statements) {
    if (
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt) ||
        ts.isInterfaceDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt)) &&
      stmt.name
    ) {
      // Interfaces and type aliases are recorded so a value-style import of a
      // type resolves; they have no runtime body, so they carry no edges.
      const body =
        ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)
          ? stmt.name
          : stmt;
      declare(stmt.name.text, body, stmt);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        for (const n of bindingNames(d.name)) declare(n, d, stmt);
      }
    } else if (ts.isImportDeclaration(stmt)) {
      const clause = stmt.importClause;
      if (!clause || clause.isTypeOnly) continue;
      const target = resolveSpec(
        file,
        (stmt.moduleSpecifier as TS.StringLiteral).text,
      );
      if (!target) continue;
      if (clause.name) {
        mod.imports.set(clause.name.text, { file: target, name: "default" });
      }
      const nb = clause.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) {
        mod.imports.set(nb.name.text, { file: target, name: "*" });
      } else if (nb) {
        for (const el of nb.elements) {
          if (el.isTypeOnly) continue; // erased at runtime
          mod.imports.set(el.name.text, {
            file: target,
            name: (el.propertyName ?? el.name).text,
          });
        }
      }
    } else if (ts.isExportDeclaration(stmt)) {
      if (stmt.isTypeOnly) continue;
      const clause = stmt.exportClause;
      if (stmt.moduleSpecifier) {
        const target = resolveSpec(
          file,
          (stmt.moduleSpecifier as TS.StringLiteral).text,
        );
        if (!target) continue;
        if (!clause) mod.reexports.push({ file: target, names: "*" });
        else if (ts.isNamedExports(clause)) {
          const names = new Map<string, string>();
          for (const el of clause.elements) {
            if (!el.isTypeOnly) {
              names.set(el.name.text, (el.propertyName ?? el.name).text);
            }
          }
          mod.reexports.push({ file: target, names });
        } else {
          throw new Error(`${rel(file)}: \`export * as\` is not modelled`);
        }
      } else if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) {
          if (!el.isTypeOnly) {
            mod.exports.set(el.name.text, (el.propertyName ?? el.name).text);
          }
        }
      }
    } else if (
      ts.isExportAssignment(stmt) &&
      ts.isIdentifier(stmt.expression)
    ) {
      mod.exports.set("default", stmt.expression.text);
    }
  }
  modules.set(file, mod);
  return mod;
}

const keyOf = (file: string, name: string): string => `${rel(file)}#${name}`;
const nodeOf = new Map<string, { file: string; name: string }>();

/**
 * The declaration an exported name of `file` stands for. A name our tree
 * exports and this cannot find is a BROKEN LINK, and a broken link is fatal:
 * a graph that silently drops an edge reports the strongest possible pass.
 */
function resolveExport(file: string, name: string, depth = 0): string[] {
  if (depth > 20) throw new Error(`re-export cycle at ${rel(file)}#${name}`);
  const mod = load(file);
  if (name === "*") {
    // a namespace used whole — every export it has
    return [...mod.exports.keys()].flatMap((n) =>
      resolveExport(file, n, depth + 1),
    );
  }
  const local = mod.exports.get(name);
  if (local !== undefined) return resolveLocal(mod, local, depth + 1);
  for (const re of mod.reexports) {
    if (re.names === "*") {
      if (name === "default") continue;
      const inner = load(re.file);
      const has =
        inner.exports.has(name) ||
        inner.reexports.some((r) => r.names === "*" || r.names.has(name));
      if (has) return resolveExport(re.file, name, depth + 1);
    } else if (re.names.has(name)) {
      return resolveExport(re.file, re.names.get(name)!, depth + 1);
    }
  }
  throw new Error(`broken link: ${rel(file)} does not export "${name}"`);
}

function resolveLocal(mod: Mod, name: string, depth = 0): string[] {
  if (mod.decls.has(name)) {
    const key = keyOf(mod.file, name);
    nodeOf.set(key, { file: mod.file, name });
    return [key];
  }
  const imported = mod.imports.get(name);
  if (imported) return resolveExport(imported.file, imported.name, depth + 1);
  return []; // a parameter, a local, or a global — not a top-level binding
}

/** Edges out of one declaration, and whether it calls `fetch` itself. */
function scan(key: string): { edges: string[]; fetches: boolean } {
  const { file, name } = nodeOf.get(key)!;
  const mod = load(file);
  const root = mod.decls.get(name)!;
  const edges: string[] = [];
  let fetches = false;
  const visit = (n: TS.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "fetch" &&
      !mod.decls.has("fetch") &&
      !mod.imports.has("fetch")
    ) {
      fetches = true;
    }
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const arg = n.arguments[0];
      const target =
        arg && ts.isStringLiteral(arg) ? resolveSpec(file, arg.text) : null;
      if (target) edges.push(...resolveExport(target, "*"));
    }
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isMemberName =
        (ts.isPropertyAccessExpression(p) && p.name === n) ||
        (ts.isPropertyAssignment(p) && p.name === n) ||
        (ts.isJsxAttribute(p) && p.name === n) ||
        (ts.isBindingElement(p) && p.propertyName === n);
      if (!isMemberName) {
        const imported = mod.imports.get(n.text);
        if (
          imported?.name === "*" &&
          ts.isPropertyAccessExpression(p) &&
          p.expression === n
        ) {
          edges.push(...resolveExport(imported.file, p.name.text));
        } else {
          edges.push(...resolveLocal(mod, n.text));
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return { edges, fetches };
}

interface Reach {
  size: number;
  /** A path from the root to a declaration that calls `fetch`, or null. */
  fetchPath: string[] | null;
}

function reach(roots: readonly string[]): Reach {
  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  for (const r of roots) {
    if (!parent.has(r)) {
      parent.set(r, null);
      queue.push(r);
    }
  }
  let fetchPath: string[] | null = null;
  while (queue.length > 0) {
    const key = queue.shift()!;
    const { edges, fetches } = scan(key);
    if (fetches && fetchPath === null) {
      const path: string[] = [];
      for (let k: string | null = key; k !== null; k = parent.get(k) ?? null) {
        path.unshift(k);
      }
      fetchPath = path;
    }
    for (const e of edges) {
      if (!parent.has(e)) {
        parent.set(e, key);
        queue.push(e);
      }
    }
  }
  return { size: parent.size, fetchPath };
}

/* ------------------------------------------------------------------ *
 *  Discovery: route -> dispatcher -> case clause
 * ------------------------------------------------------------------ */

const KINDS = new Set(
  supportedToolSlugs.map((slug) => getRunnerKind(slug)!).filter(Boolean),
);

/** The `case "<kind>":` clauses of the one declaration that switches over every kind. */
function findDispatcher(): { mod: Mod; cases: Map<string, TS.CaseClause> } {
  const route = load(TOOL_ROUTE);
  const found: Array<{ mod: Mod; cases: Map<string, TS.CaseClause> }> = [];
  for (const local of route.imports.keys()) {
    for (const key of resolveLocal(route, local)) {
      const { file, name } = nodeOf.get(key)!;
      const mod = load(file);
      const cases = new Map<string, TS.CaseClause>();
      const visit = (n: TS.Node): void => {
        if (ts.isCaseClause(n) && ts.isStringLiteral(n.expression)) {
          cases.set(n.expression.text, n);
        }
        ts.forEachChild(n, visit);
      };
      visit(mod.decls.get(name)!);
      if ([...KINDS].every((k) => cases.has(k))) found.push({ mod, cases });
    }
  }
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one dispatcher among ${rel(TOOL_ROUTE)}'s imports, found ${found.length}`,
    );
  }
  return found[0]!;
}

/** What running `slug`'s tool can reach, or null for a tool with no in-browser runner. */
function runReach(slug: string): Reach | null {
  const kind = getRunnerKind(slug);
  if (kind === undefined) return null;
  const { mod, cases } = findDispatcher();
  const clause = cases.get(kind);
  if (!clause) throw new Error(`no case "${kind}" in ${rel(mod.file)}`);
  const roots: string[] = [];
  const visit = (n: TS.Node): void => {
    if (ts.isIdentifier(n)) roots.push(...resolveLocal(mod, n.text));
    ts.forEachChild(n, visit);
  };
  clause.statements.forEach(visit);
  if (roots.length === 0) {
    throw new Error(`case "${kind}" resolved to no declaration — broken link`);
  }
  return reach(roots);
}

/** The offline sentences of `guide` that its tool's run makes false. */
function falsePromises(guide: Guide): string[] {
  const r = runReach(guide.tools[0]!);
  if (r === null || r.fetchPath === null) return [];
  return copyStrings(guide).filter((t) => OFFLINE_PROMISE.test(t));
}

function fixture(primary: string, text: string): Guide {
  return {
    slug: "fixture",
    title: "Fixture",
    description: "Fixture.",
    tools: [primary],
    keywords: [],
    intro: [text],
    steps: [],
    sections: [],
    faq: [],
    published: "2026-09-27",
    updated: "2026-09-27",
  };
}

/* ------------------------------------------------------------------ *
 *  The tests
 * ------------------------------------------------------------------ */

describe("an offline promise in a guide agrees with what its tool's run fetches", () => {
  it("the dispatcher, the graph and the corpus are healthy, in both directions", () => {
    // Every registry kind reaches a declaration, and no reach is implausibly
    // small: a resolver bug that collapses the graph would otherwise make
    // every run look fetch-free — the strongest possible pass.
    const sizes = new Map<string, number>();
    for (const slug of supportedToolSlugs) {
      const r = runReach(slug)!;
      sizes.set(slug, r.size);
      expect(r.size, `${slug}: implausibly small reach`).toBeGreaterThan(10);
    }
    expect(sizes.size).toBeGreaterThanOrEqual(KINDS.size);

    // The corpus: the guides that talk about working offline, split by what
    // their tool's run does. Both halves must be inhabited — all-fetching
    // means the graph widened (the module-graph failure above), none-fetching
    // means it went blind.
    const topical = guides.filter((g) =>
      copyStrings(g).some((t) => OFFLINE_TOPIC.test(t)),
    );
    const fetching = topical.filter((g) => runReach(g.tools[0]!)?.fetchPath);
    const quiet = topical.filter((g) => {
      const r = runReach(g.tools[0]!);
      return r !== null && r.fetchPath === null;
    });
    expect(
      fetching.length,
      "no offline-discussing guide's tool fetches",
    ).toBeGreaterThan(0);
    expect(
      quiet.length,
      "every offline-discussing guide's tool fetches",
    ).toBeGreaterThan(0);

    // The promise pattern catches shipped sentences (it is not decoration),
    // and every shipped sentence about a dropped connection is a promise it
    // catches (no synonym walks past it).
    const shipped = guides.flatMap(copyStrings);
    expect(
      shipped.filter((t) => OFFLINE_PROMISE.test(t)).length,
    ).toBeGreaterThan(0);
    for (const t of shipped.filter((t) => /dropped connection/i.test(t))) {
      expect(OFFLINE_PROMISE.test(t), `uncaught offline promise: "${t}"`).toBe(
        true,
      );
    }
  });

  it("no guide promises a dropped connection is harmless for a tool whose run fetches", () => {
    for (const guide of guides) {
      const r = runReach(guide.tools[0]!);
      if (r === null) {
        // a worker tool: any offline promise is unverifiable in this tree
        expect(
          copyStrings(guide).filter((t) => OFFLINE_PROMISE.test(t)),
          `${guide.slug}: offline promise for a tool with no in-browser run`,
        ).toEqual([]);
        continue;
      }
      if (r.fetchPath === null) continue;
      const chain = r.fetchPath.join("\n  -> ");
      expect(
        falsePromises(guide),
        `${guide.slug}: its run fetches at run time:\n  ${chain}`,
      ).toEqual([]);
      if (copyStrings(guide).some((t) => OFFLINE_TOPIC.test(t))) {
        expect(
          copyStrings(guide).some(discloses),
          `${guide.slug} discusses working offline but never says the run downloads something and needs a connection:\n  ${chain}`,
        ).toBe(true);
      }
    }

    // Positive and negative controls, through the same detector: the sentence
    // this guard was written for is caught on a fetching tool and passes on a
    // tool whose run is pdf-lib alone. Neither slug is the subject list — the
    // loop above found its subjects itself.
    const promise =
      "After that, the work runs entirely on your device, so a dropped connection does not interrupt work already in progress.";
    expect(falsePromises(fixture("edit-pdf", promise))).toEqual([promise]);
    expect(falsePromises(fixture("merge-pdf", promise))).toEqual([]);
  });

  it("control: the edit run really stops without the network — and only for text a built-in font cannot draw", async () => {
    // Reachability is not execution. This runs the engine the guard flagged,
    // with the font download failing the way a dead connection fails it.
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]);
    const bytes = await doc.save();
    const text = (t: string): EditOp => ({
      type: "text",
      page: 1,
      x: 20,
      y: 200,
      text: t,
      color: "#000000",
    });
    resetFontCache();
    let calls = 0;
    const previous = setFontByteSource(async () => {
      calls += 1;
      throw new TypeError("Failed to fetch");
    });
    try {
      // Western European text and shapes: no download, the run completes.
      const latin = await editPdf(bytes, [
        text("Café déjà vu — Größe"),
        {
          type: "rect",
          page: 1,
          x: 10,
          y: 10,
          width: 50,
          height: 20,
          color: "#ff0000",
        },
      ]);
      expect(latin.opCount).toBe(2);
      expect(calls).toBe(0);
      // Bengali: the run needs a font download, and without it the run fails.
      await expect(editPdf(bytes, [text("বাংলা লেখা")])).rejects.toThrow(
        /Failed to fetch/,
      );
      expect(calls).toBeGreaterThan(0);
    } finally {
      setFontByteSource(previous);
      resetFontCache();
    }
  });
});
