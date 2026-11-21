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
 *  - support modules: the runtime imports (type-only imports elided — a
 *    widened set is a defect too) of those entries that live under
 *    `src/tests` or `e2e`, plus every `*.child.ts` under `src/tests`, each
 *    of which must be named by some file in the set or it is dead;
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
    const byProject: Record<string, number> = {};
    for (const project of vitest.projects) {
      const { testFiles } = await project.globTestFiles();
      byProject[project.name] = testFiles.length;
      for (const f of testFiles) entries.add(rel(f));
      for (const f of project.config.setupFiles) setup.add(rel(f));
    }
    for (const f of vitest.config.globalSetup ?? [])
      setup.add(rel(path.resolve(ROOT, f)));
    return {
      entries: [...entries].sort(),
      setupFiles: [...setup].sort(),
      byProject,
    };
  } finally {
    await vitest.close();
  }
}

export interface E2eCorpus {
  listed: string[];
  readdir: string[];
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
    config?: { rootDir?: string };
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
  return { listed: [...listed].sort(), readdir: readdir.sort() };
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

function resolveSpecifier(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else if (spec.startsWith("@/")) base = path.join(ROOT, "src", spec.slice(2));
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

const SUPPORT = /^(src\/tests\/|e2e\/)/;

export interface SupportCorpus {
  modules: string[];
  children: string[];
  deadChildren: string[];
  broken: string[];
}

/** Support modules reached from `entries` by runtime imports, plus child scripts. */
export function supportCorpus(entries: readonly string[]): SupportCorpus {
  const entrySet = new Set(entries);
  const seen = new Set<string>(entries);
  const queue = [...entries];
  const broken: string[] = [];
  const support = new Set<string>();
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const abs = path.join(ROOT, file);
    const source = readFileSync(abs, "utf8");
    for (const spec of runtimeSpecifiers(abs, source)) {
      if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
      const resolved = resolveSpecifier(abs, spec);
      if (!resolved) {
        broken.push(`${file} -> ${spec}`);
        continue;
      }
      const r = rel(resolved);
      if (!SUPPORT.test(r)) continue;
      if (!entrySet.has(r)) support.add(r);
      if (!seen.has(r)) {
        seen.add(r);
        queue.push(r);
      }
    }
  }
  const children = walkFiles(path.join(ROOT, "src", "tests"))
    .map(rel)
    .filter((f) => f.endsWith(".child.ts"));
  const texts = [...entries, ...support].map((f) =>
    readFileSync(path.join(ROOT, f), "utf8"),
  );
  const deadChildren = children.filter(
    (c) => !texts.some((t) => t.includes(path.basename(c))),
  );
  for (const c of children) support.add(c);
  return {
    modules: [...support].sort(),
    children: children.sort(),
    deadChildren,
    broken,
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
