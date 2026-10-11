// @vitest-environment node
// @native-canvas
/**
 * The test files that load `@napi-rs/canvas` run on the forks pool, and no
 * other file is moved off threads — asked of vitest itself, not of the
 * config's text. The defect, the rule and the marker are in
 * `./native-canvas`; the runtime half of the guard is `./native-canvas-guard`.
 *
 * Two halves, because neither can see what the other sees:
 *
 *  - the guard setup file OBSERVES a load, at the point of consumption, and
 *    fails a thread that made one — but only for a file that runs;
 *  - this file asks vitest how it would assign EVERY test file, run or not:
 *    each marked file to the forks project and no other, every other file to
 *    threads, none lost between them.
 *
 * Its own subject is real: this file loads the native canvas (the positive
 * control below), so it is marked, and it must be among the files it finds.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";
import { createVitest } from "vitest/node";
import { cliExclude } from "../../vitest.config";
import {
  nativeCanvasModules,
  nativeCanvasTestFiles,
  TEST_FILE,
} from "./native-canvas";

const ROOT = process.cwd();
const repo = (file: string) =>
  path.relative(ROOT, file).split(path.sep).join("/");

/** Every test file under src, as vitest's `include` collects them. */
function allTestFiles(): string[] {
  const all: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (TEST_FILE.test(entry.name)) all.push(repo(full));
    }
  };
  walk(path.join(ROOT, "src"));
  return all;
}

describe("the native canvas, recognised where it is loaded", () => {
  it("names the module pdf.js loads, under either separator, and nothing else", async () => {
    expect(
      nativeCanvasModules([
        String.raw`E:\r\node_modules\.pnpm\@napi-rs+canvas@1.0.2\node_modules\@napi-rs\canvas\index.js`,
        "/r/node_modules/.pnpm/@napi-rs+canvas-linux-x64-gnu@1.0.2/node_modules/@napi-rs/canvas-linux-x64-gnu/skia.linux-x64-gnu.node",
        "/r/node_modules/@napi-rs/other/index.js",
        "/r/node_modules/canvas/index.js",
        "/r/node_modules/@napi-rs/canvasish.js",
      ]),
    ).toHaveLength(2);
    // Positive control, at the point of consumption: pdf.js's Node build
    // loads the module as it is evaluated, and the predicate finds it in
    // this process's own module cache. (Its first draft matched only "/" and
    // found nothing on Windows: a blind predicate reports the safest pass.)
    await import("pdfjs-dist/legacy/build/pdf.mjs");
    const cache = createRequire(import.meta.url).cache;
    expect(nativeCanvasModules(Object.keys(cache)).length).toBeGreaterThan(0);
  });
});

describe("vitest assigns the files that load it to the forks pool", () => {
  it("every marked file, and only those, to forks; every other file to threads; none lost", async () => {
    const vitest = await createVitest("test", {
      config: path.join(ROOT, "vitest.config.ts"),
      watch: false,
    });
    try {
      const byProject = new Map<
        string,
        { pool: string; isolate: boolean; files: string[] }
      >();
      for (const project of vitest.projects) {
        const { testFiles } = await project.globTestFiles();
        byProject.set(project.name, {
          pool: project.config.pool,
          isolate: project.config.isolate,
          files: testFiles.map(repo).sort(),
        });
      }
      expect([...byProject.keys()].sort()).toEqual([
        "native-canvas",
        "threads",
      ]);
      const native = byProject.get("native-canvas")!;
      const threads = byProject.get("threads")!;
      expect(native.pool).toBe("forks");
      expect(threads.pool).toBe("threads");
      // The runtime half is wired into both, or it observes nothing.
      for (const project of vitest.projects)
        expect(project.config.setupFiles.map(repo), project.name).toContain(
          "src/tests/native-canvas-guard.ts",
        );

      const marked = nativeCanvasTestFiles(ROOT);
      // Health, both ways (CLAUDE.md rule 4): the set this file belongs to,
      // of the size it was measured at (81 files observed loading the module
      // in a full run on 2026-10-11, and 2 gated on native engines) — not
      // empty, which would pass everything, and not the suite.
      expect(marked).toContain("src/tests/native-canvas-pool.test.ts");
      expect(marked.length).toBeGreaterThanOrEqual(60);
      const all = allTestFiles();
      expect(marked.length).toBeLessThan(all.length / 4);

      expect(native.files).toEqual(marked);
      expect(threads.files.filter((f) => marked.includes(f))).toEqual([]);
      // None lost between the two projects.
      expect([...native.files, ...threads.files].sort()).toEqual(all.sort());
    } finally {
      await vitest.close();
    }
  }, 60_000);
});

/**
 * `pnpm test` excludes the bundle tests (they need a build) with `--exclude`
 * — and vitest 4 applies a command-line `--exclude` to the root project
 * only. When this file's projects arrived, `pnpm test` silently began to list
 * all seven; `vitest.config.ts` now hands the flag to every project. Held
 * here to the script CI runs, read from package.json, through vitest's own
 * listing of what that command would run.
 */
describe("`pnpm test` runs what its script says", () => {
  it("every test file but the ones its --exclude names, across both projects", () => {
    const script = (
      JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
        scripts: Record<string, string>;
      }
    ).scripts.test!;
    const args = script.trim().split(/\s+/);
    // Health: the script is the vitest run this reads, and excludes real
    // files — an exclusion of nothing would pass whatever vitest did.
    expect(args.slice(0, 2)).toEqual(["vitest", "run"]);
    const excluded = cliExclude(args);
    expect(excluded.length).toBeGreaterThanOrEqual(1);
    for (const file of excluded)
      expect(existsSync(path.join(ROOT, file)), file).toBe(true);
    const out = execFileSync(
      process.execPath,
      [
        path.join(
          path.dirname(
            createRequire(import.meta.url).resolve("vitest/package.json"),
          ),
          "vitest.mjs",
        ),
        "list",
        "--filesOnly",
        ...args.slice(2),
      ],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    const listed = out
      .split(/\r?\n/)
      .map((line) => /^\[([\w-]+)\] (.+)$/.exec(line.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ project: m[1]!, file: m[2]! }));
    expect(new Set(listed.map((l) => l.project))).toEqual(
      new Set(["threads", "native-canvas"]),
    );
    const files = listed.map((l) => l.file);
    expect(files.filter((f) => excluded.includes(f))).toEqual([]);
    expect(files.length).toBe(allTestFiles().length - excluded.length);
  }, 120_000);
});

/**
 * A STALE MARKER, caught where it can be told for certain. A marked file
 * whose imports cannot reach pdf.js's Node build — static imports (not
 * type-only: those are erased) and `import()` of a named module — can never
 * load the module, and is moved off threads for nothing. The reverse does
 * not hold (a file that CAN reach it may not load it on every run), so this
 * is a necessary condition only; the first version of this check judged a
 * single run instead, and failed a correctly marked file 5 times in 25
 * (`native-canvas-guard.ts` has the history).
 *
 * The walker follows exactly the forms the marked files use, each one
 * removed in turn on 2026-10-11 to see a marked file go stale: `require()`,
 * `require.resolve()`, `createRequire(…)()`, `export … from`, pdf.js's
 * worker module and `@napi-rs/canvas` named directly were each followed by
 * a first draft and needed by no marked file — decoration (CLAUDE.md rule
 * 1). A file that reaches the module only through one of them will be named
 * stale here: add that form then, with that file as the case it catches.
 */
describe("every marked file can reach the native canvas through its imports", () => {
  const ts = createRequire(import.meta.url)("typescript") as typeof TS;
  /** pdf.js's Node build, which loads `@napi-rs/canvas` as it is evaluated. */
  const NATIVE_ENTRY = "pdfjs-dist/legacy/build/pdf.mjs";

  /** The modules `file` names to be loaded, as written. */
  function named(file: string): string[] {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const out: string[] = [];
    const visit = (node: TS.Node): void => {
      if (
        ts.isImportDeclaration(node) &&
        !node.importClause?.isTypeOnly &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        out.push(node.moduleSpecifier.text);
      else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const [first] = node.arguments;
        if (first && ts.isStringLiteralLike(first)) out.push(first.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return out;
  }

  /** A local module `spec` names from `from`, or null (a package). */
  function local(from: string, spec: string): string | null {
    const base = spec.startsWith("@/")
      ? path.join(ROOT, "src", spec.slice(2))
      : spec.startsWith(".")
        ? path.resolve(path.dirname(from), spec)
        : null;
    if (!base) return null;
    for (const ext of ["", ".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"])
      if (existsSync(base + ext) && statSync(base + ext).isFile())
        return base + ext;
    return null;
  }

  const visited = new Set<string>();
  const parsed = new Map<string, string[]>();
  /** Breadth-first through local modules, each parsed once. */
  function reaches(file: string): boolean {
    const seen = new Set([file]);
    const queue = [file];
    while (queue.length > 0) {
      const at = queue.shift()!;
      visited.add(at);
      let specs = parsed.get(at);
      if (!specs) parsed.set(at, (specs = named(at)));
      for (const spec of specs) {
        if (spec === NATIVE_ENTRY) return true;
        const next = local(at, spec);
        if (next && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  }

  it("each marked file reaches it; the helper module, dependency-free, does not", () => {
    // Controls, both ways: this file loads pdf.js (the positive control
    // above), and the marker's own module imports nothing that could.
    expect(
      reaches(path.join(ROOT, "src/tests/native-canvas-pool.test.ts")),
    ).toBe(true);
    expect(reaches(path.join(ROOT, "src/tests/native-canvas.ts"))).toBe(false);
    const marked = nativeCanvasTestFiles(ROOT);
    const stale = marked.filter((f) => !reaches(path.join(ROOT, f)));
    expect(stale, "marked, but nothing they import can load it").toEqual([]);
    // Health: the walk went through the import graph, not around it.
    expect(visited.size).toBeGreaterThanOrEqual(200);
  });
});
