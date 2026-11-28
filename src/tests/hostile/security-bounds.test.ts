import { describe, expect, test } from "vitest";
import { scanBudget } from "@/lib/pdf/xref-prescan";
import { measureTime } from "../time-bound";
import { runBounded, type BoundedOutcome } from "./bounded";
import { filterSpellings } from "./xref-rows.fixtures";

// Lane l02 of the hostile-input matrix: our own xref / object-stream reader
// (`src/lib/pdf/security/document.ts`) and the pdf.js access probe
// (`src/lib/pdf/encryption.ts`). Every case here looped synchronously or
// allocated about 1 GiB on the code before the fix, so each runs in a child
// process that `runBounded` can kill (see `./bounded.ts`). Before the fix:
//  - SIB-01 took 224 s (linear in /N, 0.22 us per iteration);
//  - SIB-02 peaked at 1.58 GB and threw "Map maximum size exceeded";
//  - SIB-03 aborted the process with "JavaScript heap out of memory";
//  - SIB-05 grew about 1,025 MB on every entry point;
//  - SIB-06 took 76 s inside pdf.js, then said "password-required".
const CHILD = "src/tests/hostile/security-bounds.child.ts";

/** Wall-clock bound per case: every fixed case settles in under 2 s here. */
const BOUND_MS = 20_000;

/**
 * What one entry point may ADD to the child's resident memory at its peak,
 * in MB, read by ./memory.ts after the fixture is built. The bombs inflate
 * to 1,024 MiB, so 250 MB is the room the fix's own bounded buffers get and
 * still sits 750 MB below what a single unbounded inflate adds.
 *
 * WAS `PEAK_MB = 400` on the child's absolute peak (about 145 MB of tsx,
 * pdf-lib and fixture on Windows). On CI's Linux runners the same honest
 * file peaked at 657 MB before reading a hostile byte, so every case failed
 * there for the wrong reason (PR #297's first CI run).
 */
const GROWTH_MB = 250;

async function run(fixture: string, entry: string): Promise<BoundedOutcome> {
  return runBounded(CHILD, [fixture, entry], BOUND_MS, { maxOldSpaceMb: 1024 });
}

function settled(r: BoundedOutcome): Record<string, unknown> {
  expect(r, JSON.stringify(r)).toMatchObject({ kind: "settled" });
  return (r as { value: Record<string, unknown> }).value;
}

const T = BOUND_MS + 20_000;

/**
 * What pdf.js may spend, over six rows, on XREF_ENTRY_FLOOR (2^19) rows that
 * each read a byte: measured 2026-11-08 (Windows, Node 24, this child) at 62
 * to 69 MB over three runs, plus the 64 MB the zero-width check below allows
 * between two runs. Twice the floor measured 154 to 199 MB, so doubling the
 * floor goes red here.
 */
const ENTRY_FLOOR_MB = 128;

describe("lane l02: hostile structure is read in bounded time and memory", () => {
  test(
    "control: an honest owner-only file with an object stream opens, 1 page, cheaply",
    async () => {
      const v = settled(await run("objstm-n-honest", "open"));
      expect(v).toMatchObject({ settled: "opened", pages: 1 });
      expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
    },
    T,
  );

  test(
    "SIB-01: an object stream declaring /N 999999999 opens in bounded time, page kept",
    async () => {
      const v = settled(await run("objstm-n-1e9", "open"));
      expect(v).toMatchObject({ settled: "opened", pages: 1 });
      // The loop runs to the header's pairs (1), not to /N. A loop to /N
      // that merely skipped bad pairs would still spin 10^9 times: about
      // 1-5 s at 1-5 ns a pass, which only a time bound sees. So the same
      // file at /N 2^52 (CI-flake audit lane 2): there such a loop spins
      // 4.5e15 times and is killed at BOUND_MS on ANY runner, while the
      // header-capped loop opens it like its twin.
      const huge = settled(await run("objstm-n-2e52", "open"));
      const opened = [v.settled, v.pages, huge.settled, huge.pages];
      expect(opened).toEqual(["opened", 1, "opened", 1]);
      // The open's own time, in the child: about 70 ms for the honest twin
      // on Windows, unmeasured on CI (test max 3,054 ms in 43998624497,
      // spawn and fixture included). Measure mode until harvested.
      measureTime("sib01-objstm-n-open", v.ms as number, 1_000, {
        witness: "opened",
      });
    },
    2 * T,
  );

  test(
    "SIB-02: zero-width xref rows over /Index [0 2^31] are refused by readXref, not walked",
    async () => {
      const v = settled(await run("xref-w0-plain", "readXref"));
      expect(v).toMatchObject({ settled: "threw", name: "UnreadablePdfError" });
      expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
    },
    T,
  );

  test(
    "SIB-02: the owner-only variant settles as unsupported through openProtectedPdf",
    async () => {
      const v = settled(await run("xref-w0-owner", "open"));
      expect(v).toMatchObject({ settled: "unsupported" });
      expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
    },
    T,
  );

  test(
    "SIB-03: classifyPdfAccess calls the zero-width xref unreadable before pdf.js can allocate",
    async () => {
      for (const fixture of ["xref-w0-plain", "xref-w0-owner"]) {
        const v = settled(await run(fixture, "classify"));
        expect(v, fixture).toMatchObject({ settled: "unreadable" });
        expect(v.growthMb as number, fixture).toBeLessThan(GROWTH_MB);
      }
    },
    2 * T,
  );

  test(
    "SIB-03: every spelling pdf.js reads as a zero-width /W is unreadable, not walked",
    async () => {
      // Review of the first fix: its pre-scan matched only the literal
      // `/W [0 0 0]`, and `[0 0 0.0]` / `[0 0 -0]` drove pdf.js out of memory
      // ("memory" outcome) exactly as the original finding did.
      for (const fixture of [
        "xref-w0-real",
        "xref-w0-negzero",
        "xref-w0-signs",
        "xref-w0-dup",
        "xref-w0-escaped",
        "xref-w0-size",
        "xref-w0-notype",
        "xref-w-indirect",
      ]) {
        const v = settled(await run(fixture, "classify"));
        expect(v, fixture).toMatchObject({ settled: "unreadable" });
        expect(v.growthMb as number, fixture).toBeLessThan(GROWTH_MB);
      }
    },
    8 * T,
  );

  test(
    "SIB-03: the rows the pre-scan still hands pdf.js cost pdf.js nothing measurable (second bound on ZERO_WIDTH_ROW_LIMIT)",
    async () => {
      // Measured 2026-11-08 (Windows, Node 24): 6 rows peak 479 MB, 65,536
      // rows 476 MB; 1,000,000 rows add about 180 MB and 2^31 run out of
      // memory. 64 MB is the slack between two runs of the same file.
      const six = settled(await run("xref-w0-six", "pdfjs"));
      const atLimit = settled(await run("xref-w0-at-limit", "pdfjs"));
      expect(atLimit).toMatchObject({ settled: "opened", pages: 1 });
      // The memory arm sees a raised ZERO_WIDTH_ROW_LIMIT (about +180 MB at
      // 2^20 rows); the time arm below is a backstop.
      const addedMb = Math.ceil(
        (atLimit.growthMb as number) - (six.growthMb as number),
      );
      const overMb = Math.max(0, addedMb - 63);
      expect(overMb, `added ${addedMb} MB`).toBe(0);
      // Time against the same machine's six-row run (a full parallel suite
      // slows both; it failed a fixed 3 s once that way). Measure mode until
      // harvested (CI-flake audit lane 2): the test's CI max is 4,856 ms
      // for both children (12 runs of 2026-11-18).
      measureTime(
        "sib03-zero-width-at-limit",
        atLimit.ms as number,
        Math.max(3_000, 4 * (six.ms as number)),
        { detail: `six rows ${six.ms} ms`, witness: "overMb" },
      );
    },
    2 * T,
  );

  test(
    "SIB-03 (review 2): every route to a long row walk is unreadable through classifyPdfAccess",
    async () => {
      // Each of these ran pdf.js out of memory ("memory" outcome, exit 134)
      // past the second pre-scan: /Index as an empty string, /Prev from a
      // section only a rebuild reaches, /Prev through an integer object, and
      // rows one byte wide over a deflate bomb.
      for (const fixture of [
        "idx-empty-str",
        "idx-empty-hex",
        "recovery-prev",
        "prev-indirect-int",
        "flate-rows-20m",
      ]) {
        const v = settled(await run(fixture, "classify"));
        expect(v, fixture).toMatchObject({ settled: "unreadable" });
        expect(v.growthMb as number, fixture).toBeLessThan(GROWTH_MB);
      }
    },
    5 * T,
  );

  test(
    "SIB-03 (review 2) controls: the same files at /Size 6 open as one unencrypted page",
    async () => {
      for (const fixture of [
        "idx-empty-str-6",
        "recovery-prev-6",
        "prev-indirect-int-6",
      ]) {
        const v = settled(await run(fixture, "classify"));
        // pdfjsCalls 1: the positive control for SIB-06's count of 0.
        expect(v, fixture).toMatchObject({
          settled: "unencrypted",
          pdfjsCalls: 1,
        });
      }
    },
    3 * T,
  );

  test(
    "SIB-03 (review 3): the 20M-row bomb is unreadable under every filter spelling pdf.js decodes; six rows open",
    async () => {
      // `/F /FlateDecode` (pdf.js reads `dict.get("F", "Filter")`) was
      // 'unencrypted' after 4,038 ms at 3,422 MB peak, and could not finish
      // at all in a 1.5 GB heap.
      const n = filterSpellings().length;
      expect(n).toBe(6);
      for (let i = 0; i < n; i += 1) {
        const bomb = settled(await run(`flate-spell-${i}`, "classify"));
        expect(bomb, `spelling ${i}`).toMatchObject({ settled: "unreadable" });
        expect(bomb.growthMb as number, `spelling ${i}`).toBeLessThan(
          GROWTH_MB,
        );
        // Positive control: pdf.js decodes this spelling, and the pre-scan
        // lets the honest file through.
        const six = settled(await run(`flate-spell-${i}-6`, "classify"));
        expect(six, `control ${i}`).toMatchObject({ settled: "unencrypted" });
      }
    },
    12 * T,
  );

  test(
    "SIB-03 (review 3): the pre-scan keeps no per-object state on a file of tiny objects",
    async () => {
      // It runs on the caller's (main) thread before any deadline. Keeping a
      // Map per object cost 20 MB of `0 obj<</A 1>>` about 450 MB of heap
      // (23 bytes per file byte; 2.3 GB at the 100 MiB upload cap). Bound:
      // the file's own size again (transient dictionaries a young-generation
      // GC reclaims), plus 64 MB of slack between runs.
      const v = settled(await run("dense-objects-20mb", "prescan-memory"));
      expect(v).toMatchObject({ settled: "passed" });
      expect(v.addedMb as number).toBeLessThan(20 + 64);
    },
    T,
  );

  test(
    "SIB-03 (review 2): the pre-scan itself is linear on dictionaries that never close",
    async () => {
      // It runs before any deadline, on the caller's (main) thread. 16,000
      // units took 33 s and 16 s; 64,000 would take about 9 minutes.
      for (const fixture of [
        "unclosed-xref-16k",
        "unclosed-trailer-16k",
        "unclosed-xref-64k",
      ]) {
        const r = await run(fixture, "prescan");
        const v = settled(r);
        // The cost shape as a count (CI-flake audit lane 2): the bytes the
        // pre-scan lexed, which no runner speed moves. Positive control: the
        // region is a full budget burn (refused after 98-99% of scanBudget),
        // so a fixture that stopped reaching the budget cannot make the
        // bound below vacuous.
        expect(v.settled, fixture).toBe("refused");
        const size = v.size as number;
        const lexed = v.lexed as number;
        expect(lexed, fixture).toBeGreaterThanOrEqual(0.9 * scanBudget(size));
        // A second, independently typed bound: 9 x size + 9 MiB against
        // scanBudget's 8 x size + 8 MiB. Today 16.38M of 18.65M (64k). A
        // budget multiplier raised 8 -> 64 lexes 73.9M and is red on any
        // runner; the old `ms < 1_000` caught it only on a slow one.
        const overLexed = Math.max(0, lexed - (9 * size + 9 * 2 ** 20));
        expect(overLexed, `${fixture}: lexed ${lexed} of ${size}`).toBe(0);
        // `lexed` is what the budget was CHARGED, so it cannot see lexing
        // the budget never hears of: review 2026-11-22 re-lexed each
        // dictionary 40 more times outside it, ran 21x slower, and `lexed`
        // stayed byte-identical. So also the bytes every lexer stepped over
        // (`steps`, counted in the Lexer itself), against what was charged.
        // Honest: 1.375x lexed on both xref fixtures (parseValue backs up
        // over the two tokens after a number to test for `n g R`), 1.008x
        // on the trailer one. 2x + 1 MiB: one extra full pass is red.
        // Positive control: every charged byte here is a lexed byte.
        const steps = v.steps as number;
        expect(steps, `${fixture}: steps`).toBeGreaterThanOrEqual(0.9 * lexed);
        const lexWork = {
          overLexed,
          overSteps: Math.max(0, steps - (2 * lexed + 2 ** 20)),
        };
        expect(lexWork, `${fixture}: lexed ${lexed}, steps ${steps}`).toEqual({
          overLexed: 0,
          overSteps: 0,
        });
        // Time is a backstop, never what catches the multiplier. `< 1_000`
        // had about 1.05-1.4x on slow CI runners (test max 9,251 ms in
        // 43636213581 for three children). Measure mode until harvested,
        // with a floor of 3 s. What only time sees: a lexer step that got
        // costlier per byte.
        measureTime("sib03-prescan-unclosed", v.ms as number, 3_000, {
          instance: fixture,
          detail: `lexed ${lexed} bytes, ${steps} steps`,
          witness: "lexWork",
        });
      }
    },
    3 * T,
  );

  test(
    "SIB-03: the entry rows the pre-scan still hands pdf.js cost it a bounded amount (second bound on XREF_ENTRY_FLOOR)",
    async () => {
      const six = settled(await run("flate-rows-6", "pdfjs"));
      const atFloor = settled(await run("flate-rows-at-floor", "pdfjs"));
      // The memory arm, on the FIRST hostile open in a fresh child, sees a
      // doubled XREF_ENTRY_FLOOR; the time arm below is a backstop.
      const addedMb = Math.ceil(
        (atFloor.growthMb as number) - (six.growthMb as number),
      );
      const overMb = Math.max(0, addedMb - (ENTRY_FLOOR_MB - 1));
      expect(overMb, `added ${addedMb} MB`).toBe(0);
      // Measure mode until harvested (CI-flake audit lane 2): the test's CI
      // max is 5,091 ms for both children (12 runs of 2026-11-18).
      measureTime(
        "sib03-entry-floor-at-floor",
        atFloor.ms as number,
        Math.max(5_000, 4 * (six.ms as number)),
        { detail: `six rows ${six.ms} ms`, witness: "overMb" },
      );
    },
    2 * T,
  );

  test(
    "SIB-03: probePdfEncryption says 'could not tell' (null) on it",
    async () => {
      const v = settled(await run("xref-w0-plain", "probe"));
      expect(v).toMatchObject({ settled: null });
    },
    T,
  );

  test(
    "SIB-05: a 1 GiB xref-stream bomb is inflated only as far as the rows need",
    async () => {
      for (const fixture of ["xref-bomb", "xref-bomb-chained"]) {
        for (const entry of ["readXref", "open"]) {
          const v = settled(await run(fixture, entry));
          expect(v.growthMb as number, `${fixture} ${entry}`).toBeLessThan(
            GROWTH_MB,
          );
        }
      }
    },
    4 * T,
  );

  test(
    "SIB-05: a 1 GiB object-stream bomb holding the page is refused, not inflated",
    async () => {
      const v = settled(await run("objstm-bomb", "open"));
      expect(v).toMatchObject({ settled: "unsupported" });
      expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
    },
    T,
  );

  test(
    "SIB-06: /Encrypt /Length 1000000000 is unreadable at once, without asking pdf.js",
    async () => {
      const v = settled(await run("encrypt-length-1e9", "classify"));
      expect(v).toMatchObject({ settled: "unreadable" });
      // "Without asking pdf.js" is a count (CI-flake audit lane 2): the
      // child wraps getDocument. The review-2 controls read 1, so the
      // counter is seen to count.
      const pdfjsCalls = v.pdfjsCalls;
      expect(pdfjsCalls).toBe(0);
      // A backstop with a 5 s floor; measure mode until harvested (test CI
      // max 2,638 ms, spawn and fixture included, 12 runs of 2026-11-18).
      measureTime("sib06-encrypt-length", v.ms as number, 5_000, {
        witness: "pdfjsCalls",
      });
    },
    T,
  );
});
