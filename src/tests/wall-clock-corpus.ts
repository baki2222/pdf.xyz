import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

/**
 * The sets `wall-clock-bounds.test.ts` searches, each DERIVED from something
 * that must already be true (CLAUDE.md rule 4), never typed:
 *
 *  - vitest entries: vitest's own `globTestFiles()` per project, through
 *    `createVitest` on the real config (the `native-canvas-pool.test.ts`
 *    precedent), plus the setup and global-setup files each project runs —
 *    the hook layer, where `poll-leak-guard.ts` lives (critic P7);
 *  - e2e specs: a child `playwright test --list --reporter=json`, checked
 *    both ways against a readdir of `testDir` by Playwright's default
 *    testMatch;
 *  - config files: the vitest config(s) the projects resolved from and the
 *    Playwright config `--list` names — roots, since a config names a
 *    test-side module by a string literal;
 *  - support modules (`supportCorpus` has the three ways): runtime imports
 *    into `src/tests` and `e2e`, runtime imports elsewhere of a module that
 *    calls the test framework or that only the corpus imports (a reverse
 *    index over src, scripts and e2e), and string-literal references to test-side
 *    scripts (spawned children, child configs, their fixtures). Every
 *    test-side script must be reached, or named by something outside the
 *    suite, or it is reported as unreached — on f8d48720 children were
 *    found only by the `*.child.ts` suffix and the chain fixtures, four
 *    spawned scripts and any helper outside the two folders sat outside;
 *  - CI scripts: what the workflows run (`node scripts/x`, and each
 *    `pnpm <script>` through package.json), the corpus a timing bound in CI
 *    itself lives in (critic P10).
 */

export const ROOT = path.resolve(__dirname, "..", "..");

export const rel = (file: string): string =>
  path.relative(ROOT, file).split(path.sep).join("/");

/** Playwright's default `testMatch`. */
export const DEFAULT_TEST_MATCH = /\.(spec|test)\.(c|m)?[jt]sx?$/;

export interface VitestCorpus {
  entries: string[];
  setupFiles: string[];
  /** The config file(s) the projects were resolved from. */
  configFiles: string[];
  byProject: Record<string, number>;
}

/** vitest's own file list for every project, and the setup files they run. */
export async function vitestCorpus(
  config = path.join(ROOT, "vitest.config.ts"),
): Promise<VitestCorpus> {
  const { createVitest } = await import("vitest/node");
  const vitest = await createVitest("test", { config, watch: false });
  try {
    const entries = new Set<string>();
    const setup = new Set<string>();
    const configs = new Set<string>([rel(config)]);
    const byProject: Record<string, number> = {};
    for (const project of vitest.projects) {
      const { testFiles } = await project.globTestFiles();
      byProject[project.name] = testFiles.length;
      for (const f of testFiles) entries.add(rel(f));
      for (const f of project.config.setupFiles) setup.add(rel(f));
      const file = (project.vite?.config as { configFile?: string } | undefined)
        ?.configFile;
      if (file) configs.add(rel(file));
    }
    for (const f of vitest.config.globalSetup ?? [])
      setup.add(rel(path.resolve(ROOT, f)));
    return {
      entries: [...entries].sort(),
      setupFiles: [...setup].sort(),
      configFiles: [...configs].sort(),
      byProject,
    };
  } finally {
    await vitest.close();
  }
}

export interface E2eCorpus {
  listed: string[];
  readdir: string[];
  configFiles: string[];
}

/** What Playwright lists (visual included), and what a readdir finds. */
export function e2eCorpus(): E2eCorpus {
  const cli = path.join(
    path.dirname(
      createRequire(__filename).resolve("@playwright/test/package.json"),
    ),
    "cli.js",
  );
  const env: NodeJS.ProcessEnv = { ...process.env, VISUAL: "1" };
  for (const key of Object.keys(env))
    if (key.startsWith("VITEST")) delete env[key];
  const run = spawnSync(
    process.execPath,
    [cli, "test", "--list", "--reporter=json"],
    {
      cwd: ROOT,
      encoding: "utf8",
      env,
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const report = JSON.parse(run.stdout || "{}") as {
    config?: { rootDir?: string; configFile?: string };
    suites?: { file?: string; suites?: unknown[] }[];
    errors?: { message?: string }[];
  };
  if (!report.suites)
    throw new Error(
      `playwright --list printed no report (exit ${run.status}): ${(run.stderr ?? "").slice(-2000)}`,
    );
  if (report.errors?.length)
    throw new Error(
      `playwright --list reported errors: ${report.errors.map((e) => e.message).join("\n")}`,
    );
  const rootDir = report.config?.rootDir ?? path.join(ROOT, "e2e");
  // Top-level suites are the spec FILES; a nested suite's `file` may be a
  // helper that declares tests for its caller (e2e/first-visit.ts does).
  const listed = new Set<string>();
  for (const s of report.suites)
    if (s.file) listed.add(rel(path.resolve(rootDir, s.file)));
  const readdir = walkFiles(path.join(ROOT, "e2e"))
    .filter((f) => DEFAULT_TEST_MATCH.test(f))
    .map(rel);
  if (!report.config?.configFile)
    throw new Error("playwright --list named no config file");
  return {
    listed: [...listed].sort(),
    readdir: readdir.sort(),
    configFiles: [rel(report.config.configFile)],
  };
}

export function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

const SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".js",
  ".mjs",
  ".json",
  "/index.ts",
  "/index.tsx",
];

function resolveSpecifier(
  from: string,
  spec: string,
  root: string = ROOT,
): string | null {
  let base: string;
  if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else if (spec.startsWith("@/")) base = path.join(root, "src", spec.slice(2));
  else return null;
  const stems = base.endsWith(".js") ? [base, base.slice(0, -3)] : [base];
  for (const stem of stems)
    for (const s of SUFFIXES)
      if (existsSync(stem + s) && statSync(stem + s).isFile()) return stem + s;
  return null;
}

/** Static import specifiers that survive type elision (the runtime edges). */
export function runtimeSpecifiers(file: string, source: string): string[] {
  const out = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      verbatimModuleSyntax: false,
    },
  }).outputText;
  const sf = ts.createSourceFile("x.js", out, ts.ScriptTarget.ES2022, false);
  const specs: string[] = [];
  for (const s of sf.statements)
    if (
      (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) &&
      s.moduleSpecifier &&
      ts.isStringLiteral(s.moduleSpecifier)
    )
      specs.push(s.moduleSpecifier.text);
  return specs;
}

/** The test-side folders: Playwright's testDir and the suite's support folder. */
const TEST_SIDE = /^(src\/tests\/|e2e\/)/;
const SCRIPT_FILE = /\.[cm]?[jt]sx?$/;

export interface SupportCorpus {
  /** Support modules: every reached file that is not an entry. */
  modules: string[];
  /** Reached by a string-literal reference (a spawned script, a child config, a fixture). */
  children: string[];
  /** Reached by import from outside the test-side folders because it calls the test framework. */
  outside: string[];
  /**
   * Reached by import from outside the test-side folders because every
   * runtime importer it has (static or dynamic, in src, scripts and e2e)
   * is itself in the corpus: a module only tests use is test support,
   * whatever it calls (verifier, 2026-11-21: a timing helper in
   * `src/lib/` that threw on `performance.now() - t0 > 250` and called
   * neither `expect` nor `vi` was never scanned).
   */
  testOnly: string[];
  /** Test-side script files nothing in the corpus reaches: FATAL. */
  unreached: string[];
  /**
   * Test-side files reached only from OUTSIDE the suite (a hand-run script
   * under scripts/ importing a fixture maker), each with its referrer:
   * printed, not scanned — no CI test runs them.
   */
  external: string[];
  broken: string[];
}

/**
 * Whether a module outside the test-side folders is test support: it
 * imports a test framework, or calls one (`expect`, `vi.*`, `test`, hooks —
 * the suite runs with `globals: true`, so an import is not required).
 * Product code imported by a test is not: scanning it would widen the set
 * with production deadlines that no runner speed can fail a test on.
 */
export function callsTestFramework(file: string, source: string): boolean {
  if (
    runtimeSpecifiers(file, source).some((s) =>
      /^(vitest|@playwright\/test|@testing-library\/[\w-]+)$/.test(s),
    )
  )
    return true;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  // `expect` and `vi` only: product code declares its own `describe` and
  // `test` functions (batch-view.tsx, readiness.ts, print-chrome.ts), and a
  // helper module declares no tests of its own.
  const declared = new Set<string>();
  const calls: string[] = [];
  const visit = (n: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(n) ||
        ts.isVariableDeclaration(n) ||
        ts.isParameter(n)) &&
      n.name &&
      ts.isIdentifier(n.name)
    )
      declared.add(n.name.text);
    if (ts.isCallExpression(n)) {
      const c = n.expression.getText(sf).replace(/\s+/g, "");
      if (/^expect(\.soft|\.poll)?$|^vi\.\w+$/.test(c))
        calls.push(c.split(".")[0]!);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return calls.some((c) => !declared.has(c));
}

/** String literals in a file that name a script file (`"labels-probe-hang.ts"`, `"src/tests/x.child.ts"`). */
function scriptLiterals(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (
      (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) &&
      SCRIPT_FILE.test(n.text) &&
      /^[\w./@-]+$/.test(n.text)
    )
      out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * Support modules, derived three ways from the entries, to a fixed point:
 *
 *  - runtime imports into the test-side folders (type-only edges elided —
 *    a widened set is a defect too);
 *  - runtime imports anywhere else of a module that calls the test
 *    framework (a timing helper in `src/lib/x/` was invisible on f8d48720),
 *    or whose every runtime importer is already in the corpus — to a fixed
 *    point, so a helper chain only tests load is reached link by link
 *    (verifier, 2026-11-21: a helper that called neither `expect` nor `vi`
 *    was never scanned);
 *  - string-literal references to a test-side script file, which is how a
 *    child process, a child config and its fixture are named
 *    (`path.join(root, "src", "tests", "labels-probe-hang.ts")`,
 *    `include: ["src/tests/time-bound-chain.fixture.ts"]`) — by basename,
 *    since the path is often split into segments.
 *
 * Every test-side script file must be reached, or it is `unreached`: the
 * mirror check, so a new convention cannot sit outside the set unseen.
 */
export function supportCorpus(
  entries: readonly string[],
  opts: { root?: string } = {},
): SupportCorpus {
  const root = opts.root ?? ROOT;
  const relR = (file: string): string =>
    path.relative(root, file).split(path.sep).join("/");
  const entrySet = new Set(entries);
  const testSide = [
    ...walkFiles(path.join(root, "src", "tests")),
    ...walkFiles(path.join(root, "e2e")),
  ]
    .map(rel)
    .filter((f) => SCRIPT_FILE.test(f) && !f.endsWith(".d.ts"));
  const byBase = new Map<string, string[]>();
  for (const f of testSide) {
    const b = path.basename(f);
    byBase.set(b, [...(byBase.get(b) ?? []), f]);
  }
  const seen = new Set<string>(entries);
  const queue = [...entries];
  const broken: string[] = [];
  const support = new Set<string>();
  const children = new Set<string>();
  const outside = new Set<string>();
  const reach = (r: string, how: "import" | "literal") => {
    if (!entrySet.has(r)) support.add(r);
    if (how === "literal" && !entrySet.has(r)) children.add(r);
    if (!seen.has(r)) {
      seen.add(r);
      queue.push(r);
    }
  };
  const pending = new Set<string>();
  const testOnly = new Set<string>();
  const importers = productImporters(root);
  for (;;) {
    while (queue.length > 0) {
      const file = queue.shift()!;
      if (!SCRIPT_FILE.test(file)) continue;
      const abs = path.join(root, file);
      const source = readFileSync(abs, "utf8");
      for (const spec of runtimeSpecifiers(abs, source)) {
        if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
        const resolved = resolveSpecifier(abs, spec, root);
        if (!resolved) {
          broken.push(`${file} -> ${spec}`);
          continue;
        }
        const r = relR(resolved);
        if (!SCRIPT_FILE.test(r)) continue;
        if (TEST_SIDE.test(r)) reach(r, "import");
        else if (
          !seen.has(r) &&
          callsTestFramework(resolved, readFileSync(resolved, "utf8"))
        ) {
          outside.add(r);
          reach(r, "import");
        } else if (!seen.has(r)) pending.add(r);
      }
      for (const lit of scriptLiterals(file, source)) {
        const direct = [
          path.resolve(path.dirname(abs), lit),
          path.resolve(root, lit),
        ]
          .filter((p) => existsSync(p) && statSync(p).isFile())
          .map(rel)
          .filter((r) => TEST_SIDE.test(r));
        const named =
          direct.length > 0 ? direct : (byBase.get(path.basename(lit)) ?? []);
        // A bare basename shared by two test-side files names neither for sure.
        if (direct.length === 0 && named.length !== 1) continue;
        for (const r of named) reach(r, "literal");
      }
    }
    // The fixed point: a module every importer of which is now in the
    // corpus is test support, whatever it calls.
    let promoted = 0;
    for (const r of [...pending]) {
      if (seen.has(r)) {
        pending.delete(r);
        continue;
      }
      if (isConventionEntry(r, root)) continue;
      const by = importers(r);
      if (by.length > 0 && by.every((f) => seen.has(f))) {
        pending.delete(r);
        testOnly.add(r);
        reach(r, "import");
        promoted++;
      }
    }
    if (promoted === 0) break;
  }
  const reached = new Set([...entries, ...support]);
  const left = testSide.filter((f) => !reached.has(f)).sort();
  // Who outside the suite imports what is left, by the same resolver.
  const external: string[] = [];
  const unreached: string[] = [];
  if (left.length > 0) {
    const others = [
      ...walkFiles(path.join(root, "src")),
      ...walkFiles(path.join(root, "scripts")),
      ...walkFiles(path.join(root, "e2e")),
    ].filter((f) => SCRIPT_FILE.test(f));
    for (const f of left) {
      const stem = path.basename(f).replace(SCRIPT_FILE, "");
      const by = others.find((o) => {
        const text = readFileSync(o, "utf8");
        if (!text.includes(stem)) return false;
        return runtimeSpecifiers(o, text).some(
          (spec) =>
            (spec.startsWith(".") || spec.startsWith("@/")) &&
            resolveSpecifier(o, spec, root) === path.join(root, f),
        );
      });
      if (by) {
        external.push(`${f} <- imported by ${relR(by)}`);
        continue;
      }
      // A hand-run maker named by the README beside it, or by a script.
      const named = [
        ...walkFiles(path.join(root, "src")),
        ...walkFiles(path.join(root, "scripts")),
      ].find(
        (o) =>
          o !== path.join(root, f) &&
          !SCRIPT_FILE.test(o) &&
          /\.(md|py|sh|ya?ml)$/.test(o) &&
          readFileSync(o, "utf8").includes(f),
      );
      if (named) external.push(`${f} <- named by ${relR(named)}`);
      else unreached.push(f);
    }
  }
  return {
    modules: [...support].sort(),
    children: [...children].sort(),
    outside: [...outside].sort(),
    testOnly: [...testOnly].sort(),
    unreached,
    external,
    broken,
  };
}

/**
 * Files a framework or a deployment runs by convention, with no importer:
 * Next.js route segments, middleware and instrumentation, and anything a
 * package.json script, a Dockerfile or a workflow names. Imported only by a
 * test, such a file is still product code (an API test imports
 * `route.ts`), so it is never promoted to test support.
 */
const NEXT_CONVENTION =
  /^src\/(app\/(.*\/)?(page|layout|route|template|error|global-error|loading|not-found|default|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.[cm]?[jt]sx?|(middleware|proxy|instrumentation(-client)?)\.[cm]?[jt]s)$/;
const namedByDeploy = new Map<string, string>();
function isConventionEntry(r: string, root: string): boolean {
  if (NEXT_CONVENTION.test(r)) return true;
  let text = namedByDeploy.get(root);
  text ??= [
    "package.json",
    "Dockerfile",
    ...readdirSync(root).filter((f) =>
      /^Dockerfile\.|\.config\.[cm]?[jt]s$/.test(f),
    ),
    ...(existsSync(path.join(root, ".github", "workflows"))
      ? readdirSync(path.join(root, ".github", "workflows")).map((f) =>
          path.join(".github", "workflows", f),
        )
      : []),
  ]
    .filter((f) => existsSync(path.join(root, f)))
    .map((f) => readFileSync(path.join(root, f), "utf8"))
    .join("\n");
  namedByDeploy.set(root, text);
  return text.includes(r);
}

/**
 * Every runtime edge a file declares, by a lexical scan: static imports and
 * re-exports (`import type` / `export type` skipped: erased at runtime),
 * dynamic `import("…")` and `require("…")`. Lexical on purpose — it runs
 * over every script under src, scripts and e2e, and the only use is to ask
 * whether a module has an importer OUTSIDE the corpus, where a spurious
 * extra edge can only keep a module out (the conservative direction).
 */
const EDGE =
  /\b(?:(?:import|export)\s+(type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?|(?:import|require)\(\s*)["'`]([^"'`$\n]+)["'`]/g;
export function lexicalEdges(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(EDGE)) if (!m[1]) out.push(m[2]!);
  return out;
}

/**
 * The reverse runtime-import index over every script file under src,
 * scripts and e2e, built once on first use: who imports `r`.
 */
function productImporters(root: string): (r: string) => string[] {
  const relR = (file: string): string =>
    path.relative(root, file).split(path.sep).join("/");
  let index: Map<string, string[]> | undefined;
  return (r) => {
    if (!index) {
      const built = new Map<string, string[]>();
      for (const d of ["src", "scripts", "e2e"]) {
        if (!existsSync(path.join(root, d))) continue;
        for (const file of walkFiles(path.join(root, d))) {
          if (!SCRIPT_FILE.test(file) || file.endsWith(".d.ts")) continue;
          for (const spec of lexicalEdges(readFileSync(file, "utf8"))) {
            if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
            const t = resolveSpecifier(file, spec, root);
            if (!t || t === file) continue;
            const key = relR(t);
            const by = built.get(key) ?? [];
            if (!by.includes(relR(file))) by.push(relR(file));
            built.set(key, by);
          }
        }
      }
      index = built;
    }
    return index.get(r) ?? [];
  };
}

export interface WorkflowScript {
  workflow: string;
  /** What the step runs: `node scripts/x.mjs` or `pnpm name`. */
  run: string;
  /** The repo file it executes. */
  file: string;
}

/** Every repo script the CI workflows execute, through package.json for `pnpm`. */
export function workflowScripts(): WorkflowScript[] {
  const pkg = JSON.parse(
    readFileSync(path.join(ROOT, "package.json"), "utf8"),
  ) as {
    scripts: Record<string, string>;
  };
  const out: WorkflowScript[] = [];
  const dir = path.join(ROOT, ".github", "workflows");
  for (const name of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    const text = readFileSync(path.join(dir, name), "utf8");
    const workflow = `.github/workflows/${name}`;
    const add = (run: string, cmd: string) => {
      for (const m of cmd.matchAll(
        /\b(scripts\/[\w./-]+\.(?:mjs|cjs|js|ts|sh))\b/g,
      ))
        if (existsSync(path.join(ROOT, m[1]!)))
          out.push({ workflow, run, file: m[1]! });
    };
    for (const m of text.matchAll(/\bnode\s+(scripts\/[\w./-]+)/g))
      add(`node ${m[1]}`, m[1]!);
    for (const m of text.matchAll(/\bpnpm\s+(?:run\s+)?([\w:-]+)/g)) {
      const script = pkg.scripts[m[1]!];
      if (script) add(`pnpm ${m[1]}`, script);
    }
  }
  const unique = new Map(out.map((o) => [`${o.workflow} ${o.file}`, o]));
  return [...unique.values()].sort((a, b) =>
    `${a.workflow} ${a.file}`.localeCompare(`${b.workflow} ${b.file}`),
  );
}

/** A clock read in a script: what makes a CI script a possible wall-clock bound. */
export const CLOCK_READ =
  /\b(performance\.now|Date\.now|process\.hrtime)\b|\bnew Date\(\)\.getTime\(\)/;
