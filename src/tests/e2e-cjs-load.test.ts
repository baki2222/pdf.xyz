// @vitest-environment node
/**
 * Every module Playwright loads must compile as CommonJS.
 *
 * `package.json` has no `"type": "module"`, so Playwright loads the suite
 * through its CommonJS path: it transpiles each `.ts` file and hands it to
 * Node's CJS compiler. Anything that is only legal in an ES module — first of
 * all `import.meta` — is a `SyntaxError` there, thrown while the spec FILE
 * loads. The whole file then contributes zero tests, and a green run of the
 * remaining files does not say so.
 *
 * That happened. `e2e/client-proof/cases.ts` imported one constant from
 * `src/lib/pdf/redact.ts`, which imports `./render`, which uses
 * `import.meta.url`. `playwright test --list e2e/client-proof` went from
 * "39 tests in 1 file" to "0 tests in 0 files" — every client tool proof,
 * not just the one that line was written for. The author's replay loaded
 * `cases.ts` through a different loader from the one the suite uses, so the
 * check that ran was of the author's artifact, not the consumer's.
 *
 * This guard stands where the consumer stands:
 *
 *  - The SET is derived, not typed: `playwright.config.ts` itself, its
 *    `globalSetup`, and every file under its `testDir` that Playwright's
 *    default `testMatch` selects. Then the runtime import graph from there.
 *  - An edge is a RUNTIME edge: each file is transpiled (TypeScript elides
 *    imports used only as types, as Playwright's transform does with
 *    `onlyRemoveTypeImports: false`), and only the imports that survive are
 *    followed. Following `import type` would widen the set with modules
 *    that are never loaded.
 *  - The PROPERTY is checked with Node's own compiler, not a text search:
 *    each module is transpiled to CommonJS and compiled with `vm.Script`
 *    inside Node's CJS wrapper. `import.meta` fails there, and so does any
 *    other ESM-only syntax nobody has thought of yet.
 *  - A relative import that resolves to nothing is FATAL, the graph has a
 *    lower bound, and a synthetic control proves the detector flags a value
 *    import of an `import.meta` module while ignoring a type-only one.
 *
 * What it does not cover: dynamic `import()` and `require()` edges (loaded at
 * call time, not at list time), and packages under node_modules, which
 * Playwright does not transform.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import config from "../../playwright.config";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");

/** Playwright's default `testMatch` (docs: `**\/*.@(spec|test).?(c|m)[jt]s?(x)`). */
const DEFAULT_TEST_MATCH = /\.(spec|test)\.(c|m)?[jt]sx?$/;

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

const RESOLVE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".json",
  "/index.ts",
  "/index.tsx",
];

/** Resolve a specifier the way Playwright's loader would; null for bare packages. */
function resolveSpecifier(
  from: string,
  spec: string,
): string | "unresolved" | null {
  let base: string;
  if (spec.startsWith(".") || spec.startsWith("/"))
    base = path.resolve(path.dirname(from), spec);
  else if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else return null;
  // `./x.js` may name `./x.ts` in TypeScript sources.
  const stems = base.endsWith(".js") ? [base, base.slice(0, -3)] : [base];
  for (const stem of stems) {
    for (const suffix of RESOLVE_SUFFIXES) {
      const candidate = stem + suffix;
      if (existsSync(candidate) && statSync(candidate).isFile())
        return candidate;
    }
  }
  return "unresolved";
}

/** Static import/export-from specifiers that survive type elision. */
function runtimeSpecifiers(file: string, source: string): string[] {
  const esm = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const sf = ts.createSourceFile(
    file + ".out.js",
    esm,
    ts.ScriptTarget.ES2022,
    false,
    ts.ScriptKind.JS,
  );
  const specs: string[] = [];
  for (const statement of sf.statements) {
    if (
      (ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specs.push(statement.moduleSpecifier.text);
    }
  }
  return specs;
}

/** Node's CommonJS wrapper parameters, in its own order. */
const CJS_PARAMS = ["exports", "require", "module", "__filename", "__dirname"];

/**
 * Compile as Node's CJS loader would; the SyntaxError message, or null.
 *
 * Node compiles a module body with `vm.compileFunction` over these
 * parameters, NOT by splicing it into the `Module.wrap` string. The two
 * disagree on a leading `#!`: the splice moves it off the first line, where
 * it is a SyntaxError, while Node accepts it. That false red stopped PR #254
 * (scripts/indexnow-submit.mjs, which Node and Playwright both load fine).
 *
 * The extension is neutralised for the same reason. TypeScript treats a
 * `.mjs`/`.mts` file as ESM whatever `module` says, and emits its `import`s
 * untouched; Playwright's transform rewrites them to `require` like any other
 * file — which is why an `import.meta` in that same script DID fail to load.
 */
function cjsCompileError(file: string, source: string): string | null {
  const cjs = ts.transpileModule(source, {
    fileName: file.replace(/\.m([jt]sx?)$/, ".$1"),
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  try {
    vm.compileFunction(cjs, CJS_PARAMS, { filename: file });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

interface GraphReport {
  modules: string[];
  broken: string[];
  cjsFailures: { file: string; error: string; via: string[] }[];
}

function loadGraph(entries: string[]): GraphReport {
  const seen = new Map<string, string[]>(); // file → import chain that reached it
  const queue: string[] = [];
  for (const entry of entries) {
    seen.set(entry, [entry]);
    queue.push(entry);
  }
  const broken: string[] = [];
  const cjsFailures: GraphReport["cjsFailures"] = [];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (file.endsWith(".json")) continue;
    const source = readFileSync(file, "utf8");
    const chain = seen.get(file)!;
    const error = cjsCompileError(file, source);
    if (error) cjsFailures.push({ file, error, via: chain });
    for (const spec of runtimeSpecifiers(file, source)) {
      const resolved = resolveSpecifier(file, spec);
      if (resolved === null) continue;
      if (resolved === "unresolved") {
        broken.push(`${path.relative(ROOT, file)} → ${spec}`);
        continue;
      }
      if (!seen.has(resolved)) {
        seen.set(resolved, [...chain, resolved]);
        queue.push(resolved);
      }
    }
  }
  return { modules: [...seen.keys()], broken, cjsFailures };
}

const rel = (file: string) =>
  path.relative(ROOT, file).split(path.sep).join("/");

describe("Playwright loads every e2e module as CommonJS", () => {
  const pkg = JSON.parse(
    readFileSync(path.join(ROOT, "package.json"), "utf8"),
  ) as {
    type?: string;
  };
  const testDir = path.resolve(ROOT, config.testDir ?? ".");
  const specs = walkFiles(testDir).filter((f) => DEFAULT_TEST_MATCH.test(f));
  const globalSetup =
    typeof config.globalSetup === "string"
      ? [path.resolve(ROOT, config.globalSetup)]
      : [];
  const entries = [
    path.join(ROOT, "playwright.config.ts"),
    ...globalSetup,
    ...specs,
  ];

  it("still loads through the CommonJS path this guard models", () => {
    // If either of these changes, the loader changed and this guard must be
    // re-derived rather than trusted.
    expect(pkg.type).not.toBe("module");
    expect(config.testMatch).toBeUndefined();
  });

  it("derives a plausible entry set (health check)", () => {
    // 18 spec files at the time of writing; a walker that quietly finds none
    // would report the strongest possible pass.
    expect(specs.length).toBeGreaterThanOrEqual(15);
    expect(specs.map(rel)).toContain("e2e/client-proof/client-tools.spec.ts");
  });

  const graph = loadGraph(entries);

  it("resolves every relative import (a broken link is fatal)", () => {
    expect(graph.broken).toEqual([]);
  });

  it("walks a graph of plausible size, reaching src/ through the client proofs", () => {
    const modules = graph.modules.map(rel);
    // 40 modules at the time of writing (43 before the redact fix removed
    // render/engine/render-utils from the closure).
    expect(modules.length).toBeGreaterThanOrEqual(30);
    // Relationship, not a list: the client proof spec's cases are in its
    // closure, and the closure crosses into the product source it imports.
    expect(modules).toContain("e2e/client-proof/cases.ts");
    expect(modules.some((m) => m.startsWith("src/lib/pdf/"))).toBe(true);
  });

  it("compiles every loaded module as CommonJS", () => {
    const failures = graph.cjsFailures.map(
      ({ file, error, via }) =>
        `${rel(file)}: ${error}\n    via ${via.map(rel).join(" → ")}`,
    );
    expect(failures).toEqual([]);
  });
});

describe("the CommonJS load detector (controls)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-cjs-load-"));
  const write = (name: string, body: string) => {
    const file = path.join(dir, name);
    writeFileSync(file, body);
    return file;
  };
  write("meta-value.ts", `export const here = import.meta.url;\n`);
  write(
    "meta-type.ts",
    `export const there = import.meta.url;\nexport interface Shape { a: number }\n`,
  );
  write(
    "meta-elided.ts",
    `export const also = import.meta.url;\nexport type Id = string;\n`,
  );
  write("leaf.ts", `export const leaf = 1;\n`);
  const typeOnly = write(
    "type-only.ts",
    [
      `import type { Shape } from "./meta-type";`,
      `import { type Id } from "./meta-elided";`,
      `import { leaf } from "./leaf";`,
      `export const s: Shape | Id | number = leaf;`,
    ].join("\n"),
  );
  const valueImport = write(
    "value-import.ts",
    [`import { here } from "./meta-value";`, `export const x = here;`].join(
      "\n",
    ),
  );
  const broken = write(
    "broken.ts",
    `import { gone } from "./does-not-exist";\nexport const y = gone;\n`,
  );

  it("flags a value import that reaches import.meta (positive control)", () => {
    const report = loadGraph([valueImport]);
    expect(report.cjsFailures.map((f) => path.basename(f.file))).toEqual([
      "meta-value.ts",
    ]);
    expect(report.cjsFailures[0]?.error).toMatch(/import\.meta/);
  });

  it("does not follow type-only imports (the set must not widen)", () => {
    const report = loadGraph([typeOnly]);
    expect(report.modules.map((m) => path.basename(m)).sort()).toEqual([
      "leaf.ts",
      "type-only.ts",
    ]);
    expect(report.cjsFailures).toEqual([]);
  });

  it("accepts a leading hashbang, as Node does, and still flags import.meta behind one", () => {
    // Node's own loader is the reference: it requires this file without
    // complaint, so the detector must too.
    const hashbang = write(
      "hashbang.mjs",
      `#!/usr/bin/env node\nexport const z = 1;\n`,
    );
    const hashbangMeta = write(
      "hashbang-meta.mjs",
      `#!/usr/bin/env node\nexport const w = import.meta.url;\n`,
    );
    expect(loadGraph([hashbang]).cjsFailures).toEqual([]);
    const report = loadGraph([hashbangMeta]);
    expect(report.cjsFailures.map((f) => path.basename(f.file))).toEqual([
      "hashbang-meta.mjs",
    ]);
    expect(report.cjsFailures[0]?.error).toMatch(/import\.meta/);
  });

  it("reports an unresolvable relative import", () => {
    const report = loadGraph([broken]);
    expect(report.broken).toHaveLength(1);
    expect(report.broken[0]).toMatch(/broken\.ts → \.\/does-not-exist$/);
  });
});
