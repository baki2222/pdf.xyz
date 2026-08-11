// @vitest-environment node
/**
 * The two-tier probe must be REACHED FROM AN ENTRY POINT, not merely defined.
 *
 * On 2026-08-12 the spend probe was built, reviewed, merged and deployed — and
 * production reported `probe: 0 keys` after a real job, because
 * `writeSpendProbe`/`readSpendProbe` were invoked by nothing except their own
 * unit tests. Every unit test was green. The module was correct. It was also
 * inert, and no test in the repo could tell the difference, because **every test
 * imported the function directly** and so supplied by hand the one thing
 * production was missing: a caller.
 *
 * "The probe is ready" and "the probe answers" differ by a call site, and a diff
 * shows neither.
 *
 * ── FOUR FALSE PASSES, and what each one taught ──────────────────────────────
 *
 * This guard has been wrong four times. Every fix that enumerated a FORM was
 * beaten by another form; only the fixes that named a PROPERTY have held.
 *
 *  1. `\bsymbol\s*\(` matched `export async function writeSpendProbe(`, so the
 *     guard passed over a tree with zero call sites.
 *  2. Excluding the literal token `function` fixed that one spelling — and an
 *     `interface { readSpendProbe(...) }`, a class method and an object-literal
 *     shorthand each walked straight past it. **Step 2 created the shape of
 *     step 3: the exit condition named the MECHANISM where the property is
 *     "a declaration is not a call."** Now asked of the parser: a
 *     `CallExpression` is a call and nothing else is, so the forms are
 *     unrepresentable rather than enumerated.
 *  3. The import walk keyed on the `type` KEYWORD, so rewriting
 *     `import type { A }` as a plain `import { A }` — legal, `tsc`-clean —
 *     put the module back in the graph. Now `isTypeOnly` on the node.
 *  4. **And a module graph is not a call graph.** With that same rewrite, the
 *     guard still passed: `spend-status.ts` really was loaded at runtime, and
 *     it really does contain `readSpendProbe(...)` — inside `readAiSpendStatus`,
 *     which nobody called. *Loading a module is not running a function.*
 *
 * So reachability here is **call-graph** reachability. Roots are what a
 * deployment actually starts — a route handler the framework invokes, a script's
 * top-level statements — and an edge exists only where a reached function calls
 * something. A function that is defined, exported, imported, and never invoked
 * contributes nothing, which is exactly the state production was in.
 *
 * ── WHAT IT CANNOT CATCH ─────────────────────────────────────────────────────
 *
 * Stated because a guard that overclaims is worse than none.
 *
 *  - **Reachability is not execution.** A call behind a condition that is never
 *    true satisfies this. That gap is closed on the other side, by reading the
 *    probe key off the deployed store.
 *  - It descends into function expressions *inside* a reached function, because
 *    that is how callbacks work and the worker's own probe wiring is an arrow in
 *    an object literal. A closure that is built and never invoked therefore
 *    counts — an over-approximation, and the one place this can still be too
 *    generous.
 *  - It resolves bare identifiers only. `port.readSpendProbe()` is a different
 *    binding without a type checker, and treating it as this function is the
 *    precise false pass above. A real call site that became a method call would
 *    turn this RED — a false failure, which is the safe direction.
 */
import { describe, expect, it } from "vitest";
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

/**
 * Loaded through `createRequire` rather than `import ts from "typescript"`: the
 * bundler otherwise transforms TypeScript's own multi-megabyte bundle and hunts
 * for its absent sourcemap. This is the compiler used as a library.
 */
const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const ROOT = resolve(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");
const SCRIPTS = join(ROOT, "scripts");

const isSource = (f: string): boolean =>
  /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\.(ts|tsx)$/.test(f);

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

/* ------------------------------------------------------------------ *
 *  Entry points — discovered, never listed
 * ------------------------------------------------------------------ */

/**
 * The processes a deployment actually starts.
 *
 * DISCOVERED, never listed — and the first version of this function did not
 * honour its own docblock. The web half really did discover (every Next route
 * handler); the worker half read
 *
 *     walk(SCRIPTS).filter(f => /worker-daemon|worker-ops-check/.test(f))
 *
 * which hand-names two of the sixteen `worker:*` scripts. A comment claiming
 * discovery above a regex naming files is the precise artifact this codebase
 * exists to delete, and it sat in the file whose whole subject is instruments
 * that lie.
 */
function entryPoints(): { web: string[]; worker: string[] } {
  const web = walk(join(SRC, "app")).filter((f) => /[\\/]route\.ts$/.test(f));
  return { web, worker: workerEntryPoints() };
}

/**
 * What the worker container runs, derived through the chain a deployment
 * actually uses — **container command → package script → file**:
 *
 *     Dockerfile   CMD ["pnpm", "worker:daemon"]
 *     package.json "worker:daemon": "tsx scripts/worker-daemon.ts"
 *
 * Three artifacts pinned to each other. FATAL on a broken link rather than
 * skipping it: an instrument that quietly drops one shrinks its own corpus
 * toward the empty set, which passes every `⊆` assertion it is asked.
 */
function workerEntryPoints(): string[] {
  const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const scripts = pkg.scripts ?? {};

  const files = new Set<string>();
  for (const m of dockerfile.matchAll(/["']pnpm["']\s*,\s*["']([^"']+)["']/g)) {
    const name = m[1]!;
    const command = scripts[name];
    if (command === undefined) {
      throw new Error(
        `the Dockerfile runs \`pnpm ${name}\` but package.json defines no such script`,
      );
    }
    // Only scripts that are a TypeScript entry point here; `pnpm start` is
    // Next's server and has no file of ours to walk.
    const file = /(?:^|\s)(scripts\/[\w.-]+\.ts)(?:\s|$)/.exec(command);
    if (file) files.add(join(ROOT, file[1]!));
  }
  return [...files];
}

/* ------------------------------------------------------------------ *
 *  Module facts
 * ------------------------------------------------------------------ */

/** Resolve one import specifier to a file on disk, or null if it is external. */
function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // a package, not our tree
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

interface Binding {
  readonly file: string;
  readonly name: string;
}

interface ModuleInfo {
  readonly file: string;
  /** Local name → where it really comes from. VALUE imports only. */
  readonly imports: Map<string, Binding>;
  /** Module-level function-ish declarations this file owns, by name. */
  readonly decls: Map<string, TS.Node>;
  /** `export { a } from "./x"` — a name this module forwards. */
  readonly namedReExports: Map<string, Binding>;
  /** `export * from "./x"` — files this module forwards everything from. */
  readonly starExports: string[];
  /** Identifiers called by the module body itself, outside any function. */
  readonly topLevelCalls: string[];
  /** Names this file exports as functions (roots when this file is an entry). */
  readonly exportedDecls: string[];
}

/**
 * Is this import erased at compile time?
 *
 * `isTypeOnly` on the node rather than the `type` keyword in the text — the
 * distinction that false pass 3 turned on. A side-effect import (`import "./x"`)
 * has no clause at all and is very much a runtime load.
 */
function isErasedImport(node: TS.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) return false;
  if (clause.isTypeOnly) return true;
  // `import { type A, type B } from "x"`: every binding erased ⇒ so is the
  // statement. One value binding and the module is really loaded.
  return (
    clause.name === undefined &&
    clause.namedBindings !== undefined &&
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((e) => e.isTypeOnly)
  );
}

/** Identifiers invoked anywhere inside `node`, including nested closures. */
function calledIdentifiers(node: TS.Node): string[] {
  const out: string[] = [];
  const visit = (n: TS.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      out.push(n.expression.text);
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return out;
}

/** Is this statement a module-level function-ish declaration? Returns its name. */
function declaredName(
  stmt: TS.Statement,
): { name: string; node: TS.Node } | null {
  if (ts.isFunctionDeclaration(stmt) && stmt.name) {
    return { name: stmt.name.text, node: stmt };
  }
  if (ts.isVariableStatement(stmt)) {
    for (const d of stmt.declarationList.declarations) {
      if (
        ts.isIdentifier(d.name) &&
        d.initializer !== undefined &&
        (ts.isArrowFunction(d.initializer) ||
          ts.isFunctionExpression(d.initializer))
      ) {
        return { name: d.name.text, node: d.initializer };
      }
    }
  }
  return null;
}

const MODULES = new Map<string, ModuleInfo>();

/** Parse and summarize one module, memoized. Fatal if it cannot be read. */
function moduleOf(file: string): ModuleInfo {
  const cached = MODULES.get(file);
  if (cached) return cached;

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(`unreadable module in the import graph: ${file}`);
  }
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const imports = new Map<string, Binding>();
  const decls = new Map<string, TS.Node>();
  const namedReExports = new Map<string, Binding>();
  const starExports: string[] = [];
  const topLevelCalls: string[] = [];
  const exportedDecls: string[] = [];

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      if (isErasedImport(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) {
        continue;
      }
      const target = resolveImport(file, stmt.moduleSpecifier.text);
      if (target === null) continue;
      const clause = stmt.importClause;
      if (clause?.name) {
        imports.set(clause.name.text, { file: target, name: "default" });
      }
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          if (el.isTypeOnly) continue;
          imports.set(el.name.text, {
            file: target,
            name: (el.propertyName ?? el.name).text,
          });
        }
      }
      continue;
    }

    if (ts.isExportDeclaration(stmt)) {
      if (stmt.isTypeOnly) continue;
      const spec = stmt.moduleSpecifier;
      if (spec === undefined || !ts.isStringLiteral(spec)) continue;
      const target = resolveImport(file, spec.text);
      if (target === null) continue;
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          if (el.isTypeOnly) continue;
          namedReExports.set(el.name.text, {
            file: target,
            name: (el.propertyName ?? el.name).text,
          });
        }
      } else if (stmt.exportClause === undefined) {
        starExports.push(target);
      }
      continue;
    }

    const decl = declaredName(stmt);
    if (decl !== null) {
      decls.set(decl.name, decl.node);
      const mods = ts.canHaveModifiers(stmt)
        ? ts.getModifiers(stmt)
        : undefined;
      if (mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        exportedDecls.push(decl.name);
      }
      continue;
    }

    // Anything else at module scope runs on import — its calls are top-level.
    if (!ts.isInterfaceDeclaration(stmt) && !ts.isTypeAliasDeclaration(stmt)) {
      topLevelCalls.push(...calledIdentifiers(stmt));
      // A `const x = <not a function>` still runs; catch calls in its initializer.
    }
  }

  const info: ModuleInfo = {
    file,
    imports,
    decls,
    namedReExports,
    starExports,
    topLevelCalls,
    exportedDecls,
  };
  MODULES.set(file, info);
  return info;
}

/** Follow barrels until the module that actually declares `name`. */
function resolveExport(
  file: string,
  name: string,
  seen = new Set<string>(),
): Binding | null {
  const key = `${file}#${name}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const m = moduleOf(file);
  if (m.decls.has(name)) return { file, name };
  const re = m.namedReExports.get(name);
  if (re) return resolveExport(re.file, re.name, seen);
  for (const star of m.starExports) {
    const found = resolveExport(star, name, seen);
    if (found) return found;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 *  Call-graph reachability
 * ------------------------------------------------------------------ */

/**
 * Every identifier invoked on a path from these entry points.
 *
 * Roots are what a deployment starts: the entry module's top-level statements,
 * and its exported functions (a Next route handler is invoked by the framework,
 * never by our code, so it would otherwise look unreachable).
 */
function reachableCalls(roots: string[]): Set<string> {
  const called = new Set<string>();
  const visited = new Set<string>();
  const queue: Binding[] = [];

  for (const root of roots) {
    const m = moduleOf(root);
    // The module body runs on start: its calls are reached by definition.
    for (const name of m.topLevelCalls) {
      called.add(name);
      queue.push({ file: root, name });
    }
    // A route handler is invoked by the framework and never by our code, so it
    // would otherwise look unreachable from inside the tree.
    for (const name of m.exportedDecls) queue.push({ file: root, name });
  }

  while (queue.length > 0) {
    const item = queue.pop()!;
    const m = moduleOf(item.file);

    // Where does this name actually live — imported, or declared right here?
    const via = m.imports.get(item.name);
    const target = via
      ? resolveExport(via.file, via.name)
      : m.decls.has(item.name)
        ? { file: item.file, name: item.name }
        : null;
    if (target === null) continue; // a global, a builtin, or a type

    // Mark the RESOLVED declaration, once. Marking the referring name instead
    // made every local call collide with its own key and skip itself, which
    // shrank the worker graph to two entries — visible only because the health
    // check demanded a plausible size.
    const key = `${target.file}#${target.name}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const node = moduleOf(target.file).decls.get(target.name);
    if (node === undefined) continue;

    for (const c of calledIdentifiers(node)) {
      called.add(c);
      queue.push({ file: target.file, name: c });
    }
  }

  return called;
}

/* ------------------------------------------------------------------ *
 *  The mutant corpus
 * ------------------------------------------------------------------ */

/** Does a standalone snippet, treated as a module body, call `symbol`? */
function snippetCalls(text: string, symbol: string): boolean {
  const sf = ts.createSourceFile(
    "mutant.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  let found = false;
  const visit = (n: TS.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      if (n.expression.text === symbol) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/**
 * Every construct that has ever fooled this predicate, and every construct that
 * must still register as a real call.
 *
 * A ban list needs a corpus in both directions: each declaration form here once
 * read as a call (or would have, under the previous regex), and each call form
 * must not be lost to an over-eager fix. The interface, class-method and
 * shorthand cases came from an adversarial review of a guard already fixed twice.
 */
const NOT_A_CALL: ReadonlyArray<readonly [string, string]> = [
  ["function declaration", "export async function fooBar(env) {}"],
  ["bare function declaration", "function fooBar() {}"],
  [
    "interface member - cannot run at all",
    "export interface Port { fooBar(env: E, n: number): Promise<unknown>; }",
  ],
  ["class method", "class Adapter { async fooBar(env) { return 1; } }"],
  ["abstract method", "abstract class A { abstract fooBar(env): void; }"],
  ["object-literal shorthand", "const port = { fooBar };"],
  ["object-literal method", "const port = { fooBar(env) { return 1; } };"],
  ["type member", "type Port = { fooBar(env: E): void };"],
  ["import binding", 'import { fooBar } from "./x";'],
  ["re-export", 'export { fooBar } from "./x";'],
  ["a mention in a docblock", "/** call fooBar(env) somewhere */ const x = 1;"],
  ["a mention in a line comment", "// fooBar(env)\nconst x = 1;"],
  ["a string that looks like one", 'const s = "fooBar(env)";'],
  ["a typeof reference", "type T = typeof fooBar;"],
];

const IS_A_CALL: ReadonlyArray<readonly [string, string]> = [
  ["awaited call", "await fooBar(process.env);"],
  ["assigned call", "const r = fooBar();"],
  ["call in an arrow body", "const f = () => fooBar(env);"],
  [
    "call inside a nested closure",
    "if (x) { setTimeout(() => { fooBar(1); }); }",
  ],
  ["call as an argument", "void register(fooBar(env));"],
  ["call behind optional chaining", "fooBar?.(env);"],
];

describe("the spend probe is reachable from the processes that run", () => {
  const { web, worker } = entryPoints();
  const webCalls = reachableCalls(web);
  const workerCalls = reachableCalls(worker);

  describe("CONTROL: a declaration is not a call", () => {
    // The property, asked of the parser. Each of these once passed - or, for
    // the interface/class/shorthand three, was never distinguished - under a
    // regex whose exit condition named the token `function`. Naming the
    // MECHANISM instead of the PROPERTY is what let three synonyms walk past
    // two separate fixes.
    it.each(NOT_A_CALL)("%s does not count as a call", (_label, text) => {
      expect(snippetCalls(text, "fooBar")).toBe(false);
    });

    it.each(IS_A_CALL)("%s does count as a call", (_label, text) => {
      expect(snippetCalls(text, "fooBar")).toBe(true);
    });

    it("HEALTH CHECK: the corpus is not empty in either direction", () => {
      // `[] subset X` is vacuously true. A corpus that silently emptied would
      // report the strongest possible pass on both halves at once.
      expect(NOT_A_CALL.length).toBeGreaterThan(8);
      expect(IS_A_CALL.length).toBeGreaterThan(3);
    });
  });

  it("HEALTH CHECK: the walk actually found both tiers' entry points", () => {
    // `[] subset X` is vacuously true, so a blind walk would report the
    // strongest possible pass. Every assertion below is worthless without this.
    expect(
      web.length,
      "no Next route handlers were discovered",
    ).toBeGreaterThan(10);
    expect(
      worker.length,
      "no worker entry-point script was discovered from the Dockerfile's " +
        "command through package.json - the chain is broken, and every arm " +
        "below would then be asserting something about the empty set",
    ).toBeGreaterThan(0);
    for (const f of worker) expect(statSync(f).isFile()).toBe(true);
    // The call graph must be substantial, or "not reached" means "not walked".
    expect(
      webCalls.size,
      "the web call graph is implausibly small",
    ).toBeGreaterThan(50);
    expect(
      workerCalls.size,
      "the worker call graph is implausibly small",
    ).toBeGreaterThan(20);
  });

  it("CONTROL: the worker entry point is derived, not named", () => {
    // The defect this replaced hand-named two of the sixteen `worker:*` scripts
    // under a docblock claiming discovery. The property that makes the
    // replacement real is that the answer comes from the Dockerfile and
    // package.json - so it must NOT include scripts the container never runs.
    expect(
      walk(SCRIPTS).length,
      "the scripts directory did not walk",
    ).toBeGreaterThan(worker.length);
    // `worker:ops-check` is a `worker:*` script and a legitimate entry point for
    // an operator, but it is not what the container starts - so the derived set
    // must exclude it, which a filename regex over `worker-*` could not.
    expect(worker.some((f) => /worker-ops-check/.test(f))).toBe(false);
  });

  it("POSITIVE CONTROL: the graph reaches a call known to be wired", () => {
    // If the walk were broken - a bad alias, an unfollowed barrel - every
    // assertion below would pass or fail for the wrong reason.
    expect(webCalls.has("enforceRateLimit")).toBe(true);
    expect(workerCalls.has("createWorkerDaemon")).toBe(true);
  });

  it("NEGATIVE CONTROL: it does not report a symbol nobody calls", () => {
    expect(webCalls.has("definitelyNotARealFunctionName")).toBe(false);
  });

  it("the WORKER tier reaches writeSpendProbe", () => {
    // The write half. Without it `no-probe-visible` is permanent and means
    // nothing - a posture that can only ever report one thing is not an
    // instrument.
    expect(
      workerCalls.has("writeSpendProbe"),
      "no worker entry point reaches writeSpendProbe, so the probe key is " +
        "never written and the web tier can never prove the two tiers share " +
        "one bucket - the module is deployed and inert",
    ).toBe(true);
  });

  it("the WEB tier reaches readSpendProbe", () => {
    // The read half - blocker 2's remaining question, "is the counter I read
    // the counter they write?". Reached transitively through the posture
    // resolver is fine; reached by nothing is not.
    expect(
      webCalls.has("readSpendProbe"),
      "no web entry point reaches readSpendProbe, so nothing on the tier that " +
        "must refuse jobs can say whether it reads the counter the worker writes",
    ).toBe(true);
  });

  it("the WEB tier reaches the ceiling peek, so the posture is observed not assumed", () => {
    expect(webCalls.has("peekAiSpendCeiling")).toBe(true);
  });
});
