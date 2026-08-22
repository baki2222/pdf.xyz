// @vitest-environment node
/**
 * NOTHING REACHABLE FROM A `"use client"` ROOT MAY STATICALLY IMPORT A NODE
 * BUILT-IN.
 *
 * PR #134 broke `pnpm build` in four CI jobs with three copies of the same
 * error — `UnhandledSchemeError: Reading from "node:crypto" / "node:fs" /
 * "node:path" is not handled by plugins` — from a single added import. The
 * chain webpack printed:
 *
 *     src/components/status/operations-dashboard.tsx   ← "use client"
 *       → src/components/status/operations-ui.tsx
 *       → src/components/status/alert-posture.tsx
 *       → src/lib/workers/observability/index.ts
 *       → src/lib/workers/observability/snapshot.ts
 *       → src/lib/workers/heartbeat/factory.ts         ← the one line added
 *       → src/lib/workers/heartbeat/schema.ts
 *       → src/lib/workers/build-fingerprint.ts
 *       → node:crypto, node:fs, node:path
 *
 * WHY THE GUARD THAT EXISTED DID NOT SEE IT. `import-boundary.test.ts` next
 * door asks a neighbouring question with a hand-typed `FORBIDDEN` list of
 * module substrings — `compression/native`, `ocr-native`, `daemon/runtime`,
 * `node:child_process`, … A named list cannot see a file it does not name, and
 * it did not name `build-fingerprint`, because when that list was written
 * `build-fingerprint` did not exist. Every future node-only module is a hole in
 * it by construction. That guard is still worth having — it forbids specific
 * modules whose cost is subprocesses and credentials, not merely a built-in —
 * but it is a list of SUBJECTS, and this is the PROPERTY.
 *
 * So this one names no module on either side. The corpus is the import graph
 * itself, walked out of roots discovered by the one fact Next.js already keys
 * on: the `"use client"` directive.
 *
 * WHAT THIS DOES NOT COVER, said plainly:
 *  - **Static imports only.** `await import("node:fs")` is not flagged, matching
 *    the sibling guard's rule and the fact that the observed failure was static.
 *  - **Our source only.** A third-party package that reaches a built-in is
 *    webpack's problem (browser fields, fallbacks); every bare specifier
 *    resolves to `null` here and the walk stops.
 *  - **Roots are `"use client"` files.** A server component's own graph may use
 *    `node:fs` freely and should — that is the whole point of the boundary.
 */
import { describe, expect, it } from "vitest";
import type * as TS from "typescript";
import { builtinModules, createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, relative, sep } from "node:path";

/**
 * The compiler as a library, through `createRequire` rather than a static
 * `import ts from "typescript"` — the bundler otherwise transforms TypeScript's
 * own multi-megabyte bundle and hunts for its absent sourcemap. Same reason as
 * `src/lib/ratelimit/spend-probe-reachability.test.ts`.
 */
const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const ROOT = resolve(__dirname, "..", "..");
const SRC = join(ROOT, "src");

const isSource = (f: string): boolean =>
  /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\.(ts|tsx)$/.test(f);

const rel = (f: string): string => relative(ROOT, f).split(sep).join("/");

/** Every non-test source file under a directory. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (isSource(entry)) out.push(full);
  }
  return out;
}

/**
 * The same set, derived a second and independent way — from the index, which is
 * what actually ships. Used only as a cross-bound on `walk`: if the filesystem
 * walk ever stops descending into a directory, the two disagree and this file
 * goes red for that reason instead of reporting a serene empty offender list.
 *
 * `walk` is the one that FEEDS the guard, deliberately: it sees a brand-new
 * untracked component, and git does not.
 */
function trackedSources(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--", "src"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split("\0")
    .filter((p) => p.length > 0 && isSource(p))
    .map((p) => join(ROOT, p));
}

/* ------------------------------------------------------------------ *
 *  Node built-ins
 * ------------------------------------------------------------------ */

/**
 * Derived from the running Node, not typed: `builtinModules` is the list the
 * platform itself publishes. Both spellings count — `node:fs` is what our tree
 * writes and what webpack complained about, but a bare `fs` resolves to the
 * same module and would break the same build.
 */
const BUILTINS: ReadonlySet<string> = new Set(
  builtinModules.flatMap((m) => [m, `node:${m}`]),
);

const isNodeBuiltin = (spec: string): boolean =>
  BUILTINS.has(spec) || spec.startsWith("node:");

/* ------------------------------------------------------------------ *
 *  Edges
 * ------------------------------------------------------------------ */

/** Resolve one specifier to a file in our tree, or null if it is external. */
function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // a package or a built-in, not our tree
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

/**
 * Is this statement erased before webpack ever sees it?
 *
 * WIDENING A SET IS A DEFECT TOO. An `import type` edge does not exist at
 * runtime, and a guard that follows one proves nothing while sounding certain —
 * `snapshot.ts` imported `heartbeat/types` type-only through every version of
 * this bug, including the ones that built fine. `isTypeOnly` on the node, never
 * the word `type` in the text.
 */
function isErasedImport(node: TS.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) return false; // `import "./x"` really loads it
  if (clause.isTypeOnly) return true;
  return (
    clause.name === undefined &&
    clause.namedBindings !== undefined &&
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((e) => e.isTypeOnly)
  );
}

/** The same question for `export … from "…"`, which webpack follows identically. */
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

function parse(file: string, source: string): TS.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/**
 * Every specifier this module really pulls in at runtime — `import … from`,
 * side-effect `import "…"`, and re-exports (`export * from`, `export { a }
 * from`). Dynamic `import()` is deliberately absent; see the header.
 */
function runtimeSpecifiers(source: string, file: string): string[] {
  const out: string[] = [];
  for (const st of parse(file, source).statements) {
    if (ts.isImportDeclaration(st)) {
      if (isErasedImport(st)) continue;
      if (ts.isStringLiteral(st.moduleSpecifier)) {
        out.push(st.moduleSpecifier.text);
      }
    } else if (ts.isExportDeclaration(st)) {
      if (st.moduleSpecifier === undefined) continue;
      if (isErasedExport(st)) continue;
      if (ts.isStringLiteral(st.moduleSpecifier)) {
        out.push(st.moduleSpecifier.text);
      }
    }
  }
  return out;
}

/** Does the file's directive prologue open with `"use client"`? */
function isClientRoot(file: string, source: string): boolean {
  for (const st of parse(file, source).statements) {
    if (
      !ts.isExpressionStatement(st) ||
      !ts.isStringLiteralLike(st.expression)
    ) {
      return false; // directives may only lead; the prologue is over
    }
    if (st.expression.text === "use client") return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 *  The walk
 * ------------------------------------------------------------------ */

interface Offence {
  /** root → … → the module holding the bad import. */
  readonly chain: readonly string[];
  readonly specifier: string;
}

interface Graph {
  readonly roots: readonly string[];
  readonly reached: ReadonlySet<string>;
  readonly offences: readonly Offence[];
}

/**
 * BFS out of the client roots, recording the first chain that reaches each
 * module so a red prints a path a reader can follow rather than a bare file
 * name. The fix is almost never in the file that holds the import.
 */
function clientGraph(files: readonly string[]): Graph {
  const sources = new Map<string, string>();
  const read = (f: string): string => {
    let s = sources.get(f);
    if (s === undefined) {
      s = readFileSync(f, "utf8");
      sources.set(f, s);
    }
    return s;
  };

  const roots = files.filter((f) => isClientRoot(f, read(f)));
  const chainTo = new Map<string, string[]>();
  const queue: string[] = [];
  for (const r of roots) {
    if (chainTo.has(r)) continue;
    chainTo.set(r, [rel(r)]);
    queue.push(r);
  }

  const offences: Offence[] = [];
  while (queue.length > 0) {
    const file = queue.shift()!;
    const chain = chainTo.get(file)!;
    for (const spec of runtimeSpecifiers(read(file), file)) {
      if (isNodeBuiltin(spec)) {
        offences.push({ chain, specifier: spec });
        continue;
      }
      const next = resolveImport(file, spec);
      if (next === null || chainTo.has(next)) continue;
      chainTo.set(next, [...chain, rel(next)]);
      queue.push(next);
    }
  }
  return {
    roots: roots.map(rel),
    reached: new Set([...chainTo.keys()].map(rel)),
    offences,
  };
}

/* ------------------------------------------------------------------ *
 *  Controls on the predicate itself, on synthetic source
 * ------------------------------------------------------------------ */

const specsOf = (src: string): string[] =>
  runtimeSpecifiers(src, join(SRC, "synthetic-probe.ts"));

const FLAGGED: ReadonlyArray<readonly [string, string]> = [
  ["prefixed default import", 'import path from "node:path";'],
  ["prefixed named import", 'import { readFileSync } from "node:fs";'],
  ["bare builtin name", 'import { createHash } from "crypto";'],
  ["side-effect import", 'import "node:fs";'],
  ["star re-export", 'export * from "node:fs";'],
  [
    "one value binding among types",
    'import { type Stats, readFileSync } from "node:fs";',
  ],
];

const NOT_FLAGGED: ReadonlyArray<readonly [string, string]> = [
  ["type-only import", 'import type { Stats } from "node:fs";'],
  [
    "import whose bindings are all inline-type",
    'import { type Stats, type Dirent } from "node:fs";',
  ],
  ["type-only re-export", 'export type { Stats } from "node:fs";'],
  [
    "dynamic import",
    'const f = async () => (await import("node:fs")).readFileSync;',
  ],
  ["a package", 'import { z } from "zod";'],
];

/* ------------------------------------------------------------------ *
 *  Assertions
 * ------------------------------------------------------------------ */

describe("no client bundle reaches a Node built-in", () => {
  const files = walk(SRC);
  const graph = clientGraph(files);

  describe("CONTROL: the predicate tells a runtime edge from an erased one", () => {
    for (const [label, src] of FLAGGED) {
      it(`flags a ${label}`, () => {
        expect(specsOf(src).filter(isNodeBuiltin)).not.toEqual([]);
      });
    }
    for (const [label, src] of NOT_FLAGGED) {
      it(`does not flag a ${label}`, () => {
        expect(specsOf(src).filter(isNodeBuiltin)).toEqual([]);
      });
    }
  });

  it("HEALTH CHECK: the file corpus is neither empty nor implausibly small", () => {
    // `[] ⊆ X` is vacuously true, so the corpus's own size is asserted before
    // anything is asserted about its members.
    expect(files.length).toBeGreaterThanOrEqual(200);
  });

  it("HEALTH CHECK: the walk sees every tracked source file", () => {
    // The second, independent bound on `walk`. A directory it stopped
    // descending into is invisible to every assertion below, and would look
    // exactly like a clean tree.
    const walked = new Set(files.map(rel));
    const missing = trackedSources()
      .map(rel)
      .filter((f) => !walked.has(f));
    expect(missing).toEqual([]);
  });

  it("HEALTH CHECK: the client roots are discovered, and there are many", () => {
    // Not a list of components — every file whose prologue opens with the
    // directive Next.js itself keys on. A collapse to a handful means the
    // detector broke, and a guard over three roots passes while proving
    // nothing.
    expect(graph.roots.length).toBeGreaterThanOrEqual(40);
  });

  it("HEALTH CHECK: the graph is not implausibly small", () => {
    // A BFS bug that collapses the graph makes every assertion below pass for
    // the wrong reason — and a red nobody can explain gets deleted.
    expect(graph.reached.size).toBeGreaterThanOrEqual(150);
  });

  it("POSITIVE CONTROL: the walk crosses a barrel into the module PR #134 changed", () => {
    // The exact path webpack printed, minus the last hop. If the resolver stops
    // handling `@/`, an `index.ts` barrel, or a `.tsx` root, this goes red
    // rather than the offender list quietly emptying.
    const absent = [
      "src/components/status/operations-dashboard.tsx",
      "src/components/status/alert-posture.tsx",
      "src/lib/workers/observability/index.ts",
      "src/lib/workers/observability/snapshot.ts",
      "src/lib/workers/heartbeat/capabilities.ts",
    ].filter((hop) => !graph.reached.has(hop));
    expect(absent).toEqual([]);
  });

  it("NEGATIVE CONTROL: a module reached ONLY by `import type` is not in the graph", () => {
    // `snapshot.ts` imports `heartbeat/types` type-only. That edge is erased
    // before webpack looks, so a walker that reports it is ADDING an edge — the
    // failure mode that makes a reachability guard sound certain about a module
    // nothing loads.
    //
    // Asserted in two halves, because "absent from the graph" is also what a
    // module NOBODY mentions looks like, and that control would be vacuous:
    //  1. a module already in the graph really does name it, type-only, so a
    //     widening walker would have somewhere to widen into;
    //  2. and it is still absent.
    const target = "src/lib/workers/heartbeat/types.ts";
    const namers = [...graph.reached].filter((f) => {
      const src = readFileSync(join(ROOT, f), "utf8");
      const typeOnly = parse(f, src).statements.filter(
        (st) =>
          ts.isImportDeclaration(st) &&
          isErasedImport(st) &&
          ts.isStringLiteral(st.moduleSpecifier) &&
          resolveImport(join(ROOT, f), st.moduleSpecifier.text) ===
            join(ROOT, target),
      );
      return typeOnly.length > 0;
    });
    expect(namers).not.toEqual([]);
    expect([target, graph.reached.has(target)]).toEqual([target, false]);
  });

  it('no module reachable from a "use client" root statically imports a Node built-in', () => {
    // Members, never a count. A non-zero here prints, for each offence, the
    // specifier and the whole chain from the client root that reaches it.
    const printed = graph.offences.map(
      (o) => `${o.specifier}\n    ${o.chain.join("\n    -> ")}`,
    );
    expect(printed).toEqual([]);
  });

  it("REGRESSION PIN: the heartbeat's node-only half stays out of the client graph", () => {
    // The specific relationship PR #134 broke, pinned by name on purpose: this
    // is the regression, not the corpus. `factory` -> `schema` ->
    // `build-fingerprint` -> node:crypto/fs/path is a live edge that a future
    // import of the factory from `snapshot.ts` re-opens in one line.
    const forbidden = [
      "src/lib/workers/heartbeat/factory.ts",
      "src/lib/workers/heartbeat/schema.ts",
      "src/lib/workers/build-fingerprint.ts",
    ].filter((f) => graph.reached.has(f));
    expect(forbidden).toEqual([]);
  });
});
