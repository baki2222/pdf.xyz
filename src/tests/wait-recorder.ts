import { configure, getConfig } from "@testing-library/react";
import type { WaitRecord } from "./time-bound-core";

/**
 * Times every testing-library wait (`findBy*`, `findAllBy*`, `waitFor`,
 * `waitForElementToBeRemoved`) and hands the records to the test's meta, so
 * `TimeoutHeadroomReporter` can list the waits that came close to their
 * timeout (the audit's class c: 1,023 waits on the 1 s default, 439 with a
 * timeout of their own).
 *
 * How: every one of those goes through testing-library's
 * `getConfig().asyncWrapper`, synchronously from the test's own call, so a
 * wrapper around it sees the call site on the stack and the elapsed time of
 * the whole wait. The reporter reads the call site's own `timeout:` from
 * source and compares against THAT (critic P6) — the wrapper cannot see
 * per-call options.
 *
 * Recorded in a `finally`, so a wait that times out is recorded too (CLAUDE.md
 * rule 3: the failure path carries the measurement).
 *
 * Under `isolate: false`, `setup.ts` runs once per FILE in one realm, so the
 * wrapper is marked and installed once; the buffer lives on `globalThis` for
 * the same reason, and each file's `afterEach` drains it into its test.
 *
 * Not covered: `vi.waitFor` and `expect.poll`, which do not go through
 * testing-library. The guard's sleep and deadline rules see those sites.
 */

const MARK = Symbol.for("pdfxyz.waitRecorder");
const BUFFER = Symbol.for("pdfxyz.waitRecords");

type Wrapper = ((cb: () => Promise<unknown>) => Promise<unknown>) & {
  [MARK]?: true;
};

function buffer(): WaitRecord[] {
  const g = globalThis as unknown as Record<symbol, WaitRecord[] | undefined>;
  return (g[BUFFER] ??= []);
}

/** The first frame in a test file, or under src/tests or e2e, that is not this machinery. */
export function waitCallSite(
  stack: string,
): { file: string; line: number; column: number } | null {
  for (const frame of stack.split("\n").slice(1)) {
    const m = /\(?((?:[A-Za-z]:)?[^():]+):(\d+):(\d+)\)?\s*$/.exec(
      frame.trim(),
    );
    if (!m) continue;
    const file = m[1]!.replace(/^file:\/\/\/?/, "").replace(/\\/g, "/");
    if (/node_modules|wait-recorder\.ts|\/setup\.ts$/.test(file)) continue;
    if (
      /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) ||
      /\/src\/tests\//.test(file) ||
      /\/e2e\//.test(file)
    )
      return { file, line: Number(m[2]), column: Number(m[3]) };
  }
  return null;
}

/** Wraps testing-library's asyncWrapper once per realm; returns whether it installed. */
export function installWaitRecorder(): boolean {
  const inner = getConfig().asyncWrapper as Wrapper;
  if (inner[MARK]) return false;
  const wrapper: Wrapper = async (cb) => {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 40;
    const stack = new Error().stack ?? "";
    Error.stackTraceLimit = limit;
    const site = waitCallSite(stack);
    const defaultTimeoutMs = getConfig().asyncUtilTimeout;
    const started = performance.now();
    let timedOut = true;
    try {
      const out = await inner(cb);
      timedOut = false;
      return out;
    } finally {
      if (site)
        buffer().push({
          ms: performance.now() - started,
          ...site,
          defaultTimeoutMs,
          timedOut,
        });
    }
  };
  wrapper[MARK] = true;
  configure({ asyncWrapper: wrapper });
  return true;
}

/** The records since the last drain (one test's worth, from `afterEach`). */
export function drainWaitRecords(): WaitRecord[] {
  return buffer().splice(0);
}
