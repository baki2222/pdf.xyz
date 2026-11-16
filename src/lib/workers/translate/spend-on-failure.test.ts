// @vitest-environment node
/**
 * GUARD: every failure `runTranslate` returns AFTER its first provider call
 * carries the spend — a `...spentSoFar()` spread, or `usage`, `window`,
 * `readingOrder` AND `pageMap` together.
 *
 * `readingOrder` (2026-11-16) is which text the paid calls sent, and how much.
 * It rides on the SAME carrier rather than on a parallel list, so a new arm
 * that carries the spend carries it too, and the predicate below is the one
 * place that says so. The carrier's own definition is checked as well: a
 * `spentSoFar` that lost `window` or `readingOrder` would pass every spread.
 * `pageMap` (translatePageMap, 2026-11) joined the same predicate and the
 * same carrier check, not a parallel list.
 *
 * WHY (2026-11-15). Four such returns shipped without either field: the
 * package size arm, a single empty translation, the all-empty fallback, and an
 * interruption that carried only the failing call's tokens. The executor's
 * spend hook was above the fork and correct; it recorded zero because the
 * failure shape was lean (CLAUDE.md rule 3: failure paths get the minimal type,
 * and money is spent on the way to both).
 *
 * THE SUBJECTS ARE DISCOVERED, not named: the engine is parsed with the
 * TypeScript compiler, `runTranslate` is found by declaration, and every
 * `return` whose value holds an `ok: false` object literal lexically after the
 * first `provider.complete(` is a subject — as is every assignment to
 * `interruption`, the carrier a mid-document failure rides out on. A new arm
 * written tomorrow is enrolled without anyone remembering this file.
 *
 * HEALTH: no `runTranslate`, no `provider.complete(`, or fewer than three
 * subjects is a FAILURE, never a pass — `[] ⊆ X` is vacuously true, and a
 * guard that loses its subjects would report the strongest possible green.
 *
 * POSITIVE CONTROL: the same predicate over an inline source with one bare
 * post-call failure must report it.
 *
 * MUTATION (recorded 2026-11-15, on a scratchpad COPY of engine.ts fed through
 * `ENGINE_SOURCE_OVERRIDE`): deleting `...spentSoFar()` from the size arm turned
 * this red naming that line; replacing it with `usage: undefined` alone (no
 * window) turned it red too. The guard cannot see a `spentSoFar` that lost its
 * own `window` (it checks for the spread, not the definition); that mutation
 * turned ten behavioural tests red instead (engine, processor and the
 * executor chain in `executor.translate-spend.test.ts`), which is the second,
 * independent bound.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

interface Subject {
  line: number;
  text: string;
  carries: boolean;
}

interface Scan {
  foundFunction: boolean;
  foundCall: boolean;
  subjects: Subject[];
}

function isOkFalse(literal: ts.ObjectLiteralExpression): boolean {
  return literal.properties.some(
    (p) =>
      ts.isPropertyAssignment(p) &&
      p.name.getText() === "ok" &&
      p.initializer.kind === ts.SyntaxKind.FalseKeyword,
  );
}

function spreadsSpentSoFar(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "spentSoFar"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function literalCarries(literal: ts.ObjectLiteralExpression): boolean {
  const names = new Set<string>();
  for (const p of literal.properties) {
    if (ts.isSpreadAssignment(p) && spreadsSpentSoFar(p.expression))
      return true;
    if (
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
      p.name
    )
      names.add(p.name.getText());
  }
  return (
    names.has("usage") &&
    names.has("window") &&
    names.has("readingOrder") &&
    names.has("pageMap")
  );
}

/**
 * The property names of the object literal `spentSoFar` returns, or null when
 * the definition is not found (a broken link, reported as a failure).
 */
function carrierFields(source: string): string[] | null {
  const file = ts.createSourceFile(
    "engine.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  let fields: string[] | null = null;
  const visit = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      n.name.getText() === "spentSoFar" &&
      n.initializer &&
      ts.isArrowFunction(n.initializer)
    ) {
      let body: ts.Node = n.initializer.body;
      while (ts.isParenthesizedExpression(body)) body = body.expression;
      if (ts.isObjectLiteralExpression(body)) {
        fields = body.properties
          .filter(
            (p) =>
              ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p),
          )
          .map((p) => p.name!.getText());
      }
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(file);
  return fields;
}

function okFalseLiterals(node: ts.Node): ts.ObjectLiteralExpression[] {
  const out: ts.ObjectLiteralExpression[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isObjectLiteralExpression(n) && isOkFalse(n)) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

function scanPostSpendFailures(source: string): Scan {
  const file = ts.createSourceFile(
    "engine.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const scan: Scan = { foundFunction: false, foundCall: false, subjects: [] };
  let fn: ts.FunctionDeclaration | undefined;
  file.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === "runTranslate") fn = n;
  });
  if (!fn?.body) return scan;
  scan.foundFunction = true;

  let firstCall = Number.POSITIVE_INFINITY;
  const findCall = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.getText() === "provider.complete"
    ) {
      firstCall = Math.min(firstCall, n.getStart());
    }
    ts.forEachChild(n, findCall);
  };
  findCall(fn.body);
  if (!Number.isFinite(firstCall)) return scan;
  scan.foundCall = true;

  const lineOf = (n: ts.Node) =>
    file.getLineAndCharacterOfPosition(n.getStart()).line + 1;

  const visit = (n: ts.Node): void => {
    if (n.getStart() > firstCall) {
      if (ts.isReturnStatement(n) && n.expression) {
        const literals = okFalseLiterals(n.expression);
        const viaInterruption =
          ts.isBinaryExpression(n.expression) &&
          n.expression.left.getText() === "interruption";
        if (literals.length > 0 || viaInterruption) {
          scan.subjects.push({
            line: lineOf(n),
            text: n.getText().replace(/\s+/g, " ").slice(0, 120),
            carries:
              literals.length > 0 && literals.every((l) => literalCarries(l)),
          });
        }
      }
      // The carrier for a mid-document failure: `interruption = …(…)`.
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        n.left.getText() === "interruption"
      ) {
        scan.subjects.push({
          line: lineOf(n),
          text: n.getText().replace(/\s+/g, " ").slice(0, 120),
          carries: spreadsSpentSoFar(n.right),
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(fn.body);
  return scan;
}

const ENGINE = join(process.cwd(), "src/lib/workers/translate/engine.ts");
const source = readFileSync(
  process.env.ENGINE_SOURCE_OVERRIDE ?? ENGINE,
  "utf8",
);

describe("every post-spend failure in runTranslate carries the spend", () => {
  const scan = scanPostSpendFailures(source);

  it("health: the function, the call and at least three subjects are found", () => {
    expect(scan.foundFunction, "runTranslate was not found").toBe(true);
    expect(scan.foundCall, "provider.complete( was not found").toBe(true);
    expect(
      scan.subjects.length,
      `implausibly few subjects: ${JSON.stringify(scan.subjects)}`,
    ).toBeGreaterThanOrEqual(3);
  });

  it("no subject drops the spend", () => {
    const bare = scan.subjects.filter((s) => !s.carries);
    expect(
      bare.map((s) => `engine.ts:${s.line} ${s.text}`),
      "a failure returned after provider.complete( carries neither " +
        "...spentSoFar() nor usage+window — the spend hook will record zero",
    ).toEqual([]);
  });

  it("positive control: a bare post-call failure is reported", () => {
    const control = scanPostSpendFailures(`
      export async function runTranslate(provider: any) {
        if (Math.random()) return { ok: false, kind: "x", message: "before" };
        const c = await provider.complete({});
        if (!c.ok) return { ok: false, kind: "failed", message: "bare" };
        return { ok: false, ...spentSoFar(), message: "fine" };
      }
    `);
    expect(control.foundCall).toBe(true);
    expect(control.subjects).toHaveLength(2);
    expect(control.subjects.filter((s) => !s.carries)).toHaveLength(1);
    expect(control.subjects.find((s) => !s.carries)?.text).toContain("bare");
  });

  it("the carrier itself holds the window, the reading order and the page map on every call", () => {
    const fields = carrierFields(source);
    expect(fields, "spentSoFar's object literal was not found").not.toBeNull();
    // `usage` is conditional by design (only when some call reported); the
    // other two are explicit fields, never spread conditionally.
    expect(fields).toEqual(
      expect.arrayContaining(["window", "readingOrder", "pageMap"]),
    );
  });

  it("positive control: usage + window without readingOrder is reported", () => {
    const control = scanPostSpendFailures(`
      export async function runTranslate(provider: any) {
        const c = await provider.complete({});
        if (!c.ok) return { ok: false, kind: "failed", usage, window };
        return { ok: false, usage, window, readingOrder, pageMap, message: "fine" };
      }
    `);
    expect(control.subjects).toHaveLength(2);
    expect(control.subjects.filter((s) => !s.carries)).toHaveLength(1);
    // And without pageMap (translatePageMap, 2026-11): reported too.
    const noMap = scanPostSpendFailures(`
      export async function runTranslate(provider: any) {
        const c = await provider.complete({});
        if (!c.ok) return { ok: false, usage, window, readingOrder };
        return { ok: false, usage, window, readingOrder, pageMap, message: "fine" };
      }
    `);
    expect(noMap.subjects.filter((s) => !s.carries)).toHaveLength(1);
    expect(
      carrierFields(
        `const spentSoFar = () => ({ window, ...(u ? { usage } : {}) });`,
      ),
    ).toEqual(["window"]);
  });

  it("positive control: a broken link is fatal, not a pass", () => {
    const control = scanPostSpendFailures(
      `export function runTranslateRenamed() { return { ok: false }; }`,
    );
    expect(control.foundFunction).toBe(false);
    expect(control.subjects).toEqual([]);
  });
});
