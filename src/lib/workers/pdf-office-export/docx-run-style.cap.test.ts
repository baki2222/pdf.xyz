// @vitest-environment node
/**
 * PDF to Word's formatting costs, held to bounds in a FRESH process each
 * (`src/tests/docx-run-style-measure.ts`): the matcher at the per-page cap
 * in its three layouts, a page one word past the cap, and a 500-page
 * document through the whole engine with its check before delivery. The
 * figures measured on 2026-11-15 sit beside `MAX_STYLED_PIECES_PER_PAGE`;
 * the bounds here are generous multiples of them (CI's runners are slower
 * than the dev host), and each run carries its own health check — the work
 * was done (every word matched, every page read back), so a fast run is not
 * a run that did nothing.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_STYLED_PIECES_PER_PAGE } from "./docx-run-style";

const ROOT = process.cwd();
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = path.join(ROOT, "src", "tests", "docx-run-style-measure.ts");

function measure(mode: string, n: number): Record<string, number | boolean> {
  const out = execFileSync(process.execPath, [TSX_CLI, SCRIPT, mode, `${n}`], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
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
    (mode, matched) => {
      const got = measure(mode, MAX_STYLED_PIECES_PER_PAGE);
      expect(got.matched, JSON.stringify(got)).toBe(matched);
      expect(got.total).toBe(MAX_STYLED_PIECES_PER_PAGE);
      expect(got.capped).toBe(false);
      // Measured 12 / 9 / 640 ms and +2 / +2 / +3 MB on the dev host
      // (match / match-line / match-wide); 2026-11-15 with the text test:
      // 25 / 22 / 727 / 15 ms and +8 / +12 / +9 / +3 MB (match-one: one
      // run of 100,000 characters, searched within `TEXT_WINDOW`).
      expect(got.ms, JSON.stringify(got)).toBeLessThan(10_000);
      expect(got.rssDeltaMb, JSON.stringify(got)).toBeLessThan(200);
    },
    120_000,
  );

  it("a page one word past the cap is not matched at all, and says so", () => {
    const got = measure("match", MAX_STYLED_PIECES_PER_PAGE + 1);
    expect(got.capped, JSON.stringify(got)).toBe(true);
    expect(got.matched).toBe(0);
    expect(got.total).toBe(MAX_STYLED_PIECES_PER_PAGE + 1);
  }, 120_000);
});

describe("a 500-page document through PDF to Word", () => {
  it("is converted with every word formatted and read back, in bounded time and memory", () => {
    const got = measure("engine", 500);
    // Health: every page went out, read back, formatted, and Word-clean.
    expect(got.pagesRead, JSON.stringify(got)).toBe(500);
    expect(got.problems).toBe(0);
    expect(got.unformattedPages).toBe(0);
    expect(got.unmatchedWords).toBe(0);
    // Measured 2.0 s, a 200 ms read-back and +54 MB on the dev host. The
    // read-back is the one parse the engine's check makes (under the 300 ms
    // the design allowed before the runtime path had to stream).
    expect(got.ms, JSON.stringify(got)).toBeLessThan(60_000);
    expect(got.readBackMs, JSON.stringify(got)).toBeLessThan(3_000);
    expect(got.rssDeltaMb, JSON.stringify(got)).toBeLessThan(500);
  }, 300_000);
});
