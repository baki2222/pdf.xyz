/**
 * The variants of a runner kind that several tools share, read off the
 * kind's runner module with the TypeScript parser — the SOURCE half of
 * `src/deploy/variant-panels.test.ts` (which reads the build), kept here so
 * that the reader itself is tested without a build
 * (`shared-kind-variants.test.ts`).
 *
 * A runner on a shared kind picks each page's editor by the page's slug:
 *
 *     const slug = useToolRun()?.slug;
 *     if (slug === "booklet-pdf") return <BookletRunner />;
 *     return <SinglePdfRunner …>{(pdf, reset) => <nUp.Panel … />}</SinglePdfRunner>;
 *
 * Each `if` is an ARM; the statements after the last arm are the DEFAULT,
 * for the slugs no arm names.
 *
 * WHAT A VARIANT REACHES is read from the code of its OWN branch — the arm's
 * `then`, or the default's statements — never from the module some JSX tag
 * in it resolves to. Every identifier there bound to a value import of the
 * runner is a static entry, every `import()` a lazy one, and a top-level
 * declaration of the runner it names (`const nUp = lazyPanel(…)`, a helper
 * component) is read the same way. The variant's reach is the value closure
 * of those entries; what NO sibling reaches is the variant's own.
 *
 * As first written (2026-11-10) a variant was "the module of the first
 * capitalised tag in its arm", and its editors that module's `import()`s.
 * An arm written inline — `<SinglePdfRunner …>{… <BookletEditor />}` with a
 * static import, the shape the default arm already had — then resolved to
 * `single-pdf-runner.tsx`, whose own unrelated `import("../replace-boxes")`
 * passed for Booklet's lazy editor; the real editor was in no variant, and
 * the sibling-editor assertion stayed green while Multiple Pages per
 * Sheet's first load carried the booklet editor (review of 6376d6da). The
 * suite went red only because replace-boxes.tsx happened to have one
 * marker. Reading the branch's own code, the shared runner is in every
 * variant's reach and so in none's own set, and the editor is Booklet's
 * whichever way it is imported.
 *
 * Of a variant's own modules exactly one may sit in its siblings' first
 * load: its HOST, the module of the single element an arm returns
 * (`return <BookletRunner />`) — the drop box, which the kind's runner
 * imports statically by design. Nothing the host imports is excused, so a
 * static editor import in a host is in its own set and in every sibling's
 * first load: the defect, visible. A variant's EDITORS are the `import()`
 * targets under `src/components` in its branch or its host that only it
 * reaches; on a kind with two or more variants one without any is FATAL.
 *
 * FATAL, never a smaller answer (CLAUDE.md rule 4): the slug read twice; a
 * comparison with it that is not `if (<slug> === "<literal>") return …`; an
 * arm with an `else`, for a slug not on the kind, or a second arm for a
 * slug; any statement between the slug's read and the last arm other than
 * an arm (it runs for every variant, and no variant would own what it
 * names); a top-level statement of the runner that is not an import, a
 * declaration or a directive (`void X;`, a side-effect import, a re-export:
 * each puts code in every page with no variant owning it).
 */
import ts from "typescript";
import path from "node:path";
import {
  SRC,
  parsedSource,
  rel,
  resolveSpecifier,
  valueClosure,
} from "./tool-panel-modules";
import { isTestFile } from "./chunk-markers";

const COMPONENTS = path.join(SRC, "components") + path.sep;

export interface VariantShape {
  kind: string;
  slugs: string[];
  /** The drop box an arm returns as its single element, or null. */
  host: string | null;
  /** The variant's `import()` editors (see the module docblock). */
  editors: string[];
  /** Every module only this variant reaches, editors included, host not. */
  modules: string[];
  /** The value-import closure of the variant's branch (diagnostics). */
  reach: string[];
}

const where = (sf: ts.SourceFile, node: ts.Node): string =>
  `${rel(sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;

const isDynamicImport = (n: ts.Node): n is ts.CallExpression =>
  ts.isCallExpression(n) &&
  n.expression.kind === ts.SyntaxKind.ImportKeyword &&
  !!n.arguments[0] &&
  ts.isStringLiteral(n.arguments[0]);

/** `import("…")` targets in `node`, resolved to files of this tree. */
function importCalls(file: string, node: ts.Node): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (isDynamicImport(n)) {
      const target = resolveSpecifier(
        file,
        (n.arguments[0] as ts.StringLiteral).text,
      );
      if (target) out.push(target);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/** An identifier that is a NAME here (a property, an attribute), not a use. */
function isNameOnly(id: ts.Identifier): boolean {
  const p = id.parent;
  return (
    (ts.isPropertyAccessExpression(p) && p.name === id) ||
    (ts.isPropertyAssignment(p) && p.name === id) ||
    ts.isJsxAttribute(p) ||
    ((ts.isVariableDeclaration(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isBindingElement(p)) &&
      p.name === id)
  );
}

interface RunnerFacts {
  sf: ts.SourceFile;
  /** Local name → the file a value import binds it to. */
  imports: Map<string, string>;
  /** Top-level declarations by name. */
  declared: Map<string, ts.Node>;
}

function runnerFacts(runner: string): RunnerFacts {
  const sf = parsedSource(runner);
  const imports = new Map<string, string>();
  const declared = new Map<string, ts.Node>();
  let directives = true;
  for (const stmt of sf.statements) {
    if (
      directives &&
      ts.isExpressionStatement(stmt) &&
      ts.isStringLiteral(stmt.expression)
    )
      continue;
    directives = false;
    if (ts.isImportDeclaration(stmt)) {
      const clause = stmt.importClause;
      if (!clause)
        throw new Error(
          `${where(sf, stmt)}: a side-effect import in a shared kind's runner loads its module on every page of the kind, and no variant owns it`,
        );
      if (clause.isTypeOnly) continue;
      const spec = (stmt.moduleSpecifier as ts.StringLiteral).text;
      const target = resolveSpecifier(runner, spec);
      if (!target) continue; // a package (`react`): nobody's editor
      if (clause.name) imports.set(clause.name.text, target);
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named))
        imports.set(named.name.text, target);
      if (named && ts.isNamedImports(named))
        for (const el of named.elements)
          if (!el.isTypeOnly) imports.set(el.name.text, target);
      continue;
    }
    if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) {
      if (stmt.name) declared.set(stmt.name.text, stmt);
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name))
          throw new Error(
            `${where(sf, d)}: a destructuring declaration this reader cannot attribute`,
          );
        declared.set(d.name.text, d);
      }
      continue;
    }
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt))
      continue;
    throw new Error(
      `${where(sf, stmt)}: a top-level statement this reader cannot attribute to a variant — in a shared kind's runner, only imports, declarations and directives`,
    );
  }
  return { sf, imports, declared };
}

/** The static and lazy entries the code in `nodes` names. */
function entriesOf(
  runner: string,
  facts: RunnerFacts,
  nodes: readonly ts.Node[],
): { static: Set<string>; lazy: Set<string> } {
  const out = { static: new Set<string>(), lazy: new Set<string>() };
  const seen = new Set<ts.Node>();
  const visit = (n: ts.Node): void => {
    if (isDynamicImport(n)) {
      const target = resolveSpecifier(
        runner,
        (n.arguments[0] as ts.StringLiteral).text,
      );
      if (target) out.lazy.add(target);
    }
    if (ts.isIdentifier(n) && !isNameOnly(n)) {
      const imported = facts.imports.get(n.text);
      if (imported) out.static.add(imported);
      const decl = facts.declared.get(n.text);
      if (decl && !seen.has(decl)) {
        seen.add(decl);
        visit(decl);
      }
    }
    ts.forEachChild(n, visit);
  };
  for (const n of nodes) visit(n);
  return out;
}

/** The module of the single element `stmt` returns, if it is that shape. */
function returnedElementModule(
  facts: RunnerFacts,
  stmts: readonly ts.Statement[],
): string | null {
  if (stmts.length !== 1) return null;
  let stmt: ts.Statement = stmts[0]!;
  if (ts.isBlock(stmt)) {
    if (stmt.statements.length !== 1) return null;
    stmt = stmt.statements[0]!;
  }
  if (!ts.isReturnStatement(stmt) || !stmt.expression) return null;
  let e: ts.Expression = stmt.expression;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (!ts.isJsxSelfClosingElement(e) || !ts.isIdentifier(e.tagName))
    return null;
  return facts.imports.get(e.tagName.text) ?? null;
}

/** The variants of one shared kind, read off its runner module. */
export function readVariants(
  kind: string,
  slugs: readonly string[],
  runner: string,
): VariantShape[] {
  const facts = runnerFacts(runner);
  const { sf } = facts;
  const slugDecls: ts.VariableDeclaration[] = [];
  const findVar = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isPropertyAccessExpression(n.initializer) &&
      n.initializer.name.text === "slug" &&
      ts.isCallExpression(n.initializer.expression) &&
      n.initializer.expression.expression.getText(sf) === "useToolRun"
    )
      slugDecls.push(n);
    ts.forEachChild(n, findVar);
  };
  findVar(sf);
  if (slugDecls.length > 1)
    throw new Error(
      `${rel(runner)} reads the page's slug ${slugDecls.length} times`,
    );

  interface Branch {
    slugs: string[];
    nodes: ts.Statement[];
  }
  const branches: Branch[] = [];
  const armed = new Set<string>();
  if (slugDecls.length === 1) {
    const decl = slugDecls[0]!;
    const slugVar = (decl.name as ts.Identifier).text;
    const declStmt = decl.parent.parent;
    const body = declStmt.parent;
    if (!ts.isVariableStatement(declStmt) || !ts.isBlock(body))
      throw new Error(
        `${where(sf, decl)}: the page's slug is read somewhere other than a statement of the runner's body`,
      );
    const arms = new Set<ts.IfStatement>();
    // Every comparison with the slug, anywhere in the file, must be an arm.
    const visit = (n: ts.Node): void => {
      if (
        ts.isBinaryExpression(n) &&
        [n.left, n.right].some(
          (s) => ts.isIdentifier(s) && s.text === slugVar,
        ) &&
        n.operatorToken.kind !== ts.SyntaxKind.EqualsToken
      ) {
        const other =
          ts.isIdentifier(n.left) && n.left.text === slugVar ? n.right : n.left;
        const ifStmt = n.parent;
        if (
          n.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken ||
          !ts.isStringLiteral(other) ||
          !ts.isIfStatement(ifStmt) ||
          ifStmt.expression !== n ||
          ifStmt.parent !== body
        )
          throw new Error(
            `${where(sf, n)}: a comparison with the page's slug this reader cannot follow — write it \`if (${slugVar} === "<slug>") return <Runner />\` in the runner's body`,
          );
        if (ifStmt.elseStatement)
          throw new Error(
            `${where(sf, n)}: an arm with an \`else\` — return from the arm, and let the default follow it`,
          );
        const slug = other.text;
        if (!slugs.includes(slug))
          throw new Error(
            `${where(sf, n)}: an arm for "${slug}", which is not on the "${kind}" kind`,
          );
        if (armed.has(slug))
          throw new Error(`${where(sf, n)}: a second arm for "${slug}"`);
        armed.add(slug);
        arms.add(ifStmt);
        branches.push({ slugs: [slug], nodes: [ifStmt.thenStatement] });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    const stmts = body.statements;
    const at = stmts.indexOf(declStmt);
    const lastArm = Math.max(
      at,
      ...[...arms].map((a) => stmts.indexOf(a as ts.Statement)),
    );
    for (let i = 0; i < lastArm; i++) {
      const s = stmts[i]!;
      if (s === declStmt || arms.has(s as ts.IfStatement)) continue;
      throw new Error(
        `${where(sf, s)}: a statement ${i < at ? "before the page's slug is read" : "between the arms"} runs for every variant, and no variant would own what it names — move it into a branch`,
      );
    }
    const rest = slugs.filter((s) => !armed.has(s));
    if (rest.length > 0)
      branches.push({ slugs: rest, nodes: [...stmts.slice(lastArm + 1)] });
  }
  // One variant (the runner never reads the slug): no sibling to load.
  if (branches.length < 2)
    return [
      {
        kind,
        slugs: [...slugs],
        host: null,
        editors: [],
        modules: [],
        reach: [],
      },
    ];

  const read = branches.map((b) => {
    const entries = entriesOf(runner, facts, b.nodes);
    const reach = new Set(
      [...entries.static, ...entries.lazy].flatMap((e) => valueClosure(e)),
    );
    return { ...b, entries, reach };
  });
  const variants: VariantShape[] = read.map((b, i) => {
    const others = new Set(
      read.filter((_, j) => j !== i).flatMap((o) => [...o.reach]),
    );
    const own = [...b.reach].filter(
      (m) => !others.has(m) && m !== runner && !isTestFile(m),
    );
    const owned = new Set(own);
    const candidate = returnedElementModule(facts, b.nodes);
    const host = candidate && owned.has(candidate) ? candidate : null;
    const lazy = [
      ...b.entries.lazy,
      ...(host ? importCalls(host, parsedSource(host)) : []),
    ];
    const editors = [
      ...new Set(lazy.filter((m) => m.startsWith(COMPONENTS) && owned.has(m))),
    ];
    return {
      kind,
      slugs: b.slugs,
      host,
      editors,
      modules: own.filter((m) => m !== host),
      reach: [...b.reach],
    };
  });
  if (variants.length >= 2)
    for (const v of variants)
      if (v.editors.length === 0)
        throw new Error(
          `${rel(runner)} draws ${v.slugs.join(", ")} with no lazily loaded editor of its own — on a kind its siblings share, a static editor is in every sibling's first load`,
        );
  return variants;
}
