// @vitest-environment node
/**
 * Static guard for the load-bearing deployment rule: the web app must never
 * eagerly import the worker daemon runtime or a native subprocess module.
 * Those are Node-only (they shell out / pull the queue + S3 signer) and belong
 * exclusively to the out-of-band worker image and the CLI.
 *
 * A web route MAY still reach them behind `await import(...)` — the `/status`
 * route probes the native engine that way, and the adapter lazy-loads the
 * local-dev worker — so only STATIC imports (`import … from` / `export … from` /
 * side-effect `import "…"`) are forbidden. This encodes the boundary that keeps
 * `node:child_process` out of the web bundle and stops the app from ever
 * becoming the daemon; a new eager import from a route trips it.
 */
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/**
 * THE FORBIDDEN SET IS DISCOVERED, NOT TYPED.
 *
 * History: until 2026-09 this was a hand-typed list of six substrings. Eleven
 * non-test files import `node:child_process`; the list named three of them, so
 * a route statically importing `office-conversion/native` or
 * `html-render/native` passed — and the check was one hop deep, so a file that
 * reached `child_process` THROUGH another module (`local-dev.ts`, via
 * `pdf-security/native`) was invisible even when named.
 *
 * Now: seed with every file whose static imports include `child_process`,
 * plus {@link EXTRA_SEEDS}; close over "is statically imported by"; and require
 * the closure to be exactly the modules {@link ALLOWED} lets be Node-only.
 * `import type` / `export type` edges are NOT followed — they are erased at
 * runtime, and following them would widen the set (CLAUDE.md rule 4).
 */
const CHILD_PROCESS = new Set(["node:child_process", "child_process"]);

/**
 * Node-only modules that do not spawn but must not reach a web bundle either.
 * `pdf/noto-source` resolves the Noto TTFs out of node_modules with `node:fs`
 * for the copy step, the coverage generator and the guards; an eager import
 * from a component would drag the filesystem into the client bundle — the
 * exact regression the pdf-lib dynamic boundary exists to prevent. The browser
 * fetches these faces from `public/`; it never resolves a package.
 */
const EXTRA_SEEDS = ["src/lib/pdf/noto-source.ts"];

/**
 * The modules permitted to be in the Node-only closure — each reached only via
 * lazy `import()`, the CLI, or tests, never eagerly by a route, component or
 * barrel. The closure must EQUAL this set: a member missing from it is an
 * offender, and an entry the closure no longer reaches is stale.
 */
const ALLOWED = new Set(
  [
    "src/lib/workers/compression/native.ts",
    "src/lib/workers/pdf-security/native.ts",
    "src/lib/workers/pdf-structure/native.ts",
    "src/lib/workers/pdf-archive/native.ts",
    "src/lib/workers/html-render/native.ts",
    "src/lib/workers/office-conversion/native.ts",
    "src/lib/workers/ocr-native.ts",
    // The `pdftotext` subprocess runner and every deps builder that wires it.
    // The web path must keep using the pdfjs extractors in `@/lib/pdf/*`; these
    // are reached only through `daemon/runtime` and the lazy local-dev adapter.
    "src/lib/workers/pdf-text/native.ts",
    "src/lib/workers/pdf-office-export/native.ts",
    "src/lib/workers/table-extract/native.ts",
    // The four AI engines read a PDF's selectable text before prompting a model,
    // so they take the same native extractor rather than the browser-only pdfjs one.
    "src/lib/workers/summarize/native.ts",
    "src/lib/workers/translate/native.ts",
    "src/lib/workers/ai-extract/native.ts",
    "src/lib/workers/chat-with-pdf/native.ts",
    "src/lib/workers/local-dev.ts",
    "src/lib/workers/daemon/runtime.ts",
    // Seed via EXTRA_SEEDS; reached only by the copy/coverage scripts and tests.
    "src/lib/pdf/noto-source.ts",
    // Portable-pnpm subprocess resolution: only reached by the release CLI
    // scripts (`scripts/worker-release-*.ts`) and worker `cli.smoke.test.ts`
    // helpers, never by a web route/component/barrel.
    // (A `src/tests/exec-pnpm.ts` entry sat here naming a file that no longer
    // exists — the stale-entry check below found it.)
    "src/lib/workers/exec-pnpm.ts",
    // Subprocess runner for the worker `cli.smoke.test.ts` tier: spawns the real
    // `tsx scripts/worker-*.ts` binary end-to-end. Node-only by design and pulled
    // in exclusively by smoke-test helpers, never by a web route/component/barrel.
    "src/tests/run-worker-cli.ts",
    // Reads the shipped Noto TTFs so a test embeds the same bytes a browser
    // would have downloaded. Test-side only: `setup.ts` is vitest's setupFile
    // and `unicode-fonts.ts` is pulled in by `*.test.ts` files. Neither is
    // reachable from a route, a component or a barrel.
    "src/tests/unicode-fonts.ts",
    "src/tests/setup.ts",
    // Spawns `render-tool-pages.ts` in a fresh process and parses the tool
    // pages' JSON-LD back out of the markup. Imported only by `*.test.ts` copy
    // guards; nothing on a route, a component or a barrel reaches it.
    "src/tests/rendered-tool-pages.ts",
  ].map((rel) => path.join(ROOT, rel)),
);

/** All non-test `.ts`/`.tsx` files under `src/`. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Specifiers of STATIC, RUNTIME imports: `import … from`, `export … from`,
 * side-effect `import "…"`. Parsed with TypeScript, so `import type`,
 * `export type`, and an import whose every binding is `type`-qualified are
 * skipped (erased at runtime), and a dynamic `import()` is never an edge.
 */
function staticImportSpecifiers(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false);
  const specs: string[] = [];
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const clause = stmt.importClause;
      if (clause?.isTypeOnly) continue;
      const named = clause?.namedBindings;
      const allTypes =
        !!clause &&
        !clause.name &&
        !!named &&
        ts.isNamedImports(named) &&
        named.elements.length > 0 &&
        named.elements.every((e) => e.isTypeOnly);
      if (allTypes) continue;
      if (ts.isStringLiteral(stmt.moduleSpecifier))
        specs.push(stmt.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier) {
      if (stmt.isTypeOnly) continue;
      const clause = stmt.exportClause;
      if (
        clause &&
        ts.isNamedExports(clause) &&
        clause.elements.length > 0 &&
        clause.elements.every((e) => e.isTypeOnly)
      )
        continue;
      if (ts.isStringLiteral(stmt.moduleSpecifier))
        specs.push(stmt.moduleSpecifier.text);
    }
  }
  return specs;
}

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

/** Resolve `@/…` and relative specifiers to a real file, or null (packages). */
function resolveSpecifier(
  importer: string,
  spec: string,
  exists: (file: string) => boolean,
): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith("."))
    base = path.resolve(path.dirname(importer), spec);
  else return null;
  if (/\.tsx?$/.test(base) && exists(base)) return base;
  for (const ext of EXTENSIONS) if (exists(base + ext)) return base + ext;
  return null;
}

interface Graph {
  seeds: Set<string>;
  closure: Set<string>;
}

/**
 * ONE implementation over a file → source map, so the positive control below
 * runs the same detector the corpus does rather than a second opinion.
 */
function nodeOnlyClosure(sources: Map<string, string>): Graph {
  const exists = (f: string) => sources.has(f);
  const importedBy = new Map<string, Set<string>>();
  const seeds = new Set<string>(EXTRA_SEEDS.map((r) => path.join(ROOT, r)));
  for (const [file, source] of sources) {
    for (const spec of staticImportSpecifiers(file, source)) {
      if (CHILD_PROCESS.has(spec)) {
        seeds.add(file);
        continue;
      }
      const target = resolveSpecifier(file, spec, exists);
      if (!target) continue;
      if (!importedBy.has(target)) importedBy.set(target, new Set());
      importedBy.get(target)!.add(file);
    }
  }
  const closure = new Set<string>();
  const queue = [...seeds].filter(exists);
  while (queue.length) {
    const file = queue.pop()!;
    if (closure.has(file)) continue;
    closure.add(file);
    for (const importer of importedBy.get(file) ?? []) queue.push(importer);
  }
  return { seeds, closure };
}

const rel = (file: string) =>
  path.relative(ROOT, file).split(path.sep).join("/");

describe("web-eager modules do not statically import Node-only worker internals", () => {
  const files = walk(SRC);
  const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
  const { seeds, closure } = nodeOnlyClosure(sources);

  it("scans a meaningful number of source files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("discovers a plausible Node-only set (health check)", () => {
    // Eleven non-test files import child_process today; a collapse of the
    // walk or the resolver would shrink this and pass everything below.
    expect(seeds.size).toBeGreaterThanOrEqual(10);
    const members = [...closure].map(rel);
    for (const member of [
      "src/lib/workers/office-conversion/native.ts",
      "src/lib/workers/html-render/native.ts",
      // Reaches child_process only THROUGH pdf-security/pdf-structure native.
      "src/lib/workers/local-dev.ts",
      "src/lib/pdf/noto-source.ts",
    ])
      expect(members, member).toContain(member);
  });

  it("the Node-only closure is exactly the allowlist", () => {
    const offenders = [...closure].filter((f) => !ALLOWED.has(f)).map(rel);
    expect(offenders).toEqual([]);
    const stale = [...ALLOWED]
      .filter((f) => !closure.has(f))
      .map(rel)
      .sort();
    expect(stale).toEqual([]);
  });

  it("POSITIVE CONTROL: an eager route import is caught; a lazy one and a type-only one are not", () => {
    const route = path.join(SRC, "app/api/__probe__/route.ts");
    const inClosure = (source: string) =>
      nodeOnlyClosure(new Map([...sources, [route, source]])).closure.has(
        route,
      );
    expect(
      inClosure(
        'import { nativeOfficeConversionDeps } from "@/lib/workers/office-conversion/native";\nexport const x = nativeOfficeConversionDeps;',
      ),
    ).toBe(true);
    // Transitively: local-dev never names child_process itself.
    expect(inClosure('export { x } from "@/lib/workers/local-dev";')).toBe(
      true,
    );
    expect(
      inClosure(
        'export async function GET() { await import("@/lib/workers/office-conversion/native"); }',
      ),
    ).toBe(false);
    expect(
      inClosure(
        'import type { ChromiumSeams } from "@/lib/workers/html-render/native";\nexport type T = ChromiumSeams;',
      ),
    ).toBe(false);
  });

  it("the eager @/lib/workers barrel pulls in nothing Node-only", () => {
    const barrel = path.join(SRC, "lib/workers/index.ts");
    expect(closure.has(barrel)).toBe(false);
    const specs = staticImportSpecifiers(barrel, sources.get(barrel)!);
    expect(specs.some((s) => s.startsWith("node:"))).toBe(false);
  });

  it("the /status readiness surface stays out of the closure and probes lazily", () => {
    // The status route + page read presence-only readiness; they must reach it
    // through the node-free `daemon` barrel (args/daemon/readiness), never the
    // Node-only `daemon/runtime` wiring.
    const routeFile = path.join(SRC, "app/api/worker/status/route.ts");
    expect(closure.has(routeFile)).toBe(false);
    // …and it still probes the native engine, but lazily.
    expect(sources.get(routeFile)).toMatch(
      /await import\(\s*["'][^"']*compression\/native/,
    );
  });
});
