import { createHash } from "node:crypto";
import ts from "typescript";
import { CONFIG_NAME, TIME_NAME, isTimeName } from "./time-bound-core";

export { isTimeName };

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
 *  R1  a clock read reaches the subject (or the bound) through a variable:
 *      `performance.now()`, `Date.now()`, `process.hrtime(.bigint)()`,
 *      `new Date()` with no arguments (`+new Date() - +s`, `.getTime()`),
 *      an ALIAS of one (`const realDateNow = Date.now.bind(Date)`, which
 *      every earlier finder missed in `poll-leak-guard.ts`; `const { now } =
 *      Date`), a function that returns one (a stopwatch `lap()`), an
 *      `hrtime` tuple destructured, an array a clock reading is pushed
 *      into, or a `page.evaluate` whose callback returns a time;
 *  R2  the subject is time-named (`ms`, `*Ms`, `elapsed*`, `took*`,
 *      `*Duration`, `duration*`, `latency*`, `perQuery*`), config names out;
 *  R3  the bound is time-named and the subject was observed (an `await`, or
 *      derived from one) — merge-tool's p95 against a frame budget — unless
 *      both sides are the same function of configuration
 *      (`pollWaitMs(a) > pollWaitMs(b)`);
 *  R4  a boolean comparison on time values handed to an assertion:
 *      `expect(a < b).toBe(..)`, `assert(a < b)`, `assert.ok`, `toSatisfy`,
 *      or a same-file boolean helper whose returned comparison is on time
 *      values (`withinBound`);
 *  R5  a filter/some/every/find predicate comparing a time-named value with
 *      a time-named bound, or comparing an element of a clock-tainted array;
 *  R6  the matchers: `toBe(Less|Greater)Than(OrEqual)`, also under `.not`,
 *      on `expect` and `expect.soft`, callee text whitespace-normalised;
 *  R7  a deadline loop: a loop whose condition compares a clock read — the
 *      shape of `poll-leak-guard.ts`'s 2 s grace, run in every file's
 *      afterAll (hooks are in scope: the whole file is walked);
 *  R8  chai's order assertions on a time value: `.below/.lessThan/.lt/
 *      .most/.above/.greaterThan/.gt/.least/.within` on an `expect` chain,
 *      and `assert.isBelow/isAbove/isAtMost/isAtLeast`;
 *  R9  `if (<comparison on a clock read or a time value>) throw ...`.
 *
 * DIRECTION is the sign of the clock term, not the matcher's name: a
 * ceiling is a comparison a slower runner pushes towards failing, whichever
 * side holds the time (`expect(500 - el).toBeGreaterThan(0)` is a ceiling).
 *
 * KEYS (`snippet`) are the node's token stream ({@link keyText}), so a
 * Prettier rewrap of an unchanged expression keeps its debt key.
 */

export type WallClockRule =
  "R1" | "R2" | "R3" | "R4" | "R5" | "R7" | "R8" | "R9";

export const WALL_CLOCK_RULES: readonly WallClockRule[] = [
  "R1",
  "R2",
  "R3",
  "R4",
  "R5",
  "R7",
  "R8",
  "R9",
];

export interface WallClockMember {
  file: string;
  line: number;
  rule: WallClockRule;
  /**
   * "floor" when a slower runner only makes the comparison easier to pass
   * (the clock term pushes away from failing); it is reported but never in
   * debt. Everything else — including every comparison whose sign is
   * ambiguous — is a ceiling.
   */
  direction: "ceiling" | "floor";
  /** The comparison's token stream ({@link keyText}): the key, with `file` and an occurrence index. */
  snippet: string;
  /** The raw text, whitespace collapsed (seed matching). */
  raw: string;
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
  /**
   * Whether `witness` is a speed-independent subject asserted in the same
   * test: not a time by name or by taint, and the subject of an equality
   * or size matcher (`toBe`, `toEqual`, `toStrictEqual`, `toHaveLength`,
   * `toMatchObject`, `toHaveBeenCalledTimes`), not negated.
   */
  witnessAsserted: boolean;
  /** Why the witness does not count, when one was named. */
  witnessProblem?: string;
  /**
   * The options argument is absent or an object literal whose `mode` and
   * `witness` are string literals (no spread, no variable): what the guard
   * reads statically is what the runtime runs.
   */
  optionsLiteral: boolean;
  /** The measured value is a literal (or a same-file numeric const): it measures nothing. */
  measuredLiteral: boolean;
  /** The bound, when it is a literal or a same-file numeric const. */
  bound?: number;
  boundText: string;
  /** The enclosing test's name, when the call is inside one. */
  test?: string;
  /** sha256 (16 hex) of the enclosing test's (or function's) token stream. */
  bodyHash: string;
  snippet: string;
}

export interface SleepMember {
  file: string;
  line: number;
  ms: number;
  snippet: string;
}

/** A use of a time-bound export the routed scan cannot read as a call. */
export interface TimeBoundRef {
  file: string;
  line: number;
  text: string;
}

export interface ScanResult {
  comparisons: WallClockMember[];
  routed: RoutedCall[];
  sleeps: SleepMember[];
  /** Any use of the time-bound helpers other than a call the routed scan reads. */
  timeBoundRefs: TimeBoundRef[];
  parseErrors: string[];
}

export const ROUTED_HELPERS: readonly RoutedHelper[] = [
  "expectFasterThan",
  "expectRatioBelow",
  "expectAtLeast",
  "measureTime",
  "timedWait",
];
/** Value exports of the helper modules that are not timing checks. */
const OTHER_HELPER_EXPORTS = new Set(["observeFor"]);

/** `./time-bound`, `../../tests/time-bound`, `@/tests/time-bound`, `../e2e/time-bound.ts`. */
export const TIME_BOUND_MODULE = /(^|\/)time-bound(\.[cm]?[jt]s)?$/;

const ORDER_MATCHERS = new Set([
  "toBeLessThan",
  "toBeLessThanOrEqual",
  "toBeGreaterThan",
  "toBeGreaterThanOrEqual",
]);
/** chai's order assertions; `true` = less-like. */
const CHAI_ORDER = new Map<string, boolean | "within">([
  ["below", true],
  ["lessThan", true],
  ["lt", true],
  ["most", true],
  ["lte", true],
  ["above", false],
  ["greaterThan", false],
  ["gt", false],
  ["least", false],
  ["gte", false],
  ["within", "within"],
]);
const ASSERT_ORDER = new Map<string, boolean>([
  ["isBelow", true],
  ["isAtMost", true],
  ["isAbove", false],
  ["isAtLeast", false],
]);
/** Matchers that pin a witness to a value or a size. */
const WITNESS_MATCHERS = new Set([
  "toBe",
  "toEqual",
  "toStrictEqual",
  "toHaveLength",
  "toMatchObject",
  "toHaveBeenCalledTimes",
]);

const BOUND_NAME = /(Ms|_MS)\b/;
const COMPARE = new Set([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
]);
const LESS = new Set([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
]);
const ARITH = new Set([
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);
const MATH_PASS =
  /^(Math\.(max|min|round|ceil|floor|abs|trunc)|Number|BigInt)$/;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

// ── Keys ───────────────────────────────────────────────────────────────────

const NO_SPACE_AFTER = new Set(["(", "[", ".", "?.", "!"]);
const NO_SPACE_BEFORE = new Set([")", "]", ".", "?.", ",", ";"]);
const CLOSERS = new Set([")", "]", "}"]);

function leaves(node: ts.Node, sf: ts.SourceFile, out: ts.Node[]): void {
  if (
    node.kind >= ts.SyntaxKind.FirstJSDocNode &&
    node.kind <= ts.SyntaxKind.LastJSDocNode
  )
    return;
  const kids = node.getChildren(sf);
  if (kids.length === 0) {
    if (node.kind !== ts.SyntaxKind.EndOfFileToken && node.getWidth(sf) > 0)
      out.push(node);
    return;
  }
  for (const k of kids) leaves(k, sf, out);
}

/**
 * A node's token stream as one line: comments dropped, whitespace inside a
 * token collapsed, a trailing comma before a closing bracket dropped, and a
 * single space between two tokens only where the source had whitespace and
 * no wrap could have put it (never after `(`/`[`/`.`, never before
 * `)`/`]`/`.`/`,`). So `expect(\n  Date.now() - t0,\n).toBeLessThan(5)` and
 * `expect(Date.now() - t0).toBeLessThan(5)` are one key — the reformat that
 * forced `--accept-new` on f8d48720 — while a real edit still changes it.
 */
export function keyTextOf(node: ts.Node, sf: ts.SourceFile): string {
  const ls: ts.Node[] = [];
  leaves(node, sf, ls);
  let out = "";
  let prevEnd = -1;
  let prev = "";
  for (let i = 0; i < ls.length; i++) {
    const leaf = ls[i]!;
    const text = collapse(leaf.getText(sf));
    if (text === ",") {
      const next = ls[i + 1] ? leaf && collapse(ls[i + 1]!.getText(sf)) : "";
      if (CLOSERS.has(next)) {
        prevEnd = leaf.getEnd();
        continue;
      }
    }
    const start = leaf.getStart(sf);
    const gap = prevEnd >= 0 && start > prevEnd;
    if (out && gap && !NO_SPACE_AFTER.has(prev) && !NO_SPACE_BEFORE.has(text))
      out += " ";
    out += text;
    prevEnd = leaf.getEnd();
    prev = text;
  }
  return out;
}

const scriptKind = (fileName: string) =>
  /\.[cm]?[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

/** {@link keyTextOf} a whole text (a snippet's key is a substring of its file's). */
export function keyText(text: string, fileName = "k.ts"): string {
  const sf = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  return keyTextOf(sf, sf);
}

export function bodyHashOf(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

// ── Analysis state ─────────────────────────────────────────────────────────

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

const isNewDateNow = (x: ts.Expression, sf: ts.SourceFile) =>
  ts.isNewExpression(x) &&
  x.expression.getText(sf) === "Date" &&
  (x.arguments?.length ?? 0) === 0;

/** A file's analysis state: tainted names, clock aliases, observed names. */
interface FileState {
  sf: ts.SourceFile;
  aliases: Set<string>;
  tainted: Set<string>;
  observed: Set<string>;
  consts: Map<string, number>;
  boolHelpers: Map<string, ts.Expression>;
  /** Same-file sleep helpers: name → index of the ms parameter. */
  sleepHelpers: Map<string, number>;
  /** Local names bound to `setTimeout` from `timers/promises`. */
  promiseTimers: Set<string>;
}

function isClockCall(x: ts.Expression, st: FileState): boolean {
  x = unwrap(x);
  if (isNewDateNow(x, st.sf)) return true;
  if (
    ts.isPrefixUnaryExpression(x) &&
    (x.operator === ts.SyntaxKind.PlusToken ||
      x.operator === ts.SyntaxKind.MinusToken)
  )
    return isClockCall(x.operand, st);
  if (!ts.isCallExpression(x)) return false;
  const callee = collapse(x.expression.getText(st.sf)).replace(/\s+/g, "");
  if (isClockReference(callee)) return true;
  if (ts.isIdentifier(x.expression) && st.aliases.has(x.expression.text))
    return true;
  // new Date().getTime() / .valueOf(), and the same on a tainted Date
  if (
    ts.isPropertyAccessExpression(x.expression) &&
    /^(getTime|valueOf)$/.test(x.expression.name.text) &&
    x.arguments.length === 0
  ) {
    const target = unwrap(x.expression.expression);
    if (isNewDateNow(target, st.sf)) return true;
    if (ts.isIdentifier(target) && st.tainted.has(target.text)) return true;
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
    if (MATH_PASS.test(callee))
      return x.arguments.some((a) =>
        isTimeExpr(ts.isSpreadElement(a) ? a.expression : a, st),
      );
    return false;
  }
  if (ts.isPrefixUnaryExpression(x)) return isTimeExpr(x.operand, st);
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
  if (ts.isPrefixUnaryExpression(e)) return hasClockOrTainted(e.operand, st);
  if (ts.isBinaryExpression(e) && ARITH.has(e.operatorToken.kind))
    return hasClockOrTainted(e.left, st) || hasClockOrTainted(e.right, st);
  if (ts.isCallExpression(e) && MATH_PASS.test(e.expression.getText(st.sf)))
    return e.arguments.some((a) =>
      hasClockOrTainted(ts.isSpreadElement(a) ? a.expression : a, st),
    );
  if (ts.isConditionalExpression(e))
    return (
      hasClockOrTainted(e.whenTrue, st) || hasClockOrTainted(e.whenFalse, st)
    );
  return false;
}

type Sign = 0 | 1 | -1 | 2;
const neg = (s: Sign): Sign => (s === 1 ? -1 : s === -1 ? 1 : s);
const combine = (a: Sign, b: Sign): Sign =>
  a === 0 ? b : b === 0 ? a : a === b ? a : 2;

/**
 * How a time moves an expression: +1 a larger time makes it larger, -1
 * smaller, 0 no time in it, 2 both or unknown (treated as a ceiling).
 */
function timeSign(
  x: ts.Expression | undefined,
  st: FileState,
  names = true,
): Sign {
  if (!x) return 0;
  x = unwrap(x);
  if (isClockCall(x, st)) {
    if (
      ts.isPrefixUnaryExpression(x) &&
      x.operator === ts.SyntaxKind.MinusToken
    )
      return -1;
    return 1;
  }
  if (ts.isPrefixUnaryExpression(x)) {
    const s = timeSign(x.operand, st, names);
    return x.operator === ts.SyntaxKind.MinusToken ? neg(s) : s;
  }
  if (ts.isIdentifier(x))
    return st.tainted.has(x.text) || (names && isTimeName(x.text)) ? 1 : 0;
  if (ts.isPropertyAccessExpression(x))
    return names && isTimeName(x.name.text) ? 1 : 0;
  if (ts.isCallExpression(x)) {
    if (MATH_PASS.test(x.expression.getText(st.sf)))
      return x.arguments.reduce<Sign>(
        (acc, a) =>
          combine(
            acc,
            timeSign(ts.isSpreadElement(a) ? a.expression : a, st, names),
          ),
        0,
      );
    return 0;
  }
  if (ts.isBinaryExpression(x)) {
    const l = timeSign(x.left, st, names);
    const r = timeSign(x.right, st, names);
    switch (x.operatorToken.kind) {
      case ts.SyntaxKind.PlusToken:
      case ts.SyntaxKind.AsteriskToken:
      case ts.SyntaxKind.QuestionQuestionToken:
        return combine(l, r);
      case ts.SyntaxKind.MinusToken:
        return minusSign(x.left, x.right, l, r, st);
      case ts.SyntaxKind.SlashToken:
        return combine(l, neg(r));
      default:
        return l === 0 && r === 0 ? 0 : 2;
    }
  }
  if (ts.isConditionalExpression(x))
    return combine(
      timeSign(x.whenTrue, st, names),
      timeSign(x.whenFalse, st, names),
    );
  return 0;
}

/** A literal, a same-file numeric const, or a config-named value: it does not move with time. */
function constantLike(x: ts.Expression, st: FileState): boolean {
  const e = unwrap(x);
  if (numericValue(e, st.consts) !== undefined) return true;
  const name = ts.isIdentifier(e)
    ? e.text
    : ts.isPropertyAccessExpression(e)
      ? e.name.text
      : undefined;
  return name !== undefined && CONFIG_NAME.test(name) && !st.tainted.has(name);
}

/**
 * The sign of `left - right` when the right side holds a time. A constant
 * minus a time is what is LEFT of a budget (`500 - el`, `deadline - now`):
 * it falls as time grows. A fresh clock read on the left is an elapsed time
 * (`Date.now() - started`): it grows. A fresh clock read on the right is a
 * remaining time (`deadlineAt - Date.now()`). Otherwise two times, or an
 * unseen value minus a time (`frames[i].t - pickedAt`), are read as `end -
 * start`, by convention: they grow.
 */
function minusSign(
  left: ts.Expression,
  right: ts.Expression,
  l: Sign,
  r: Sign,
  st: FileState,
): Sign {
  if (r === 0) return l;
  if (constantLike(left, st)) return neg(r);
  if (isClockCall(left, st)) return 1;
  if (isClockCall(right, st)) return -1;
  return l === 2 || r === 2 ? 2 : 1;
}

/**
 * The direction of `left < right` (less) or `left > right`: a ceiling when a
 * larger time pushes the comparison towards false. When neither side moves
 * with time by anything the detector can see (an R3 subject observed from
 * an await against a time-named bound), the matcher's own direction stands.
 * On the BOUND side a time-NAMED value is a budget (`BUDGET.frameP95Ms`),
 * not a moving time: only a clock reading there carries a sign.
 */
function directionOf(
  less: boolean,
  left: ts.Expression | undefined,
  right: ts.Expression | undefined,
  st: FileState,
): "ceiling" | "floor" {
  const l = timeSign(left, st);
  const r = timeSign(right, st, false);
  if (l === 0 && r === 0) return less ? "ceiling" : "floor";
  const pressure = less
    ? l === 1 || l === 2 || r === -1 || r === 2
    : l === -1 || l === 2 || r === 1 || r === 2;
  return pressure ? "ceiling" : "floor";
}

/** A clock call (direct or alias) in the expression itself, no taint. */
function readsClock(x: ts.Node, st: FileState): boolean {
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

/** The expression(s) a function returns: its concise body, or each `return`. */
function returnedExprs(
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
): ts.Expression[] {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const out: ts.Expression[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isFunctionLike(n)) return;
    if (ts.isReturnStatement(n) && n.expression) out.push(n.expression);
    ts.forEachChild(n, walk);
  };
  fn.body.statements.forEach(walk);
  return out;
}

const isFn = (
  n: ts.Node | undefined,
): n is ts.ArrowFunction | ts.FunctionExpression =>
  !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));

/** `new Promise(r => setTimeout(r, X))` (or `() => r()`): X, else undefined. */
function promiseSleepDelay(
  n: ts.NewExpression,
  sf: ts.SourceFile,
): ts.Expression | undefined {
  if (n.expression.getText(sf) !== "Promise") return undefined;
  const cb = n.arguments?.[0];
  if (!isFn(cb)) return undefined;
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
  if (!/(^|\.)(\w*[sS]etTimeout)$/.test(call.expression.getText(sf)))
    return undefined;
  const target = call.arguments[0];
  const resolves =
    !!target &&
    ((ts.isIdentifier(target) && target.text === param.name.text) ||
      (isFn(target) &&
        (() => {
          const body = ts.isBlock(target.body)
            ? target.body.statements.length === 1 &&
              ts.isExpressionStatement(target.body.statements[0]!)
              ? target.body.statements[0]!.expression
              : undefined
            : target.body;
          const b = body && unwrap(body);
          return (
            !!b &&
            ts.isCallExpression(b) &&
            ts.isIdentifier(b.expression) &&
            b.expression.text === param.name.text
          );
        })()));
  return resolves ? call.arguments[1] : undefined;
}

function prepare(sf: ts.SourceFile): FileState {
  const st: FileState = {
    sf,
    aliases: new Set(),
    tainted: new Set(),
    observed: new Set(),
    consts: new Map(),
    boolHelpers: new Map(),
    sleepHelpers: new Map(),
    promiseTimers: new Set(),
  };
  // Aliases, numeric consts and sleep helpers first: taint reads them. Two
  // passes, so a stopwatch built on an alias is an alias too.
  for (let pass = 0; pass < 2; pass++) {
    const first = (n: ts.Node): void => {
      if (
        ts.isImportDeclaration(n) &&
        ts.isStringLiteral(n.moduleSpecifier) &&
        /^(node:)?timers\/promises$/.test(n.moduleSpecifier.text)
      ) {
        const named = n.importClause?.namedBindings;
        if (named && ts.isNamedImports(named))
          for (const el of named.elements)
            if ((el.propertyName ?? el.name).text === "setTimeout")
              st.promiseTimers.add(el.name.text);
      }
      if (ts.isVariableDeclaration(n) && n.initializer) {
        const init = unwrap(n.initializer);
        const text = collapse(init.getText(sf));
        if (ts.isIdentifier(n.name)) {
          if (
            isClockReference(text) ||
            /^(globalThis\.)?(Date\.now|performance\.now)\.bind\(\s*(globalThis\.)?(Date|performance)\s*\)$/.test(
              text,
            ) ||
            (isFn(init) && returnedExprs(init).some((r) => readsClock(r, st)))
          )
            st.aliases.add(n.name.text);
          const v = numericValue(init, st.consts);
          if (
            v !== undefined &&
            ts.isVariableDeclarationList(n.parent) &&
            n.parent.flags & ts.NodeFlags.Const
          )
            st.consts.set(n.name.text, v);
          if (isFn(init)) noteSleepHelper(n.name.text, init, st);
        } else if (
          ts.isObjectBindingPattern(n.name) &&
          /^(globalThis\.)?(Date|performance)$/.test(text)
        ) {
          // const { now } = Date; const { now: clock } = performance;
          for (const el of n.name.elements)
            if (
              ts.isIdentifier(el.name) &&
              (el.propertyName && ts.isIdentifier(el.propertyName)
                ? el.propertyName.text
                : el.name.text) === "now"
            )
              st.aliases.add(el.name.text);
        }
      }
      if (ts.isFunctionDeclaration(n) && n.name) {
        if (returnedExprs(n).some((r) => readsClock(r, st)))
          st.aliases.add(n.name.text);
        noteSleepHelper(n.name.text, n, st);
      }
      ts.forEachChild(n, first);
    };
    first(sf);
  }
  // Fixed point over a few passes: taint and observation flow through
  // assignments and destructuring, into arrays a clock reading is pushed
  // into, and out of a page.evaluate whose callback returns a time; never
  // through object properties (design R1).
  for (let pass = 0; pass < 3; pass++) {
    const walk = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && n.initializer) {
        if (isObserved(n.initializer, st))
          for (const name of bindingNames(n.name)) st.observed.add(name);
        const timeInit =
          hasClockOrTainted(n.initializer, st) ||
          isTimeExpr(n.initializer, st) ||
          evaluatesToTime(n.initializer, st);
        if (timeInit)
          for (const name of bindingNames(n.name))
            if (!CONFIG_NAME.test(name)) st.tainted.add(name);
      }
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(n.left) &&
        !CONFIG_NAME.test(n.left.text) &&
        (hasClockOrTainted(n.right, st) || isTimeExpr(n.right, st))
      )
        st.tainted.add(n.left.text);
      // samples.push(performance.now() - t0)
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        /^(push|unshift)$/.test(n.expression.name.text) &&
        ts.isIdentifier(n.expression.expression) &&
        n.arguments.some(
          (a) => !ts.isSpreadElement(a) && hasClockOrTainted(a, st),
        )
      )
        st.tainted.add(n.expression.expression.text);
      ts.forEachChild(n, walk);
    };
    walk(sf);
  }
  // Same-file boolean helpers whose returned comparison is on time values.
  const helpers = (n: ts.Node): void => {
    let name: string | undefined;
    let fn:
      | ts.ArrowFunction
      | ts.FunctionExpression
      | ts.FunctionDeclaration
      | undefined;
    if (ts.isFunctionDeclaration(n) && n.name && n.body) {
      name = n.name.text;
      fn = n;
    } else if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      isFn(n.initializer)
    ) {
      name = n.name.text;
      fn = n.initializer;
    }
    if (name && fn)
      for (const r of returnedExprs(fn)) {
        const e = unwrap(r);
        if (
          ts.isBinaryExpression(e) &&
          COMPARE.has(e.operatorToken.kind) &&
          (isTimeExpr(e.left, st) || isTimeExpr(e.right, st))
        )
          st.boolHelpers.set(name, e);
      }
    ts.forEachChild(n, helpers);
  };
  helpers(sf);
  return st;
}

/** `await page.evaluate(() => <time>)`: a time read in the page. */
function evaluatesToTime(init: ts.Expression, st: FileState): boolean {
  let e = unwrap(init);
  if (ts.isAwaitExpression(e)) e = unwrap(e.expression);
  if (
    !ts.isCallExpression(e) ||
    !ts.isPropertyAccessExpression(e.expression) ||
    !/^(evaluate|evaluateHandle|\$eval)$/.test(e.expression.name.text)
  )
    return false;
  return e.arguments.some(
    (a) =>
      isFn(a) &&
      returnedExprs(a).some((r) => readsClock(r, st) || isTimeExpr(r, st)),
  );
}

/** A function whose body sleeps for one of its own parameters. */
function noteSleepHelper(
  name: string,
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  st: FileState,
): void {
  const params = fn.parameters.map((p) =>
    ts.isIdentifier(p.name) ? p.name.text : "",
  );
  if (params.length === 0 || !fn.body) return;
  let index = -1;
  const walk = (n: ts.Node): void => {
    if (index !== -1) return;
    if (ts.isNewExpression(n)) {
      const delay = promiseSleepDelay(n, st.sf);
      const d = delay && unwrap(delay);
      if (d && ts.isIdentifier(d)) index = params.indexOf(d.text);
    }
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      st.promiseTimers.has(n.expression.text)
    ) {
      const d = n.arguments[0] && unwrap(n.arguments[0]);
      if (d && ts.isIdentifier(d)) index = params.indexOf(d.text);
    }
    if (index === -1) ts.forEachChild(n, walk);
  };
  walk(fn.body);
  if (index !== -1) st.sleepHelpers.set(name, index);
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

/** The `expect(...)` at the root of a chai chain (`expect(x).to.be.below`), and whether a `.not` is on the way. */
function chainRoot(
  x: ts.Expression,
  sf: ts.SourceFile,
): { call: ts.CallExpression; negated: boolean } | undefined {
  let negated = false;
  let cur = unwrap(x);
  for (let i = 0; i < 8; i++) {
    if (ts.isPropertyAccessExpression(cur)) {
      if (cur.name.text === "not") negated = !negated;
      cur = unwrap(cur.expression);
      continue;
    }
    if (ts.isCallExpression(cur)) {
      const callee = cur.expression.getText(sf).replace(/\s+/g, "");
      if (/^expect(\.soft)?$/.test(callee)) return { call: cur, negated };
      return undefined;
    }
    return undefined;
  }
  return undefined;
}

const TEST_CALLEE =
  /^(test|it)(\.(only|skip|fails|concurrent|sequential|todo))*(\.(skipIf|runIf)\(.*\))?$/s;
const DESCRIBE_CALLEE =
  /^(describe|suite)(\.(only|skip|concurrent|sequential|todo|serial|parallel))*(\.(skipIf|runIf)\(.*\))?$/s;
const HOOK_CALLEE = /^(test\.)?(beforeEach|beforeAll|afterEach|afterAll)$/;

const calleeText = (p: ts.CallExpression, sf: ts.SourceFile) =>
  p.expression.getText(sf).replace(/\s+/g, "");

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
      TEST_CALLEE.test(calleeText(p, sf)) &&
      p.arguments.some((a) => isFn(a))
    ) {
      const title = p.arguments[0];
      const body = p.arguments.find((a) => isFn(a))!;
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

const BOUND_ARG: Record<RoutedHelper, number> = {
  expectFasterThan: 2,
  expectRatioBelow: 3,
  expectAtLeast: 2,
  measureTime: 2,
  timedWait: 1,
};
const MEASURED_ARG: Record<RoutedHelper, number | undefined> = {
  expectFasterThan: 1,
  expectRatioBelow: 1,
  expectAtLeast: 1,
  measureTime: 1,
  timedWait: undefined,
};
const KIND: Record<RoutedHelper, RoutedCall["kind"]> = {
  expectFasterThan: "ceiling",
  expectRatioBelow: "ratio",
  expectAtLeast: "floor",
  measureTime: "ceiling",
  timedWait: "ceiling",
};

/** Local names the file binds to the time-bound helpers. */
interface HelperImports {
  /** local name → helper (named imports, renamed or not). */
  named: Map<string, string>;
  /** namespace import names (`import * as tb`). */
  namespaces: Set<string>;
}

function helperImports(sf: ts.SourceFile): HelperImports {
  const named = new Map<string, string>();
  const namespaces = new Set<string>();
  for (const s of sf.statements) {
    if (
      !ts.isImportDeclaration(s) ||
      !ts.isStringLiteral(s.moduleSpecifier) ||
      !TIME_BOUND_MODULE.test(s.moduleSpecifier.text) ||
      s.importClause?.isTypeOnly
    )
      continue;
    const b = s.importClause?.namedBindings;
    if (b && ts.isNamespaceImport(b)) namespaces.add(b.name.text);
    else if (b && ts.isNamedImports(b))
      for (const el of b.elements) {
        if (el.isTypeOnly) continue;
        const imported = (el.propertyName ?? el.name).text;
        if (
          (ROUTED_HELPERS as readonly string[]).includes(imported) ||
          OTHER_HELPER_EXPORTS.has(imported)
        )
          named.set(el.name.text, imported);
      }
  }
  return { named, namespaces };
}

/** The helper a call's callee names: a bare helper, a renamed import, or `ns.helper`. */
function resolveHelper(
  callee: ts.Expression,
  imp: HelperImports,
): string | undefined {
  if (ts.isIdentifier(callee)) return imp.named.get(callee.text) ?? callee.text;
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    imp.namespaces.has(callee.expression.text)
  )
    return callee.name.text;
  return undefined;
}

function routedCall(
  n: ts.CallExpression,
  st: FileState,
  imp: HelperImports,
  file: string,
): RoutedCall | undefined {
  const name = resolveHelper(n.expression, imp);
  if (!name || !(ROUTED_HELPERS as readonly string[]).includes(name))
    return undefined;
  const helper = name as RoutedHelper;
  const sf = st.sf;
  const idArg = n.arguments[0];
  const id =
    idArg &&
    (ts.isStringLiteral(idArg) || ts.isNoSubstitutionTemplateLiteral(idArg))
      ? idArg.text
      : null;
  const boundArg = n.arguments[BOUND_ARG[helper]];
  const optsIndex = helper === "timedWait" ? 3 : BOUND_ARG[helper] + 1;
  const optsRaw = n.arguments[optsIndex];
  const optsArg =
    optsRaw && ts.isObjectLiteralExpression(unwrap(optsRaw))
      ? (unwrap(optsRaw) as ts.ObjectLiteralExpression)
      : undefined;
  const literalProp = (name: string): string | undefined | null => {
    const p = optsArg?.properties.find(
      (q) =>
        (ts.isPropertyAssignment(q) || ts.isShorthandPropertyAssignment(q)) &&
        q.name.getText(sf) === name,
    );
    if (!p) return undefined;
    if (!ts.isPropertyAssignment(p)) return null;
    const v = unwrap(p.initializer);
    return ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)
      ? v.text
      : null;
  };
  const modeProp = literalProp("mode");
  const witnessProp = literalProp("witness");
  const optionsLiteral =
    optsRaw === undefined ||
    (!!optsArg &&
      !optsArg.properties.some((q) => ts.isSpreadAssignment(q)) &&
      modeProp !== null &&
      witnessProp !== null);
  const mode =
    helper === "measureTime" || modeProp === "measure" ? "measure" : "assert";
  const witness = witnessProp ?? undefined;
  const t = enclosingTest(n, sf);
  let witnessAsserted = false;
  let witnessProblem: string | undefined;
  if (witness !== undefined) {
    if (TIME_NAME.test(witness) || CONFIG_NAME.test(witness))
      witnessProblem = `witness "${witness}" is named as a time`;
    else if (st.tainted.has(witness) || st.aliases.has(witness))
      witnessProblem = `witness "${witness}" holds a clock reading`;
    else if (!t) witnessProblem = "the call is not inside a test";
    else {
      const walk = (m: ts.Node): void => {
        if (witnessAsserted) return;
        if (
          ts.isCallExpression(m) &&
          ts.isPropertyAccessExpression(m.expression) &&
          WITNESS_MATCHERS.has(m.expression.name.text)
        ) {
          const target = m.expression.expression;
          const e = expectCall(target, sf);
          const negated =
            ts.isPropertyAccessExpression(unwrap(target)) &&
            (unwrap(target) as ts.PropertyAccessExpression).name.text === "not";
          const subject = e?.arguments[0];
          if (
            subject &&
            !negated &&
            rootName(subject) === witness &&
            !m.arguments.some((a) => isTimeExpr(a, st))
          )
            witnessAsserted = true;
        }
        ts.forEachChild(m, walk);
      };
      walk(t.body);
      if (!witnessAsserted)
        witnessProblem = `witness "${witness}" is not pinned by an equality or size matcher in this test`;
    }
  }
  const measuredIndex = MEASURED_ARG[helper];
  const measuredArg =
    measuredIndex === undefined ? undefined : n.arguments[measuredIndex];
  const measuredLiteral =
    !!measuredArg &&
    (numericValue(measuredArg, st.consts) !== undefined ||
      /^(Number\.)?(NaN|POSITIVE_INFINITY|NEGATIVE_INFINITY)$|^Infinity$/.test(
        unwrap(measuredArg).getText(sf),
      ));
  let kind = KIND[helper];
  // A floor whose measured value falls as time grows (or whose bound rises
  // with it) is a ceiling written as a floor.
  if (kind === "floor") {
    const m = timeSign(measuredArg, st);
    const b = timeSign(boundArg, st);
    if (m === -1 || m === 2 || b === 1 || b === 2) kind = "ceiling";
  }
  const bound = numericValue(boundArg, st.consts);
  return {
    file,
    line: lineOf(sf, n),
    helper,
    id,
    mode,
    kind,
    ...(witness === undefined ? {} : { witness }),
    witnessAsserted,
    ...(witnessProblem === undefined ? {} : { witnessProblem }),
    optionsLiteral,
    measuredLiteral,
    ...(bound === undefined ? {} : { bound }),
    boundText: boundArg ? keyTextOf(boundArg, sf) : "",
    ...(t?.name === undefined ? {} : { test: t.name }),
    bodyHash: bodyHashOf(keyTextOf(t ? t.body : n, sf)),
    snippet: keyTextOf(n, sf),
  };
}

/** `encodes`, `encodes.length`, `spy.mock.calls[0]`: the identifier at the root; typeof and the rest: none. */
function rootName(x: ts.Expression): string | undefined {
  let cur = unwrap(x);
  for (;;) {
    if (ts.isIdentifier(cur)) return cur.text;
    if (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur))
      cur = unwrap(cur.expression);
    else return undefined;
  }
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

/**
 * The ranges where timers are fake: each REAL call (an AST call, never a
 * comment or a string) to `vi.useFakeTimers` that fakes `setTimeout`, over
 * the test that makes it — or, from a hook, the describe (or file) the hook
 * belongs to; from module scope, the whole file; from a helper function,
 * that function. A mention elsewhere exempted a whole file on f8d48720 and
 * hid a real 300 ms sleep in a real-timer test.
 */
function fakeTimerRanges(sf: ts.SourceFile): [number, number][] {
  const ranges: [number, number][] = [];
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      calleeText(n, sf) === "vi.useFakeTimers" &&
      fakesSetTimeout(n)
    ) {
      let scope: ts.Node = sf;
      for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
        if (isFn(p) || ts.isFunctionDeclaration(p)) {
          const call = p.parent;
          if (call && ts.isCallExpression(call)) {
            const c = calleeText(call, sf);
            if (TEST_CALLEE.test(c)) {
              scope = p;
              break;
            }
            if (HOOK_CALLEE.test(c)) {
              // The hook's describe callback, or the file.
              let d: ts.Node = sf;
              for (let q: ts.Node | undefined = call.parent; q; q = q.parent)
                if (
                  isFn(q) &&
                  q.parent &&
                  ts.isCallExpression(q.parent) &&
                  DESCRIBE_CALLEE.test(calleeText(q.parent, sf))
                ) {
                  d = q;
                  break;
                }
              scope = d;
              break;
            }
            if (DESCRIBE_CALLEE.test(c)) {
              scope = p;
              break;
            }
          }
          scope = p;
          break;
        }
      }
      ranges.push([scope.getStart(sf), scope.getEnd()]);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return ranges;
}

/** `vi.useFakeTimers()` fakes setTimeout unless `toFake` leaves it out. */
function fakesSetTimeout(call: ts.CallExpression): boolean {
  const opts = call.arguments[0] && unwrap(call.arguments[0]);
  if (!opts || !ts.isObjectLiteralExpression(opts)) return true;
  const toFake = opts.properties.find(
    (p) => ts.isPropertyAssignment(p) && p.name.getText() === "toFake",
  ) as ts.PropertyAssignment | undefined;
  if (!toFake) return true;
  const list = unwrap(toFake.initializer);
  if (!ts.isArrayLiteralExpression(list)) return true;
  return list.elements.some(
    (e) => ts.isStringLiteral(e) && e.text === "setTimeout",
  );
}

/**
 * Every use of an imported time-bound helper that is not a call the routed
 * scan reads: a shorthand in an object, an assignment, a namespace passed
 * around, a re-export, a dynamic import or require. Each would let a check
 * run (and print) while no list carries it — the renamed-import and
 * namespace attack on f8d48720.
 */
function timeBoundRefs(
  sf: ts.SourceFile,
  imp: HelperImports,
  file: string,
): TimeBoundRef[] {
  const out: TimeBoundRef[] = [];
  const push = (n: ts.Node, text: string) =>
    out.push({ file, line: lineOf(sf, n), text });
  const visit = (n: ts.Node): void => {
    if (
      ts.isExportDeclaration(n) &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      TIME_BOUND_MODULE.test(n.moduleSpecifier.text) &&
      !n.isTypeOnly
    ) {
      push(n, collapse(n.getText(sf)));
      return;
    }
    if (
      ts.isCallExpression(n) &&
      (n.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(n.expression) && n.expression.text === "require")) &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0]) &&
      TIME_BOUND_MODULE.test(n.arguments[0].text)
    ) {
      push(n, collapse(n.getText(sf)));
      return;
    }
    if (ts.isImportDeclaration(n)) return;
    if (ts.isIdentifier(n) && !inTypePosition(n)) {
      const p = n.parent;
      const isName =
        (ts.isPropertyAccessExpression(p) && p.name === n) ||
        (ts.isPropertyAssignment(p) && p.name === n) ||
        (ts.isVariableDeclaration(p) && p.name === n) ||
        (ts.isFunctionDeclaration(p) && p.name === n) ||
        (ts.isParameter(p) && p.name === n) ||
        ts.isBindingElement(p) ||
        ts.isImportSpecifier(p) ||
        ts.isExportSpecifier(p);
      if (!isName) {
        if (imp.named.has(n.text)) {
          const called = ts.isCallExpression(p) && p.expression === n;
          if (!called) push(n, n.text);
        } else if (imp.namespaces.has(n.text)) {
          const access = ts.isPropertyAccessExpression(p) && p.expression === n;
          const called =
            access &&
            ts.isCallExpression(p.parent) &&
            p.parent.expression === p &&
            ((ROUTED_HELPERS as readonly string[]).includes(p.name.text) ||
              OTHER_HELPER_EXPORTS.has(p.name.text));
          if (!called) push(n, n.text);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function inTypePosition(n: ts.Node): boolean {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isTypeNode(p) || ts.isTypeQueryNode(p)) return true;
    if (ts.isStatement(p) || (ts.isExpression(p) && !ts.isIdentifier(p))) {
      if (ts.isExpressionWithTypeArguments(p)) continue;
      return false;
    }
  }
  return false;
}

/** Every member of all three families in one file's text. */
export function scanSource(text: string, fileName: string): ScanResult {
  const sf = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  const diagnostics =
    (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] })
      .parseDiagnostics ?? [];
  const parseErrors = diagnostics.map(
    (d) =>
      `${fileName}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`,
  );
  const st = prepare(sf);
  const imp = helperImports(sf);
  const comparisons: WallClockMember[] = [];
  const routed: RoutedCall[] = [];
  const sleeps: SleepMember[] = [];
  const fake = fakeTimerRanges(sf);
  const faked = (n: ts.Node) => {
    const at = n.getStart(sf);
    return fake.some(([a, b]) => at >= a && at < b);
  };
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
      snippet: keyTextOf(node, sf),
      raw: collapse(node.getText(sf)),
      lines: spannedLines(sf, node),
    });
  };
  const sleep = (node: ts.Node, ms: number | undefined) => {
    if (ms === undefined || ms < 2 || faked(node)) return;
    sleeps.push({
      file: fileName,
      line: lineOf(sf, node),
      ms,
      snippet: keyTextOf(node, sf),
    });
  };
  /** A boolean comparison on time values: the binary expression, else undefined. */
  const timeComparison = (x: ts.Expression | undefined) => {
    const e = x && unwrap(x);
    return e &&
      ts.isBinaryExpression(e) &&
      COMPARE.has(e.operatorToken.kind) &&
      (isTimeExpr(e.left, st) || isTimeExpr(e.right, st))
      ? e
      : undefined;
  };
  const compDirection = (c: ts.BinaryExpression) =>
    directionOf(LESS.has(c.operatorToken.kind), c.left, c.right, st);

  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const r = routedCall(n, st, imp, fileName);
      if (r) routed.push(r);
      const pa = ts.isPropertyAccessExpression(n.expression)
        ? n.expression
        : undefined;
      // R1/R2/R3 via R6's matchers.
      if (pa && ORDER_MATCHERS.has(pa.name.text)) {
        const e = expectCall(pa.expression, sf);
        const subject = e?.arguments[0];
        const boundArg = n.arguments[0];
        if (e && subject) {
          const s = unwrap(subject);
          const negated =
            ts.isPropertyAccessExpression(pa.expression) &&
            pa.expression.name.text === "not";
          const less = pa.name.text.startsWith("toBeLess") !== negated;
          const direction = directionOf(less, s, boundArg, st);
          if (hasClockOrTainted(s, st)) member(n, "R1", direction);
          else if (isTimeExpr(s, st)) member(n, "R2", direction);
          else if (
            boundArg &&
            BOUND_NAME.test(boundArg.getText(sf)) &&
            !CONFIG_NAME.test(boundArg.getText(sf).replace(/^.*\./, "")) &&
            isObserved(s, st) &&
            !sameFunctionOfConfig(s, boundArg, sf)
          )
            member(n, "R3", direction);
          // A constant held against a time (`expect(500).toBeGreaterThan(el)`):
          // only when the subject cannot be a time itself — an unseen value
          // against a time is usually an ordering of two times.
          else if (
            boundArg &&
            hasClockOrTainted(boundArg, st) &&
            constantLike(s, st)
          )
            member(n, "R1", direction);
        }
      }
      // R8: chai order assertions on an expect chain.
      if (pa && CHAI_ORDER.has(pa.name.text)) {
        const root = chainRoot(pa.expression, sf);
        const subject = root?.call.arguments[0];
        if (root && subject && isTimeExpr(subject, st)) {
          const kind = CHAI_ORDER.get(pa.name.text)!;
          const direction =
            kind === "within"
              ? "ceiling"
              : directionOf(kind !== root.negated, subject, n.arguments[0], st);
          member(n, "R8", direction);
        }
      }
      // R8: assert.isBelow(a, b) and friends.
      if (
        pa &&
        ASSERT_ORDER.has(pa.name.text) &&
        pa.expression.getText(sf) === "assert" &&
        (isTimeExpr(n.arguments[0], st) || isTimeExpr(n.arguments[1], st))
      )
        member(
          n,
          "R8",
          directionOf(
            ASSERT_ORDER.get(pa.name.text)!,
            n.arguments[0],
            n.arguments[1],
            st,
          ),
        );
      // R4: assert(cond), assert.ok(cond), assert.isTrue(cond).
      const callee = calleeText(n, sf);
      if (/^assert(\.(ok|isTrue|isOk))?$/.test(callee)) {
        const c = timeComparison(n.arguments[0]);
        if (c) member(n, "R4", compDirection(c));
      }
      // R4: expect(a < b).toBe(...) / toBeTruthy() / expect(helper(...)).toBe(...)
      if (
        pa &&
        /^(toBe|toEqual|toStrictEqual|toBeTruthy|toBeFalsy)$/.test(pa.name.text)
      ) {
        const e = expectCall(pa.expression, sf);
        const subject = e?.arguments[0] && unwrap(e.arguments[0]);
        if (subject) {
          const c = timeComparison(subject);
          // expect(a < b).toBe(false) / toBeFalsy() fails when it holds.
          const expectsFalse =
            pa.name.text === "toBeFalsy" ||
            (n.arguments[0]?.kind === ts.SyntaxKind.FalseKeyword &&
              pa.name.text !== "toBeTruthy");
          if (c)
            member(
              n,
              "R4",
              expectsFalse
                ? directionOf(
                    !LESS.has(c.operatorToken.kind),
                    c.left,
                    c.right,
                    st,
                  )
                : compDirection(c),
            );
          else if (
            ts.isCallExpression(subject) &&
            ts.isIdentifier(subject.expression) &&
            st.boolHelpers.has(subject.expression.text)
          )
            member(n, "R4");
        }
      }
      // R4: expect(time).toSatisfy((v) => v < 500)
      if (pa && pa.name.text === "toSatisfy") {
        const e = expectCall(pa.expression, sf);
        const fn = n.arguments[0];
        if (e && isFn(fn) && isTimeExpr(e.arguments[0], st)) {
          const param = fn.parameters[0];
          const pname =
            param && ts.isIdentifier(param.name) ? param.name.text : "";
          if (
            returnedExprs(fn).some((r) => {
              const b = unwrap(r);
              return (
                ts.isBinaryExpression(b) &&
                COMPARE.has(b.operatorToken.kind) &&
                [b.left, b.right].some(
                  (side) =>
                    ts.isIdentifier(unwrap(side)) &&
                    (unwrap(side) as ts.Identifier).text === pname,
                )
              );
            })
          )
            member(n, "R4");
        }
      }
      // Sleeps: page.waitForTimeout(N), a timers/promises setTimeout, a same-file sleep helper.
      if (pa && pa.name.text === "waitForTimeout")
        sleep(n, numericValue(n.arguments[0], st.consts));
      if (ts.isIdentifier(n.expression)) {
        if (st.promiseTimers.has(n.expression.text))
          sleep(n, numericValue(n.arguments[0], st.consts));
        const at = st.sleepHelpers.get(n.expression.text);
        if (at !== undefined)
          sleep(n, numericValue(n.arguments[at], st.consts));
      }
    }
    if (ts.isNewExpression(n)) {
      const delay = promiseSleepDelay(n, sf);
      if (delay) sleep(n, numericValue(delay, st.consts));
    }
    // R5: predicates
    if (
      isFn(n) &&
      ts.isCallExpression(n.parent) &&
      ts.isPropertyAccessExpression(n.parent.expression) &&
      /^(filter|some|every|find|findIndex|findLast)$/.test(
        n.parent.expression.name.text,
      )
    ) {
      const receiver = unwrap(n.parent.expression.expression);
      const taintedArray =
        ts.isIdentifier(receiver) && st.tainted.has(receiver.text);
      const param = n.parameters[0];
      const pname = param && ts.isIdentifier(param.name) ? param.name.text : "";
      for (const r of returnedExprs(n)) {
        const b = unwrap(r);
        if (!ts.isBinaryExpression(b) || !COMPARE.has(b.operatorToken.kind))
          continue;
        const onParam = [b.left, b.right].some((side) => {
          const u = unwrap(side);
          return ts.isIdentifier(u) && u.text === pname;
        });
        if (
          (taintedArray && onParam) ||
          ((isTimeExpr(b.left, st) || isTimeExpr(b.right, st)) &&
            /(MS|Ms)\b/.test(b.getText(sf)))
        ) {
          member(n, "R5");
          break;
        }
      }
    }
    // R9: if (<time comparison>) throw ...
    if (ts.isIfStatement(n)) {
      const comps: ts.BinaryExpression[] = [];
      const collect = (m: ts.Node): void => {
        if (ts.isBinaryExpression(m) && COMPARE.has(m.operatorToken.kind))
          comps.push(m);
        if (!isFn(m)) ts.forEachChild(m, collect);
      };
      collect(n.expression);
      const timed = comps.find(
        (c) =>
          readsClock(c.left, st) ||
          readsClock(c.right, st) ||
          hasClockOrTainted(c.left, st) ||
          hasClockOrTainted(c.right, st),
      );
      // The branch FAILS when its condition holds, the opposite of an
      // assertion: `if (t < 650) throw "not yet"` is a floor.
      if (timed && throws(n.thenStatement))
        member(
          n.expression,
          "R9",
          directionOf(
            !LESS.has(timed.operatorToken.kind),
            timed.left,
            timed.right,
            st,
          ),
        );
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
        if (!isFn(m)) ts.forEachChild(m, collect);
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
  return {
    comparisons,
    routed,
    sleeps,
    timeBoundRefs: timeBoundRefs(sf, imp, fileName),
    parseErrors,
  };
}

/** `throw`, `expect.fail(...)` or `assert.fail(...)` directly in a branch. */
function throws(s: ts.Statement): boolean {
  let found = false;
  const walk = (n: ts.Node): void => {
    if (found || isFn(n) || ts.isFunctionDeclaration(n)) return;
    if (ts.isThrowStatement(n)) found = true;
    else if (
      ts.isCallExpression(n) &&
      /^(expect|assert)\.fail$/.test(n.expression.getText().replace(/\s+/g, ""))
    )
      found = true;
    else ts.forEachChild(n, walk);
  };
  walk(s);
  return found;
}

/** `pollWaitMs(a)` against `pollWaitMs(b)`: one function of configuration on both sides. */
function sameFunctionOfConfig(
  subject: ts.Expression,
  bound: ts.Expression,
  sf: ts.SourceFile,
): boolean {
  const s = unwrap(subject);
  const b = unwrap(bound);
  return (
    ts.isCallExpression(s) &&
    ts.isCallExpression(b) &&
    s.expression.getText(sf) === b.expression.getText(sf)
  );
}

/** The comparison family alone: the function the design names. */
export function findWallClockComparisons(
  text: string,
  fileName: string,
): WallClockMember[] {
  return scanSource(text, fileName).comparisons;
}

/** Stable keys: file + token-stream snippet + occurrence index, never a line number. */
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
    scriptKind(fileName),
  );
  const st = prepare(sf);
  const out: { line: number; snippet: string }[] = [];
  const visit = (n: ts.Node): void => {
    if (
      ts.isBinaryExpression(n) &&
      COMPARE.has(n.operatorToken.kind) &&
      (isTimeExpr(n.left, st) || isTimeExpr(n.right, st))
    )
      out.push({ line: lineOf(sf, n), snippet: keyTextOf(n, sf) });
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
