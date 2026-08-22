/**
 * Claims that a follow-up avoids sending the document again.
 *
 * NOTE these are phrased as negations on purpose, and this rule deliberately
 * does NOT use `marketing-honesty`'s denial classifier. There, the offence was a
 * promise and a negation made it innocent. Here the offence IS the negation —
 * running it through a "skip anything negated" filter would skip every single
 * one. Same repository, opposite polarity; a shared helper applied without
 * thinking would have emptied this guard on day one.
 *
 * ── WHY THIS LIVES IN A MODULE AND NOT IN THE TEST THAT USES IT ─────────────
 *
 * It used to be `export const FORBIDDEN` inside `transmission-honesty.test.ts`,
 * and `guard-wrap-controls.test.ts` imported it from there. One test file
 * statically importing another is fine with per-file isolation and is a trap
 * without it. `vitest.config.ts` runs `isolate: false`, so the module cache is
 * shared: whichever of the two files runs first EVALUATES
 * `transmission-honesty.test.ts` as a plain import — its `describe()` blocks
 * register against the wrong collector — and when vitest later runs that file
 * on its own the import is a cache hit, nothing re-registers, and the run dies
 * with
 *
 *     Error: No test suite found in file …/transmission-honesty.test.ts
 *
 * Order-dependent, so it is intermittent: seen in 2 of 7 local full runs, and
 * reproducible on demand with just the two files —
 *
 *     npx vitest run --no-file-parallelism --sequence.shuffle.files \
 *       --sequence.seed=2 src/lib/tools/guard-wrap-controls.test.ts \
 *       src/lib/tools/transmission-honesty.test.ts
 *
 * Same family as `src/tests/mock-isolation.test.ts` — a module evaluated under
 * one file's regime stays cached for the next — but one hop over, with no mock
 * involved, which is why that guard's corpus never saw it. It does now.
 */
export const FORBIDDEN = [
  /does\s?n'?t resend/i,
  /does not resend/i,
  /without resending/i,
  /never resent/i,
  /is not sent again/i,
  /only sent once/i,
  /sent (?:just |only )?once/i,
  /no need to resend/i,
];
