/**
 * testing-library's default wait (`findBy*`, `waitFor` without a `timeout`),
 * set once for every test file by `./setup.ts`. Phase 0b of the wall-clock
 * flake programme (`.claude/ci-flake-audit-design-2026-11-19.md` §3).
 *
 * The rule, fixed before the data was read: twice the CI maximum of the
 * waits that still use the default, clamped to `ASYNC_UTIL_TIMEOUT_RANGE`.
 *
 * The data (2026-11-28), from CI's "wait headroom" block. That block lists
 * every wait past half its timeout plus the worst five, so no slow wait can
 * hide below it. Two sources:
 * - all 9 main runs since the recorder landed (#390): 44931945692 to
 *   46131553554, the last one on 8f379e1a itself (its worst default wait,
 *   worker-job.test.tsx:420 again, took 804 ms). The 9th was missed in
 *   the first count and found in review;
 * - the 3 failed attempts in the same window: 44946891961/1, 44941026100/1
 *   and 44938151052/1.
 *
 * The slowest default wait whose site still uses the default on main
 * 8f379e1a is `worker-job.test.tsx:420`, at 853 ms (run 44960461235).
 * 2 x 853 = 1706, which is under the floor, so the value is 2000.
 *
 * Excluded because the lanes gave them their own timeouts:
 * - sign-runner's two decode waits (up to 2109 ms against the 1000 ms
 *   default, on 44938151052/1), now `WAIT_MS` and `ENCODE_MS`;
 * - `sign-restricted.test.tsx:183` (864 ms);
 * - `table-extract-worker-panel.test.tsx:910` (820 ms).
 * In every passing attempt the only wait that timed out was
 * drop-sheets-live's, and that one runs out its own 4000 ms on purpose. So
 * no passing test uses a default wait as a timed absence check: raising the
 * default changes only waits that fail.
 *
 * What it does NOT reach:
 * - `vi.waitFor`, which keeps its own 1000 ms default;
 * - vitest's `expect.poll`.
 * The recorder stores each wait's own default: `getConfig().asyncUtilTimeout`
 * for testing-library, 1000 for vi.waitFor. The report judges every wait
 * against the default it ran under, and its headline names the two
 * defaults apart. It once printed the first record's default for both, so
 * the line changed with test order; that was found in review, and is now
 * pinned in time-bound.test.ts and time-bound-chain.test.ts. The report's
 * worst-five list stays printed, so creep stays visible.
 */
export const ASYNC_UTIL_TIMEOUT_MS = 2000;

/**
 * The floor: twice the 1000 ms library default.
 * The ceiling: 1 s under vitest's 5 s test timeout. A wait that fails must
 * still report its own message and DOM dump, not "Test timed out", and
 * `async-util-timeout.test.ts` checks that by letting one fail.
 */
export const ASYNC_UTIL_TIMEOUT_RANGE = [2000, 4000] as const;

/** @testing-library/dom 10's own default, for the "it really applied" control. */
export const LIBRARY_DEFAULT_ASYNC_UTIL_TIMEOUT_MS = 1000;
