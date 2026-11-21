// @vitest-environment node
/**
 * PDF to Word's formatting costs, held to bounds in a FRESH process each
 * (`src/tests/docx-run-style-measure.ts`): the matcher at the per-page cap
 * in its three layouts, a page one word past the cap, and a 500-page
 * document through the whole engine with its check before delivery. The
 * figures measured on 2026-11-15 sit beside `MAX_STYLED_PIECES_PER_PAGE`,
 * and each run carries its own health check — the work was done (every word
 * matched, every page read back), so a fast run is not a run that did
 * nothing.
 *
 * Since 2026-11-22 (ci-flake audit 2026-11-19, line 82) the read-back's
 * time is routed through `@/tests/time-bound` and RECORDS (measure mode)
 * until CI calibrates it: it timed this script's own read-back, so the
 * engine parsing twice could never move it. What fails on that defect is
 * speed-independent: the engine's ONE structural parse of what it delivers
 * (`structureParses`). The matcher rows' 10 s and the engine's 60 s still
 * assert, as on main (outside the lane's scope; a cap-40,000 mutant flips
 * red or green with the runner CI draws, about 4.8 s on the fastest runner
 * seen and 10.7 s on the slowest, and the matched counts cannot see it).
 * Each row also prints its cost shape — the same layout at a reference
 * size, same child — so the harvest can set those bounds from CI.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_STYLED_PIECES_PER_PAGE } from "./docx-run-style";
import { expectFasterThan, expectRatioBelow } from "@/tests/time-bound";

const ROOT = process.cwd();
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = path.join(ROOT, "src", "tests", "docx-run-style-measure.ts");

/**
 * Runs one mode in a fresh child. `killMs` is enforced WHILE it runs:
 * execFileSync blocks the worker, so vitest's timeout is only checked after
 * it returns and a child that never exits would hold the job; each caller's
 * value sits under its test's timeout, so ETIMEDOUT is what reports.
 */
function measure(
  mode: string,
  n: number,
  killMs: number,
): Record<string, number | boolean> {
  const out = execFileSync(process.execPath, [TSX_CLI, SCRIPT, mode, `${n}`], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: killMs,
    killSignal: "SIGKILL",
  });
  return JSON.parse(out.trim().split("\n").at(-1)!) as Record<
    string,
    number | boolean
  >;
}

describe("the formatting matcher is bounded per page", () => {
  it.each([
    ["match", MAX_STYLED_PIECES_PER_PAGE],
    ["match-line", MAX_STYLED_PIECES_PER_PAGE],
    // The bold half of the words lie inside the wide REGULAR run too, and
    // both texts hold them: two styles is no style (since 2026-11-15).
    ["match-wide", MAX_STYLED_PIECES_PER_PAGE / 2],
    ["match-one", MAX_STYLED_PIECES_PER_PAGE],
  ] as const)(
    "%s: a page AT the cap is matched, in bounded time and memory",
    (mode, want) => {
      // Kill bound: the slowest row on CI took 3,814 ms for the whole test
      // (match-wide, 44299285879; 3,685 ms over 14 attempts 2026-11-19..21),
      // so 100 s is 26x that, under the 120 s timeout.
      const got = measure(mode, MAX_STYLED_PIECES_PER_PAGE, 100_000);
      const matched = got.matched;
      expect(matched, JSON.stringify(got)).toBe(want);
      expect(got.total).toBe(MAX_STYLED_PIECES_PER_PAGE);
      expect(got.capped).toBe(false);
      // Measured 12 / 9 / 640 ms and +2 / +2 / +3 MB on the dev host
      // (match / match-line / match-wide); 2026-11-15 with the text test:
      // 25 / 22 / 727 / 15 ms and +8 / +12 / +9 / +3 MB (match-one: one
      // run of 100,000 characters, searched within `TEXT_WINDOW`).
      // 2026-11-15 with parts (#28 slice 4): 45 / 49 / 781-1,143 / 31 ms and
      // +20 / +21 / +16-21 / +15 MB — about twice the base build's time,
      // far inside these bounds. Outside lane 1b's scope (its item is line
      // 82): it asserts as on main (CI: 3,814 ms for match-wide's whole
      // test, 44299285879, so 10 s is 2.6x).
      expect(got.ms, JSON.stringify(got)).toBeLessThan(10_000);
      // The shape, same child, alternating: the cap against an eighth for
      // the near-linear layouts (dev host 2026-11-22, time-boxed samples,
      // 2 runs: 7.6-9.8; the firstFrom-to-0 mutants the audit counted read
      // about 40-50), and against a literal 2,000 words for match-wide
      // (69-88: quadratic, 10x the words; a cap raised 1.5x reads 2.25x that
      // on any runner). Dev-host bounds; they record until CI prints its own.
      expectRatioBelow(
        "docx-run-style-match-scale",
        got.capMs as number,
        got.refMs as number,
        mode === "match-wide" ? 200 : 20,
        { mode: "measure", witness: "matched", instance: mode },
      );
      expect(got.rssDeltaMb, JSON.stringify(got)).toBeLessThan(200);
    },
    120_000,
  );

  it("a page one word past the cap is not matched at all, and says so", () => {
    // 1,230 ms on CI for the whole test (failed run 43998624497; 1,183 ms in
    // passing runs, 44321190257): 100 s is 81x.
    const got = measure("match", MAX_STYLED_PIECES_PER_PAGE + 1, 100_000);
    expect(got.capped, JSON.stringify(got)).toBe(true);
    expect(got.matched).toBe(0);
    expect(got.total).toBe(MAX_STYLED_PIECES_PER_PAGE + 1);
  }, 120_000);
});

describe("a 500-page document through PDF to Word", () => {
  it("is converted with every word formatted and read back, in bounded time and memory", () => {
    // Kill bound: 13,323 ms on CI for the whole test (ci-flake audit
    // 2026-11-19; 12,620 ms over 14 attempts 2026-11-19..21, 44428026069),
    // so 280 s is 21x that, under the 300 s timeout.
    const got = measure("engine", 500, 280_000);
    const said = JSON.stringify(got);
    // The times first, so a slow run that also tripped the page reader's
    // deadline (a production limit, 120 s) is reported as time, not as a
    // formatting failure. Measured 2.0 s, a 200 ms read-back and +54 MB on
    // the dev host; 60 s is 4.5x the CI maximum above. It ASSERTS, as on
    // main (line 81 is outside lane 1b's scope; review 2026-11-22: routed
    // to measure mode, only the 280 s kill would have failed).
    expect(got.ms, JSON.stringify(got)).toBeLessThan(60_000);
    // WAS `readBackMs < 3_000`, said to guard "one parse": it times this
    // script's OWN read-back, so the engine parsing twice could never move
    // it (ci-flake audit 2026-11-19, line 82). The one parse is a count now,
    // below; the read-back's time is a shape, 500 pages against 63 of the
    // same engine (dev host 2026-11-22: 7.5; linear about 8), and both
    // record until CI prints them. The scale's bound is 20, 2.4x the dev
    // host's 8.4 and 3x under a quadratic read-back's 63.
    expectFasterThan(
      "docx-run-style-read-back",
      got.readBackMs as number,
      3_000,
      { mode: "measure", witness: "structureParses" },
    );
    expectRatioBelow(
      "docx-run-style-read-back-scale",
      got.fullReadMs as number,
      got.smallReadMs as number,
      20,
      { mode: "measure", witness: "structureParses" },
    );
    // Health: every page went out, read back, formatted, and Word-clean.
    expect(got.pagesRead, said).toBe(500);
    expect(got.problems, said).toBe(0);
    expect(got.unformattedPages, said).toBe(0);
    expect(got.unmatchedWords, said).toBe(0);
    // The engine's check before delivery reads the structure and its
    // problems from ONE parse of the package (docx-structure's
    // inspectDocxStructure; two took 340 ms against 200 on the dev host).
    // Counted in the child: two opens of the delivered bytes, the
    // independent reader's and that one. Mutant: the check calling
    // readDocxStructure and docxStructureProblems apart reads 2 here.
    const structureParses = got.structureParses;
    expect(structureParses, said).toBe(1);
    expect(got.packageParses, said).toBe(2);
    expect(got.rssDeltaMb, said).toBeLessThan(500);
  }, 300_000);
});
