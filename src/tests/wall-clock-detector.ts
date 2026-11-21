import { createHash } from "node:crypto";
import ts from "typescript";

/**
 * The detector behind `wall-clock-bounds.test.ts`: every comparison in a
 * test that can fail on how fast the runner is, every routed call to the
 * time-bound helpers, and every fixed sleep. Pure — text in, members out —
 * so the guard's planted controls run through exactly the function that
 * reads the corpus (`A guard can match prose, not code`: controls must run
 * THROUGH the detector).
 *
 * Comparison rules (design 2, plus critic P7):
 *
 *  R1  a clock read reaches the subject through a variable: `performance.now()`,
 *      `Date.now()`, `process.hrtime(.bigint)()`, `new Date().getTime()`, or
 *      an ALIAS of one (`const realDateNow = Date.now.bind(Date)`, which
 *      every earlier finder missed in `poll-leak-guard.ts`);
 *  R2  the subject is time-named (`ms`, `*Ms`, `elapsed*`, `took*`,
 *      `*Duration`, `duration*`, `latency*`, `perQuery*`), config names out;
 *  R3  the bound is time-named and the subject was observed (an `await`, or
 *      derived from one) — merge-tool's p95 against a frame budget;
 *  R4  `expect(a < b).toBe(..)` on time values, or a same-file boolean
 *      helper whose returned comparison is on time values (`withinBound`);
 *  R5  a filter/some/every/find predicate comparing a time-named value with
 *      a time-named bound;
 *  R6  the matchers: `toBe(Less|Greater)Than(OrEqual)`, also under `.not`,
 *      on `expect` and `expect.soft`, callee text whitespace-normalised (a
 *      multi-line `expect\n.soft` evaded the first draft);
 *  R7  a deadline loop: a loop whose condition compares a clock read — the
 *      shape of `poll-leak-guard.ts`'s 2 s grace, run in every file's
 *      afterAll (hooks are in scope: the whole file is walked).
 */

export type WallClockRule = "R1" | "R2" | "R3" | "R4" | "R5" | "R7";

export interface WallClockMember {
  file: string;
  line: number;
  rule: WallClockRule;
  /**
   * "floor" for an at-least comparison (`toBeGreaterThan*`, or a negated
   * `toBeLessThan*`): a slower runner only makes it easier to pass, so it
   * is reported but never in debt. Everything else is a ceiling.
   */
  direction: "ceiling" | "floor";
  /** The comparison's text, whitespace collapsed: the key, with `file` and an occurrence index. */
  snippet: string;
  /** Every source line the member spans, collapsed (seed matching). */
  lines: string[];
}

export type RoutedHelper =
  | "expectFasterThan"
  | "expectRatioBelow"
  | "expectAtLeast"
  | "measureTime"
  | "timedWait";

export interface RoutedCall {
  file: string;
  line: number;
  helper: RoutedHelper;
  /** null when the id is not a string literal (the guard refuses that). */
  id: string | null;
  mode: "assert" | "measure";
  kind: "ceiling" | "ratio" | "floor";
  witness?: string;
  /** Whether `witness` is the subject of an `expect` in the same test body. */
  witnessAsserted: boolean;
  /** The bound, when it is a literal or a same-file numeric const. */
  bound?: number;
  boundText: string;
  /** The enclosing test's name, when the call is inside one. */
  test?: string;
  /** sha256 (16 hex) of the enclosing test's (or function's) collapsed body. */
  bodyHash: string;
  snippet: string;
}

export interface SleepMember {
  file: string;
  line: number;
  ms: number;
  snippet: string;
}

export interface ScanResult {
  comparisons: WallClockMember[];
  routed: RoutedCall[];
  sleeps: SleepMember[];
  parseErrors: string[];
}

export const ROUTED_HELPERS: readonly RoutedHelper[] = [
  "expectFasterThan",
  "expectRatioBelow",
  "expectAtLeast",
  "measureTime",
  "timedWait",
];

const ORDER_MATCHERS = new Set([
  "toBeLessThan",
  "toBeLessThanOrEqual",
  "toBeGreaterThan",
  "toBeGreaterThanOrEqual",
]);

const TIME_NAME =
  /^(ms|\w*Ms|elapsed\w*|took\w*|\w*Duration|duration\w*|latency\w*|perQuery\w*)$/;
/** Config names: a bound, a knob or a schedule — never the measured subject. */
const CONFIG_NAME =
  /^(timeout\w*|\w*Timeout\w*|\w*TIMEOUT\w*|interval\w*|delay\w*|budget\w*|ttl\w*|deadline\w*|retryAfter\w*|\w*(Budget|Interval|Delay|Ceiling|Bound|Limit|Max|Min|Wait|Sleep|Hold|Grace)Ms)$/i;
const BOUND_NAME = /(Ms|_MS)\b/;
const COMPARE = new Set([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
]);
const ARITH = new Set([
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

export const isTimeName = (name: string): boolean =>
  TIME_NAME.test(name) && !CONFIG_NAME.test(name);

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function unwrap(x: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(x) ||
    ts.isAsExpression(x) ||
    ts.isNonNullExpression(x) ||
    ts.isTypeAssertionExpression(x) ||
    ts.isSatisfiesExpression(x)
  )
    x = x.expression;
  return x;
}

/** `Date.now`, `performance.now`, `process.hrtime`, `process.hrtime.bigint`. */
function isClockReference(text: string): boolean {
  return /^(globalThis\.)?(performance\.now|Date\.now|process\.hrtime(\.bigint)?)$/.test(
    text,
  );
}

/** A file's analysis state: tainted names, clock aliases, observed names. */
interface FileState {
  sf: ts.SourceFile;
  aliases: Set<string>;
  tainted: Set<string>;
  observed: Set<string>;
  consts: Map<string, number>;
  boolHelpers: Map<string, ts.Expression>;
}

function isClockCall(x: ts.Expression, st: FileState): boolean {
  x = unwrap(x);
  if (!ts.isCallExpression(x)) return false;
  const callee = collapse(x.expression.getText(st.sf));
  if (isClockReference(callee)) return true;
  if (ts.isIdentifier(x.expression) && st.aliases.has(x.expression.text))
    return true;
  // new Date().getTime() / .valueOf() with no arguments
  if (
    ts.isPropertyAccessExpression(x.expression) &&
    /^(getTime|valueOf)$/.test(x.expression.name.text)
  ) {
    const target = unwrap(x.expression.expression);
    if (
      ts.isNewExpression(target) &&
      target.expression.getText(st.sf) === "Date" &&
      (target.arguments?.length ?? 0) === 0
    )
      return true;
  }
  return false;
}

/** Whether an expression carries a wall-clock time (R1 taint or R2 name). */
function isTimeExpr(x: ts.Expression | undefined, st: FileState): boolean {
  if (!x) return false;
  x = unwrap(x);
  if (isClockCall(x, st)) return true;
  if (ts.isCallExpression(x)) {
    const callee = x.expression.getText(st.sf);
    if (/^(Math\.(max|min|round|ceil|floor|abs)|Number)$/.test(callee))
      return x.arguments.some((a) =>
        isTimeExpr(ts.isSpreadElement(a) ? a.expression : a, st),
      );
    return false;
  }
  if (ts.isIdentifier(x)) return st.tainted.has(x.text) || isTimeName(x.text);
  if (ts.isPropertyAccessExpression(x)) return isTimeName(x.name.text);
  if (ts.isBinaryExpression(x)) {
    const k = x.operatorToken.kind;
    if (ARITH.has(k) || COMPARE.has(k))
      return isTimeExpr(x.left, st) || isTimeExpr(x.right, st);
    return false;
  }
  if (ts.isConditionalExpression(x))
    return isTimeExpr(x.whenTrue, st) || isTimeExpr(x.whenFalse, st);
  return false;
}

/** A clock call (direct or alias) in the expression itself, no taint. */
function readsClock(x: ts.Expression, st: FileState): boolean {
  let found = false;
  const walk = (n: ts.Node): void => {
    if (found || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return;
    if (ts.isExpression(n) && isClockCall(n, st)) found = true;
    else ts.forEachChild(n, walk);
  };
  walk(x);
  return found;
}

function isObserved(x: ts.Node, st: FileState): boolean {
  let found = false;
  const walk = (n: ts.Node): void => {
    if (found) return;
    if (ts.isAwaitExpression(n)) found = true;
    else if (ts.isIdentifier(n) && st.observed.has(n.text)) found = true;
    else if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return;
    else ts.forEachChild(n, walk);
  };
  walk(x);
  return found;
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  const out: string[] = [];
  for (const el of name.elements)
    if (!ts.isOmittedExpression(el)) out.push(...bindingNames(el.name));
  return out;
}

function numericValue(
  x: ts.Expression | undefined,
  consts: Map<string, number>,
): number | undefined {
  if (!x) return undefined;
  x = unwrap(x);
  if (ts.isNumericLiteral(x)) return Number(x.text.replace(/_/g, ""));
  if (ts.isIdentifier(x)) return consts.get(x.text);
  if (
    ts.isPrefixUnaryExpression(x) &&
    x.operator === ts.SyntaxKind.MinusToken
  ) {
    const v = numericValue(x.operand, consts);
    return v === undefined ? undefined : -v;
  }
  if (ts.isBinaryExpression(x)) {
    const a = numericValue(x.left, consts);
    const b = numericValue(x.right, consts);
    if (a === undefined || b === undefined) return undefined;
    switch (x.operatorToken.kind) {
      case ts.SyntaxKind.AsteriskToken:
        return a * b;
      case ts.SyntaxKind.PlusToken:
        return a + b;
      case ts.SyntaxKind.MinusToken:
        return a - b;
      case ts.SyntaxKind.SlashToken:
        return a / b;
    }
  }
  return undefined;
}

function prepare(sf: ts.SourceFile): FileState {
  const st: FileState = {
    sf,
    aliases: new Set(),
    tainted: new Set(),
    observed: new Set(),
    consts: new Map(),
    boolHelpers: new Map(),
  };
  // Aliases and numeric consts first: taint reads them.
  const first = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer
    ) {
      const init = unwrap(n.initializer);
      const text = collapse(init.getText(sf));
      if (
        isClockReference(text) ||
        /^(globalThis\.)?(Date\.now|performance\.now)\.bind\(\s*(globalThis\.)?(Date|performance)\s*\)$/.test(
          text,
        ) ||
        ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
          init.parameters.length === 0 &&
          /^\(\s*\)\s*=>\s*(globalThis\.)?(performance\.now|Date\.now)\(\)$/.test(
            text,
          ))
      )
        st.aliases.add(n.name.text);
      const v = numericValue(init, st.consts);
      if (
        v !== undefined &&
        ts.isVariableDeclarationList(n.parent) &&
        n.parent.flags & ts.NodeFlags.Const
      )
        st.consts.set(n.name.text, v);
    }
    ts.forEachChild(n, first);
  };
  first(sf);
  // Fixed point over a few passes: taint and observation flow through
  // assignments; never through object properties (design R1).
  for (let pass = 0; pass < 3; pass++) {
    const walk = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && n.initializer) {
        if (isObserved(n.initializer, st))
          for (const name of bindingNames(n.name)) st.observed.add(name);
        if (
          ts.isIdentifier(n.name) &&
          !CONFIG_NAME.test(n.name.text) &&
          (hasClockOrTainted(n.initializer, st) ||
            isTimeExpr(n.initializer, st))
        )
          st.tainted.add(n.name.text);
      }
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(n.left) &&
        !CONFIG_NAME.test(n.left.text) &&
        (hasClockOrTainted(n.right, st) || isTimeExpr(n.right, st))
      )
        st.tainted.add(n.left.text);
      ts.forEachChild(n, walk);
    };
    walk(sf);
  }
  // Same-file boolean helpers whose returned comparison is on time values.
  const helpers = (n: ts.Node): void => {
    let name: string | undefined;
    let body: ts.ConciseBody | undefined;
    if (ts.isFunctionDeclaration(n) && n.name && n.body) {
      name = n.name.text;
      body = n.body;
    } else if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) ||
        ts.isFunctionExpression(n.initializer))
    ) {
      name = n.name.text;
      body = n.initializer.body;
    }
    if (name && body) {
      const returned: ts.Expression[] = [];
      if (!ts.isBlock(body)) returned.push(body);
      else
        body.statements.forEach((s) => {
          if (ts.isReturnStatement(s) && s.expression)
            returned.push(s.expression);
        });
      for (const r of returned) {
        const e = unwrap(r);
        if (
          ts.isBinaryExpression(e) &&
          COMPARE.has(e.operatorToken.kind) &&
          (isTimeExpr(e.left, st) || isTimeExpr(e.right, st))
        )
          st.boolHelpers.set(name, e);
      }
    }
    ts.forEachChild(n, helpers);
  };
  helpers(sf);
  return st;
}

/**
 * Whether the VALUE of an expression is a clock reading: a clock call, a
 * tainted name, or arithmetic / Math.* / a conditional over those. A clock
 * read passed as an argument to some other call (`heartbeat(Date.now())`)
 * does not make the call's result a time — that widened the set with
 * every value that merely mentioned the clock.
 */
function hasClockOrTainted(x: ts.Expression, st: FileState): boolean {
  const e = unwrap(x);
  if (isClockCall(e, st)) return true;
  if (ts.isIdentifier(e)) return st.tainted.has(e.text);
  if (ts.isBinaryExpression(e) && ARITH.has(e.operatorToken.kind))
    return hasClockOrTainted(e.left, st) || hasClockOrTainted(e.right, st);
  if (
    ts.isCallExpression(e) &&
    /^(Math\.(max|min|round|ceil|floor|abs|trunc)|Number)$/.test(
      e.expression.getText(st.sf),
    )
  )
    return e.arguments.some(
      (a) => !ts.isSpreadElement(a) && hasClockOrTainted(a, st),
    );
  if (ts.isConditionalExpression(e))
    return (
      hasClockOrTainted(e.whenTrue, st) || hasClockOrTainted(e.whenFalse, st)
    );
  return false;
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function spannedLines(sf: ts.SourceFile, node: ts.Node): string[] {
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
  const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
  const lines = sf.text.split(/\r?\n/);
  return lines
    .slice(start, end + 1)
    .map(collapse)
    .filter(Boolean);
}

/** `expect(...)` or `expect.soft(...)`: the call node, else undefined. */
function expectCall(
  x: ts.Expression,
  sf: ts.SourceFile,
): ts.CallExpression | undefined {
  x = unwrap(x);
  if (ts.isPropertyAccessExpression(x) && x.name.text === "not")
    x = unwrap(x.expression);
  if (!ts.isCallExpression(x)) return undefined;
  const callee = x.expression.getText(sf).replace(/\s+/g, "");
  return /^expect(\.soft)?$/.test(callee) ? x : undefined;
}

const TEST_CALLEE =
  /^(test|it)(\.(only|skip|fails|concurrent|sequential|todo))*(\.(skipIf|runIf)\(.*\))?$/s;

function enclosingTest(
  node: ts.Node,
  sf: ts.SourceFile,
): { name?: string; body: ts.Node } | undefined {
  let fn: ts.Node | undefined;
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (
      (ts.isArrowFunction(p) ||
        ts.isFunctionExpression(p) ||
        ts.isFunctionDeclaration(p)) &&
      !fn
    )
      fn = p;
    if (
      ts.isCallExpression(p) &&
      TEST_CALLEE.test(p.expression.getText(sf).replace(/\s+/g, "")) &&
      p.arguments.some(
        (a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a),
      )
    ) {
      const title = p.arguments[0];
      const body = p.arguments.find(
        (a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a),
      )!;
      return {
        ...(title &&
        (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title))
          ? { name: title.text }
          : title
            ? { name: collapse(title.getText(sf)) }
            : {}),
        body,
      };
    }
  }
  return fn ? { body: fn } : undefined;
}

export function bodyHashOf(text: string): string {
  return createHash("sha256").update(collapse(text)).digest("hex").slice(0, 16);
}

const BOUND_ARG: Record<RoutedHelper, number> = {
  expectFasterThan: 2,
  expectRatioBelow: 3,
  expectAtLeast: 2,
  measureTime: 2,
  timedWait: 1,
};
const KIND: Record<RoutedHelper, RoutedCall["kind"]> = {
  expectFasterThan: "ceiling",
  expectRatioBelow: "ratio",
  expectAtLeast: "floor",
  measureTime: "ceiling",
  timedWait: "ceiling",
};

function routedCall(
  n: ts.CallExpression,
  st: FileState,
  file: string,
): RoutedCall | undefined {
  if (!ts.isIdentifier(n.expression)) return undefined;
  const helper = n.expression.text as RoutedHelper;
  if (!ROUTED_HELPERS.includes(helper)) return undefined;
  const sf = st.sf;
  const idArg = n.arguments[0];
  const id =
    idArg &&
    (ts.isStringLiteral(idArg) || ts.isNoSubstitutionTemplateLiteral(idArg))
      ? idArg.text
      : null;
  const boundArg = n.arguments[BOUND_ARG[helper]];
  const optsArg = n.arguments.find(
    (a, i) => i > BOUND_ARG[helper] && ts.isObjectLiteralExpression(a),
  ) as ts.ObjectLiteralExpression | undefined;
  const prop = (name: string) => {
    const p = optsArg?.properties.find(
      (q) => ts.isPropertyAssignment(q) && q.name.getText(sf) === name,
    ) as ts.PropertyAssignment | undefined;
    return p &&
      (ts.isStringLiteral(p.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(p.initializer))
      ? p.initializer.text
      : undefined;
  };
  const mode =
    helper === "measureTime" || prop("mode") === "measure"
      ? "measure"
      : "assert";
  const witness = prop("witness");
  const t = enclosingTest(n, sf);
  let witnessAsserted = false;
  if (witness && t) {
    const walk = (m: ts.Node): void => {
      if (witnessAsserted) return;
      if (ts.isCallExpression(m)) {
        const e = expectCall(m, sf);
        if (
          e &&
          m === e &&
          e.arguments[0] &&
          new RegExp(
            `\\b${witness.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          ).test(e.arguments[0].getText(sf))
        )
          witnessAsserted = true;
      }
      ts.forEachChild(m, walk);
    };
    walk(t.body);
  }
  const bound = numericValue(boundArg, st.consts);
  return {
    file,
    line: lineOf(sf, n),
    helper,
    id,
    mode,
    kind: KIND[helper],
    ...(witness === undefined ? {} : { witness }),
    witnessAsserted,
    ...(bound === undefined ? {} : { bound }),
    boundText: boundArg ? collapse(boundArg.getText(sf)) : "",
    ...(t?.name === undefined ? {} : { test: t.name }),
    bodyHash: bodyHashOf(t ? t.body.getText(sf) : n.getText(sf)),
    snippet: collapse(n.getText(sf)),
  };
}

function sleepMs(
  arg: ts.Expression | undefined,
  st: FileState,
): number | undefined {
  const v = numericValue(arg, st.consts);
  return v !== undefined && v >= 2 ? v : undefined;
}

/** `new Promise(r => setTimeout(r, N))`: the ms, else undefined. */
function promiseSleep(n: ts.NewExpression, st: FileState): number | undefined {
  if (n.expression.getText(st.sf) !== "Promise") return undefined;
  const cb = n.arguments?.[0];
  if (!cb || !(ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)))
    return undefined;
  const param = cb.parameters[0];
  if (!param || !ts.isIdentifier(param.name)) return undefined;
  let call: ts.Expression | undefined;
  if (!ts.isBlock(cb.body)) call = cb.body;
  else if (
    cb.body.statements.length === 1 &&
    ts.isExpressionStatement(cb.body.statements[0]!)
  )
    call = cb.body.statements[0]!.expression;
  if (!call) return undefined;
  call = unwrap(call);
  if (!ts.isCallExpression(call)) return undefined;
  if (!/(^|\.)(\w*[sS]etTimeout)$/.test(call.expression.getText(st.sf)))
    return undefined;
  const target = call.arguments[0];
  if (!target || !ts.isIdentifier(target) || target.text !== param.name.text)
    return undefined;
  return sleepMs(call.arguments[1], st);
}

/**
 * Inside the definition of a routed helper itself (`function
 * expectFasterThan(...)`): that assertion IS the routed comparison, held by
 * the routed-call rules at each call site, not a raw one.
 */
function insideHelperDefinition(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent)
    if (
      ts.isFunctionDeclaration(p) &&
      p.name &&
      (ROUTED_HELPERS as readonly string[]).includes(p.name.text)
    )
      return true;
  return false;
}

/** Every member of all three families in one file's text. */
export function scanSource(text: string, fileName: string): ScanResult {
  const sf = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    /\.[cm]?[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const diagnostics =
    (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] })
      .parseDiagnostics ?? [];
  const parseErrors = diagnostics.map(
    (d) =>
      `${fileName}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`,
  );
  const st = prepare(sf);
  const comparisons: WallClockMember[] = [];
  const routed: RoutedCall[] = [];
  const sleeps: SleepMember[] = [];
  const fakeTimers = /\bvi\s*\.\s*useFakeTimers\s*\(/.test(text);
  const member = (
    node: ts.Node,
    rule: WallClockRule,
    direction: "ceiling" | "floor" = "ceiling",
  ) => {
    if (insideHelperDefinition(node)) return;
    comparisons.push({
      file: fileName,
      line: lineOf(sf, node),
      rule,
      direction,
      snippet: collapse(node.getText(sf)),
      lines: spannedLines(sf, node),
    });
  };

  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const r = routedCall(n, st, fileName);
      if (r) routed.push(r);
      // R1/R2/R3 via R6's matchers.
      if (
        ts.isPropertyAccessExpression(n.expression) &&
        ORDER_MATCHERS.has(n.expression.name.text)
      ) {
        const e = expectCall(n.expression.expression, sf);
        const subject = e?.arguments[0];
        if (e && subject) {
          const s = unwrap(subject);
          // A floor (at least / not under) cannot fail on a SLOW runner.
          const negated =
            ts.isPropertyAccessExpression(n.expression.expression) &&
            n.expression.expression.name.text === "not";
          const greater = n.expression.name.text.startsWith("toBeGreater");
          const direction = greater !== negated ? "floor" : "ceiling";
          if (hasClockOrTainted(s, st)) member(n, "R1", direction);
          else if (isTimeExpr(s, st)) member(n, "R2", direction);
          else if (
            n.arguments[0] &&
            BOUND_NAME.test(n.arguments[0].getText(sf)) &&
            !CONFIG_NAME.test(
              n.arguments[0].getText(sf).replace(/^.*\./, ""),
            ) &&
            isObserved(s, st)
          )
            member(n, "R3", direction);
        }
      }
      // R4: expect(a < b).toBe(...) / expect(helper(...)).toBe(...)
      if (
        ts.isPropertyAccessExpression(n.expression) &&
        /^(toBe|toEqual|toStrictEqual)$/.test(n.expression.name.text)
      ) {
        const e = expectCall(n.expression.expression, sf);
        const subject = e?.arguments[0] && unwrap(e.arguments[0]);
        if (subject) {
          if (
            ts.isBinaryExpression(subject) &&
            COMPARE.has(subject.operatorToken.kind) &&
            (isTimeExpr(subject.left, st) || isTimeExpr(subject.right, st))
          )
            member(n, "R4");
          else if (
            ts.isCallExpression(subject) &&
            ts.isIdentifier(subject.expression) &&
            st.boolHelpers.has(subject.expression.text)
          )
            member(n, "R4");
        }
      }
      // Sleeps: page.waitForTimeout(N)
      if (
        !fakeTimers &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "waitForTimeout"
      ) {
        const ms = sleepMs(n.arguments[0], st);
        if (ms !== undefined)
          sleeps.push({
            file: fileName,
            line: lineOf(sf, n),
            ms,
            snippet: collapse(n.getText(sf)),
          });
      }
    }
    if (!fakeTimers && ts.isNewExpression(n)) {
      const ms = promiseSleep(n, st);
      if (ms !== undefined)
        sleeps.push({
          file: fileName,
          line: lineOf(sf, n),
          ms,
          snippet: collapse(n.getText(sf)),
        });
    }
    // R5: predicates
    if (
      (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
      ts.isCallExpression(n.parent) &&
      ts.isPropertyAccessExpression(n.parent.expression) &&
      /^(filter|some|every|find|findIndex)$/.test(
        n.parent.expression.name.text,
      ) &&
      !ts.isBlock(n.body)
    ) {
      const b = unwrap(n.body);
      if (
        ts.isBinaryExpression(b) &&
        COMPARE.has(b.operatorToken.kind) &&
        (isTimeExpr(b.left, st) || isTimeExpr(b.right, st)) &&
        /(MS|Ms)\b/.test(b.getText(sf))
      )
        member(n, "R5");
    }
    // R7: deadline loops
    const cond =
      ts.isWhileStatement(n) || ts.isDoStatement(n)
        ? n.expression
        : ts.isForStatement(n)
          ? n.condition
          : undefined;
    if (cond) {
      const comparisonsIn: ts.BinaryExpression[] = [];
      const collect = (m: ts.Node): void => {
        if (ts.isBinaryExpression(m) && COMPARE.has(m.operatorToken.kind))
          comparisonsIn.push(m);
        if (!ts.isArrowFunction(m) && !ts.isFunctionExpression(m))
          ts.forEachChild(m, collect);
      };
      collect(cond);
      // A clock READ in the condition itself (direct or alias): taint is
      // file-wide by name, and loop counters (`i`, `r`) share names with
      // tainted variables elsewhere in a file.
      if (
        comparisonsIn.some(
          (c) => readsClock(c.left, st) || readsClock(c.right, st),
        )
      )
        member(cond, "R7");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { comparisons, routed, sleeps, parseErrors };
}

/** The comparison family alone: the function the design names. */
export function findWallClockComparisons(
  text: string,
  fileName: string,
): WallClockMember[] {
  return scanSource(text, fileName).comparisons;
}

/** Stable keys: file + collapsed snippet + occurrence index, never a line number. */
export function keyed<T extends { file: string; snippet: string }>(
  members: readonly T[],
): (T & { n: number })[] {
  const seen = new Map<string, number>();
  return members.map((m) => {
    const k = `${m.file}\u0000${m.snippet}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return { ...m, n };
  });
}

/**
 * Every ordering comparison on a wall-clock value anywhere in a file, not
 * only inside `expect`: how a CI script (which has no expect) bounds a time.
 * Used for the workflow-script corpus (critic P10).
 */
export function findTimeComparisonsAnywhere(
  text: string,
  fileName: string,
): { line: number; snippet: string }[] {
  const sf = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    /\.[cm]?[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const st = prepare(sf);
  const out: { line: number; snippet: string }[] = [];
  const visit = (n: ts.Node): void => {
    if (
      ts.isBinaryExpression(n) &&
      COMPARE.has(n.operatorToken.kind) &&
      (isTimeExpr(n.left, st) || isTimeExpr(n.right, st))
    )
      out.push({ line: lineOf(sf, n), snippet: collapse(n.getText(sf)) });
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
