// @vitest-environment node
/**
 * Every tool run reaches an outcome reporter — found by DISCOVERY, not by a
 * list of runners.
 *
 * THE DEFECT (review of 6a2fc17): `tool-outcome.ts` said outcomes were "sent
 * from the two places every run already passes through, so no runner or panel
 * can forget" — `useAsyncRun`, `runSecurityJob`, `runWorkerOcr`. Three run
 * paths passed through none of them: compress's on-device analysis (its own
 * `{ busy }` state) and its deep `runWorkerCompression` job (its own
 * `/api/jobs` lifecycle), the batch runner (its own `runningRef`), and
 * `runWorkerWebpageToPdf` (its own `/api/jobs` lifecycle, no upload). So
 * compress-pdf and webpage-to-pdf sent no `tool_completed` and no
 * `tool_failed`. `event-call-sites.test.ts` could not see it — it checks that
 * each EVENT has a sender, not that each RUN reaches one — so the docblock was
 * the only guard of coverage. A comment is not a guard.
 *
 * WHAT THIS DISCOVERS (rule 4: derive the set from something that must
 * already be true):
 *
 *  A. Job lifecycles — every call whose first argument is `"/api/jobs"` (job
 *     creation; a poll is `/api/jobs/${id}`). The function holding it must not
 *     be exported, and every reference to it must sit inside a
 *     `withToolOutcome(...)` call. Cross-checked against an independent signal:
 *     the modules that import `pollJobToTerminal` must be exactly the modules
 *     that create jobs, so a lifecycle that hides its URL in a constant still
 *     turns up.
 *  B. Hand-rolled run state — every function that declares its own run state
 *     (`const [busy, …] = useState`, `useState({ busy: … })`,
 *     `const runningRef = useRef`) must call something that reaches a
 *     reporter. "Reaches" is computed, not typed: the seeds are the functions
 *     that `track()` a `tool_completed`/`tool_failed`, closed over resolved
 *     imports to a fixpoint.
 *
 * WHAT IT DOES NOT PROVE, stated rather than overclaimed: B asks whether a
 * run-state owner CALLS a reporter somewhere, not that every branch does — a
 * panel that picks between two lifecycles passes if either reports, which is
 * why A checks each lifecycle on its own. A run whose state is named something
 * else (`pending`, `working`) is not discovered; each state pattern below must
 * match a shipped subject (corpus in both directions, rule 1), and the subject
 * count is bounded below. The behavioural chain — the real path, read at the
 * sink — is `tool-outcome.test.tsx`.
 */
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const ROOT = resolve(__dirname, "..", "..", "..");

function productFiles(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "src"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => !/\.(test|spec)\.(ts|tsx)$/.test(f))
    .filter((f) => !f.endsWith(".d.ts"));
}

function parse(file: string, source: string): TS.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

type FnLike =
  | TS.FunctionDeclaration
  | TS.FunctionExpression
  | TS.ArrowFunction
  | TS.MethodDeclaration;

function isFnLike(node: TS.Node): node is FnLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function hasExportModifier(node: TS.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

interface ModuleInfo {
  file: string;
  sf: TS.SourceFile;
  /** Top-level function name → its function node. */
  functions: Map<string, FnLike>;
  exported: Set<string>;
  /** Local name → where a VALUE import of it resolves. */
  imports: Map<string, { file: string; name: string }>;
  /** Named re-exports: exported name → its origin. */
  reexports: Map<string, { file: string; name: string }>;
}

class Corpus {
  readonly modules = new Map<string, ModuleInfo>();

  constructor(sources: Map<string, string>) {
    const fileSet = new Set(sources.keys());
    for (const [file, source] of sources) {
      this.modules.set(file, this.read(file, source, fileSet));
    }
  }

  private resolveSpec(
    from: string,
    spec: string,
    files: Set<string>,
  ): string | null {
    let base: string;
    if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
    else if (spec.startsWith(".")) base = posix.join(posix.dirname(from), spec);
    else return null;
    for (const cand of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
    ]) {
      if (files.has(cand)) return cand;
    }
    return null;
  }

  private read(file: string, source: string, files: Set<string>): ModuleInfo {
    const sf = parse(file, source);
    const info: ModuleInfo = {
      file,
      sf,
      functions: new Map(),
      exported: new Set(),
      imports: new Map(),
      reexports: new Map(),
    };
    for (const stmt of sf.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name) {
        info.functions.set(stmt.name.text, stmt);
        if (hasExportModifier(stmt)) info.exported.add(stmt.name.text);
      } else if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (
            ts.isIdentifier(decl.name) &&
            decl.initializer &&
            (ts.isArrowFunction(decl.initializer) ||
              ts.isFunctionExpression(decl.initializer))
          ) {
            info.functions.set(decl.name.text, decl.initializer);
            if (hasExportModifier(stmt)) info.exported.add(decl.name.text);
          }
        }
      } else if (
        ts.isImportDeclaration(stmt) &&
        ts.isStringLiteral(stmt.moduleSpecifier) &&
        !stmt.importClause?.isTypeOnly
      ) {
        const target = this.resolveSpec(file, stmt.moduleSpecifier.text, files);
        const bindings = stmt.importClause?.namedBindings;
        if (target && bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            if (el.isTypeOnly) continue;
            info.imports.set(el.name.text, {
              file: target,
              name: (el.propertyName ?? el.name).text,
            });
          }
        }
      } else if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly) {
        const clause = stmt.exportClause;
        if (clause && ts.isNamedExports(clause)) {
          const target =
            stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
              ? this.resolveSpec(file, stmt.moduleSpecifier.text, files)
              : file;
          for (const el of clause.elements) {
            const origin = (el.propertyName ?? el.name).text;
            if (target === file) info.exported.add(origin);
            else if (target)
              info.reexports.set(el.name.text, { file: target, name: origin });
          }
        }
      }
    }
    return info;
  }

  /** `file#name` of the function a call to `name` inside `file` runs. */
  resolveCall(file: string, name: string, depth = 0): string | null {
    const mod = this.modules.get(file);
    if (!mod || depth > 8) return null;
    const imported = mod.imports.get(name);
    if (imported)
      return this.resolveExport(imported.file, imported.name, depth);
    if (mod.functions.has(name)) return `${file}#${name}`;
    return null;
  }

  private resolveExport(
    file: string,
    name: string,
    depth: number,
  ): string | null {
    const mod = this.modules.get(file);
    if (!mod) return null;
    if (mod.functions.has(name)) return `${file}#${name}`;
    const re = mod.reexports.get(name);
    if (re) return this.resolveExport(re.file, re.name, depth + 1);
    return null;
  }
}

/** Every call inside `node` (nested functions included), resolved. */
function callsIn(corpus: Corpus, file: string, node: TS.Node): string[] {
  const out: string[] = [];
  const walk = (n: TS.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const key = corpus.resolveCall(file, n.expression.text);
      if (key) out.push(key);
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return out;
}

const OUTCOME_EVENTS = ["tool_completed", "tool_failed"] as const;

/**
 * The seeds: top-level functions whose body `track()`s an outcome event,
 * either as `{ name: "tool_…" }` or through a builder whose body constructs
 * one. Read from the code, so a renamed reporter moves the guard with it.
 */
function seedReporters(corpus: Corpus): Map<string, string> {
  const builders = new Map<string, string>(); // file#fn → event
  for (const mod of corpus.modules.values()) {
    for (const [name, fn] of mod.functions) {
      const events = new Set<string>();
      const walk = (n: TS.Node): void => {
        if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name)) {
          if (
            n.name.text === "name" &&
            ts.isStringLiteralLike(n.initializer) &&
            (OUTCOME_EVENTS as readonly string[]).includes(n.initializer.text)
          )
            events.add(n.initializer.text);
        }
        ts.forEachChild(n, walk);
      };
      walk(fn);
      if (events.size === 1)
        builders.set(`${mod.file}#${name}`, [...events][0]!);
    }
  }
  const seeds = new Map<string, string>(); // file#fn → event
  for (const mod of corpus.modules.values()) {
    for (const [name, fn] of mod.functions) {
      const walk = (n: TS.Node): void => {
        if (
          ts.isCallExpression(n) &&
          ts.isIdentifier(n.expression) &&
          n.expression.text === "track"
        ) {
          const arg = n.arguments[0];
          if (
            arg &&
            ts.isCallExpression(arg) &&
            ts.isIdentifier(arg.expression)
          ) {
            const b = corpus.resolveCall(mod.file, arg.expression.text);
            if (b && builders.has(b))
              seeds.set(`${mod.file}#${name}`, builders.get(b)!);
          }
          if (arg && ts.isObjectLiteralExpression(arg)) {
            for (const p of arg.properties) {
              if (
                ts.isPropertyAssignment(p) &&
                ts.isIdentifier(p.name) &&
                p.name.text === "name" &&
                ts.isStringLiteralLike(p.initializer) &&
                (OUTCOME_EVENTS as readonly string[]).includes(
                  p.initializer.text,
                )
              )
                seeds.set(`${mod.file}#${name}`, p.initializer.text);
            }
          }
        }
        ts.forEachChild(n, walk);
      };
      walk(fn);
    }
  }
  return seeds;
}

/** Seeds, closed over "calls something that reaches a seed", to a fixpoint. */
function reporters(corpus: Corpus, seeds: Iterable<string>): Set<string> {
  const set = new Set(seeds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const mod of corpus.modules.values()) {
      for (const [name, fn] of mod.functions) {
        const key = `${mod.file}#${name}`;
        if (set.has(key)) continue;
        if (callsIn(corpus, mod.file, fn).some((c) => set.has(c))) {
          set.add(key);
          grew = true;
        }
      }
    }
  }
  return set;
}

function fnName(fn: FnLike, sf: TS.SourceFile): string {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name)
    return fn.name.getText(sf);
  if (ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name))
    return fn.parent.name.text;
  return `<anonymous>@${sf.getLineAndCharacterOfPosition(fn.getStart()).line + 1}`;
}

function nearestFn(node: TS.Node): FnLike | null {
  let cur: TS.Node | undefined = node.parent;
  while (cur && !ts.isSourceFile(cur)) {
    if (isFnLike(cur)) return cur;
    cur = cur.parent;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 *  A. Job lifecycles
 * ------------------------------------------------------------------ */

interface LifecycleSite {
  file: string;
  line: number;
  holder: string | null;
}

function jobCreations(corpus: Corpus): LifecycleSite[] {
  const out: LifecycleSite[] = [];
  for (const mod of corpus.modules.values()) {
    const walk = (n: TS.Node): void => {
      if (ts.isCallExpression(n)) {
        const first = n.arguments[0];
        if (
          first &&
          ts.isStringLiteralLike(first) &&
          first.text === "/api/jobs"
        ) {
          const fn = nearestFn(n);
          out.push({
            file: mod.file,
            line: mod.sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
            holder: fn ? fnName(fn, mod.sf) : null,
          });
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(mod.sf);
  }
  return out;
}

/** Why a job-creating function is not always wrapped; empty when it is. */
function lifecycleProblems(
  corpus: Corpus,
  site: LifecycleSite,
  wrapper: string,
): string[] {
  const where = `${site.file}:${site.line}`;
  if (site.holder === null)
    return [`${where}: job created outside any function`];
  const mod = corpus.modules.get(site.file)!;
  const problems: string[] = [];
  if (mod.exported.has(site.holder))
    problems.push(
      `${where}: ${site.holder} creates a job and is exported, so a caller can run it without withToolOutcome`,
    );
  let wrapped = 0;
  const walk = (n: TS.Node): void => {
    if (ts.isIdentifier(n) && n.text === site.holder) {
      const p = n.parent;
      const isDecl =
        (ts.isFunctionDeclaration(p) && p.name === n) ||
        (ts.isVariableDeclaration(p) && p.name === n);
      if (!isDecl) {
        let cur: TS.Node | undefined = p;
        let inside = false;
        while (cur && !ts.isSourceFile(cur)) {
          if (
            ts.isCallExpression(cur) &&
            ts.isIdentifier(cur.expression) &&
            corpus.resolveCall(site.file, cur.expression.text) === wrapper &&
            cur.arguments.some((a) => a.pos <= n.pos && n.end <= a.end)
          ) {
            inside = true;
            break;
          }
          cur = cur.parent;
        }
        if (inside) wrapped += 1;
        else
          problems.push(
            `${site.file}:${mod.sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: ${site.holder} is used outside withToolOutcome`,
          );
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(mod.sf);
  if (wrapped === 0 && !mod.exported.has(site.holder))
    problems.push(
      `${where}: ${site.holder} is never run through withToolOutcome`,
    );
  return problems;
}

/* ------------------------------------------------------------------ *
 *  B. Hand-rolled run state
 * ------------------------------------------------------------------ */

/**
 * The shapes a run's own state takes. Each must match at least one shipped
 * subject (checked below) — a pattern nothing exercises is decoration.
 */
const RUN_STATE_PATTERNS = [
  { id: "useState-array busy", hook: "useState", shape: "array", name: "busy" },
  {
    id: "useState-object busy",
    hook: "useState",
    shape: "object",
    name: "busy",
  },
  {
    id: "useRef runningRef",
    hook: "useRef",
    shape: "ident",
    name: "runningRef",
  },
] as const;

interface RunOwner {
  file: string;
  fn: string;
  pattern: string;
  reaches: boolean;
}

function runStatePattern(decl: TS.VariableDeclaration): string | null {
  const init = decl.initializer;
  if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression))
    return null;
  const hook = init.expression.text;
  for (const p of RUN_STATE_PATTERNS) {
    if (p.hook !== hook) continue;
    if (p.shape === "array" && ts.isArrayBindingPattern(decl.name)) {
      const first = decl.name.elements[0];
      if (
        first &&
        ts.isBindingElement(first) &&
        ts.isIdentifier(first.name) &&
        first.name.text === p.name
      )
        return p.id;
    }
    if (p.shape === "object") {
      const arg = init.arguments[0];
      if (
        arg &&
        ts.isObjectLiteralExpression(arg) &&
        arg.properties.some(
          (q) => q.name && ts.isIdentifier(q.name) && q.name.text === p.name,
        )
      )
        return p.id;
    }
    if (
      p.shape === "ident" &&
      ts.isIdentifier(decl.name) &&
      decl.name.text === p.name
    )
      return p.id;
  }
  return null;
}

function runOwners(corpus: Corpus, reporting: Set<string>): RunOwner[] {
  const out: RunOwner[] = [];
  for (const mod of corpus.modules.values()) {
    const walk = (n: TS.Node): void => {
      if (ts.isVariableDeclaration(n)) {
        const pattern = runStatePattern(n);
        const fn = pattern ? nearestFn(n) : null;
        if (pattern && fn) {
          out.push({
            file: mod.file,
            fn: fnName(fn, mod.sf),
            pattern,
            reaches: callsIn(corpus, mod.file, fn).some((c) =>
              reporting.has(c),
            ),
          });
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(mod.sf);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  The corpus
 * ------------------------------------------------------------------ */

function corpusOf(extra: Record<string, string> = {}): Corpus {
  const sources = new Map<string, string>();
  for (const f of productFiles())
    sources.set(f, readFileSync(resolve(ROOT, f), "utf8"));
  for (const [f, s] of Object.entries(extra)) sources.set(f, s);
  return new Corpus(sources);
}

function analyse(corpus: Corpus) {
  const seeds = seedReporters(corpus);
  const reporting = reporters(corpus, seeds.keys());
  const seedFiles = new Set([...seeds.keys()].map((k) => k.split("#")[0]!));
  const wrapper = [...reporting].find(
    (k) => seedFiles.has(k.split("#")[0]!) && k.endsWith("#withToolOutcome"),
  );
  const creations = jobCreations(corpus);
  const owners = runOwners(corpus, reporting);
  const lifecycle = wrapper
    ? creations.flatMap((s) => lifecycleProblems(corpus, s, wrapper))
    : ["withToolOutcome was not found among the reporters"];
  return { seeds, reporting, wrapper, creations, owners, lifecycle };
}

const REAL = corpusOf();
const R = analyse(REAL);

/**
 * Positive controls, shaped as 6a2fc17 shipped them: compress's analysis
 * state with no reporter, and a job lifecycle exported unwrapped. They go
 * through the SAME detector as the real corpus, with real import paths.
 */
const FIXTURE_DIR = "src/components/tools/runner";
const SILENT_EDITOR = `${FIXTURE_DIR}/__fixture-silent.tsx`;
const REPORTING_EDITOR = `${FIXTURE_DIR}/__fixture-reporting.tsx`;
const SILENT_LIFECYCLE = "src/lib/workers/__fixture-lifecycle.ts";
const LEAKY_LIFECYCLE = "src/lib/workers/__fixture-leaky.ts";
const editor = (report: boolean) => `
import { useEffect, useState } from "react";
import { analyzePdf } from "@/lib/pdf/analyze";
${report ? 'import { reportToolCompleted } from "@/lib/telemetry/tool-outcome";' : ""}
export function Editor({ bytes }: { bytes: Uint8Array }) {
  const [state, setState] = useState({ result: null, error: null, busy: true });
  useEffect(() => {
    void analyzePdf(bytes).then((r) => {
      setState({ result: r, error: null, busy: false });
      ${report ? "reportToolCompleted({});" : ""}
    });
  }, [bytes]);
  return state.busy ? null : null;
}`;
const CONTROLS = corpusOf({
  [SILENT_EDITOR]: editor(false),
  [REPORTING_EDITOR]: editor(true),
  [SILENT_LIFECYCLE]: `
import { pollJobToTerminal } from "./job-polling";
export async function runWorkerThing(fetchImpl: (u: string) => Promise<unknown>) {
  const job = await fetchImpl("/api/jobs");
  return pollJobToTerminal(job as never);
}`,
  [LEAKY_LIFECYCLE]: `
import { pollJobToTerminal } from "./job-polling";
import { withToolOutcome } from "@/lib/telemetry/tool-outcome";
async function steps(fetchImpl: (u: string) => Promise<unknown>) {
  const job = await fetchImpl("/api/jobs");
  return pollJobToTerminal(job as never);
}
export const wrapped = (f: (u: string) => Promise<unknown>) =>
  withToolOutcome("thing", () => steps(f) as never);
export const bypass = (f: (u: string) => Promise<unknown>) => steps(f);`,
});
const C = analyse(CONTROLS);

describe("the instruments", () => {
  it("the reporter seeds are read from the code, one per outcome event", () => {
    const events = new Set(R.seeds.values());
    expect([...events].sort(), [...R.seeds.keys()].join("\n")).toEqual([
      ...OUTCOME_EVENTS,
    ]);
    expect(R.wrapper, "withToolOutcome is not a reporter").toBeDefined();
    // The shared hook and both kinds of worker lifecycle are reached by the
    // closure — if these fall out, the resolver is blind, not the code clean.
    const reached = [...R.reporting].map((k) => k.split("#")[1]);
    expect(reached).toEqual(
      expect.arrayContaining(["useAsyncRun", "runSecurityJob", "runWorkerOcr"]),
    );
  });

  it("the discovered sets are plausibly sized", () => {
    const lifecycleFiles = new Set(R.creations.map((s) => s.file));
    // Four lifecycles created jobs when this guard was written.
    expect(
      lifecycleFiles.size,
      [...lifecycleFiles].join("\n"),
    ).toBeGreaterThanOrEqual(4);
    // Seventeen functions held their own run state when it was written.
    expect(
      R.owners.length,
      R.owners.map((o) => `${o.file} ${o.fn}`).join("\n"),
    ).toBeGreaterThanOrEqual(17);
    expect(R.reporting.size).toBeGreaterThan(R.owners.length);
  });

  it("every run-state pattern matches a shipped subject (corpus in both directions)", () => {
    const used = new Set(R.owners.map((o) => o.pattern));
    const idle = RUN_STATE_PATTERNS.map((p) => p.id).filter(
      (id) => !used.has(id),
    );
    expect(idle, "a pattern nothing exercises is decoration").toEqual([]);
  });

  it("the job-creation set equals the job-polling set (two independent signals)", () => {
    const creators = new Set(R.creations.map((s) => s.file));
    const pollerKey = [...REAL.modules.values()]
      .filter(
        (m) =>
          m.functions.has("pollJobToTerminal") &&
          m.exported.has("pollJobToTerminal"),
      )
      .map((m) => `${m.file}#pollJobToTerminal`);
    expect(
      pollerKey,
      "pollJobToTerminal's definition was not found",
    ).toHaveLength(1);
    const pollers = new Set(
      [...REAL.modules.values()]
        .filter((m) =>
          [...m.imports.keys()].some(
            (local) => REAL.resolveCall(m.file, local) === pollerKey[0],
          ),
        )
        .map((m) => m.file),
    );
    expect([...pollers].sort()).toEqual([...creators].sort());
  });

  it("positive control: 6a2fc17's silent compress state is flagged, the reporting one is not", () => {
    const silent = C.owners.find((o) => o.file === SILENT_EDITOR);
    const reporting = C.owners.find((o) => o.file === REPORTING_EDITOR);
    expect(silent).toMatchObject({
      fn: "Editor",
      pattern: "useState-object busy",
      reaches: false,
    });
    expect(reporting).toMatchObject({ fn: "Editor", reaches: true });
  });

  it("positive control: an exported or bypassed lifecycle is flagged; a wrapped one is not", () => {
    const flagged = C.lifecycle.join("\n");
    expect(flagged).toContain(`${SILENT_LIFECYCLE}:`);
    expect(flagged).toMatch(/runWorkerThing creates a job and is exported/);
    expect(flagged).toMatch(
      /__fixture-leaky\.ts:\d+: steps is used outside withToolOutcome/,
    );
    expect(
      C.lifecycle.filter((p) => p.includes("__fixture-leaky")),
    ).toHaveLength(1);
  });

  it("positive control: the real defect sites are subjects", () => {
    const at = (file: string) =>
      R.owners.filter((o) => o.file === file).map((o) => o.fn);
    expect(
      at("src/components/tools/runner/compress-runner.tsx").sort(),
    ).toEqual(["CompressEditor", "WorkerDeepPanel"]);
    expect(at("src/components/tools/runner/use-batch-runner.ts")).toEqual([
      "useBatchRunner",
    ]);
  });
});

describe("every tool run reaches an outcome reporter", () => {
  it("A. every job lifecycle runs only through withToolOutcome", () => {
    expect(R.lifecycle).toEqual([]);
  });

  it("B. every function holding its own run state calls something that reports", () => {
    const silent = R.owners
      .filter((o) => !o.reaches)
      .map((o) => `${o.file} ${o.fn} (${o.pattern})`);
    expect(
      silent,
      "these runs keep their own busy/running state and never reach reportToolCompleted/Failed — the owner cannot see them fail",
    ).toEqual([]);
  });
});
