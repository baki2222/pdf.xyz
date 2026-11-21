/**
 * The shared core of the wall-clock instrument: the record a timing check
 * leaves behind, the one line it prints, and the report both reporters
 * (vitest's `TimeoutHeadroomReporter`, Playwright's `e2e/headroom-reporter.ts`)
 * print from those records at the end of a run.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * The CI flake audit of 2026-11-19 found 371 checks that can fail a test on
 * how fast the runner is, and no instrument that showed how close any of them
 * ran to its bound: a ratio at 1.34x headroom printed the same green tick as
 * one at 10x. Every check that compares a time now routes through
 * `src/tests/time-bound.ts` (vitest) or `e2e/time-bound.ts` (Playwright),
 * which record what they measured on the PASS path and the FAIL path alike —
 * CLAUDE.md rule 3: the failure shape carries the measurement, or the run
 * that most needed the number is the one without it.
 *
 * Dependency-free on purpose, and CommonJS-safe (no `import.meta`, no
 * top-level await): `vitest.config.ts` imports it through the reporter, and
 * so does Playwright's CommonJS loader through `e2e/headroom-reporter.ts`
 * (`src/tests/e2e-cjs-load.test.ts` compiles it the way that loader does).
 */

import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";

/** A bound is reported once it has used more than this share of its margin. */
export const BOUND_HEADROOM_RATIO = 0.5;

/**
 * GitHub shows at most 10 warning annotations per step; each block
 * annotates only its worst few, so a real near-miss is not crowded off the
 * PR page by the blocks printed before it. The rest are printed plainly.
 */
export const ANNOTATIONS_PER_BLOCK = 3;

let tsModule: typeof TS | null | undefined;
/**
 * TypeScript, loaded on first use from the working directory: the reporters
 * import this module at config time (vitest's, Playwright's CommonJS loader),
 * so nothing third-party loads until a report reads source. Null when it
 * cannot be loaded — callers then say "unresolved", never "default".
 */
function typescript(): typeof TS | null {
  if (tsModule === undefined) {
    try {
      tsModule = createRequire(path.join(process.cwd(), "noop.js"))(
        "typescript",
      ) as typeof TS;
    } catch {
      tsModule = null;
    }
  }
  return tsModule;
}

const parsed = new Map<string, TS.SourceFile>();
function parse(source: string): TS.SourceFile | null {
  const ts = typescript();
  if (!ts) return null;
  let sf = parsed.get(source);
  if (!sf) {
    sf = ts.createSourceFile(
      "x.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    if (parsed.size > 400) parsed.clear();
    parsed.set(source, sf);
  }
  return sf;
}

/** Names that hold a time (`ms`, `*Ms`, `elapsed*`, `took*`, `*Duration`, ...). */
export const TIME_NAME =
  /^(ms|\w*Ms|elapsed\w*|took\w*|\w*Duration|duration\w*|latency\w*|perQuery\w*)$/;
/** Config names: a bound, a knob or a schedule — never the measured subject. */
export const CONFIG_NAME =
  /^(timeout\w*|\w*Timeout\w*|\w*TIMEOUT\w*|interval\w*|delay\w*|budget\w*|ttl\w*|deadline\w*|retryAfter\w*|\w*(Budget|Interval|Delay|Ceiling|Bound|Limit|Max|Min|Wait|Sleep|Hold|Grace)Ms)$/i;

export const isTimeName = (name: string): boolean =>
  TIME_NAME.test(name) && !CONFIG_NAME.test(name);

/**
 * Why `witness` cannot be a measure-mode bound's witness, or null. A witness
 * is a speed-independent count, size or shape; a name that reads as a time
 * (measured or configured) is the measurement wearing a witness's label —
 * the attack that turned detection off on f8d48720 was `{ witness: "ms" }`.
 * The guard adds what only the source can show (that the name is not a
 * clock-tainted variable, and that an equality or size matcher asserts it).
 */
export function witnessNameProblem(witness: string | undefined): string | null {
  if (!witness) return "no witness";
  if (!/^[A-Za-z_$][\w$]*$/.test(witness))
    return `witness "${witness}" is not a variable name`;
  if (TIME_NAME.test(witness) || CONFIG_NAME.test(witness))
    return `witness "${witness}" is named as a time, so it is the measurement, not a speed-independent witness`;
  return null;
}

export type TimeBoundKind = "ceiling" | "ratio" | "floor";
export type TimeBoundMode = "assert" | "measure";

/** What one timing check measured, against what, in which test. */
export interface TimeBound {
  /** A string literal at the call site (the guard holds it to that). */
  id: string;
  /** Per-instance data for a check written once and run many times. */
  instance?: string;
  kind: TimeBoundKind;
  /** ms for a ceiling or floor; the numerator for a ratio. */
  measured: number;
  /** ms for a ceiling or floor; the largest ratio allowed for a ratio. */
  bound: number;
  /** The denominator of a ratio, in the same unit as `measured`. */
  control?: number;
  mode: TimeBoundMode;
  /** Measure mode only: the speed-independent assertion that still catches the defect. */
  witness?: string;
  /** Free text kept beside the numbers (e.g. both attempts of a best-of-two). */
  detail?: string;
  file: string;
  test: string;
  line: number;
  /**
   * The token-stream hash of the test body that RAN, computed at record
   * time from the file on disk (`routedBodyHash`), so a calibration value
   * certifies the body it was measured on — not whatever body the harvest
   * finds in today's tree (critic P5, CLAUDE.md rule 2).
   */
  bodyHash?: string;
}

/** One testing-library wait (`findBy*`, `waitFor`), timed by `src/tests/wait-recorder.ts`. */
export interface WaitRecord {
  ms: number;
  file: string;
  line: number;
  column: number;
  /** testing-library's `asyncUtilTimeout` when the wait ran. */
  defaultTimeoutMs: number;
  /**
   * The wait rejected. Whether it TIMED OUT is decided by the report against
   * the timeout it ran under (`waitForElementToBeRemoved` rejects at once
   * when the element is already gone — that is not a timeout).
   */
  rejected: boolean;
  test?: string;
}

/**
 * The share of its margin a bound used: measured/bound for a ceiling,
 * (a/b)/bound for a ratio, bound/measured for a floor. Over 0.5 is less than
 * the 2x margin the property (design 2) asks for; over 1 is a failure.
 */
export function shareOf(
  b: Pick<TimeBound, "kind" | "measured" | "bound" | "control">,
): number {
  if (b.kind === "ratio") return b.measured / (b.control as number) / b.bound;
  if (b.kind === "floor")
    return b.measured === 0 ? Infinity : b.bound / b.measured;
  return b.measured / b.bound;
}

/** The value a ratio record compares, or the ms of the others. */
export function observedValue(
  b: Pick<TimeBound, "kind" | "measured" | "control">,
): number {
  return b.kind === "ratio" ? b.measured / (b.control as number) : b.measured;
}

const pct = (share: number) =>
  Number.isFinite(share) ? `${Math.round(share * 100)}%` : "inf%";
const round = (n: number) =>
  Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100;

/** "412 ms of 1000 ms", "1.53x of 2.2x (612 ms / 400 ms)", "floor 150 ms, measured 412 ms". */
export function describeBound(
  b: Pick<TimeBound, "kind" | "measured" | "bound" | "control">,
): string {
  if (b.kind === "ratio")
    return `${round(observedValue(b))}x of ${b.bound}x (${round(b.measured)} / ${round(b.control as number)})`;
  if (b.kind === "floor")
    return `floor ${round(b.bound)} ms, measured ${round(b.measured)} ms`;
  return `${round(b.measured)} ms of ${round(b.bound)} ms`;
}

/**
 * The line every check prints, on a pass and a failure, in the grep
 * convention the hostile suites started (`[time-bound] <what>`), with the
 * whole record after ` json=` so `scripts/time-bounds-harvest.ts` reads the
 * numbers back out of a CI log instead of re-parsing prose.
 */
export function timeBoundLine(b: TimeBound): string {
  const name = b.instance ? `${b.id} ${b.instance}` : b.id;
  const mode = b.mode === "measure" ? " [measure]" : "";
  const detail = b.detail ? ` — ${b.detail}` : "";
  return `[time-bound] ${name}: ${describeBound(b)} (${pct(shareOf(b))})${mode}${detail} json=${JSON.stringify(b)}`;
}

/** Every record printed in `text` (a log), in order; lines without a record are skipped. */
export function parseTimeBoundLines(text: string): TimeBound[] {
  const out: TimeBound[] = [];
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf("[time-bound] ");
    if (at === -1) continue;
    const j = line.indexOf(" json={", at);
    if (j === -1) continue;
    try {
      const rec = JSON.parse(line.slice(j + " json=".length)) as TimeBound;
      if (typeof rec.id === "string" && typeof rec.measured === "number")
        out.push(rec);
    } catch {
      // A line cut by the log viewer: not a record.
    }
  }
  return out;
}

/** `%`, CR and LF are the characters a workflow-command message must escape. */
export function escapeData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
export function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/** One row of a headroom block. */
export interface HeadroomItem {
  share: number;
  /** "<file> > <test> > <id>: 488 ms of 800 ms" */
  text: string;
  file?: string;
  line?: number;
}

/**
 * The rows over the threshold, largest share first, then (on GitHub) one
 * warning annotation each at the file and line. Shared by both reporters so
 * the two halves of the suite read the same way.
 */
export function headroomLines(
  items: readonly HeadroomItem[],
  opts: { github: boolean; title: string; ratio?: number; annotate?: number },
): string[] {
  const ratio = opts.ratio ?? BOUND_HEADROOM_RATIO;
  const cap = opts.annotate ?? ANNOTATIONS_PER_BLOCK;
  const lines: string[] = [];
  const over = [...items]
    .filter((i) => i.share > ratio)
    .sort((a, b) => b.share - a.share);
  over.forEach((item, i) => {
    lines.push(`  ${pct(item.share).padStart(4)}  ${item.text}`);
    if (opts.github && i < cap)
      lines.push(annotation(item.file, item.line, opts.title, item.text));
  });
  if (opts.github && cap > 0 && over.length > cap)
    lines.push(
      `        (${over.length - cap} more over the threshold are not annotated: GitHub shows at most 10 annotations per step)`,
    );
  return lines;
}

/** One `::warning` workflow command. */
export function annotation(
  file: string | undefined,
  line: number | undefined,
  title: string,
  text: string,
): string {
  return `::warning ${file ? `file=${escapeProperty(file)},` : ""}${line ? `line=${line},` : ""}title=${escapeProperty(title)}::${escapeData(text)}`;
}

const repoPath = (file: string, root: string) => {
  const f = file.replace(/\\/g, "/");
  const r = root.replace(/\\/g, "/").replace(/\/?$/, "/");
  return f.startsWith(r) ? f.slice(r.length) : f;
};

/**
 * The time-bound block: assert-mode bounds over half their margin, then the
 * measure-mode ones (recorded, never asserted), each with its worst share.
 */
export function timeBoundReport(
  bounds: readonly TimeBound[],
  opts: { github: boolean; root: string },
): string[] {
  const asserted = bounds.filter((b) => b.mode === "assert");
  const measured = bounds.filter((b) => b.mode === "measure");
  const item = (b: TimeBound): HeadroomItem => ({
    share: shareOf(b),
    text: `${repoPath(b.file, opts.root)} > ${b.test} > ${b.instance ? `${b.id} ${b.instance}` : b.id}: ${describeBound(b)}`,
    file: repoPath(b.file, opts.root),
    line: b.line,
  });
  const worst = (list: readonly TimeBound[]) =>
    list.length === 0
      ? "none"
      : (() => {
          const w = [...list].sort((a, b) => shareOf(b) - shareOf(a))[0]!;
          return `${w.id}${w.instance ? ` ${w.instance}` : ""} ${pct(shareOf(w))}`;
        })();
  const over = asserted.filter((b) => shareOf(b) > BOUND_HEADROOM_RATIO);
  return [
    `time-bound headroom: ${over.length} of ${asserted.length} wall-clock bounds used more than ${BOUND_HEADROOM_RATIO * 100}% of their bound (worst: ${worst(asserted)})`,
    ...headroomLines(asserted.map(item), {
      github: opts.github,
      title: "Time bound near its limit",
    }),
    `time-bound measure-only: ${measured.length} bounds recorded, not asserted (worst vs proposed: ${worst(measured)})`,
    ...headroomLines(measured.map(item), {
      github: false,
      title: "Measure-only bound",
    }),
  ];
}

/** What a call site says about its own timeout, read from its source text. */
export type CallTimeout =
  | { kind: "default" }
  | { kind: "explicit"; ms: number }
  | { kind: "unresolved"; text: string };

/**
 * The timeout a call site passes, read from its AST at (line, column) — the
 * position a stack frame (a testing-library wait) or a Playwright step
 * location (`backToExpect`: the matcher, possibly lines below the
 * `expect.poll(fn, { timeout })` that carries the timeout) points at.
 *
 * The call is the innermost one containing the position (or, when the
 * position is on `await` before it, the first call starting after it on
 * that line). Its timeout is a top-level `timeout` property of an
 * object-literal OPTIONS argument — never the callback's, never the first
 * argument (a waitFor callback, a findBy matcher); for an expect chain, the
 * matcher's options first, then each call down the chain. An options
 * argument that is a variable is resolved to a same-file `const` object; a
 * value that is a numeric literal or a same-file numeric `const` is
 * "explicit"; anything else is "unresolved" and reported as such — never
 * silently held to the default (critic P6). The textual scan this replaces
 * took the first `timeout:` anywhere, including inside the callback and,
 * past an apostrophe in a regex literal, in a LATER call (finding C2,
 * 2026-11-21).
 */
export function callTimeoutAt(
  source: string,
  line: number,
  column = 1,
  opts: { backToExpect?: boolean } = {},
): CallTimeout {
  const sf = parse(source);
  const ts = typescript();
  if (!sf || !ts)
    return { kind: "unresolved", text: "typescript not loadable" };
  const starts = sf.getLineStarts();
  if (line < 1 || line > starts.length) return { kind: "default" };
  const lineStart = starts[line - 1]!;
  const lineEnd = line < starts.length ? starts[line]! : sf.text.length;
  const pos = Math.min(lineStart + Math.max(0, column - 1), lineEnd);
  let inner: TS.CallExpression | undefined;
  let after: TS.CallExpression | undefined;
  const visit = (n: TS.Node): void => {
    const start = n.getStart(sf);
    const contains = start <= pos && pos < n.getEnd();
    const onLineAfter = start >= pos && start < lineEnd;
    if (ts.isCallExpression(n)) {
      if (contains) inner = n;
      else if (onLineAfter && !after) after = n;
    }
    if (start < lineEnd && n.getEnd() > pos) ts.forEachChild(n, visit);
  };
  visit(sf);
  const call = inner ?? after;
  if (!call) return { kind: "default" };
  const chain: TS.CallExpression[] = [];
  if (opts.backToExpect) {
    // Up to the outermost call of the chain (the location may sit on
    // `expect(` or on the matcher), then the matcher call and each call
    // below it.
    let top: TS.CallExpression = call;
    while (
      ts.isPropertyAccessExpression(top.parent) &&
      ts.isCallExpression(top.parent.parent) &&
      top.parent.parent.expression === top.parent
    )
      top = top.parent.parent;
    let cur: TS.Expression = top;
    for (;;) {
      if (ts.isCallExpression(cur)) {
        chain.push(cur);
        cur = cur.expression;
      } else if (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
      else break;
    }
  } else chain.push(call);
  for (const c of chain) {
    const t = optionsTimeout(c, sf, ts);
    if (t) return t;
  }
  return { kind: "default" };
}

/** The timeout in a call's options arguments, or undefined when it passes none. */
function optionsTimeout(
  call: TS.CallExpression,
  sf: TS.SourceFile,
  ts: typeof TS,
): CallTimeout | undefined {
  const constInit = (name: string): TS.Expression | undefined => {
    let found: TS.Expression | undefined;
    const visit = (n: TS.Node): void => {
      if (found) return;
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === name &&
        n.initializer &&
        ts.isVariableDeclarationList(n.parent) &&
        n.parent.flags & ts.NodeFlags.Const
      )
        found = n.initializer;
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
  };
  const text = (n: TS.Node) => n.getText(sf).replace(/\s+/g, " ");
  const value = (x: TS.Expression, label: string): CallTimeout => {
    let e = x;
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e))
      e = e.expression;
    if (ts.isNumericLiteral(e))
      return { kind: "explicit", ms: Number(e.text.replace(/_/g, "")) };
    if (ts.isIdentifier(e)) {
      const init = constInit(e.text);
      if (init && ts.isNumericLiteral(init))
        return { kind: "explicit", ms: Number(init.text.replace(/_/g, "")) };
    }
    return { kind: "unresolved", text: `${label}: ${text(e)}` };
  };
  // A matcher (`toBeCloseTo(100, 0)`, `toHaveCount(n)`) takes its timeout
  // only in an options object: its positional numbers are expected values
  // and precisions (CI run 44917160721 read toBeCloseTo's 0 as "0 ms").
  const matcher =
    ts.isPropertyAccessExpression(call.expression) &&
    /^to[A-Z]/.test(call.expression.name.text);
  // The first argument is a callback, a matcher text or a locator — an
  // options object only when it is written as one (`toBeVisible({ timeout })`).
  for (const [i, raw] of call.arguments.entries()) {
    let arg: TS.Expression = raw;
    if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) continue;
    if (i === 0 && !ts.isObjectLiteralExpression(arg)) continue;
    // vi.waitFor(cb, 2000): a bare number is the timeout.
    if (ts.isNumericLiteral(arg)) {
      if (matcher) continue;
      return { kind: "explicit", ms: Number(arg.text.replace(/_/g, "")) };
    }
    if (ts.isIdentifier(arg)) {
      const init = constInit(arg.text);
      if (!init || !ts.isObjectLiteralExpression(init)) {
        if (matcher) continue;
        return { kind: "unresolved", text: `options: ${arg.text}` };
      }
      arg = init;
    }
    if (!ts.isObjectLiteralExpression(arg)) continue;
    for (const p of arg.properties) {
      if (ts.isSpreadAssignment(p))
        return { kind: "unresolved", text: `options: ${text(p)}` };
      if (!p.name || p.name.getText(sf) !== "timeout") continue;
      if (ts.isShorthandPropertyAssignment(p))
        return value(p.name, "timeout (shorthand)");
      if (ts.isPropertyAssignment(p)) return value(p.initializer, "timeout");
    }
  }
  return undefined;
}

/**
 * The timeout each `beforeAll`/`afterAll` in a file runs under: its own
 * numeric argument (a literal or a same-file const), else `defaultMs`.
 */
export function hookBudgets(source: string, defaultMs: number): number[] {
  const sf = parse(source);
  const ts = typescript();
  if (!sf || !ts) return [];
  const consts = new Map<string, number>();
  const out: number[] = [];
  const visit = (n: TS.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isNumericLiteral(n.initializer)
    )
      consts.set(n.name.text, Number(n.initializer.text.replace(/_/g, "")));
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      /^(beforeAll|afterAll)$/.test(n.expression.text)
    ) {
      const t = n.arguments[1];
      out.push(
        t && ts.isNumericLiteral(t)
          ? Number(t.text.replace(/_/g, ""))
          : t && ts.isIdentifier(t) && consts.has(t.text)
            ? consts.get(t.text)!
            : defaultMs,
      );
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * The wait block (testing-library on the vitest side). Each wait is held to
 * the timeout it RAN under: its own `timeout:` when the call site passes
 * one, testing-library's default otherwise. The worst five are always
 * printed, over the threshold or not, so creep under a raised default stays
 * visible (design 3c).
 */
export function waitReport(
  waits: readonly WaitRecord[],
  opts: {
    github: boolean;
    root: string;
    source: (file: string) => string | undefined;
  },
): string[] {
  const defaultMs = waits[0]?.defaultTimeoutMs ?? 1000;
  const judged = waits.map((w) => {
    const src = opts.source(w.file);
    const t =
      src === undefined
        ? ({ kind: "default" } as CallTimeout)
        : callTimeoutAt(src, w.line, w.column);
    const budget =
      t.kind === "explicit"
        ? t.ms
        : t.kind === "default"
          ? w.defaultTimeoutMs
          : undefined;
    const timedOut = w.rejected && budget !== undefined && w.ms >= budget;
    return { w, t, budget, share: budget ? w.ms / budget : NaN, timedOut };
  });
  const site = (w: WaitRecord) => `${repoPath(w.file, opts.root)}:${w.line}`;
  const label = (j: (typeof judged)[number]) =>
    `${site(j.w)}${j.w.test ? ` > ${j.w.test}` : ""}: ${Math.round(j.w.ms)} ms of ${j.budget ?? "?"} ms (${j.t.kind === "explicit" ? "its own timeout" : j.t.kind === "default" ? "default" : j.t.text}${j.timedOut ? "; TIMED OUT" : j.w.rejected ? (j.budget === undefined ? "; REJECTED" : "; REJECTED early") : ""})`;
  const resolved = judged.filter((j) => j.budget !== undefined);
  const over = resolved.filter((j) => j.share > BOUND_HEADROOM_RATIO);
  const unresolved = judged.filter(
    (j) => j.budget === undefined && j.w.ms > defaultMs * BOUND_HEADROOM_RATIO,
  );
  const timedOut = judged.filter((j) => j.timedOut);
  const early = judged.filter(
    (j) => j.w.rejected && !j.timedOut && j.budget !== undefined,
  );
  const unread = judged.filter((j) => j.w.rejected && j.budget === undefined);
  const lines = [
    `wait headroom: ${over.length} of ${waits.length} waits (testing-library and vi.waitFor) took more than ${BOUND_HEADROOM_RATIO * 100}% of their timeout (default asyncUtilTimeout ${defaultMs} ms; ${timedOut.length} timed out${early.length > 0 ? `, ${early.length} rejected before its timeout` : ""}${unread.length > 0 ? `, ${unread.length} rejected under a timeout it could not read` : ""})`,
    ...headroomLines(
      over.map((j) => ({
        share: j.share,
        text: label(j),
        file: repoPath(j.w.file, opts.root),
        line: j.w.line,
      })),
      { github: opts.github, title: "Wait near its timeout" },
    ),
  ];
  if (unresolved.length > 0) {
    lines.push(
      `wait headroom: ${unresolved.length} slow waits pass a timeout this report could not read from source:`,
    );
    for (const j of unresolved) lines.push(`        ${label(j)}`);
  }
  const worst = [...resolved].sort((a, b) => b.share - a.share).slice(0, 5);
  if (worst.length > 0) {
    lines.push("wait headroom, worst five whatever their share:");
    for (const j of worst)
      lines.push(`  ${pct(j.share).padStart(4)}  ${label(j)}`);
  }
  return lines;
}

/** A measure-mode id with no witness yet, and why (`src/tests/wall-clock-pending.ts`). */
export interface PendingEntry {
  id: string;
  file: string;
  reason: string;
}

/** Every pending entry, on every CI run: a list nobody reads is a list that only grows. */
export function pendingReport(
  pending: readonly PendingEntry[],
  cap: number,
): string[] {
  return [
    `time-bound pending: ${pending.length} of at most ${cap} measure-only bounds have no speed-independent witness yet`,
    ...pending.map((p) => `  ${p.id} (${p.file}): ${p.reason}`),
  ];
}

/**
 * The hook line. Vitest 4.1 reports no per-hook duration: `onHookEnd` carries
 * only the hook's name and its entity, and is batched to the main process,
 * so timing it there measures the batching. What it does expose is each
 * module's `diagnostic().duration` ("all tests and hooks") and each test's
 * duration (which includes its beforeEach/afterEach), so the difference is
 * the time a file spent in beforeAll/afterAll — an UPPER bound on any single
 * such hook.
 *
 * Each file is held to the SMALLEST timeout among its own beforeAll/afterAll
 * hooks (`hookBudgets`: each hook's explicit timeout, else hookTimeout; with
 * none of its own, hookTimeout). That bounds the worst hook's share from
 * above: any one hook took at most the sum, and runs under at least the
 * smallest budget. On f8d48720 every file was held to the global
 * hookTimeout, so a beforeAll with its own 300 s timeout read as 318%
 * (finding S1, 2026-11-21). Printed, never annotated: the split between
 * hooks is unknown, and an annotation would name a hook the figure cannot.
 */
export function hookReport(
  modules: readonly {
    file: string;
    moduleMs: number;
    testsMs: number;
    budgets: readonly number[];
  }[],
  hookTimeoutMs: number,
  opts: { github: boolean; root: string },
): string[] {
  const items = modules.map((m) => {
    const hooks = Math.max(0, m.moduleMs - m.testsMs);
    const budget =
      m.budgets.length > 0 ? Math.min(...m.budgets) : hookTimeoutMs;
    const own =
      m.budgets.length === 0
        ? "none of its own; hookTimeout"
        : `${m.budgets.length} of its own: ${m.budgets.join(", ")} ms`;
    return {
      share: hooks / budget,
      text: `${repoPath(m.file, opts.root)}: ${Math.round(hooks)} ms in beforeAll/afterAll (module total less its tests; an upper bound on any one hook) against ${budget} ms, the smallest timeout of its hooks (${own})`,
      file: repoPath(m.file, opts.root),
    };
  });
  const over = items.filter((i) => i.share > BOUND_HEADROOM_RATIO);
  return [
    `hook headroom: ${over.length} of ${modules.length} files spent more than ${BOUND_HEADROOM_RATIO * 100}% of their hooks' smallest timeout in beforeAll/afterAll (vitest 4.1 exposes no per-hook duration; this is the per-file sum, printed only, not annotated)`,
    ...headroomLines(items, {
      github: false,
      title: "Hooks near their timeout",
    }),
  ];
}

/**
 * The broken-pipe health check, by relation rather than by size: every
 * `[time-bound]` line a test printed is a record that must have reached the
 * reporter through the test's meta. More lines than records means the meta
 * pipe dropped some — and a report of "0 of 0 bounds near their limit" would
 * be the strongest possible pass for the wrong reason. A size fallback
 * catches a run in which no line was captured either.
 */
export function brokenPipeLines(opts: {
  printed: number;
  recorded: number;
  testsSeen: number;
  github: boolean;
  minTests?: number;
}): string[] {
  const min = opts.minTests ?? 5000;
  const msgs: string[] = [];
  if (opts.printed > opts.recorded)
    msgs.push(
      `time-bound pipe broken: ${opts.printed} [time-bound] lines were printed but only ${opts.recorded} records reached the reporter`,
    );
  else if (opts.testsSeen > min && opts.recorded === 0)
    msgs.push(
      `time-bound pipe broken: ${opts.testsSeen} tests ran and no time-bound record reached the reporter`,
    );
  // On GitHub the plain line is printed too: the step summary drops
  // workflow commands, and the annotation can be crowded out.
  return msgs.flatMap((m) =>
    opts.github
      ? [m, `::warning title=time-bound pipe::${escapeData(m)}`]
      : [m],
  );
}
