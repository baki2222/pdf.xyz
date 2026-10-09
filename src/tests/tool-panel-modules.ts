/**
 * Which module renders each tool page's interactive panel — read from the two
 * dispatchers the page actually mounts, never typed.
 *
 * A tool page picks its panel in two places:
 *
 *  1. `app/tools/[slug]/page.tsx` asks the registry (`getRunnerKind`) for a
 *     runner kind and mounts the element it hands that value to (today
 *     `<ToolRunner kind={runnerKind} …>`), whose `switch (kind)` returns one
 *     runner per kind;
 *  2. otherwise it walks a chain of `tool.slug === "…" ? <XWorkerPanel
 *     tool={tool} />` arms.
 *
 * Both are read here with the TypeScript parser, and every component is
 * followed through its bindings to the module that DEFINES it: a static
 * `import { X } from "…"`, an `export { X } from "…"`, or a
 * `const X = dynamic(() => import("…").then(({ X }) => X))` loader. Following
 * the loader is the point — a dispatcher that defers its panels must still
 * resolve to the panel modules, or every guard reading this would lose them.
 *
 * A broken link is FATAL, never a smaller answer: a slug comparison outside an
 * arm, an arm whose component does not resolve, a `dynamic()` call whose loader
 * this cannot read, a registry kind with no `case`, a `case` no slug reaches.
 * Each of those would otherwise drop a module from the corpus silently, and an
 * empty corpus passes every `⊆` check (CLAUDE.md rule 4).
 */
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getRunnerKind } from "@/lib/pdf/registry";
import { tools } from "@/lib/tools";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;

export const ROOT = process.cwd();
export const SRC = path.join(ROOT, "src");
export const TOOL_PAGE = path.join(SRC, "app", "tools", "[slug]", "page.tsx");

/** Repo-relative, POSIX separators — how files are named in messages. */
export const rel = (file: string): string =>
  path.relative(ROOT, file).split(path.sep).join("/");

/** One hop from a name to the module it comes from. */
export interface Hop {
  /** The module the name is bound to, resolved to a file. */
  file: string;
  /** The name exported there. */
  name: string;
  /** A static import / re-export, or a `next/dynamic` loader's `import()`. */
  via: "static" | "dynamic";
}

interface ModuleFacts {
  /**
   * Local names bound to another module: value imports, `export … from`
   * re-exports, and `dynamic(() => import("…"))` loaders.
   */
  bindings: Map<string, Hop>;
  /** Names declared here (a function, class or non-loader const). */
  declared: Set<string>;
  sf: TS.SourceFile;
}

/** Resolve `@/…` and relative specifiers to a file in our tree, or null. */
export function resolveSpecifier(
  fromFile: string,
  spec: string,
): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith("."))
    base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

const where = (sf: TS.SourceFile, node: TS.Node): string =>
  `${rel(sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;

/**
 * The module a `dynamic(loader)` call loads, and the export it takes:
 * `() => import("x")` (the default export), `() => import("x").then((m) =>
 * m.X)`, or `() => import("x").then(({ X }) => X)`. Anything else throws —
 * an unreadable loader is a dropped module.
 */
function loaderTarget(
  sf: TS.SourceFile,
  call: TS.CallExpression,
): { spec: string; name: string } {
  const fail = (): never => {
    throw new Error(
      `${where(sf, call)}: a dynamic() loader this reader cannot follow — write it as () => import("…").then(({ X }) => X)`,
    );
  };
  const loader = call.arguments[0];
  if (
    !loader ||
    !(ts.isArrowFunction(loader) || ts.isFunctionExpression(loader))
  )
    return fail();
  let body: TS.Node = loader.body;
  if (ts.isBlock(body)) {
    const ret = body.statements.find(ts.isReturnStatement);
    if (!ret?.expression) return fail();
    body = ret.expression;
  }
  while (ts.isParenthesizedExpression(body)) body = body.expression;
  const isImport = (n: TS.Node): n is TS.CallExpression =>
    ts.isCallExpression(n) &&
    n.expression.kind === ts.SyntaxKind.ImportKeyword &&
    !!n.arguments[0] &&
    ts.isStringLiteral(n.arguments[0]);
  if (isImport(body))
    return {
      spec: (body.arguments[0] as TS.StringLiteral).text,
      name: "default",
    };
  if (
    ts.isCallExpression(body) &&
    ts.isPropertyAccessExpression(body.expression) &&
    body.expression.name.text === "then" &&
    isImport(body.expression.expression)
  ) {
    const spec = (body.expression.expression.arguments[0] as TS.StringLiteral)
      .text;
    const cb = body.arguments[0];
    if (!cb || !(ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)))
      return fail();
    const param = cb.parameters[0];
    if (!param) return fail();
    // `({ X }) => X`
    if (ts.isObjectBindingPattern(param.name)) {
      const [only] = param.name.elements;
      if (param.name.elements.length !== 1 || !only) return fail();
      const name = ((only.propertyName ?? only.name) as TS.Identifier).text;
      return { spec, name };
    }
    // `(m) => m.X`
    let ret: TS.Node = cb.body;
    while (ts.isParenthesizedExpression(ret)) ret = ret.expression;
    if (
      ts.isIdentifier(param.name) &&
      ts.isPropertyAccessExpression(ret) &&
      ts.isIdentifier(ret.expression) &&
      ret.expression.text === param.name.text
    )
      return { spec, name: ret.name.text };
  }
  return fail();
}

const factsCache = new Map<string, ModuleFacts>();

function facts(file: string): ModuleFacts {
  const hit = factsCache.get(file);
  if (hit) return hit;
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const bindings = new Map<string, Hop>();
  const declared = new Set<string>();
  const bind = (local: string, spec: string, name: string, via: Hop["via"]) => {
    const target = resolveSpecifier(file, spec);
    // A package (`next/dynamic`, `lucide-react`) is not a panel module.
    if (target) bindings.set(local, { file: target, name, via });
  };
  // The local names `next/dynamic`'s default export is bound to.
  const dynamicNames = new Set<string>();
  for (const stmt of sf.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      const clause = stmt.importClause;
      if (!clause || clause.isTypeOnly) continue;
      const spec = stmt.moduleSpecifier.text;
      if (clause.name) {
        if (spec === "next/dynamic") dynamicNames.add(clause.name.text);
        bind(clause.name.text, spec, "default", "static");
      }
      const named = clause.namedBindings;
      if (named && ts.isNamedImports(named))
        for (const el of named.elements) {
          if (el.isTypeOnly) continue;
          bind(el.name.text, spec, (el.propertyName ?? el.name).text, "static");
        }
    } else if (
      ts.isExportDeclaration(stmt) &&
      !stmt.isTypeOnly &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.exportClause &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      for (const el of stmt.exportClause.elements) {
        if (el.isTypeOnly) continue;
        bind(
          el.name.text,
          stmt.moduleSpecifier.text,
          (el.propertyName ?? el.name).text,
          "static",
        );
      }
    } else if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) {
      if (stmt.name) declared.add(stmt.name.text);
    }
  }
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const init = decl.initializer;
      if (
        init &&
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression) &&
        dynamicNames.has(init.expression.text)
      ) {
        const { spec, name } = loaderTarget(sf, init);
        const target = resolveSpecifier(file, spec);
        if (!target)
          throw new Error(
            `${where(sf, init)}: dynamic() loads "${spec}", which is not a file in this tree`,
          );
        bindings.set(decl.name.text, { file: target, name, via: "dynamic" });
      } else {
        declared.add(decl.name.text);
      }
    }
  }
  const value = { bindings, declared, sf };
  factsCache.set(file, value);
  return value;
}

export interface Resolved {
  /** The module that defines the component. */
  file: string;
  /** Its name there. */
  name: string;
  /** Every hop taken from the name as the caller wrote it. */
  hops: Hop[];
}

/** Follow `name`, as `file` uses it, to the module that defines it. */
export function resolveComponent(file: string, name: string): Resolved {
  const hops: Hop[] = [];
  let at = { file, name };
  for (let i = 0; i < 16; i++) {
    const f = facts(at.file);
    const hop = f.bindings.get(at.name);
    if (!hop) {
      if (f.declared.has(at.name)) return { ...at, hops };
      throw new Error(
        `${rel(at.file)}: ${at.name} is neither declared there nor bound to a module this reader can follow`,
      );
    }
    hops.push(hop);
    at = { file: hop.file, name: hop.name };
  }
  throw new Error(`${rel(file)}: ${name} resolves through a cycle`);
}

/** The first JSX element under `node` whose tag passes `keep`, as written. */
function firstJsx(
  node: TS.Node,
  keep: (el: TS.JsxOpeningLikeElement) => boolean,
): TS.JsxOpeningLikeElement | null {
  let found: TS.JsxOpeningLikeElement | null = null;
  const visit = (n: TS.Node): void => {
    if (found) return;
    if (
      (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) &&
      keep(n)
    ) {
      found = n;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

const tagName = (el: TS.JsxOpeningLikeElement): string => el.tagName.getText();

const hasAttribute = (el: TS.JsxOpeningLikeElement, name: string): boolean =>
  el.attributes.properties.some(
    (p) => ts.isJsxAttribute(p) && p.name.getText() === name,
  );

/** One way a dispatcher mounts a module. */
export interface DispatchArm {
  /** The runner kinds (`case` labels) or slugs (`tool.slug ===`) of this arm. */
  keys: string[];
  /** The component as the dispatcher writes it. */
  component: string;
  /** The module that defines it, and how the dispatcher reaches it. */
  resolved: Resolved;
}

/**
 * The element the page hands its runner kind to: whatever receives, as an
 * attribute, the variable assigned from `getRunnerKind(…)`. Derived from the
 * registry call, so renaming the dispatcher component moves this with it.
 */
export function runnerDispatcher(): Resolved {
  const { sf } = facts(TOOL_PAGE);
  const kindVars = new Set<string>();
  const visitDecl = (n: TS.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isCallExpression(n.initializer) &&
      ts.isIdentifier(n.initializer.expression) &&
      n.initializer.expression.text === "getRunnerKind"
    )
      kindVars.add(n.name.text);
    ts.forEachChild(n, visitDecl);
  };
  visitDecl(sf);
  if (kindVars.size !== 1)
    throw new Error(
      `${rel(TOOL_PAGE)} assigns getRunnerKind(…) to ${kindVars.size} variables; expected exactly one`,
    );
  const [kindVar] = kindVars;
  const el = firstJsx(sf, (e) =>
    e.attributes.properties.some(
      (p) =>
        ts.isJsxAttribute(p) &&
        !!p.initializer &&
        ts.isJsxExpression(p.initializer) &&
        !!p.initializer.expression &&
        ts.isIdentifier(p.initializer.expression) &&
        p.initializer.expression.text === kindVar,
    ),
  );
  if (!el)
    throw new Error(`${rel(TOOL_PAGE)} mounts no element with {${kindVar}}`);
  return resolveComponent(TOOL_PAGE, tagName(el));
}

/** The runner dispatcher's `case` arms, each resolved to its module. */
export function runnerArms(): DispatchArm[] {
  const dispatcher = runnerDispatcher();
  const { sf } = facts(dispatcher.file);
  const arms: DispatchArm[] = [];
  const visit = (n: TS.Node): void => {
    if (ts.isSwitchStatement(n)) {
      let pending: string[] = [];
      for (const clause of n.caseBlock.clauses) {
        if (ts.isDefaultClause(clause)) {
          pending = [];
          continue;
        }
        if (!ts.isStringLiteral(clause.expression))
          throw new Error(
            `${where(sf, clause)}: a case label that is not a string literal`,
          );
        pending.push(clause.expression.text);
        if (clause.statements.length === 0) continue; // falls through
        const el = firstJsx(clause, (e) => /^[A-Z]/.test(tagName(e)));
        if (!el)
          throw new Error(
            `${where(sf, clause)}: case ${pending.join(", ")} mounts no component`,
          );
        arms.push({
          keys: pending,
          component: tagName(el),
          resolved: resolveComponent(dispatcher.file, tagName(el)),
        });
        pending = [];
      }
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return arms;
}

/**
 * The module a component the runner dispatcher mounts is defined in,
 * repo-relative (`src/components/tools/runner/merge-runner.tsx`) — followed
 * through the dispatcher's own bindings, static or `next/dynamic`. For the
 * guards that read a runner's SOURCE: what the dispatcher renders is a loader,
 * and what the reader gets is the module it loads.
 */
export function runnerModuleOf(component: string): string {
  return rel(resolveComponent(runnerDispatcher().file, component).file);
}

/** A module file as the `@/…` specifier a test can `import()`. */
export function specifierOf(file: string): string {
  return `@/${path
    .relative(SRC, file)
    .split(path.sep)
    .join("/")
    .replace(/\.tsx?$/, "")}`;
}

/** `tool.slug === "x"` — the literal, or null. */
function slugComparison(n: TS.Node): string | null {
  if (
    ts.isBinaryExpression(n) &&
    n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    n.left.getText() === "tool.slug" &&
    ts.isStringLiteral(n.right)
  )
    return n.right.text;
  return null;
}

/** The slugs of an arm condition made ONLY of `tool.slug === "…"` joined by `||`. */
function armSlugs(cond: TS.Expression): string[] | null {
  let c: TS.Expression = cond;
  while (ts.isParenthesizedExpression(c)) c = c.expression;
  const one = slugComparison(c);
  if (one !== null) return [one];
  if (
    ts.isBinaryExpression(c) &&
    c.operatorToken.kind === ts.SyntaxKind.BarBarToken
  ) {
    const left = armSlugs(c.left);
    const right = armSlugs(c.right);
    return left && right ? [...left, ...right] : null;
  }
  return null;
}

/**
 * The page's worker-panel arms: every `tool.slug === "…" ? (…<X tool={tool}
 * />…)` conditional, resolved to the module that defines X. Every slug
 * comparison in the page must land in one of them.
 */
export function workerPanelArms(): DispatchArm[] {
  const { sf } = facts(TOOL_PAGE);
  const arms: DispatchArm[] = [];
  let compared = 0;
  const visit = (n: TS.Node): void => {
    if (slugComparison(n) !== null) compared += 1;
    if (ts.isConditionalExpression(n)) {
      const slugs = armSlugs(n.condition);
      if (slugs) {
        const el = firstJsx(n.whenTrue, (e) => hasAttribute(e, "tool"));
        if (!el)
          throw new Error(
            `${where(sf, n)}: the arm for ${slugs.join(", ")} mounts no element with a tool prop`,
          );
        arms.push({
          keys: slugs,
          component: tagName(el),
          resolved: resolveComponent(TOOL_PAGE, tagName(el)),
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const parsed = arms.reduce((sum, arm) => sum + arm.keys.length, 0);
  if (compared !== parsed)
    throw new Error(
      `${rel(TOOL_PAGE)} compares tool.slug ${compared} times; the arms parsed account for ${parsed}`,
    );
  return arms;
}

/** Every panel module a tool page can mount, keyed by file. */
export interface PanelModule {
  file: string;
  name: string;
  /** "runner" (registry kind → dispatcher case) or "worker" (page slug arm). */
  dispatch: "runner" | "worker";
  /** The catalogue slugs whose page mounts it. */
  slugs: string[];
}

/**
 * slug → the module its page mounts as its panel, or null (a page that mounts
 * neither a runner nor a worker panel: the upload zone or the worker preview).
 * Mirrors the page: a registry kind wins, the slug arms are the fallback.
 * Throws on any broken link — see the module docblock.
 */
export function ownPanelModules(): {
  bySlug: Map<string, PanelModule | null>;
  modules: PanelModule[];
} {
  const runners = runnerArms();
  const workers = workerPanelArms();
  const slugs = new Set(tools.map((t) => t.slug));
  const byKind = new Map<string, DispatchArm>();
  for (const arm of runners)
    for (const kind of arm.keys) {
      if (byKind.has(kind))
        throw new Error(`the runner dispatcher has two arms for "${kind}"`);
      byKind.set(kind, arm);
    }
  const bySlugArm = new Map<string, DispatchArm>();
  for (const arm of workers)
    for (const slug of arm.keys) {
      if (!slugs.has(slug))
        throw new Error(
          `${rel(TOOL_PAGE)} dispatches "${slug}", which is not a catalogue slug`,
        );
      if (bySlugArm.has(slug))
        throw new Error(`${rel(TOOL_PAGE)} has two panel arms for "${slug}"`);
      bySlugArm.set(slug, arm);
    }
  const modules = new Map<string, PanelModule>();
  const bySlug = new Map<string, PanelModule | null>();
  const reachedKinds = new Set<string>();
  const reachedArms = new Set<DispatchArm>();
  for (const tool of tools) {
    const kind = getRunnerKind(tool.slug);
    let arm: DispatchArm | undefined;
    let dispatch: PanelModule["dispatch"];
    if (kind) {
      arm = byKind.get(kind);
      if (!arm)
        throw new Error(
          `the registry gives ${tool.slug} the kind "${kind}", and the runner dispatcher has no case for it`,
        );
      reachedKinds.add(kind);
      dispatch = "runner";
    } else {
      arm = bySlugArm.get(tool.slug);
      dispatch = "worker";
    }
    if (!arm) {
      bySlug.set(tool.slug, null);
      continue;
    }
    reachedArms.add(arm);
    const { file, name } = arm.resolved;
    const mod = modules.get(file) ?? { file, name, dispatch, slugs: [] };
    if (mod.dispatch !== dispatch)
      throw new Error(`${rel(file)} is mounted by both dispatchers`);
    mod.slugs.push(tool.slug);
    modules.set(file, mod);
    bySlug.set(tool.slug, mod);
  }
  // Both directions: an arm no catalogue page reaches is a module this corpus
  // would carry without a page to own it.
  const deadKinds = [...byKind.keys()].filter((k) => !reachedKinds.has(k));
  if (deadKinds.length > 0)
    throw new Error(
      `runner dispatcher cases no catalogue slug reaches: ${deadKinds.join(", ")}`,
    );
  const deadArms = workers.filter((a) => !reachedArms.has(a));
  if (deadArms.length > 0)
    throw new Error(
      `page panel arms no catalogue page reaches (a registry kind wins over them): ${deadArms.map((a) => a.keys.join("|")).join(", ")}`,
    );
  return { bySlug, modules: [...modules.values()] };
}
