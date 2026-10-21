// @vitest-environment node
/**
 * Every run a tool page can start reaches the activity bus (spec E.11).
 *
 * The masthead's square and a hidden tab's title report work — busy, done,
 * failed — and both read ONE source, `src/lib/activity/bus.ts`. Nothing
 * reports to it but three hooks: `useAsyncRun` (the browser runners),
 * `useBatchRunner` (a batch of files) and `useWorkerJob` (every worker job).
 * So the claim "the square says when this page is working" is true exactly
 * when every panel a tool page mounts runs its work through one of them. A
 * runner that kept its own `busy` state would run silently, and nothing on
 * the page would look wrong.
 *
 * THE SET IS DERIVED, never typed: `ownPanelModules()` reads the tool page,
 * follows its runner dispatcher and its worker-panel registry through every
 * `next/dynamic` loader, and returns the module each slug's page really
 * mounts. A broken link there throws, and a walk that finds fewer than 40
 * modules fails before any assertion can pass over a short list.
 *
 * REACH IS A CALL, not an import (CLAUDE.md rule 4: loading a module is not
 * running a function). A module reaches the bus if it CALLS one of the three
 * hooks, or renders or calls a component or function it imports from a module
 * that does — followed through re-exports and loaders to where the name is
 * defined. `import type` edges are erased at runtime and are not followed.
 * And each hook is held to its half: its own body calls `reportActivity`,
 * bound to the bus module, so the chain is checked end to end.
 */
import ts from "typescript";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ROOT,
  ownPanelModules,
  rel,
  resolveComponent,
  resolveSpecifier,
} from "@/tests/tool-panel-modules";

const BUS = "src/lib/activity/bus.ts";

/** The three hooks, and the module each is defined in. */
const HOOKS: Record<string, string> = {
  useAsyncRun: "src/components/tools/runner/runner-kit.tsx",
  useBatchRunner: "src/components/tools/runner/use-batch-runner.ts",
  useWorkerJob: "src/components/tools/worker-job.tsx",
};

/**
 * Modules a page mounts that start no run of their own, each with its reason.
 * Stale entries fail: an exempt module that does reach the bus must leave.
 */
const EXEMPT: Record<string, string> = {};

const abs = (file: string) => path.join(ROOT, file);

const parsed = new Map<string, ts.SourceFile>();
function source(file: string): ts.SourceFile {
  let sf = parsed.get(file);
  if (!sf) {
    sf = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    parsed.set(file, sf);
  }
  return sf;
}

/** Local names a module VALUE-imports from a module in this tree. */
function localImports(file: string): Set<string> {
  const out = new Set<string>();
  for (const stmt of source(file).statements) {
    if (
      !ts.isImportDeclaration(stmt) ||
      !ts.isStringLiteral(stmt.moduleSpecifier)
    )
      continue;
    const clause = stmt.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (!resolveSpecifier(file, stmt.moduleSpecifier.text)) continue;
    if (clause.name) out.add(clause.name.text);
    const named = clause.namedBindings;
    if (named && ts.isNamedImports(named))
      for (const el of named.elements)
        if (!el.isTypeOnly) out.add(el.name.text);
  }
  return out;
}

/** Names a module renders as a JSX tag or calls, anywhere in its body. */
function usedNames(node: ts.Node): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
      ts.isIdentifier(n.tagName)
    )
      out.add(n.tagName.text);
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression))
      out.add(n.expression.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/**
 * The hook a module reaches the bus through, or null. Followed through every
 * imported name it renders or calls, to the module that defines that name.
 */
export function reachThrough(
  file: string,
  seen = new Set<string>(),
): string | null {
  if (seen.has(file)) return null;
  seen.add(file);
  const imported = localImports(file);
  for (const name of usedNames(source(file))) {
    if (!imported.has(name)) continue;
    // A local import this reader cannot follow is FATAL, not a smaller set.
    const def = resolveComponent(file, name);
    const defFile = rel(def.file);
    if (HOOKS[def.name] === defFile) return def.name;
    const via = reachThrough(def.file, seen);
    if (via) return via;
  }
  return null;
}

/** The function a module declares under `name` (a declaration or a const). */
function declaredFunction(file: string, name: string): ts.Node | null {
  for (const stmt of source(file).statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) return stmt;
    if (ts.isVariableStatement(stmt))
      for (const d of stmt.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer)
          return d.initializer;
  }
  return null;
}

/** Does `fn`, declared in `file`, call the bus's `reportActivity`? */
function callsBus(file: string, fn: ts.Node): boolean {
  if (!usedNames(fn).has("reportActivity")) return false;
  if (!localImports(file).has("reportActivity")) return false;
  return rel(resolveComponent(file, "reportActivity").file) === BUS;
}

const { modules } = ownPanelModules();
const files = [...new Set(modules.map((m) => rel(m.file)))].sort();

describe("every run a tool page can start reaches the activity bus", () => {
  it("health check: the set is every module the tool pages mount", () => {
    // 27 runner modules and 13 worker panels on 2026-10-21.
    expect(files.length).toBeGreaterThanOrEqual(40);
    expect(files).toContain("src/components/tools/runner/merge-runner.tsx");
    expect(files).toContain("src/components/tools/ocr-worker-panel.tsx");
  });

  it("positive control: a runner reaches, a helper with no run does not, and a type import is not an edge", () => {
    expect(
      reachThrough(abs("src/components/tools/runner/merge-runner.tsx")),
    ).toBe("useAsyncRun");
    expect(reachThrough(abs("src/components/tools/ocr-worker-panel.tsx"))).toBe(
      "useWorkerJob",
    );
    expect(
      reachThrough(abs("src/components/tools/runner/list-utils.ts")),
    ).toBeNull();
    // `worker-panels.tsx` imports only types from the job hook's world; the
    // registry starts no run.
    expect(reachThrough(abs("src/components/tools/worker-panels.tsx"))).toBe(
      null,
    );
  });

  it("each hook reports to the bus from its own body", () => {
    const silent = Object.entries(HOOKS)
      .filter(([name, file]) => {
        const fn = declaredFunction(abs(file), name);
        if (!fn) throw new Error(`${file} declares no ${name}`);
        return !callsBus(abs(file), fn);
      })
      .map(([name]) => name);
    expect(
      silent,
      "these hooks run work without telling the bus — the square and the tab title cannot see it",
    ).toEqual([]);
  });

  it("every mounted module reaches the bus through one of the hooks", () => {
    const silent = files.filter(
      (f) => !(f in EXEMPT) && reachThrough(abs(f)) === null,
    );
    expect(
      silent,
      "these panels start work the masthead cannot see — run it through useAsyncRun, useBatchRunner or useWorkerJob, or exempt it with a reason",
    ).toEqual([]);
  });

  it("exemptions are not stale", () => {
    const stale = Object.keys(EXEMPT).filter(
      (f) => !files.includes(f) || reachThrough(abs(f)) !== null,
    );
    expect(stale, "these exemptions reach the bus, or are not mounted").toEqual(
      [],
    );
  });
});
