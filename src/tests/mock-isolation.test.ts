// @vitest-environment node
/**
 * A `vi.mock` must not be observable by another test file.
 *
 * `vitest.config.ts` runs `pool: "threads"` with `isolate: false`, deliberately:
 * per-file isolation re-imports and re-transforms a deep, mostly-pure worker
 * graph ~900 times and the full run never finished inside CI's budget. The
 * config justifies it with a sentence — *"the tests are pure/content-free and
 * carry no cross-file module state, so this is safe"* — and **nothing checked
 * it.** A comment asserting an invariant that nothing tests is the defect this
 * project's house rules exist to prevent, in the one place no test can fail.
 *
 * It cost a red CI. `workers/delivery-cap.chain.test.ts` mocked `@/lib/workers`
 * to capture an adapter call, and three assertions in
 * `app/api/worker/local-dev-flow.test.ts` then saw `202` — the other file's stub
 * status — where the local-dev adapter returns `201`.
 *
 * **It presented as a platform bug and was not one.** File-to-worker assignment
 * follows the CPU count, so those files shared a thread on Linux CI and not on a
 * Windows dev box. Every local instrument — the file alone, its directory, the
 * full suite, a stash-compare against the known-fail list — was green, because
 * all of them were measuring the wrong machine. `--no-file-parallelism`
 * reproduces it anywhere.
 *
 * ── THE MECHANISM, MEASURED — AND IT IS NOT "A MOCK LEAKS" ──────────────────
 *
 * The first version of this guard asserted that a `vi.mock` leaks into the next
 * file. **That reason did not reproduce**, and a reason that does not reproduce
 * is worse than no reason. Two probes:
 *
 *   A. a file that mocks `@/lib/workers` and imports nothing else — the next
 *      file is unaffected. The MOCK REGISTRY is reset per test file.
 *   B. the same file, plus one `await import("@/app/api/jobs/route")` — the next
 *      file fails with exactly the CI failures.
 *
 * So what survives is not the mock: it is the **evaluated module instance**.
 * Under `isolate: false` the module cache is shared, and a module evaluated
 * while the mock was active keeps its binding to the stub. The next file
 * re-imports that same cached module and gets the stub through it, with a
 * perfectly clean mock registry of its own.
 *
 * **That makes the mocked module itself the wrong subject.** The dangerous set
 * is the INTERMEDIARIES — modules the mocking file caused to be evaluated that
 * import the mocked module transitively. `@/lib/workers` was never the problem;
 * `app/api/jobs/route`, which both files import, was.
 *
 * It also explains why the one other mock in the repo is safe rather than
 * fortunate: the panel test mocks its client, so the poisoned intermediary is
 * the panel component, and no other test file imports the panel. Nothing needs
 * grandfathering.
 *
 * The corpus is DISCOVERED — every tracked source file, the graph built from
 * their actual import statements — rather than named, because a list of files
 * cannot see a file it does not name.
 */
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, posix } from "node:path";
import { describe, expect, it } from "vitest";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const isTestFile = (file: string): boolean => /\.(test|spec)\.tsx?$/.test(file);

/**
 * Every source file vitest would run or import — tracked AND
 * untracked-but-not-ignored.
 *
 * `git ls-files` alone was the first version, and it had a hole exactly where
 * it matters: vitest's `include` glob runs any `src/**` test file, so a brand
 * new one — the moment you would most want this guard — was invisible to it.
 * Found by writing two probe files and watching the guard report a clean pass
 * over both.
 *
 * Still derived from git rather than from a filesystem walk, so ignored build
 * output stays out; `--others --exclude-standard` is precisely "files that
 * would be committed".
 */
function trackedSources(): string[] {
  const listings = [
    execFileSync("git", ["ls-files", "src"], { encoding: "utf8" }),
    execFileSync("git", ["ls-files", "--others", "--exclude-standard", "src"], {
      encoding: "utf8",
    }),
  ].join("\n");
  return [...new Set(listings.split("\n").map((line) => line.trim()))].filter(
    (line) => /\.tsx?$/.test(line),
  );
}

/**
 * Resolve an import specifier to a tracked file path, or `null`.
 *
 * `@/x` is the tsconfig alias for `src/x`. Bare package specifiers resolve to
 * nothing here on purpose: mocking `node:fs` or a dependency is a different
 * question, and pretending to answer it would overclaim.
 */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = posix.join("src", spec.slice(2));
  else if (spec.startsWith("."))
    base = posix.normalize(posix.join(dirname(fromFile), spec));
  else return null;

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

interface Parsed {
  /** Files this one imports, resolved. Type-only imports included — see below. */
  imports: string[];
  /** Specifiers passed to `vi.mock` / `vi.doMock`, resolved. */
  mocks: string[];
}

/**
 * Type-only imports are KEPT here, and that is deliberate even though a
 * different guard in this repo was wrong for including them.
 *
 * There the question was "does this module get loaded at runtime", and a
 * `import type` edge is erased, so following it ADDED edges that do not exist.
 * Here the question is "could this file's module registry entry be the mocked
 * one", and the safe direction is the opposite: an edge that turns out to be
 * type-only makes this guard slightly over-eager, which costs a conversation.
 * Missing a real edge costs a red CI on another platform.
 */
function parse(file: string): Parsed {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  const mocks: string[] = [];

  const walk = (node: TS.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const target = resolveSpecifier(file, node.moduleSpecifier.text);
      if (target) imports.push(target);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : "";
      const receiver =
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression)
          ? callee.expression.text
          : "";
      if (receiver === "vi" && (name === "mock" || name === "doMock")) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          const target = resolveSpecifier(file, arg.text);
          if (target) mocks.push(target);
        }
      }
      // A dynamic `import("…")` puts the module in the same registry.
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          const target = resolveSpecifier(file, arg.text);
          if (target) imports.push(target);
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return { imports, mocks };
}

/** Every file reachable from `roots` through import edges. */
function closure(
  roots: readonly string[],
  graph: ReadonlyMap<string, Parsed>,
): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of graph.get(file)?.imports ?? []) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

/** A module the mocking file caused to be evaluated against a stub. */
interface Violation {
  readonly mocker: string;
  readonly target: string;
  /** Modules evaluated while the mock was active that bind to it. */
  readonly poisoned: string[];
  /** Other test files that re-import one of those cached modules. */
  readonly observers: string[];
}

/**
 * The detection, as a pure function of a graph.
 *
 * Pure so the probes that established the mechanism can be replayed as
 * assertions rather than described in a comment. A guard whose logic is only
 * ever run against a corpus that passes is a guard nobody has seen work — and
 * the prose version of this mechanism was wrong the first time.
 */
function findMockLeaks(
  graph: ReadonlyMap<string, Parsed>,
  testFiles: readonly string[],
): Violation[] {
  const cache = new Map<string, Set<string>>();
  const reach = (file: string): Set<string> => {
    const hit = cache.get(file);
    if (hit) return hit;
    const value = closure([file], graph);
    cache.set(file, value);
    return value;
  };

  const violations: Violation[] = [];
  for (const mocker of testFiles) {
    const mocks = graph.get(mocker)?.mocks ?? [];
    if (mocks.length === 0) continue;
    const evaluated = reach(mocker);
    for (const target of mocks) {
      // The mocked module itself is EXCLUDED: probe A showed its registry entry
      // is reset for the next file. What survives is every OTHER module that
      // was evaluated while the mock was active and binds to it.
      const poisoned = [...evaluated].filter(
        (file) => file !== mocker && file !== target && reach(file).has(target),
      );
      if (poisoned.length === 0) continue;
      const observers = testFiles.filter(
        (file) =>
          file !== mocker && poisoned.some((module) => reach(file).has(module)),
      );
      if (observers.length > 0) {
        violations.push({ mocker, target, poisoned, observers });
      }
    }
  }
  return violations;
}

/** Build a tiny graph by hand, for the probes below. */
function graphOf(
  spec: Record<string, { imports?: string[]; mocks?: string[] }>,
): Map<string, Parsed> {
  return new Map(
    Object.entries(spec).map(([file, node]) => [
      file,
      { imports: node.imports ?? [], mocks: node.mocks ?? [] },
    ]),
  );
}

describe("the detection reproduces the probes that found the mechanism", () => {
  it("PROBE A: mocking a module without evaluating anything that binds to it is safe", () => {
    // Measured: a file that mocks `@/lib/workers` and imports nothing else
    // leaves the next file untouched. The mock registry is per test file.
    const graph = graphOf({
      "a.test.ts": { mocks: ["m.ts"] },
      "b.test.ts": { imports: ["route.ts"] },
      "route.ts": { imports: ["m.ts"] },
      "m.ts": {},
    });
    expect(findMockLeaks(graph, ["a.test.ts", "b.test.ts"])).toEqual([]);
  });

  it("PROBE B: mocking it AND evaluating a module that binds to it is not", () => {
    // Measured: adding one `await import("@/app/api/jobs/route")` to that same
    // file reproduces the CI failures exactly. The module cache is shared.
    const graph = graphOf({
      "a.test.ts": { mocks: ["m.ts"], imports: ["route.ts"] },
      "b.test.ts": { imports: ["route.ts"] },
      "route.ts": { imports: ["m.ts"] },
      "m.ts": {},
    });
    const found = findMockLeaks(graph, ["a.test.ts", "b.test.ts"]);
    expect(found).toHaveLength(1);
    expect(found[0]!.poisoned).toEqual(["route.ts"]);
    expect(found[0]!.observers).toEqual(["b.test.ts"]);
  });

  it("PROBE C: a poisoned module no other test reaches is still safe", () => {
    // The panel/client shape. The intermediary exists and nothing else imports
    // it, which is why the repo's other mock needs no exception rather than a
    // grandfathered one — an exception is a guard licensing a defect.
    const graph = graphOf({
      "panel.test.tsx": { mocks: ["client.ts"], imports: ["panel.tsx"] },
      "client.test.ts": { imports: ["client.ts"] },
      "panel.tsx": { imports: ["client.ts"] },
      "client.ts": {},
    });
    expect(findMockLeaks(graph, ["panel.test.tsx", "client.test.ts"])).toEqual(
      [],
    );
  });
});

describe("no mock is observable by another test file", () => {
  it("holds across every tracked test file", () => {
    const files = trackedSources();

    // BOUND THE CORPUS. A collapsed file list makes every assertion below
    // vacuously true and reports the strongest possible pass.
    expect(
      files.length,
      "the tracked source listing is implausibly small — the corpus, not the code, is what failed",
    ).toBeGreaterThan(500);

    const graph = new Map<string, Parsed>();
    for (const file of files) graph.set(file, parse(file));

    const testFiles = files.filter(isTestFile);
    expect(
      testFiles.length,
      "no test files were found, so this guard is asking nothing",
    ).toBeGreaterThan(300);

    const edges = [...graph.values()].reduce((n, p) => n + p.imports.length, 0);
    expect(
      edges,
      "the import graph is implausibly sparse — resolution is broken, and a " +
        "broken graph makes every reachability answer below `false`",
    ).toBeGreaterThan(1_000);

    // POSITIVE CONTROL on the real graph: prove the walk finds a module that is
    // obviously reached from many test files, before trusting it to say a
    // module is reached from none.
    const barrel = "src/lib/jobs/index.ts";
    expect(files, "the control module is not in the corpus").toContain(barrel);
    const reachesBarrel = testFiles.filter((file) =>
      closure([file], graph).has(barrel),
    );
    expect(
      reachesBarrel.length,
      `only ${reachesBarrel.length} test files reach the jobs barrel — the walk is broken, not the code`,
    ).toBeGreaterThan(20);

    // And a mock must actually be FOUND, or the check below asks nothing.
    const mockers = testFiles.filter(
      (file) => (graph.get(file)?.mocks ?? []).length > 0,
    );
    expect(
      mockers.length,
      "no test file mocks anything — either that is true, or vi.mock detection has stopped working and this guard is inert",
    ).toBeGreaterThan(0);

    const violations = findMockLeaks(graph, testFiles);
    expect(
      violations.map(
        (v) =>
          `${v.mocker} mocks ${v.target}; ${v.poisoned.slice(0, 3).join(", ")} ` +
          `stays cached bound to that stub and is re-imported by ${v.observers.slice(0, 3).join(", ")}`,
      ),
      "a test file mocked a module and then evaluated something that binds to " +
        "it. Under `isolate: false` that module stays in the shared cache with " +
        "the stub, so the next file in the same worker runs against it — " +
        "silently, and only on machines whose CPU count puts them in one thread.",
    ).toEqual([]);
  });

  it("still applies — the config has not turned isolation back on", () => {
    /**
     * The guard's own exit condition, named as a PROPERTY rather than left
     * implicit: this file is only necessary while test files share a module
     * cache. If `isolate` is ever restored, nothing can leak and this should be
     * deleted rather than worked around — so the day that happens, this line
     * says so instead of the guard quietly policing something that stopped
     * mattering.
     */
    const config = readFileSync("vitest.config.ts", "utf8");
    expect(
      /isolate:\s*false/.test(config),
      "vitest no longer shares a module cache between test files — nothing can leak, so this guard has outlived its reason and should be removed rather than relaxed",
    ).toBe(true);
  });
});
