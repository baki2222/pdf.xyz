import { readFileSync } from "node:fs";
import { expect, onTestFinished } from "vitest";
import {
  timeBoundLine,
  witnessNameProblem,
  type TimeBound,
  type TimeBoundKind,
  type TimeBoundMode,
} from "./time-bound-core";
import { WALL_CLOCK_PENDING } from "./wall-clock-pending";
import { scanSource } from "./wall-clock-detector";

/**
 * The one way a vitest test compares a wall-clock time against a bound.
 *
 * Each call, in this order (CLAUDE.md rule 3 — the ORDER does the work):
 *
 *  1. checks its inputs are healthy: finite, non-negative, and for a ratio a
 *     denominator above zero — a dead control reads as ratio 0, the
 *     strongest possible pass for the wrong reason;
 *  2. builds the record and registers it on the test's meta with
 *     `onTestFinished`, so it reaches the reporter (`timeout-headroom.ts`)
 *     when the test passes AND when it fails — the run that most needs the
 *     number is the red one. Outside a test this throws, before printing;
 *  3. prints its `[time-bound]` line — after registering, so every printed
 *     line has a record, which is what the reporter's pipe check counts;
 *  4. only then asserts, unless the mode is "measure".
 *
 * `time-bound-chain.test.ts` checks the whole path through a child vitest,
 * the failing bound included, and that deleting step 2's registration is
 * reported as a broken pipe.
 *
 * `id` is a string literal at the call site; the guard
 * (`wall-clock-bounds.test.ts`) holds it to that, and holds every
 * assert-mode call to a CI calibration (`time-bounds.calibration.json`).
 * Per-instance data goes in `instance`.
 *
 * Measure mode records and never fails. It needs a `witness` — the subject
 * of a speed-independent equality or size `expect` in the same test, which
 * the guard finds, and never a name that reads as a time (refused here too)
 * — or an entry in `wall-clock-pending.ts`; otherwise it would be a switch
 * that turns a detector off (critic P6).
 */

declare module "vitest" {
  interface TaskMeta {
    timeBounds?: TimeBound[];
    waits?: import("./time-bound-core").WaitRecord[];
  }
}

export interface TimeBoundOptions {
  instance?: string;
  detail?: string;
  mode?: TimeBoundMode;
  /** Measure mode: the subject of the speed-independent `expect` in this test. */
  witness?: string;
}

/** The first stack frame outside this module: the call site's line. */
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

const hashes = new Map<string, Map<string, string>>();

/**
 * The body hash of the routed call `id` in `file`, as the guard computes it,
 * read from the file the test RAN from (cached per file). Undefined when the
 * file cannot be read or holds no routed call with that id.
 */
export function routedBodyHash(file: string, id: string): string | undefined {
  if (!file) return undefined;
  if (!hashes.has(file)) {
    const byId = new Map<string, string>();
    try {
      for (const r of scanSource(readFileSync(file, "utf8"), file).routed)
        if (r.id) byId.set(r.id, r.bodyHash);
    } catch {
      // Unreadable: no hash, so the harvest skips the record.
    }
    hashes.set(file, byId);
  }
  return hashes.get(file)!.get(id);
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
  for (const [what, v] of [
    ["measured", measured],
    ["bound", bound],
    ...(control === undefined ? [] : [["control", control] as const]),
  ] as const)
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0)
      throw new Error(
        `${named}: ${what} is ${String(v)}, not a finite time >= 0 — the measurement itself is broken`,
      );
  if (kind === "ratio" && !(control! > 0))
    throw new Error(
      `${named}: the ratio's control measured ${control}, so any ratio would pass — the control did no work`,
    );
  if (mode === "measure" && !WALL_CLOCK_PENDING.some((p) => p.id === id)) {
    if (!opts.witness)
      throw new Error(
        `${named}: measure mode records and never fails, so it needs a witness (a speed-independent expect in this test) or an entry in src/tests/wall-clock-pending.ts`,
      );
    const problem = witnessNameProblem(opts.witness);
    if (problem) throw new Error(`${named}: ${problem}`);
  }
  // File and test are filled HERE, before the line is printed: the log is
  // what the harvest reads, and on f8d48720 every printed vitest record
  // carried file "" (they were filled only later, for the meta).
  const state = expect.getState();
  const file = state.testPath ?? "";
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
    file,
    test: state.currentTestName ?? "",
    line: callSiteLine(),
  };
  const bodyHash = routedBodyHash(file, id);
  if (bodyHash) rec.bodyHash = bodyHash;
  // Registered BEFORE the assertion below, so a failing bound still carries
  // its measurement to the reporter.
  try {
    onTestFinished(({ task }) => {
      rec.file ||= task.file?.filepath ?? "";
      rec.test ||= task.name;
      (task.meta.timeBounds ??= []).push(rec);
    });
  } catch (cause) {
    throw new Error(
      `${named}: call inside a test, not in a hook or at module scope`,
      { cause },
    );
  }
  console.log(timeBoundLine(rec));
  return rec;
}

/** `ms` must stay under `boundMs`. */
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

/** `numerator / denominator` must stay under `bound`; both in one unit, measured on one machine in one run. */
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

/** `ms` must be at least `minMs`: a planted control, or "the timer really waited". */
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

/** Records and prints against a proposed bound; never asserts. */
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
 * A declared negative observation window: "nothing happens for `ms`". The
 * one sanctioned fixed sleep (the guard's sleep family counts every other
 * one), logged so its cost is visible in every run.
 */
export async function observeFor(
  id: string,
  ms: number,
  reason: string,
): Promise<void> {
  console.log(`[observe] ${id}: ${ms} ms — ${reason}`);
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
