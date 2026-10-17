// @vitest-environment node
/**
 * NOTHING THE WEB BUILD COMPILES MAY NAME A NATIVE ADDON TO THE BUNDLER.
 *
 * On 2026-10-10 `pnpm build` failed — `Module parse failed: Unexpected
 * character` in `skia.win32-x64-msvc.node` — on the chain webpack printed:
 *
 *     src/app/api/jobs/route.ts
 *       → src/lib/workers/index.ts                  (re-exports the processors)
 *       → src/lib/workers/processor/index.ts
 *       → src/lib/workers/processor/pdf-office-export.ts
 *       → src/lib/workers/pdf-office-export/engine.ts
 *       → src/lib/workers/pdf-office-export/page-scan.ts
 *       → src/lib/workers/pdf-office-export/pdfjs-node.ts
 *       → createRequire(pdfjs).resolve("@napi-rs/canvas")
 *       → the canvas's native binary
 *
 * Every vitest suite was green, because vitest does not bundle. The web tier
 * never RUNS that code — the worker does, unbundled, under tsx — but webpack
 * parses every module a route can reach before it prunes a single export, so
 * one line in a worker-only file broke the web deploy. The app does not even
 * depend on `@napi-rs/canvas`: it is pdf.js's optional dependency, and webpack
 * found it through pnpm's hoisted store, which pnpm puts on NODE_PATH and Next
 * adds to webpack's `resolve.modules`.
 *
 * `client-bundle-node-free.test.ts` asks the client half of this question
 * (a Node built-in reached from a `"use client"` root). This is the server
 * half, and it is a different property: built-ins are fine on the server, a
 * native binary is not anywhere webpack has to parse it.
 *
 * THE SET is derived, never typed: every module the web build compiles,
 * walked out of every source file under `src/app` (each is an entry Next
 * keys on, or imported by one) and `src/instrumentation.ts`, through VALUE
 * edges only — an `import type` edge is erased before webpack reads the file,
 * and following one would widen the set.
 *
 * THE REQUESTS are what webpack reads as a dependency: value imports and
 * re-exports, `import("…")` without `webpackIgnore`, and calls through the
 * free `require` or a function `createRequire` made (imported from
 * `node:module`) — called, or through `.resolve`. NOT a `require` reached
 * through `process.getBuiltinModule`, which no bundler reads: that is the fix
 * `pdfjs-node.ts` took, and NOT_FLAGGED holds the detector to it.
 *
 * NATIVE is read off each installed package, resolved the way the build
 * resolved it (from the requesting file upward, then pnpm's hoisted store):
 * a `napi` manifest field (napi-rs), `gypfile` or a `binding.gyp` (node-gyp),
 * or a `.node` file of its own. EXEMPT is what Next leaves to Node at run
 * time: `server-external-packages.jsonc` as the INSTALLED Next ships it.
 *
 * WHAT THIS DOES NOT COVER, said plainly: a package's own requests (webpack
 * parses those too, but they are the package's and Next's external list's
 * business); `new URL(…, import.meta.url)` assets; and next.config's own
 * `serverExternalPackages`, which a test below requires to stay absent until
 * this file is taught to read it.
 */
import { describe, expect, it } from "vitest";
import type * as TS from "typescript";
import { builtinModules, createRequire } from "node:module";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  type Dirent,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/** The compiler as a library; see `client-bundle-node-free.test.ts`. */
const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const ROOT = resolve(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const PNPM_HOISTED = join(ROOT, "node_modules", ".pnpm", "node_modules");

const isSource = (f: string): boolean =>
  /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\.(ts|tsx)$/.test(f);

const rel = (f: string): string => relative(ROOT, f).split(sep).join("/");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (isSource(entry)) out.push(full);
  }
  return out;
}

/** Next's server entries: `src/app/**`, and the instrumentation hook. */
function serverRoots(): string[] {
  const roots = walk(join(SRC, "app"));
  for (const hook of ["instrumentation.ts", "middleware.ts", "proxy.ts"]) {
    const file = join(SRC, hook);
    if (existsSync(file)) roots.push(file);
  }
  return roots;
}

/* ------------------------------------------------------------------ *
 *  Edges and requests
 * ------------------------------------------------------------------ */

function parse(file: string, source: string): TS.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function visit(node: TS.Node, fn: (n: TS.Node) => void): void {
  fn(node);
  node.forEachChild((child) => visit(child, fn));
}

/** Erased before webpack reads the file: `isTypeOnly` on the node, not the word. */
function isErasedImport(node: TS.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) return false;
  if (clause.isTypeOnly) return true;
  return (
    clause.name === undefined &&
    clause.namedBindings !== undefined &&
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((e) => e.isTypeOnly)
  );
}

function isErasedExport(node: TS.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  return (
    clause !== undefined &&
    ts.isNamedExports(clause) &&
    clause.elements.length > 0 &&
    clause.elements.every((e) => e.isTypeOnly)
  );
}

interface Request {
  readonly specifier: string;
  readonly how: "import" | "export from" | "import()" | "require" | "resolve";
}

/** Every module request webpack reads in this source; see the header. */
function bundlerRequests(file: string, source: string): Request[] {
  const sf = parse(file, source);
  const out: Request[] = [];
  const createRequireNames = new Set<string>();
  const moduleNamespaces = new Set<string>();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      if (!isErasedImport(st))
        out.push({ specifier: st.moduleSpecifier.text, how: "import" });
      const clause = st.importClause;
      if (
        /^(?:node:)?module$/.test(st.moduleSpecifier.text) &&
        clause &&
        !clause.isTypeOnly
      ) {
        if (clause.name) moduleNamespaces.add(clause.name.text);
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings))
          moduleNamespaces.add(bindings.name.text);
        if (bindings && ts.isNamedImports(bindings))
          for (const el of bindings.elements)
            if (
              !el.isTypeOnly &&
              (el.propertyName ?? el.name).text === "createRequire"
            )
              createRequireNames.add(el.name.text);
      }
    } else if (
      ts.isExportDeclaration(st) &&
      st.moduleSpecifier &&
      ts.isStringLiteral(st.moduleSpecifier) &&
      !isErasedExport(st)
    )
      out.push({ specifier: st.moduleSpecifier.text, how: "export from" });
  }
  const madeByCreateRequire = (e: TS.Expression): boolean =>
    ts.isCallExpression(e) &&
    ((ts.isIdentifier(e.expression) &&
      createRequireNames.has(e.expression.text)) ||
      (ts.isPropertyAccessExpression(e.expression) &&
        e.expression.name.text === "createRequire" &&
        ts.isIdentifier(e.expression.expression) &&
        moduleNamespaces.has(e.expression.expression.text)));
  // The free `require`, and every name a created require is bound to.
  const requireNames = new Set<string>(["require"]);
  visit(sf, (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      madeByCreateRequire(n.initializer)
    )
      requireNames.add(n.name.text);
  });
  const isRequire = (e: TS.Expression): boolean =>
    (ts.isIdentifier(e) && requireNames.has(e.text)) || madeByCreateRequire(e);
  visit(sf, (n) => {
    if (!ts.isCallExpression(n)) return;
    const [arg] = n.arguments;
    if (!arg || !ts.isStringLiteralLike(arg)) return;
    const callee = n.expression;
    if (callee.kind === ts.SyntaxKind.ImportKeyword) {
      // The magic comment sits between "(" and the specifier.
      const lead = source.slice(n.arguments.pos, arg.getStart(sf));
      if (!/webpackIgnore:\s*true/.test(lead))
        out.push({ specifier: arg.text, how: "import()" });
    } else if (isRequire(callee)) {
      out.push({ specifier: arg.text, how: "require" });
    } else if (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "resolve" &&
      isRequire(callee.expression)
    ) {
      out.push({ specifier: arg.text, how: "resolve" });
    }
  });
  return out;
}

/** Resolve one specifier to a file in our tree, or null if it is external. */
function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
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

/* ------------------------------------------------------------------ *
 *  Packages: which one a specifier names, where it is, whether it is native
 * ------------------------------------------------------------------ */

const BUILTINS: ReadonlySet<string> = new Set(builtinModules);

/** The package a bare specifier names, or null for ours and Node's own. */
function packageOf(spec: string): string | null {
  if (/^(?:\.|\/|@\/|node:)/.test(spec) || BUILTINS.has(spec)) return null;
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

/** Where the build finds `name` from `fromDir`, real path, or null. */
function packageDir(name: string, fromDir: string): string | null {
  const bases: string[] = [];
  for (let dir = fromDir; ; dir = dirname(dir)) {
    bases.push(join(dir, "node_modules"));
    if (dirname(dir) === dir) break;
  }
  bases.push(PNPM_HOISTED);
  for (const base of bases) {
    const manifest = join(base, name, "package.json");
    if (existsSync(manifest)) return dirname(realpathSync(manifest));
  }
  return null;
}

function hasOwnBinary(dir: string, depth: number): boolean {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  if (entries.some((e) => e.isFile() && e.name.endsWith(".node"))) return true;
  return (
    depth > 0 &&
    entries.some(
      (e) =>
        e.isDirectory() &&
        e.name !== "node_modules" &&
        hasOwnBinary(join(dir, e.name), depth - 1),
    )
  );
}

/** The installed package carries, or builds, a native addon. */
function isNativePackage(dir: string): boolean {
  const manifest = JSON.parse(
    readFileSync(join(dir, "package.json"), "utf8"),
  ) as { napi?: unknown; gypfile?: unknown };
  return (
    manifest.napi !== undefined ||
    manifest.gypfile === true ||
    existsSync(join(dir, "binding.gyp")) ||
    hasOwnBinary(dir, 3)
  );
}

/** What the installed Next leaves to Node at run time (its own JSONC list). */
function nextExternals(): ReadonlySet<string> {
  const nextDir = packageDir("next", ROOT);
  if (!nextDir) throw new Error("next is not installed");
  const jsonc = readFileSync(
    join(nextDir, "dist", "lib", "server-external-packages.jsonc"),
    "utf8",
  );
  const json = jsonc
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n")
    .replace(/,(\s*\])/, "$1");
  return new Set(JSON.parse(json) as string[]);
}

/* ------------------------------------------------------------------ *
 *  The walk
 * ------------------------------------------------------------------ */

interface Offence {
  readonly chain: readonly string[];
  readonly specifier: string;
  readonly how: Request["how"];
}

interface Graph {
  readonly roots: readonly string[];
  readonly reached: ReadonlySet<string>;
  /** Bare packages requested, each with the first file that asked. */
  readonly packages: ReadonlyMap<string, string>;
  readonly unresolved: readonly string[];
  readonly offences: readonly Offence[];
}

/** BFS out of the roots. `sources` overrides a file's text, for controls. */
function serverGraph(
  roots: readonly string[],
  sources: ReadonlyMap<string, string> = new Map(),
): Graph {
  const read = (f: string) => sources.get(f) ?? readFileSync(f, "utf8");
  const externals = nextExternals();
  const chainTo = new Map<string, string[]>();
  const queue: string[] = [];
  for (const r of roots) {
    if (chainTo.has(r)) continue;
    chainTo.set(r, [rel(r)]);
    queue.push(r);
  }
  const packages = new Map<string, string>();
  const unresolved = new Set<string>();
  const offences: Offence[] = [];
  const native = new Map<string, boolean>();
  while (queue.length > 0) {
    const file = queue.shift()!;
    const chain = chainTo.get(file)!;
    for (const { specifier, how } of bundlerRequests(file, read(file))) {
      const name = packageOf(specifier);
      if (name === null) {
        const next = resolveImport(file, specifier);
        // Only static edges are followed: what `import()` loads is another
        // chunk, and a `require` of our own source does not occur.
        if (
          next === null ||
          chainTo.has(next) ||
          (how !== "import" && how !== "export from")
        )
          continue;
        chainTo.set(next, [...chain, rel(next)]);
        queue.push(next);
        continue;
      }
      if (!packages.has(name)) packages.set(name, rel(file));
      if (externals.has(name)) continue;
      const dir = packageDir(name, dirname(file));
      if (dir === null) {
        unresolved.add(name);
        continue;
      }
      if (!native.has(dir)) native.set(dir, isNativePackage(dir));
      if (native.get(dir)) offences.push({ chain, specifier, how });
    }
  }
  return {
    roots: roots.map(rel),
    reached: new Set([...chainTo.keys()].map(rel)),
    packages,
    unresolved: [...unresolved].sort(),
    offences,
  };
}

/* ------------------------------------------------------------------ *
 *  Controls on the detector, on synthetic source
 * ------------------------------------------------------------------ */

const CANVAS = "@napi-rs/canvas";
const requested = (src: string): string[] =>
  bundlerRequests(join(SRC, "synthetic-probe.ts"), src)
    .map((r) => r.specifier)
    .filter((s) => s === CANVAS);

const FLAGGED: ReadonlyArray<readonly [string, string]> = [
  // The shipped line, with its import.
  [
    "created require's resolve, on a variable (the 2026-10-10 line)",
    `import { createRequire } from "node:module";\nconst pdfjs = "x";\ncreateRequire(pdfjs).resolve("${CANVAS}");`,
  ],
  [
    "a created require bound to a name",
    `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nrequire("${CANVAS}");`,
  ],
  [
    "a created require called in place",
    `import { createRequire } from "module";\ncreateRequire(import.meta.url)("${CANVAS}");`,
  ],
  [
    "createRequire through a namespace",
    `import * as m from "node:module";\nm.createRequire(import.meta.url).resolve("${CANVAS}");`,
  ],
  [
    "a renamed createRequire",
    `import { createRequire as cr } from "node:module";\nconst r = cr(import.meta.url);\nr.resolve("${CANVAS}");`,
  ],
  ["the free require", `require("${CANVAS}");`],
  ["a value import", `import { Canvas } from "${CANVAS}";`],
  ["a side-effect import", `import "${CANVAS}";`],
  ["a re-export", `export { Canvas } from "${CANVAS}";`],
  ["a dynamic import webpack reads", `const load = () => import("${CANVAS}");`],
];

const NOT_FLAGGED: ReadonlyArray<readonly [string, string]> = [
  // The fix: `pdfjs-node.ts`'s shape.
  [
    "a require made through process.getBuiltinModule (the fix)",
    `function runtimeRequire(from: string) {\n  return process.getBuiltinModule("node:module").createRequire(from);\n}\nruntimeRequire("x").resolve("${CANVAS}");`,
  ],
  [
    "a dynamic import webpack is told to ignore",
    `const load = () => import(/* webpackIgnore: true */ "${CANVAS}");`,
  ],
  ["a type-only import", `import type { Canvas } from "${CANVAS}";`],
  [
    "an import whose bindings are all inline-type",
    `import { type Canvas } from "${CANVAS}";`,
  ],
  ["a type-only re-export", `export type { Canvas } from "${CANVAS}";`],
  ["a string that is not a request", `const name = "${CANVAS}";`],
];

/* ------------------------------------------------------------------ *
 *  Assertions
 * ------------------------------------------------------------------ */

describe("nothing the web build compiles names a native addon to the bundler", () => {
  const roots = serverRoots();
  const graph = serverGraph(roots);

  describe("CONTROL: the detector reads what webpack reads, and nothing else", () => {
    for (const [label, src] of FLAGGED)
      it(`flags ${label}`, () => {
        expect(requested(src)).toEqual([CANVAS]);
      });
    for (const [label, src] of NOT_FLAGGED)
      it(`does not flag ${label}`, () => {
        expect(requested(src)).toEqual([]);
      });
  });

  it("CONTROL: the native predicate tells an addon from plain JavaScript", () => {
    // Found the way the build found it — not from `src`'s own node_modules,
    // where it is not, but through pnpm's hoisted store.
    const canvas = packageDir(CANVAS, join(SRC, "lib"));
    expect(canvas, `${CANVAS} is not installed where the build looks`).not.toBe(
      null,
    );
    expect(isNativePackage(canvas!)).toBe(true);
    for (const plain of ["pdf-lib", "jszip", "zod"]) {
      const dir = packageDir(plain, SRC);
      expect(dir, `${plain} is not installed`).not.toBe(null);
      expect(isNativePackage(dir!), plain).toBe(false);
    }
    // The exemption list is the installed Next's, and it is the real list.
    const externals = nextExternals();
    expect(externals.size).toBeGreaterThan(50);
    expect(externals.has("canvas")).toBe(true);
    expect(externals.has(CANVAS)).toBe(false);
  });

  it("HEALTH CHECK: the roots are discovered, and the graph is not implausibly small", () => {
    // Measured 2026-10-10: 54 roots, 492 modules, and 9 packages requested —
    // react, next, lucide-react, clsx, tailwind-merge, pdf-lib, jszip,
    // fontkit, pdfjs-dist. Members as well as counts: a walk that lost the
    // worker graph would still find react.
    expect(graph.roots.length).toBeGreaterThanOrEqual(40);
    expect(graph.reached.size).toBeGreaterThanOrEqual(300);
    expect(graph.packages.size).toBeGreaterThanOrEqual(8);
    expect(
      ["react", "next", "pdf-lib", "jszip", "pdfjs-dist"].filter(
        (name) => !graph.packages.has(name),
      ),
    ).toEqual([]);
  });

  it("HEALTH CHECK: every package the build is asked for is found, so each was judged", () => {
    // A package this walk cannot find is one it cannot call native or not; a
    // list that quietly grew would be a blind spot that reads as a pass.
    expect(graph.unresolved).toEqual([]);
  });

  it("POSITIVE CONTROL: the walk reaches the file the 2026-10-10 failure went through, by the path webpack printed", () => {
    const absent = [
      "src/app/api/jobs/route.ts",
      "src/lib/workers/index.ts",
      "src/lib/workers/processor/index.ts",
      "src/lib/workers/processor/pdf-office-export.ts",
      "src/lib/workers/pdf-office-export/engine.ts",
      "src/lib/workers/pdf-office-export/page-scan.ts",
      "src/lib/workers/pdf-office-export/pdfjs-node.ts",
    ].filter((hop) => !graph.reached.has(hop));
    expect(absent).toEqual([]);
  });

  it("POSITIVE CONTROL: the 2026-10-10 line, put back into pdfjs-node.ts, is caught through the whole chain", () => {
    // In memory, never on disk. The mutation is checked to have landed before
    // its result is trusted: a replace that matched nothing would leave the
    // file clean and this control green for the wrong reason.
    const file = join(SRC, "lib/workers/pdf-office-export/pdfjs-node.ts");
    const now = readFileSync(file, "utf8");
    const before = `import { createRequire } from "node:module";\n${now.replace(
      /runtimeRequire\(pdfjs\)\.resolve\(/,
      "createRequire(pdfjs).resolve(",
    )}`;
    expect(before).toContain(`createRequire(pdfjs).resolve("${CANVAS}")`);
    const offences = serverGraph(roots, new Map([[file, before]])).offences;
    expect(
      offences.map((o) => `${o.chain.at(-1)} ${o.how} ${o.specifier}`),
    ).toEqual([
      `src/lib/workers/pdf-office-export/pdfjs-node.ts resolve ${CANVAS}`,
    ]);
  });

  it("next.config.mjs names no serverExternalPackages this guard cannot read", () => {
    expect(readFileSync(join(ROOT, "next.config.mjs"), "utf8")).not.toMatch(
      /serverExternalPackages/,
    );
  });

  it("no module the web build compiles names a native addon to the bundler", () => {
    expect(
      graph.offences.map(
        (o) => `${o.chain.join("\n    → ")}\n    → ${o.how} "${o.specifier}"`,
      ),
      "webpack parses every module a route can reach before it prunes an export, and cannot parse a native binary. Reach the package at run time instead (process.getBuiltinModule, as pdfjs-node.ts does), or behind `import(/* webpackIgnore: true */ …)`",
    ).toEqual([]);
  });
});
