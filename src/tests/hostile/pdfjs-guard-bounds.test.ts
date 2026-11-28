import { describe, expect, test } from "vitest";
import {
  MAX_DECODED_TOTAL_BYTES,
  PDF_EXPANDS_TOO_FAR_MESSAGE,
  PDF_IMAGE_TOO_LARGE_MESSAGE,
  PDF_NESTED_TOO_DEEPLY_MESSAGE,
} from "@/lib/pdf/pdfjs-guard";
import { UNREADABLE_PDF_MESSAGE } from "@/lib/pdf/engine-errors";
import { runBounded, type BoundedOutcome } from "./bounded";
import { expectFasterThan, expectRatioBelow, measureTime } from "../time-bound";

// The hostile matrix's resource findings on pdf.js consumers, each run at the
// entry point a tool calls (extractPdfText, rasterizePdf) in a child process
// with a hard kill: before the fix STAMP-14 ran for 493 s, and CO-06 inflated
// 1 GiB, which no in-process timeout can interrupt.
/**
 * What one hostile case may ADD to the child's resident memory, MB, read by
 * ./memory.ts after pdf.js and the canvas are warmed on a clean file (see
 * `warm` in ./pdfjs-guard.child.ts). The unfixed cases inflated 1.2-3.6 GB;
 * measured after the fix, on Linux / Node 22: 10-11 MB.
 *
 * WAS an absolute `maxRssMb < 900`, which counted pdf.js's own load (about
 * 500 MB on Linux) against the file. It read 933 on CI for PR #299 with
 * nothing wrong.
 */
const GROWTH_MB = 300;
const CHILD = "src/tests/hostile/pdfjs-guard.child.ts";

/**
 * The time bound on an `open:<file>:<reader>` refusal (lane res1), against a
 * yardstick measured in the same child just before the read
 * (./yardstick.ts): inflate Flate and look at every byte once, scaled to
 * MAX_DECODED_TOTAL_BYTES. That is the irreducible work of a preflight that
 * stops at its budget, so the bound reads "the refusal costs at most
 * BUDGET_READS_ALLOWED budget-reads on this machine, now".
 *
 * History (2026-11-15). The bound WAS `growth.ms < 30_000`. The object-stream
 * bomb's preflight (JS scanners over 1.6 GB of inflate, plus zlib) took
 * 7.8-8.1 s on a quiet Windows box and up to 3.7x that on CI: main at
 * 1e73d632 (run 43629904891) failed it at 30,179 ms through viewer-render,
 * with nothing wrong, and the access probe's identical region was estimated
 * at 0.90 of the bound on the slowest run seen. The comment's "2.5-4 s
 * (measured 2026-11-09)" was already stale. The constant could not tell a
 * loaded runner from a slow preflight; the yardstick, on the same runner at
 * the same moment, can.
 *
 * Measured 2026-11-15 (Windows, Node 24, a busy box): the bomb's refusal
 * 1.69-2.16 budget-reads through every reader and the access probe, the
 * other files under 0.02. Mutations, run through these tests: the object
 * scanners fed every chunk 8 times read 4.49-4.89 and failed all six; 4
 * times read 2.86-3.14 and passed, which is this bound's resolution (the
 * old 30 s constant passed both, at 13 s and 21 s). A reader that stopped
 * refusing (the defect lane res1 fixed) is caught by the typed-error
 * assertion beside this one.
 *
 * History (2026-11-16): best of two. Linux CI, 25 recent runs of the
 * `[time-bound] objstm-bomb via ...` lines: honest reads 1.5-2.2, with
 * outliers at 3.26 (run 43820825827, count-pages) and 3.68 (run
 * 43804932617, viewer-render: a red with nothing wrong). A single sample
 * cannot tell a guard that is slow from a runner that stalled for a moment;
 * a second sample can, because a stall does not repeat on demand and a slow
 * guard does. So a first measurement over either bound re-runs the same
 * refusal ONCE in a fresh child with its own yardstick (and its own
 * typed-error assertion), and the lower ratio is judged; both are printed.
 * The bound itself is unchanged, 3.5 and 60 s. Resolution kept, mutation
 * re-run 2026-11-16 (Windows, Node 24): the object scanners fed every chunk
 * 8 times failed all six again, every attempt over the bound (first and
 * re-run 4.18-5.18, judged 4.12-4.85). Best of two buys the mutant a little
 * (judged minimum 4.12 against a single-sample 4.49), so the 4x mutant
 * (2.86-3.14) stays the resolution limit and passes, as before. The
 * re-run path itself was forced live by lowering the bound to 1.0 on a
 * copy: objstm-bomb via access read 1.88, re-ran, read 1.66, judged 1.66.
 *
 * History (2026-11-22, CI-flake audit lane 2): 3.5 had 1.14x over CI. 144
 * objstm-bomb samples from 24 CI logs read median 1.44, max 3.08
 * (44386549494, auto-crop; 2.90 access in the same run, a whole-run shift
 * best of two cannot absorb), and the ratio RISES as the yardstick gets
 * faster (fit: refusal = 7,307 ms + 0.921 x budget-read). The attempts of
 * 2026-11-21 read 1.09-1.84 (44917160721, 44924793701).
 *
 * 6.5 was set from 3.08 and was 1.77x over the real CI max (review,
 * 2026-11-22): that harvest read `gh run view <id> --log`, which returns
 * only a run's LATEST attempt, so every failed first attempt that a re-run
 * turned green was dropped (rule 4). The failed attempts read 3.68
 * (43804932617 attempt 1, viewer-render, the red cited above) and 3.16
 * (44465012923 attempt 1, access). Now 7.5, 2.04x over 3.68.
 *
 * What that costs, measured (Windows, so a shape, not a bound): the object
 * scanners fed every chunk 8 times read 4.76-4.79 budget-reads against an
 * honest 1.60-1.83, so a 2.6-3x slowdown of the refusal is GREEN on time.
 * The work count beside this bound (`expectBombScannedOnce`) is what
 * catches that mutant: each scanner counts the bytes it is fed inside its
 * own `feed`, so a caller that hands a chunk over k times reads k.0 against
 * an honest 1.0 on any runner. Neither sees extra work INSIDE one scanner
 * for bytes it was fed once; this ratio is the only check on that, and it
 * fires from about 4.5x the honest median, not 2.4x.
 */
const BUDGET_READS_ALLOWED = 7.5;
/**
 * And an absolute ceiling beside it, under the open's kill, so a preflight
 * that crawls is reported with its number rather than as a hang, even if
 * the yardstick were slow for the same reason. WAS 60,000 under a 90 s
 * kill: CI's refusal reached 27,826 ms (44299285879, auto-crop) and
 * 30,179 ms before best of two (43629904891), about 2x. Now 100,000 (3.3x
 * over 30,179, the failed attempt; 3.6x over the passing 27,826) under a 150 s kill ({@link OPEN_KILL_MS}): the child spends
 * up to 15.8 s outside the refusal (43998624497), so the ceiling still
 * reports before the kill.
 */
const REFUSAL_CEILING_MS = 100_000;
/**
 * The kill on an `open:<file>:<reader>` child. WAS 90,000: the objstm-bomb
 * child reached about 44,678 ms on CI (43998624497, auto-crop), 2.01x.
 * 150,000 is 3.4x.
 */
const OPEN_KILL_MS = 150_000;

/**
 * A first attempt killed at its bound is run ONCE more (CI-flake audit lane
 * 2, L631/L863): best of two re-ran a slow refusal but not a child that a
 * stalled runner pushed past its kill, which failed `settled()` at once. A
 * real hang hangs twice and is still red, with the bound it exceeded; only
 * a one-off stall is absorbed, as best of two already absorbs one. Pure,
 * so the selection is tested below with fixed outcomes.
 */
async function rerunOnHang(
  attempt: () => Promise<BoundedOutcome>,
): Promise<{ attempts: number; outcome: BoundedOutcome }> {
  const first = await attempt();
  if (first.kind !== "hang") return { attempts: 1, outcome: first };
  return { attempts: 2, outcome: await attempt() };
}

/**
 * The most `files` refusals can take before every kill has fired: each is
 * an {@link openChild} (up to two kills) and, through best of two, a second
 * {@link openChild} (two more). A test's timeout is built from this, so it
 * moves with {@link OPEN_KILL_MS} instead of going stale beside it.
 */
const OPENS_KILL_BUDGET_MS = (files: number) => files * 4 * OPEN_KILL_MS;

/** One `open:` child, its kill and its single re-run on a hang. */
async function openChild(arg: string): Promise<BoundedOutcome> {
  const { attempts, outcome } = await rerunOnHang(() =>
    runBounded(CHILD, [arg], OPEN_KILL_MS, { maxOldSpaceMb: 1024 }),
  );
  if (attempts > 1)
    console.log(
      `[kill-headroom] ${arg}: the first attempt was killed at ${OPEN_KILL_MS} ms; re-run once`,
    );
  return outcome;
}

/**
 * The object-stream bomb's refusal, as work (CI-flake audit lane 2, L156):
 * the bytes the preflight inflated before it stopped, and the bytes each
 * object scanner (`refs`, `contents`, `kids`) was fed, counted inside the
 * scanner's own `feed` (`pdfjsScanWork`) around the reader alone. The bomb
 * is all object streams, so an honest refusal feeds each scanner each
 * inflated byte once; a chunk handed over k times reads k.0 on any runner,
 * wherever the extra call is made (review 2026-11-22: a count taken at the
 * call site missed a mutant that looped the three calls below it, 4.76
 * budget-reads and green). Health: it inflated the whole budget (a counter
 * in another module instance would read 0), and every scanner was fed at
 * least most of it (a scanner nobody feeds would read 0, the strongest pass).
 */
function expectBombScannedOnce(v: Record<string, unknown>, said: string) {
  const { work } = v.growth as {
    work: { inflated: number; refs: number; contents: number; kids: number };
  };
  const detail = `${said}: inflated ${work.inflated}, fed refs ${work.refs}, contents ${work.contents}, kids ${work.kids} (budget ${MAX_DECODED_TOTAL_BYTES})`;
  console.log(`[scan-work] ${detail}`);
  expect(work.inflated, detail).toBeGreaterThanOrEqual(
    0.9 * MAX_DECODED_TOTAL_BYTES,
  );
  expect(work.inflated, detail).toBeLessThanOrEqual(
    MAX_DECODED_TOTAL_BYTES + 2 ** 20,
  );
  for (const scanner of ["refs", "contents", "kids"] as const) {
    expect(
      work[scanner] / work.inflated,
      `${scanner}: ${detail}`,
    ).toBeGreaterThanOrEqual(0.9);
    expect(
      work[scanner] / work.inflated,
      `${scanner}: ${detail}`,
    ).toBeLessThanOrEqual(1.25);
  }
}

/** One timed refusal, read against its own child's yardstick. */
interface TimedRefusal {
  ms: number;
  reads: number;
  budgetReadMs: number;
}
function timedRefusal(v: Record<string, unknown>, said: string): TimedRefusal {
  const { ms, yardstick } = v.growth as {
    ms: number;
    yardstick: { msPerMiB: number; sampleMiB: number; reps: number[] };
  };
  // Health check: a yardstick that measured nothing would pass every bound.
  expect(yardstick.reps, said).toHaveLength(3);
  expect(yardstick.msPerMiB, said).toBeGreaterThan(0);
  const budgetReadMs =
    yardstick.msPerMiB * (MAX_DECODED_TOTAL_BYTES / (1024 * 1024));
  return { ms, reads: ms / budgetReadMs, budgetReadMs };
}
function withinTimeBounds(t: TimedRefusal): boolean {
  return t.reads < BUDGET_READS_ALLOWED && t.ms < REFUSAL_CEILING_MS;
}
function describeTimed(t: TimedRefusal): string {
  return `${t.ms} ms = ${t.reads.toFixed(2)} budget-reads of ${Math.round(t.budgetReadMs)} ms`;
}

/**
 * Best of two (2026-11-16). The first measurement is judged alone when it is
 * inside both bounds. When it is not, the SAME refusal runs once more in a
 * fresh child, with its own yardstick, and the LOWER ratio is judged; both
 * are returned so both get printed. Kept pure (no child, no
 * expect) so the selection itself is tested below with fixed numbers.
 */
async function bestOfTwo(
  first: TimedRefusal,
  again: () => Promise<TimedRefusal>,
): Promise<{ attempts: TimedRefusal[]; judged: TimedRefusal }> {
  if (withinTimeBounds(first)) return { attempts: [first], judged: first };
  const second = await again();
  // Prefer an attempt inside BOTH bounds (review, 2026-11-16): judging by
  // ratio alone threw away a clean re-run whenever the first attempt broke
  // only the absolute ceiling (a stalled child, yardstick included) and the
  // re-run's ratio was a hair higher. Neither attempt clean: the lower ratio.
  const judged = withinTimeBounds(second)
    ? second
    : withinTimeBounds(first)
      ? first
      : second.reads < first.reads
        ? second
        : first;
  return { attempts: [first, second], judged };
}

/**
 * `rerun` repeats the same refusal in a fresh child and must itself assert
 * the typed refusal (the caller's typed-error assertion, again), so a second
 * attempt that was fast because it stopped refusing can never be the one
 * judged.
 */
async function expectRefusedInBudgetTime(
  v: Record<string, unknown>,
  said: string,
  rerun: () => Promise<Record<string, unknown>>,
) {
  const { attempts, judged } = await bestOfTwo(
    timedRefusal(v, said),
    async () => timedRefusal(await rerun(), `${said} (re-run)`),
  );
  const detail =
    attempts.length === 1
      ? `${said}: ${describeTimed(judged)}`
      : `${said}: ${describeTimed(judged)} (lower of ${attempts.length}: ${attempts.map(describeTimed).join(" | ")})`;
  // Printed and recorded on a pass too (src/tests/time-bound.ts): CI logs
  // showed this region only on a failure, so the spread the bound was set
  // from could not be read back. A re-run prints both attempts (`detail`),
  // so the outlier it absorbed stays visible. `reads` is ms / budgetReadMs,
  // so the ratio below is the same comparison as before.
  expectRatioBelow(
    "pdfjs-guard-refusal-budget-reads",
    judged.ms,
    judged.budgetReadMs,
    BUDGET_READS_ALLOWED,
    { instance: said, detail },
  );
  expectFasterThan(
    "pdfjs-guard-refusal-ceiling",
    judged.ms,
    REFUSAL_CEILING_MS,
    { instance: said, detail },
  );
}

describe("the res1 time bound's best of two", () => {
  // Positive and negative controls for the selection, with fixed numbers:
  // a live forcing of the path is in the commit that added it (2026-11-16).
  const t = (reads: number, ms = 10_000): TimedRefusal => ({
    ms,
    reads,
    budgetReadMs: ms / reads,
  });
  test("a first measurement inside the bound is judged alone, with no re-run", async () => {
    let reruns = 0;
    const r = await bestOfTwo(t(2.0), async () => {
      reruns++;
      return t(1.0);
    });
    expect(reruns).toBe(0);
    expect(r.attempts).toHaveLength(1);
    expect(r.judged.reads).toBe(2.0);
  });
  // The fixed numbers follow the bound (2026-11-22: 3.5 -> 6.5 -> 7.5).
  // These two read 3.68 (the red of run 43804932617) and 4.89/4.49 (the 8x
  // re-feed mutant on Windows) against 3.5; inverted to the same shapes
  // above the bound, now 7.8 and 8.9/8.4. The 8x re-feed mutant itself now
  // reads 4.76 on time, inside 7.5: it is caught by the work count
  // (expectBombScannedOnce), not by this bound.
  test("an outlier re-runs once and the lower ratio is judged", async () => {
    let reruns = 0;
    const r = await bestOfTwo(t(7.8), async () => {
      reruns++;
      return t(1.9);
    });
    expect(reruns).toBe(1);
    expect(r.attempts.map((a) => a.reads)).toEqual([7.8, 1.9]);
    expect(r.judged.reads).toBe(1.9);
    expect(withinTimeBounds(r.judged)).toBe(true);
  });
  test("a slow guard is slow twice and still fails", async () => {
    const r = await bestOfTwo(t(8.9), async () => t(8.4));
    expect(r.judged.reads).toBe(8.4);
    expect(withinTimeBounds(r.judged)).toBe(false);
  });
  test("a first attempt over the absolute ceiling alone also re-runs, and a clean re-run is the one judged", async () => {
    let reruns = 0;
    const r = await bestOfTwo(t(1.0, REFUSAL_CEILING_MS + 1), async () => {
      reruns++;
      // A hair HIGHER ratio than the stalled first attempt, but inside both
      // bounds: ratio-only selection would have judged the first and failed.
      return t(1.1);
    });
    expect(reruns).toBe(1);
    expect(withinTimeBounds(r.judged)).toBe(true);
  });

  test("a first attempt killed at its bound is re-run once; a settled one is not; a hang twice stays a hang", async () => {
    const outcomes = (...kinds: BoundedOutcome["kind"][]) => {
      const queue = kinds.map((kind): BoundedOutcome =>
        kind === "settled"
          ? { kind, value: {}, ms: 1 }
          : { kind, message: "", ms: 1 },
      );
      let calls = 0;
      return {
        attempt: async () => {
          calls += 1;
          return queue.shift()!;
        },
        calls: () => calls,
      };
    };
    const settledFirst = outcomes("settled", "settled");
    const a = await rerunOnHang(settledFirst.attempt);
    expect([a.attempts, a.outcome.kind, settledFirst.calls()]).toEqual([
      1,
      "settled",
      1,
    ]);
    const stalled = outcomes("hang", "settled");
    const b = await rerunOnHang(stalled.attempt);
    expect([b.attempts, b.outcome.kind, stalled.calls()]).toEqual([
      2,
      "settled",
      2,
    ]);
    const hung = outcomes("hang", "hang", "settled");
    const c = await rerunOnHang(hung.attempt);
    expect([c.attempts, c.outcome.kind, hung.calls()]).toEqual([2, "hang", 2]);
    // A crash is never re-run: only the kill is the runner's to absorb.
    const crashed = outcomes("internal", "settled");
    const d = await rerunOnHang(crashed.attempt);
    expect([d.attempts, d.outcome.kind]).toEqual([1, "internal"]);
  });

  test("negative control: both attempts over the ceiling still fail", async () => {
    const r = await bestOfTwo(t(1.0, REFUSAL_CEILING_MS + 1), async () =>
      t(1.0, REFUSAL_CEILING_MS + 2),
    );
    expect(withinTimeBounds(r.judged)).toBe(false);
  });
});

/** The value a settled child reported; fails loudly on a hang or crash. */
function settled(r: BoundedOutcome): Record<string, unknown> {
  expect(r, JSON.stringify(r)).toMatchObject({ kind: "settled" });
  return (r as { value: Record<string, unknown> }).value;
}

describe("pdf.js consumers stay bounded on hostile streams", () => {
  test("CO-06: a 2.5 KB chained-Flate content bomb is refused, typed, without inflating 1 GiB", async () => {
    const v = settled(
      await runBounded(CHILD, ["co06-text"], 60_000, { maxOldSpaceMb: 1024 }),
    );
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_EXPANDS_TOO_FAR_MESSAGE,
    });
    // Second, independent bound: the process never held the gigabyte. The
    // unfixed run peaked at 1.2-3.6 GB; the refusal streams and keeps nothing.
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 90_000);

  test("CO-06 positive control: the same reader on a plain file reads its text", async () => {
    const v = settled(await runBounded(CHILD, ["co06-control-text"], 60_000));
    expect(v).toMatchObject({ ok: true, pageCount: 1 });
    expect(v.text).toContain("HOSTILE MARKER");
  }, 90_000);

  test("STAMP-14: 100,000 unclosed q is refused in seconds, not read for 8 minutes", async () => {
    const v = settled(await runBounded(CHILD, ["stamp14-text"], 30_000));
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_NESTED_TOO_DEEPLY_MESSAGE,
    });
  }, 60_000);

  test("STAMP-14 boundary: nesting exactly MAX_GRAPHICS_STATE_DEPTH still reads", async () => {
    // Positive controls: content AT the bound must be read, not refused, so
    // they get time. Measured 2026-11-09: 2.6-3.2 s on Windows / Node 24,
    // 17 s (this one) and 25 s (the work control) on Linux / Node 22 in the
    // worker image. CI runs Node 22 under load, where 30 s was a "hang".
    const v = settled(
      await runBounded(CHILD, ["stamp14-at-bound-text"], 120_000),
    );
    expect(v).toMatchObject({ ok: true, pageCount: 1 });
    expect(v.text).toContain("Hostile control");
  }, 150_000);

  test("STAMP-14, split: one page of 32 streams x 1,020 unclosed q (32,640 deep) is refused, not read for 66 s", async () => {
    const v = settled(await runBounded(CHILD, ["stamp14-split-text"], 30_000));
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_NESTED_TOO_DEEPLY_MESSAGE,
    });
  }, 60_000);

  test("STAMP-14 control: one stream 5,000 deep (1.45-1.55 s on base) still reads", async () => {
    const v = settled(await runBounded(CHILD, ["stamp14-5k-text"], 30_000));
    expect(v).toMatchObject({ ok: true, pageCount: 1 });
    expect(v.text).toContain("END");
  }, 60_000);

  test("STAMP-14, work: one form 16,000 deep painted 30 times (157 s on the first repair) is refused in seconds", async () => {
    // History: the first repair bounded DEPTH only. This page never goes past
    // 16,000, so it passed, and pdf.js climbed the nest 30 times.
    const v = settled(
      await runBounded(CHILD, ["stamp14-form-repeat-text"], 30_000),
    );
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_NESTED_TOO_DEEPLY_MESSAGE,
    });
  }, 60_000);

  test("STAMP-14, work control: the same form painted once still reads", async () => {
    // See the boundary control above for the measured times (25 s here on
    // Linux / Node 22).
    const v = settled(
      await runBounded(CHILD, ["stamp14-form-once-text"], 120_000),
    );
    expect(v).toMatchObject({ ok: true, pageCount: 1 });
    expect(v.text).toContain("MARK");
  }, 150_000);

  test("CO-08: a 100 MP image whose /Width is an indirect reference is refused like a direct one", async () => {
    // History: the scan read `/Width 7 0 R` as no width (0 pixels) and pdf.js
    // resolved it and decoded the whole image: 29.8 s, 1.5 GB.
    const v = settled(
      await runBounded(CHILD, ["co08-indirect-width-raster"], 20_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_IMAGE_TOO_LARGE_MESSAGE,
    });
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 60_000);

  test("the scan is linear: 4.5 MB of `>>stream` with no `<<` is scanned in seconds, not 18 s", async () => {
    // History: each keyword walked back 64 KB looking for `<<`, synchronously,
    // in the tab's own thread (the preflight runs before pdf.js's worker).
    const v = settled(
      await runBounded(CHILD, ["scan-unmatched-dict-preflight"], 20_000),
    );
    expect(v).toMatchObject({ ok: true, bytes: 4_500_015 });
    // Kept as an assertion (CI-flake audit lane 2): on the fastest box the
    // 64 KB walk-back takes 18 s, under the 20 s kill, so this bound is
    // what catches it there. CI's estimated preflightMs is about 0.5-1.2 s
    // (test max 3,759 ms in 43636213581, child start-up included), and it
    // is now printed on every pass. The input's length was named as its
    // witness once; it cannot change, so a quarter-window walk-back passed
    // it (witness audit, 2026-11-22). Pending (wall-clock-pending.ts): the
    // raw bound below is what fails.
    measureTime(
      "pdfjs-guard-scan-unmatched-dict",
      v.preflightMs as number,
      3_000,
      {},
    );
    expect(v.preflightMs as number).toBeLessThan(3_000);
  }, 60_000);

  test("the scan is linear: 4 MB of `<</Length 0>>stream` with no endstream is scanned in seconds", async () => {
    // History: each keyword searched forward to the end of the file for an
    // `endstream` that is not there: 400 KB took 7.5 s, 1.6 MB did not finish
    // in 2 minutes.
    const v = settled(
      await runBounded(CHILD, ["scan-no-endstream-preflight"], 20_000),
    );
    expect(v).toMatchObject({ ok: true, bytes: 1_000_015 });
    // 2026-11-22 (CI-flake audit lane 2): 1 MB, where it was 4 MB. CI's
    // 4 MB preflight was about 5.0-5.8 s against this 8 s (test max 9,027
    // ms in 43632313634), 1.4x; at 1 MB a linear scan is about 1.5 s on CI
    // (over 5x), and the forward-to-EOF search is about 47 s on the dev
    // box (7.5 s x 2.5^2): past the 20 s kill on every runner seen. The
    // input's length was named as its witness once; it cannot change, so a
    // capped forward search passed it at 87% of 8 s (witness audit,
    // 2026-11-22). Pending (wall-clock-pending.ts): the raw bound below is
    // what fails.
    measureTime(
      "pdfjs-guard-scan-no-endstream",
      v.preflightMs as number,
      8_000,
      {},
    );
    // The property is LINEAR, seconds and not minutes: the quadratic scan took
    // 7.5 s for 400 KB and did not finish 1.6 MB in 2 minutes. WAS 3,000 ms,
    // which CI went over on PR #306 (3,967 ms) with the scan still linear.
    // Measured 2026-11-09 on one machine, 4 / 8 / 16 MB: main 658 / 1,193 /
    // 2,403 ms, the branch 757 / 1,355 / 2,731 ms (it also reads inline image
    // dictionaries and image references). CI runs about 5x slower than that
    // machine. 8 s keeps a linear scan inside and a quadratic one far out.
    expect(v.preflightMs as number).toBeLessThan(8_000);
  }, 60_000);

  test("CO-08: a 100 MP image is refused by name before pdf.js decodes it", async () => {
    const v = settled(
      await runBounded(CHILD, ["co08-raster"], 30_000, { maxOldSpaceMb: 2048 }),
    );
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_IMAGE_TOO_LARGE_MESSAGE,
    });
    // Second bound: refused before the decode (42 s and 1.5 GB unfixed).
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 60_000);

  test("CO-08 bilevel: a 600-dpi A3 1-bit scan (69.6 MP, 0.38-0.45 s on base) still rasterizes", async () => {
    const v = settled(
      await runBounded(CHILD, ["co08-bilevel-a3-raster"], 60_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v).toMatchObject({ ok: true, pages: 1 });
  }, 90_000);

  test("CO-08 output path: a file whose page 2 holds the 100 MP image is refused by name, even under onPageFailed", async () => {
    // A page written without its image would be a wrong document, and pdf.js
    // 6 cannot say which page skipped one (see preflightPdfjsBytes), so the
    // output paths refuse the file.
    const v = settled(
      await runBounded(CHILD, ["co08-per-page-raster"], 30_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_IMAGE_TOO_LARGE_MESSAGE,
    });
  }, 60_000);

  test("CO-08 previews: both pages get a thumbnail, in seconds; pdf.js skips only the 100 MP image", async () => {
    // History: the first fix refused the whole file at createThumbnailRenderer,
    // and every caller swallows that (`catch {}`), so a file with one huge
    // image silently had no previews at all.
    const v = settled(
      await runBounded(CHILD, ["co08-per-page-thumbs"], 30_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v).toMatchObject({ ok: true, previews: [true, true] });
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 60_000);

  test("CO-08 editor canvas: Edit/Annotate/Sign PDF draw page 1 in seconds, without the 100 MP image, and say so", async () => {
    // History (2026-11-09): `openEditorPdf` ran the preflight but dropped its
    // previewOptions, so the editor decoded the image the thumbnails skip:
    // killed at this bound, where the thumbnails of the same file took
    // seconds. A preview, not an output: the page is drawn without the image
    // and the editor says so in the output paths' own sentence.
    const v = settled(
      await runBounded(CHILD, ["co08-editor-render"], 30_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v).toMatchObject({ ok: true, drawn: true, size: [300, 200] });
    // The image's place is the white sheet: skipped, not decoded.
    expect(v.ink).toEqual([765, 765]);
    expect(v.notice as string).toContain(PDF_IMAGE_TOO_LARGE_MESSAGE);
    // Kept raw (review 2026-11-22): never flaky (test CI max 4,366 ms over
    // 12 runs of 2026-11-18, the render alone less), and white ink is the
    // same however slowly it was reached, so it cannot stand in for this.
    expect(v.renderMs as number).toBeLessThan(10_000);
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 60_000);

  test("CO-08 editor canvas positive control: a 9 MP image is drawn, and nothing is said", async () => {
    const v = settled(
      await runBounded(CHILD, ["co08-control-editor-render"], 60_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v).toMatchObject({ ok: true, drawn: true, size: [300, 200] });
    // The image of zeros, painted: black where the skipped one left white.
    expect(v.ink).toEqual([0, 0]);
    expect(v.notice).toBeNull();
  }, 90_000);

  test("the editor canvas at its deepest zoom on an A0 page stays within MAX_CANVAS_PIXELS at every device ratio", async () => {
    // History (2026-11-09): `cappedPixelRatio` floored the ratio at 0.5, so a
    // page whose CSS area passed 64 MP (A0 at 400%: 228 MP) was allocated
    // past the cap it is named for (57 MP here).
    const { MAX_CANVAS_PIXELS } = await import("@/lib/pdf/editor/page-render");
    const v = settled(
      await runBounded(CHILD, ["editor-zoom-a0"], 60_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    const renders = v.renders as { ratio: number; pixels: number | null }[];
    // Health: three renders, each drawn (a null would pass any bound).
    expect(renders.map((r) => r.ratio)).toEqual([1, 2, 3]);
    for (const r of renders) {
      expect(r.pixels, `ratio ${r.ratio}`).not.toBeNull();
      expect(r.pixels!, `ratio ${r.ratio}`).toBeLessThanOrEqual(
        MAX_CANVAS_PIXELS,
      );
      // And not starved: the cap is reached, not undershot by a factor.
      expect(r.pixels!, `ratio ${r.ratio}`).toBeGreaterThan(
        MAX_CANVAS_PIXELS * 0.99,
      );
    }
  }, 90_000);

  test("an inline 100 MP image: the editor draws page 1 in seconds, without it, and says so", async () => {
    // History (hostile review, 2026-11-09): the scan sized image STREAMS
    // only, so `BI /W 10000 /H 10000 ... ID` passed with no options and the
    // editor decoded it: 32,649 ms on page 1, no notice.
    const v = settled(
      await runBounded(CHILD, ["inline-editor-render"], 30_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v).toMatchObject({ ok: true, drawn: true, size: [300, 200] });
    expect(v.ink).toEqual([765, 765]);
    expect(v.notice as string).toContain(PDF_IMAGE_TOO_LARGE_MESSAGE);
    // Kept raw (review 2026-11-22): never flaky (test CI max 4,690 ms over
    // 12 runs of 2026-11-18, the render alone less), and white ink is the
    // same however slowly it was reached, so it cannot stand in for this.
    expect(v.renderMs as number).toBeLessThan(10_000);
  }, 60_000);

  test("an inline image positive control: 1,000 x 1,000 is drawn, and nothing is said", async () => {
    const v = settled(
      await runBounded(CHILD, ["inline-control-editor-render"], 30_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v).toMatchObject({ ok: true, drawn: true, notice: null });
    expect(v.ink).toEqual([0, 0]);
  }, 60_000);

  test("an orphan over-budget image hides nothing: the page's own 144 MP bilevel scan is drawn, and nothing is said", async () => {
    // History (hostile review, 2026-11-09): an 8,000 x 8,000 image object
    // nothing references set maxImageSize to 63,999,999, so the page's own
    // scan, within its budget, was skipped: blank page 1 in 5 ms, and a
    // notice about an image that was never on the page.
    const v = settled(
      await runBounded(CHILD, ["orphan-bilevel-editor-render"], 60_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v).toMatchObject({ ok: true, drawn: true, notice: null });
    expect(v.ink).toEqual([0, 0]);
  }, 90_000);

  for (const [name, typed] of [
    ["softmask-editor-render", "with"],
    ["softmask-untyped-editor-render", "without"],
  ] as const) {
    test(`a 10 x 10 image with a 100 MP soft mask ${typed} /Subtype: skipped before its mask is decoded, and the notice is true`, async () => {
      // History (hostile review, 2026-11-09): masks were not charged. With
      // /Subtype the mask set maxImageSize to ITS size, which the 100-pixel
      // image passes, so pdf.js decoded the mask (2.0 s) under a notice
      // that said the image was left out; without it nothing was seen.
      const v = settled(
        await runBounded(CHILD, [name], 30_000, { maxOldSpaceMb: 2048 }),
      );
      expect(v).toMatchObject({ ok: true, drawn: true, size: [300, 200] });
      const drawnInk = v.ink;
      expect(drawnInk).toEqual([765, 765]);
      expect(v.notice as string).toContain(PDF_IMAGE_TOO_LARGE_MESSAGE);
      // Ink and notice cannot see the mask decoded (a zero mask paints white
      // either way). Memory can: decoding the 100 MP mask allocates 100 MB
      // or more. A first guess of 64 MB read 77 MB honest on a loaded
      // Windows box, so the bound is this file's GROWTH_MB (300), the one
      // every other decode in it is held to (witness audit, 2026-11-22:
      // with masks no longer charged, the "with" instance grew 1,121 MB
      // while ink stayed [765, 765]). Memory, not time: no runner's speed
      // moves it.
      const maskGrowth = Math.max(0, (v.growthMb as number) - GROWTH_MB);
      expect(maskGrowth, `growth ${v.growthMb as number} MB`).toBe(0);
      // The 500 ms bound stays until its CI spread is read: it is printed
      // now, never before (CI's tests took up to 4,170 / 5,681 ms with the
      // fixture build and the open).
      measureTime("pdfjs-guard-softmask-render", v.renderMs as number, 500, {
        instance: typed,
        detail: `growth ${v.growthMb as number} MB`,
        witness: "maskGrowth",
      });
      expect(v.renderMs as number).toBeLessThan(500);
    }, 60_000);
  }

  test("the editor draws a page again (zoom, rail, canvas) without decoding its images again", async () => {
    // History (hostile review, 2026-11-09): every draw ended in
    // `page.cleanup()`, which drops the page's operator list and decoded
    // images, so each zoom step asked the worker again and decoded afresh
    // (asks 1, 2, 3 here; a 25 MP image took ~4 s per draw).
    const v = settled(
      await runBounded(CHILD, ["editor-redraw"], 60_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    // Health: every draw drew, and the instrument saw the first draw ask
    // (a hook that saw nothing would read [0, 0, 0]).
    expect(v.asks).toEqual([1, 1, 1]);
  }, 90_000);

  test("CO-08 positive control: a 9 MP image page still rasterizes", async () => {
    const v = settled(
      await runBounded(CHILD, ["co08-control-raster"], 60_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v).toMatchObject({ ok: true, pages: 1 });
  }, 90_000);
});

describe("third review: labels, strings and references that hid a stream", () => {
  const nested = {
    name: "PdfEngineError",
    message: PDF_NESTED_TOO_DEEPLY_MESSAGE,
  };

  test("STAMP-14: page content labelled /Subtype /Image (90 s hang before) is refused in seconds", async () => {
    const v = settled(await runBounded(CHILD, ["label-image-q-text"], 30_000));
    expect(v.error).toMatchObject(nested);
  }, 60_000);

  test("positive control: pdf.js reads an image-labelled /Contents stream as page content", async () => {
    // Without this, the refusal above could be of a file pdf.js never reads.
    const v = settled(
      await runBounded(CHILD, ["label-image-control-text"], 30_000),
    );
    expect(v).toMatchObject({ ok: true, pageCount: 1 });
    expect(v.text).toContain("MARK");
  }, 60_000);

  test("STAMP-14: page content labelled /Length1 0 (60 s hang before) is refused in seconds", async () => {
    const v = settled(
      await runBounded(CHILD, ["label-length1-q-text"], 30_000),
    );
    expect(v.error).toMatchObject(nested);
  }, 60_000);

  test("CO-06: a 1 GiB chained-Flate bomb labelled as a 1x1 image (2,350 MB before) is refused without inflating it", async () => {
    const v = settled(
      await runBounded(CHILD, ["label-image-bomb-text"], 60_000, {
        maxOldSpaceMb: 1024,
      }),
    );
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_EXPANDS_TOO_FAR_MESSAGE,
    });
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 90_000);

  test("STAMP-14: '(>>stream)' in the content dictionary (60 s hang before) does not hide its /Filter", async () => {
    const v = settled(
      await runBounded(CHILD, ["dict-string-flate-q-text"], 30_000),
    );
    expect(v.error).toMatchObject(nested);
  }, 60_000);

  test("positive control: the same dictionary string over a shallow page still reads", async () => {
    const v = settled(
      await runBounded(CHILD, ["dict-string-control-text"], 30_000),
    );
    expect(v).toMatchObject({ ok: true, pageCount: 1 });
    expect(v.text).toContain("MARK");
  }, 60_000);

  test("CO-08: a 100 MP image whose /Subtype is a reference (36.5 s, 1.5 GB before) is refused by name", async () => {
    const v = settled(
      await runBounded(CHILD, ["co08-indirect-subtype-raster"], 20_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_IMAGE_TOO_LARGE_MESSAGE,
    });
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 60_000);
});

describe("lane res1: every pdf.js open goes through the preflight", () => {
  // History: only the text and raster readers ran the stream preflight, and
  // only the access probe ran the xref pre-scan. These four readers opened
  // pdf.js with neither: measured on origin/main 2026-11-09 (Windows, Node
  // 24), the object-stream bomb opened and walked in 10.6-11.7 s, the
  // zero-width xref ran the child out of memory in 3 s, the q-split page was
  // read by the page board as if nothing were wrong and drawn by Auto-crop
  // in 9.3 s.
  const READERS = [
    "read-pages",
    "count-pages",
    "auto-crop",
    "editor-render",
    "viewer-render",
  ];
  const expanded = {
    name: "PdfEngineError",
    message: PDF_EXPANDS_TOO_FAR_MESSAGE,
  };
  const FILES: Record<string, object> = {
    "objstm-bomb": expanded,
    "zero-width-xref": {
      name: "PdfEngineError",
      message: UNREADABLE_PDF_MESSAGE,
      kind: "unreadable",
    },
    "q-split": {
      name: "PdfEngineError",
      message: PDF_NESTED_TOO_DEEPLY_MESSAGE,
    },
  };
  for (const reader of READERS) {
    test(
      `${reader}: each hostile file is refused, typed, and a plain file still opens`,
      async () => {
        for (const [file, error] of Object.entries(FILES)) {
          const v = settled(await openChild(`open:${file}:${reader}`));
          expect(v.error, `${file} via ${reader}`).toMatchObject(error);
          if (file === "objstm-bomb")
            expectBombScannedOnce(v, `${file} via ${reader}`);
          // Second bound: refused in about the time it takes to read the
          // preflight's budget, before pdf.js parsed anything. See
          // `expectRefusedInBudgetTime` for the shape and its history.
          await expectRefusedInBudgetTime(
            v,
            `${file} via ${reader}`,
            async () => {
              const again = settled(await openChild(`open:${file}:${reader}`));
              expect(
                again.error,
                `${file} via ${reader} (re-run)`,
              ).toMatchObject(error);
              return again;
            },
          );
          const { mb } = v.growth as { mb: number };
          // Third bound, memory: the bomb's refusal comes from a preflight that
          // streams up to 1.6 GB through inflate, so what it KEEPS is the bound
          // worth pinning (added after review; the child always reported it).
          // Read from the fixture's end, after the warm-up (GROWTH_MB above).
          expect(mb, `${file} via ${reader}`).toBeLessThan(GROWTH_MB);
        }
        const control = settled(
          await runBounded(CHILD, [`open:control:${reader}`], 60_000),
        );
        expect(control, `control via ${reader}`).toMatchObject({ ok: true });
        // Three files, each up to FOUR kills: openChild may kill twice (a hang
        // re-run), and best of two's re-run is another openChild, two more.
        // Plus the control's 60 s and 30 s for the parent's own work, so a
        // kill's message always lands before vitest's "Test timed out"
        // (review 2026-11-22: the old 3 x 2 x 150 s + 60 s counted two kills
        // per file, and a 101 s open, a killed re-run and an 80 s one already
        // overran 330 s on the access test below).
      },
      OPENS_KILL_BUDGET_MS(3) + 60_000 + 30_000,
    );
  }
});

describe("the PDF Viewer's open, on every hostile class it meets first", () => {
  // The viewer opens a file the page board already read, so most of these
  // were refused there first; the viewer's own open must refuse them as
  // well, typed and bounded, since a hand-off or a re-open reaches it too.
  test("CO-06: the chained-Flate bomb is refused, typed, without inflating 1 GiB", async () => {
    const v = settled(
      await runBounded(CHILD, ["co06-viewer"], 60_000, { maxOldSpaceMb: 1024 }),
    );
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_EXPANDS_TOO_FAR_MESSAGE,
    });
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 90_000);

  test("CO-06 positive control: the viewer draws a plain file and reads its text", async () => {
    const v = settled(await runBounded(CHILD, ["co06-control-viewer"], 60_000));
    expect(v).toMatchObject({ ok: true, numPages: 1, drawn: "drawn" });
    expect(v.text).toContain("HOSTILE MARKER");
  }, 90_000);

  test("STAMP-14: 100,000 unclosed q is refused in seconds", async () => {
    const v = settled(await runBounded(CHILD, ["stamp14-viewer"], 30_000));
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_NESTED_TOO_DEEPLY_MESSAGE,
    });
  }, 60_000);

  test("CO-08: a 100 MP image, page 1 drawn in seconds without it, and the viewer knows to say so", async () => {
    const v = settled(
      await runBounded(CHILD, ["co08-viewer-render"], 30_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v).toMatchObject({ ok: true, drawn: "drawn" });
    // The image's place is the white sheet: skipped, not decoded.
    expect(v.ink).toEqual([765, 765]);
    expect(v.imageTooLarge).toBe(true);
    // Kept raw (review 2026-11-22): never flaky (test CI max 4,406 ms over
    // 12 runs of 2026-11-18, the render alone less), and white ink is the
    // same however slowly it was reached, so it cannot stand in for this.
    expect(v.renderMs as number).toBeLessThan(10_000);
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 60_000);

  test("CO-08 positive control: a 9 MP image is drawn, and nothing is said", async () => {
    const v = settled(
      await runBounded(CHILD, ["co08-control-viewer-render"], 60_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v).toMatchObject({ ok: true, drawn: "drawn" });
    expect(v.ink).toEqual([0, 0]);
    expect(v.imageTooLarge).toBe(false);
  }, 90_000);

  test("/Count 0 is the unreadable refusal", async () => {
    const v = settled(await runBounded(CHILD, ["count0-viewer"], 30_000));
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: UNREADABLE_PDF_MESSAGE,
      kind: "unreadable",
    });
  }, 60_000);

  test("a file that needs a password is the typed needs-password refusal (its remedy is Unlock PDF)", async () => {
    const v = settled(await runBounded(CHILD, ["password-viewer"], 30_000));
    expect(v.error).toMatchObject({ kind: "encrypted" });
  }, 60_000);

  test("scrolling ten 9 MP image pages: the process retains at most the kept-pixel budget's decoded images", async () => {
    // History (review, 2026-11-10): the viewer kept the last ten pages it
    // drew, whatever their images held; this probe measured +271 MB after
    // ten pages with that rule (mutation, 2026-11-10) and +135 MB with the
    // pixel budget. Measured from the PROCESS (array buffers after a full
    // collection, where pdf.js keeps decoded images in Node), not from the
    // viewer's own count.
    const { VIEWER_KEPT_IMAGE_PIXELS } = await import("@/lib/pdf/viewer");
    const v = settled(
      await runBounded(CHILD, ["viewer-retention"], 240_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v.drawn).toEqual(Array.from({ length: 10 }, () => "drawn"));
    const mb = v.afterDrawMb as number[];
    // Positive control: one 3,000 x 3,000 RGB image decoded and kept is
    // visible to the meter (27 MB at 3 bytes a pixel).
    expect(mb[0]!).toBeGreaterThanOrEqual(24);
    // The bound, at 4 bytes a pixel (the most pdf.js keeps per pixel).
    const bound = (VIEWER_KEPT_IMAGE_PIXELS * 4) / 1e6;
    for (const [i, held] of mb.entries()) {
      expect(held, `after page ${i + 1}`).toBeLessThanOrEqual(bound);
    }
  }, 300_000);

  test("the editor drawing ten 16 MP image pages: the process retains at most the kept-pixel budget's decoded images", async () => {
    // History (PDF Viewer review, PR #310): the editor kept the last six
    // pages it drew, whatever their images held — the rule the viewer had
    // just been fixed for. Measured the viewer's way: array buffers after a
    // full collection, from the PROCESS, not the editor's own count. 16 MP,
    // not the viewer probe's 9: six 9 MP pages (162 MB) fit under this
    // bound at 4 bytes a pixel, so they could not see the old rule. Measured
    // 2026-11-10 (Windows, Node 24): the six-page rule +288 MB, the budget
    // +144 MB (three pages).
    const { EDITOR_KEPT_IMAGE_PIXELS } =
      await import("@/lib/pdf/editor/page-render");
    // Kill 330 s (CI-flake audit lane 2): the child reached 110,987 ms on
    // CI (44307575570), 2.16x under the old 240 s, with a 1.9x spread
    // between runners. The bound under test is memory, not time.
    const v = settled(
      await runBounded(CHILD, ["editor-retention"], 330_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v.drawn).toEqual(Array.from({ length: 10 }, () => true));
    const mb = v.afterDrawMb as number[];
    // Positive control: one 4,000 x 4,000 RGB image decoded and kept is
    // visible to the meter (48 MB at 3 bytes a pixel).
    expect(mb[0]!).toBeGreaterThanOrEqual(43);
    const bound = (EDITOR_KEPT_IMAGE_PIXELS * 4) / 1e6;
    for (const [i, held] of mb.entries()) {
      expect(held, `after page ${i + 1}`).toBeLessThanOrEqual(bound);
    }
  }, 400_000);

  test.each([
    ["editor", "editor-retention-inline"],
    ["viewer", "viewer-retention-inline"],
  ])(
    "the %s drawing ten pages of 1,700 inline images each: the process retains at most the kept-pixel budget",
    async (_, probe) => {
      // History (hostile review, 2026-11-10): the keeper summed only
      // `page.objs`, and pdf.js keeps an inline image under 200 px
      // wide-plus-high in the page's OPERATOR LIST instead (decoded RGBA,
      // `paintInlineImageXObject`), so each such page read as 0 px and six
      // were kept: a 593 KB file held 74, 147, ... 439 MB after each draw.
      // Measured as heap + array buffers after a full collection, from the
      // PROCESS: the samples are typed arrays, and the list's objects heap.
      const { KEPT_IMAGE_PIXELS } = await import("@/lib/pdf/kept-pages");
      const v = settled(
        await runBounded(CHILD, [probe], 240_000, { maxOldSpaceMb: 4096 }),
      );
      expect(v.drawn).toHaveLength(10);
      expect(
        (v.drawn as unknown[]).every((d) => d === true || d === "drawn"),
      ).toBe(true);
      const mb = v.afterDrawMb as number[];
      // Positive control: one page's 16.7 MP of inline samples, kept, is
      // visible to the meter (67 MB at 4 bytes a pixel).
      expect(mb[0]!).toBeGreaterThanOrEqual(60);
      const bound = (KEPT_IMAGE_PIXELS * 4) / 1e6;
      for (const [i, held] of mb.entries()) {
        expect(held, `after page ${i + 1}`).toBeLessThanOrEqual(bound);
      }
    },
    300_000,
  );

  test("the deepest zoom on an A0 page stays within the canvas caps at every device ratio", async () => {
    const { MAX_CANVAS_PIXELS, MAX_CANVAS_SIDE } =
      await import("@/lib/pdf/viewer-geometry");
    const v = settled(
      await runBounded(CHILD, ["viewer-zoom-a0"], 60_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    const renders = v.renders as {
      ratio: number;
      pixels: number | null;
      side: number | null;
    }[];
    // Health: three renders, each drawn (a null would pass any bound).
    expect(renders.map((r) => r.ratio)).toEqual([1, 2, 3]);
    for (const r of renders) {
      expect(r.pixels, `ratio ${r.ratio}`).not.toBeNull();
      expect(r.pixels!, `ratio ${r.ratio}`).toBeLessThanOrEqual(
        MAX_CANVAS_PIXELS,
      );
      expect(r.side!, `ratio ${r.ratio}`).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
      // Reaches the cap, not starved by a factor.
      expect(r.pixels!, `ratio ${r.ratio}`).toBeGreaterThan(
        MAX_CANVAS_PIXELS * 0.99,
      );
    }
  }, 90_000);
});

describe("lane res1: the access probe's open goes through the preflight too", () => {
  // History (review of lane res1, 2026-11-09): classifyPdfAccess ran the xref
  // pre-scan and a 30 s deadline but not the stream preflight, and the
  // open-preflight guard EXEMPTED it while the opener's docblock said every
  // open was preflighted. The probe runs on file arrival on the batch
  // runners, Compress, Protect/Unlock, Request Signatures and the single-file
  // look, so it is where a hostile file actually lands first: on d44ca719 the
  // object-stream bomb was opened and walked, verdict "unencrypted", in
  // 11.3 s at 621 MB peak RSS.
  for (const file of ["objstm-bomb", "zero-width-xref", "q-split"]) {
    test(
      `${file}: "unreadable", in seconds and bounded memory`,
      async () => {
        const v = settled(await openChild(`open:${file}:access`));
        expect(v, file).toMatchObject({ ok: true, access: "unreadable" });
        if (file === "objstm-bomb")
          expectBombScannedOnce(v, `${file} via access`);
        await expectRefusedInBudgetTime(v, `${file} via access`, async () => {
          const again = settled(await openChild(`open:${file}:access`));
          expect(again, `${file} (re-run)`).toMatchObject({
            ok: true,
            access: "unreadable",
          });
          return again;
        });
        const { mb } = v.growth as { mb: number };
        expect(mb, file).toBeLessThan(GROWTH_MB);
        // The first open and its best-of-two re-run, each up to two kills:
        // four kills, plus 30 s for the parent (see the reader loop above).
      },
      OPENS_KILL_BUDGET_MS(1) + 30_000,
    );
  }

  test("positive control: a plain file is still unencrypted", async () => {
    const v = settled(await runBounded(CHILD, ["open:control:access"], 60_000));
    expect(v).toMatchObject({ ok: true, access: "unencrypted" });
  }, 90_000);
});

describe("lane res1: pdf.js's numPages is never looped over unchecked", () => {
  // /Count -1 over three real kids: pdf-lib's repair reads three pages,
  // pdf.js reports -1. Before: Auto-crop analysed 0 pages against 3 sizes
  // and planned "nothing to crop"; the editor opened with numPages -1.
  const unreadable = {
    name: "PdfEngineError",
    message: UNREADABLE_PDF_MESSAGE,
    kind: "unreadable",
  };
  test("Auto-crop refuses /Count -1 as unreadable, never a plan from 0 analysed pages", async () => {
    const v = settled(
      await runBounded(CHILD, ["open:count-minus-one:auto-crop"], 60_000),
    );
    expect(v.error).toMatchObject(unreadable);
  }, 90_000);

  test("the editor canvas refuses /Count -1 as unreadable", async () => {
    const v = settled(
      await runBounded(CHILD, ["open:count-minus-one:editor-render"], 60_000),
    );
    expect(v.error).toMatchObject(unreadable);
  }, 90_000);

  test("the same refusal the page board already gave (the reference behaviour)", async () => {
    const v = settled(
      await runBounded(CHILD, ["open:count-minus-one:read-pages"], 60_000),
    );
    expect(v.error).toMatchObject(unreadable);
  }, 90_000);
});

describe("lane res1: a Flate stage behind ASCIIHex is counted on the raster paths", () => {
  test("thumbnails refuse a page whose content is AHx over 1 GiB of Flate, without inflating it", async () => {
    const v = settled(
      await runBounded(CHILD, ["ahx-bomb-thumbs"], 60_000, {
        maxOldSpaceMb: 1024,
      }),
    );
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_EXPANDS_TOO_FAR_MESSAGE,
    });
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 90_000);

  test("PDF to JPG refuses it too", async () => {
    const v = settled(
      await runBounded(CHILD, ["ahx-bomb-raster"], 60_000, {
        maxOldSpaceMb: 1024,
      }),
    );
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_EXPANDS_TOO_FAR_MESSAGE,
    });
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 90_000);

  test("positive control: a small AHx+Flate content stream still renders", async () => {
    const v = settled(await runBounded(CHILD, ["ahx-control-raster"], 60_000));
    expect(v).toMatchObject({ ok: true, pages: 1 });
  }, 90_000);
});
