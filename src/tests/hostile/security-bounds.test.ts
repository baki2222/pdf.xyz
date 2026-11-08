import { describe, expect, test } from "vitest";
import { runBounded, type BoundedOutcome } from "./bounded";

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
 * Peak RSS of the child, in MB. The honest control below measures what tsx,
 * pdf-lib and the fixture cost before any hostile byte is read (about 145 MB
 * on Windows / Node 24); the bombs inflate to 1,024 MiB, so a cap of 400 MB
 * leaves 250 MB for the fix's own bounded buffers and still sits 600 MB below
 * what a single unbounded inflate costs.
 */
const PEAK_MB = 400;

async function run(fixture: string, entry: string): Promise<BoundedOutcome> {
  return runBounded(CHILD, [fixture, entry], BOUND_MS, { maxOldSpaceMb: 1024 });
}

function settled(r: BoundedOutcome): Record<string, unknown> {
  expect(r, JSON.stringify(r)).toMatchObject({ kind: "settled" });
  return (r as { value: Record<string, unknown> }).value;
}

const T = BOUND_MS + 20_000;

describe("lane l02: hostile structure is read in bounded time and memory", () => {
  test(
    "control: an honest owner-only file with an object stream opens, 1 page, cheaply",
    async () => {
      const v = settled(await run("objstm-n-honest", "open"));
      expect(v).toMatchObject({ settled: "opened", pages: 1 });
      expect(v.peakMb as number).toBeLessThan(PEAK_MB);
    },
    T,
  );

  test(
    "SIB-01: an object stream declaring /N 999999999 opens in bounded time, page kept",
    async () => {
      const v = settled(await run("objstm-n-1e9", "open"));
      expect(v).toMatchObject({ settled: "opened", pages: 1 });
      // The loop runs to the header's pairs (1), not to /N: the open costs
      // what the honest twin costs (about 70 ms), far under a second. A loop
      // to /N that merely skipped bad pairs would still spin 10^9 times.
      expect(v.ms as number).toBeLessThan(1_000);
    },
    T,
  );

  test(
    "SIB-02: zero-width xref rows over /Index [0 2^31] are refused by readXref, not walked",
    async () => {
      const v = settled(await run("xref-w0-plain", "readXref"));
      expect(v).toMatchObject({ settled: "threw", name: "UnreadablePdfError" });
      expect(v.peakMb as number).toBeLessThan(PEAK_MB);
    },
    T,
  );

  test(
    "SIB-02: the owner-only variant settles as unsupported through openProtectedPdf",
    async () => {
      const v = settled(await run("xref-w0-owner", "open"));
      expect(v).toMatchObject({ settled: "unsupported" });
      expect(v.peakMb as number).toBeLessThan(PEAK_MB);
    },
    T,
  );

  test(
    "SIB-03: classifyPdfAccess calls the zero-width xref unreadable before pdf.js can allocate",
    async () => {
      for (const fixture of ["xref-w0-plain", "xref-w0-owner"]) {
        const v = settled(await run(fixture, "classify"));
        expect(v, fixture).toMatchObject({ settled: "unreadable" });
        expect(v.peakMb as number, fixture).toBeLessThan(PEAK_MB);
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
        expect(v.peakMb as number, fixture).toBeLessThan(PEAK_MB);
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
      expect((atLimit.peakMb as number) - (six.peakMb as number)).toBeLessThan(
        64,
      );
      // Time against the same machine's six-row run (a full parallel suite
      // slows both; it failed a fixed 3 s once that way).
      expect(atLimit.ms as number).toBeLessThan(
        Math.max(3_000, 4 * (six.ms as number)),
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
          expect(v.peakMb as number, `${fixture} ${entry}`).toBeLessThan(
            PEAK_MB,
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
      expect(v.peakMb as number).toBeLessThan(PEAK_MB);
    },
    T,
  );

  test(
    "SIB-06: /Encrypt /Length 1000000000 is unreadable at once, without asking pdf.js",
    async () => {
      const v = settled(await run("encrypt-length-1e9", "classify"));
      expect(v).toMatchObject({ settled: "unreadable" });
      expect(v.ms as number).toBeLessThan(5_000);
    },
    T,
  );
});
