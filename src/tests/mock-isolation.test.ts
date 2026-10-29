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
 * It also explained why the one other mock in the repo was safe rather than
 * fortunate: the chat panel test mocked its client, so the poisoned
 * intermediary was the panel component, and no other test file imported the
 * panel. That stopped being true on 2026-09-27, when the tool-page guards began
 * importing every worker panel — by a specifier read from the page, which this
 * parser could not see — and the chat tests failed only in a full run. The
 * chat test now swaps its driver through a seam, so no `vi.mock` remains, and
 * a computed `import(...)` now makes its test an observer of everything.
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
/**
 * The tracked half alone, so a failure can name which files were transient.
 * Populated by {@link trackedSources}; only ever read in a failure message.
 */
let tracked = new Set<string>();

function trackedSources(): string[] {
  const listings = [
    execFileSync("git", ["ls-files", "src"], { encoding: "utf8" }),
    execFileSync("git", ["ls-files", "--others", "--exclude-standard", "src"], {
      encoding: "utf8",
    }),
  ].join("\n");
  tracked = new Set(
    execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim()),
  );
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
  /**
   * Every `vi.mock` / `vi.doMock` call with a literal specifier, resolved or
   * not: a package mock (`next/navigation`) runs the same detection as a
   * local one. Only the health check reads it.
   */
  mockCalls?: number;
  /**
   * True when this file calls `import(...)` with a specifier that is NOT a
   * string literal. Such a file can load any module, so the graph cannot say
   * which — and a test that reaches it is treated as observing EVERY module
   * (the safe direction: over-eager costs a conversation, a missed edge a red
   * CI). Added 2026-09-27: the tool-page guards import every worker panel by
   * a specifier read from the page, which this parser could not see, and one
   * of those panels was the intermediary the chat panel's `vi.mock` poisoned.
   */
  computedImport?: boolean;
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
  /**
   * A file listed a moment ago can be gone by the time it is read — the
   * untracked half of the corpus is by definition files somebody may be
   * creating and deleting right now. A vanished file cannot be a violation, so
   * it is skipped rather than thrown on.
   *
   * ⚠️ A HARDENING, NOT A DIAGNOSED FIX. This guard failed once in a full run
   * and has not reproduced since — the file alone is green, nothing `chdir`s,
   * and no test writes under `src/`. This race is the one mechanism here that
   * is real and cheap to remove, so it is removed; the corpus-bound message
   * below now carries what it actually saw, so the next occurrence does not
   * cost another investigation that ends in a hypothesis.
   */
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return { imports: [], mocks: [], mockCalls: 0 };
  }
  return parseSource(file, source);
}

/** {@link parse} on source text — so detection can be proven on a sample. */
function parseSource(file: string, source: string): Parsed {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  const mocks: string[] = [];
  let mockCalls = 0;
  let computedImport = false;

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
          mockCalls += 1;
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
        } else if (arg) {
          computedImport = true;
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return {
    imports,
    mocks,
    mockCalls,
    ...(computedImport ? { computedImport } : {}),
  };
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
          file !== mocker &&
          (poisoned.some((module) => reach(file).has(module)) ||
            // A computed `import(...)` can load any module, poisoned ones
            // included; the graph cannot rule it out, so it does not.
            [...reach(file)].some(
              (module) => graph.get(module)?.computedImport,
            )),
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
  spec: Record<
    string,
    { imports?: string[]; mocks?: string[]; computedImport?: boolean }
  >,
): Map<string, Parsed> {
  return new Map(
    Object.entries(spec).map(([file, node]) => [
      file,
      {
        imports: node.imports ?? [],
        mocks: node.mocks ?? [],
        ...(node.computedImport ? { computedImport: true } : {}),
      },
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

describe("a computed import observes everything", () => {
  it("PROBE D: a test that loads modules by a computed specifier is an observer of every poisoned module", () => {
    // The shape that broke the chat panel's tests in a full run: the mocker
    // poisons panel.tsx; a guard test loads every panel through a helper that
    // imports by a path read at runtime. No literal edge reaches panel.tsx.
    const graph = graphOf({
      "panel.test.tsx": { mocks: ["client.ts"], imports: ["panel.tsx"] },
      "guard.test.tsx": { imports: ["dispatch.ts"] },
      "dispatch.ts": { computedImport: true },
      "panel.tsx": { imports: ["client.ts"] },
      "client.ts": {},
    });
    const found = findMockLeaks(graph, ["panel.test.tsx", "guard.test.tsx"]);
    expect(found).toHaveLength(1);
    expect(found[0]!.observers).toEqual(["guard.test.tsx"]);
  });

  it("POSITIVE CONTROL: without the computed import the same graph is clean", () => {
    const graph = graphOf({
      "panel.test.tsx": { mocks: ["client.ts"], imports: ["panel.tsx"] },
      "guard.test.tsx": { imports: ["dispatch.ts"] },
      "dispatch.ts": {},
      "panel.tsx": { imports: ["client.ts"] },
      "client.ts": {},
    });
    expect(findMockLeaks(graph, ["panel.test.tsx", "guard.test.tsx"])).toEqual(
      [],
    );
  });

  it("the parser sees a mock, a literal import and a computed one in source", () => {
    const parsed = parseSource(
      "src/tests/sample.test.ts",
      [
        'vi.mock("@/lib/jobs/types");',
        'await import("@/lib/jobs/index");',
        "await import(`${dir}/x.ts`);",
      ].join("\n"),
    );
    expect(parsed.mocks).toEqual(["src/lib/jobs/types.ts"]);
    expect(parsed.imports).toContain("src/lib/jobs/index.ts");
    expect(parsed.computedImport).toBe(true);
  });
});

describe("no mock is observable by another test file", () => {
  it("holds across every tracked test file", () => {
    const files = trackedSources();

    // BOUND THE CORPUS. A collapsed file list makes every assertion below
    // vacuously true and reports the strongest possible pass.
    const transient = files.filter((file) => !tracked.has(file));
    expect(
      files.length,
      `the source listing is implausibly small (${files.length} files, ` +
        `${transient.length} untracked: ${transient.slice(0, 8).join(", ") || "none"}) ` +
        "— the corpus, not the code, is what failed",
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

    // And vi.mock detection must be shown to WORK on the real tree, or the
    // check below asks nothing. Until 2026-09-27 this counted test files that
    // mock a LOCAL module. The last one (the Chat with PDF panel test) now
    // hands its driver in as a prop, precisely so the panel is not left cached
    // against a stub, so that count is 0 for the good reason, and its own
    // message said so ("either that is true, or ..."). The property this check
    // needs is "the parser sees a vi.mock call", and a package mock
    // (`next/navigation`, `pdf-lib`) goes through exactly that code; resolving
    // its specifier is the same `resolveSpecifier` the import graph is proven
    // on above.
    const mockCalls = testFiles.reduce(
      (n, file) => n + (graph.get(file)?.mockCalls ?? 0),
      0,
    );
    expect(
      mockCalls,
      "no vi.mock / vi.doMock call was found in any test file — detection has stopped working and this guard is inert",
    ).toBeGreaterThan(0);
    // Detection must be SEEN working before a clean result means anything.
    // This used to require a live `vi.mock` somewhere in the corpus; since
    // 2026-09-27 there is none (the chat panel test swaps its driver through
    // a seam instead), so detection is proven on a sample ("the parser sees a
    // mock…" above) and here on the real graph, where the tool-page guards'
    // computed panel imports must be found — or they observe nothing.
    const computed = files.filter((file) => graph.get(file)?.computedImport);
    expect(
      computed,
      "no computed import() found — the tool-page dispatch helper uses one, so detection is broken",
    ).toContain("src/tests/worker-panel-dispatch.ts");

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
    // A parse of every tracked source: about 1 s alone, and it outgrew
    // vitest's 5 s default under a loaded full run once the home desk added
    // its files (timed out once on 2026-10-10, 2/2 green alone) — the same
    // class as 2b20baa7 (raster-boundary).
  }, 30_000);

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

/**
 * The same shared cache, one hop over, with no mock involved.
 *
 * `findMockLeaks` asks about modules evaluated WHILE A MOCK WAS ACTIVE. That is
 * a real question and it is not the only one: a test file that statically
 * imports ANOTHER TEST FILE is evaluated by it, and under `isolate: false` the
 * second file's own turn is then a module-cache hit. Its `describe()` blocks
 * never re-register and vitest kills the run with
 *
 *     Error: No test suite found in file …
 *
 * Found on 2026-08-22 while rescuing PR #130, in 2 of 7 local full runs, and it
 * had nothing to do with that branch: `guard-wrap-controls.test.ts` imported a
 * pattern list from `transmission-honesty.test.ts`. Order-dependent, so it is
 * intermittent, and it reproduces on demand from the two files alone —
 *
 *     npx vitest run --no-file-parallelism --sequence.shuffle.files \
 *       --sequence.seed=2 src/lib/tools/guard-wrap-controls.test.ts \
 *       src/lib/tools/transmission-honesty.test.ts
 *
 * The corpus is the one above — every tracked and untracked source file, edges
 * from their real import statements — so this cannot go stale against a file it
 * does not name. The fix at the time was to move the shared list into
 * `src/lib/tools/transmission-claims.ts`; the general rule is that shared
 * fixtures belong in a module, not in a file vitest also collects.
 */
describe("no test file is imported by another test file", () => {
  it("holds across every tracked test file", () => {
    const files = trackedSources();
    expect(
      files.length,
      "the source listing is implausibly small — the corpus, not the code, is what failed",
    ).toBeGreaterThan(500);

    const graph = new Map<string, Parsed>();
    for (const file of files) graph.set(file, parse(file));

    const testFiles = files.filter(isTestFile);
    expect(
      testFiles.length,
      "no test files were found, so this guard is asking nothing",
    ).toBeGreaterThan(300);

    // POSITIVE CONTROL: the detection is `an edge whose TARGET is a test file`.
    // Prove that predicate can fire at all before trusting it to report none —
    // run it over a graph that contains exactly the edge this guard exists for.
    const control = graphOf({
      "a.test.ts": { imports: ["b.test.ts"] },
      "b.test.ts": { imports: ["helper.ts"] },
    });
    expect(
      importedTestFiles(control, ["a.test.ts", "b.test.ts"]),
      "the detection cannot see a test-file import even when handed one",
    ).toEqual(["a.test.ts -> b.test.ts"]);

    expect(
      importedTestFiles(graph, testFiles),
      "a test file statically imports another test file. Under `isolate: false` " +
        "the imported file is evaluated by the importer, so when vitest runs it " +
        "on its own the module cache answers and no suite registers: " +
        "`No test suite found in file …`. Move whatever is shared into a plain " +
        "module — a file vitest collects is not a fixture library.",
    ).toEqual([]);
    // A whole-repo parse, like the guard above: under CI's full unit run it
    // passed 5s (PR #222, Linux) with nothing in its corpus at fault. The
    // budget is the runtime's, not the assertion's.
  }, 30_000);
});

/** Every `importer -> imported` edge whose target is itself a test file. */
function importedTestFiles(
  graph: ReadonlyMap<string, Parsed>,
  testFiles: readonly string[],
): string[] {
  const isTest = new Set(testFiles);
  const edges: string[] = [];
  for (const importer of testFiles) {
    for (const target of graph.get(importer)?.imports ?? []) {
      if (target !== importer && isTest.has(target)) {
        edges.push(`${importer} -> ${target}`);
      }
    }
  }
  return edges.sort();
}
