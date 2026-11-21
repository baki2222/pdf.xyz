import { expect, test } from "@playwright/test";
import {
  timeBoundLine,
  type TimeBound,
  type TimeBoundKind,
  type TimeBoundMode,
} from "../src/tests/time-bound-core";
import { WALL_CLOCK_PENDING } from "../src/tests/wall-clock-pending";

/**
 * The e2e twin of `src/tests/time-bound.ts`: the one way a spec compares a
 * wall-clock time against a bound. The same order, for the same reason
 * (CLAUDE.md rule 3): health-check the inputs, record the measurement on
 * the test (an annotation, which reaches `e2e/headroom-reporter.ts` on a
 * pass and a failure), print the `[time-bound]` line, and only then assert.
 *
 * `timedWait` is for the waits whose own duration is the risk (design 1.5):
 * it records how long the wait took against its timeout, in a `finally`, so
 * the wait that timed out is the one with a number.
 *
 * CommonJS-safe, like everything Playwright loads (`e2e-cjs-load.test.ts`).
 */

export interface TimeBoundOptions {
  instance?: string;
  detail?: string;
  mode?: TimeBoundMode;
  /** Measure mode: the subject of the speed-independent `expect` in this test. */
  witness?: string;
}

/** The first stack frame outside this module. */
function callSiteLine(): number {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 30;
  const stack = new Error().stack ?? "";
  Error.stackTraceLimit = limit;
  for (const frame of stack.split("\n").slice(1)) {
    if (/time-bound\.ts/.test(frame)) continue;
    const m = /:(\d+):\d+\)?\s*$/.exec(frame);
    if (m) return Number(m[1]);
  }
  return 0;
}

function record(
  kind: TimeBoundKind,
  id: string,
  measured: number,
  bound: number,
  control: number | undefined,
  opts: TimeBoundOptions,
): TimeBound {
  const mode = opts.mode ?? "assert";
  const named = `[time-bound] ${id}`;
  const values: [string, number][] = [
    ["measured", measured],
    ["bound", bound],
  ];
  if (control !== undefined) values.push(["control", control]);
  for (const [what, v] of values)
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0)
      throw new Error(
        `${named}: ${what} is ${String(v)}, not a finite time >= 0 — the measurement itself is broken`,
      );
  if (kind === "ratio" && !(control! > 0))
    throw new Error(
      `${named}: the ratio's control measured ${control}, so any ratio would pass — the control did no work`,
    );
  if (
    mode === "measure" &&
    !opts.witness &&
    !WALL_CLOCK_PENDING.some((p) => p.id === id)
  )
    throw new Error(
      `${named}: measure mode records and never fails, so it needs a witness (a speed-independent expect in this test) or an entry in src/tests/wall-clock-pending.ts`,
    );
  const info = test.info();
  const rec: TimeBound = {
    id,
    ...(opts.instance === undefined ? {} : { instance: opts.instance }),
    kind,
    measured,
    bound,
    ...(control === undefined ? {} : { control }),
    mode,
    ...(opts.witness === undefined ? {} : { witness: opts.witness }),
    ...(opts.detail === undefined ? {} : { detail: opts.detail }),
    file: info.file,
    test: info.title,
    line: callSiteLine(),
  };
  // Recorded BEFORE the assertion: a failing attempt keeps its number.
  info.annotations.push({
    type: "time-bound",
    description: JSON.stringify(rec),
  });
  console.log(timeBoundLine(rec));
  return rec;
}

export function expectFasterThan(
  id: string,
  ms: number,
  boundMs: number,
  opts: TimeBoundOptions = {},
): TimeBound {
  const rec = record("ceiling", id, ms, boundMs, undefined, opts);
  if (rec.mode === "assert")
    expect(ms, timeBoundLine(rec)).toBeLessThan(boundMs);
  return rec;
}

export function expectRatioBelow(
  id: string,
  numerator: number,
  denominator: number,
  bound: number,
  opts: TimeBoundOptions = {},
): TimeBound {
  const rec = record("ratio", id, numerator, bound, denominator, opts);
  if (rec.mode === "assert")
    expect(numerator / denominator, timeBoundLine(rec)).toBeLessThan(bound);
  return rec;
}

export function expectAtLeast(
  id: string,
  ms: number,
  minMs: number,
  opts: TimeBoundOptions = {},
): TimeBound {
  const rec = record("floor", id, ms, minMs, undefined, opts);
  if (rec.mode === "assert")
    expect(ms, timeBoundLine(rec)).toBeGreaterThanOrEqual(minMs);
  return rec;
}

export function measureTime(
  id: string,
  ms: number,
  proposedBoundMs: number,
  opts: Omit<TimeBoundOptions, "mode"> = {},
): TimeBound {
  return record("ceiling", id, ms, proposedBoundMs, undefined, {
    ...opts,
    mode: "measure",
  });
}

/**
 * Runs `wait(timeoutMs)` — an `expect(...).toX({ timeout })` — and records
 * how long it took against `timeoutMs`, whether it passed or timed out.
 * The wait's own expect is the assertion; this adds the number.
 */
export async function timedWait<T>(
  id: string,
  timeoutMs: number,
  wait: (timeout: number) => Promise<T>,
  opts: Omit<TimeBoundOptions, "mode"> = {},
): Promise<T> {
  const started = Date.now();
  let failed = true;
  try {
    const out = await wait(timeoutMs);
    failed = false;
    return out;
  } finally {
    record("ceiling", id, Date.now() - started, timeoutMs, undefined, {
      ...opts,
      detail: `${opts.detail ? `${opts.detail}; ` : ""}${failed ? "the wait failed" : "the wait passed"}`,
    });
  }
}

/** A declared negative observation window; the one sanctioned fixed sleep. */
export async function observeFor(
  id: string,
  ms: number,
  reason: string,
): Promise<void> {
  console.log(`[observe] ${id}: ${ms} ms — ${reason}`);
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
