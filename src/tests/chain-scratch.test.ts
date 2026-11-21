// @vitest-environment node
/**
 * The chain tests' mutation controls write a scratch copy of a helper and
 * delete it afterwards. Written under `src/` or `e2e/`, that copy is a
 * member of every tree walk that runs at the same moment: at 70bdf71c the
 * full suite failed `chosen-pages-no-text.test.ts` with ENOENT on
 * `src/tests/.time-bound-chain-mutant/time-bound.ts` — the walk listed the
 * file, the control deleted it, the walk read it (verifier, 2026-11-21).
 *
 * The property: no control writes inside a root a tree walk reads. The
 * subjects are DISCOVERED (every test source under src/tests that writes a
 * file whose path names a mutant), not named, and must be at least the two
 * chain tests (health check: a scan that finds nothing passes vacuously).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { chainScratchDir } from "./chain-scratch";

const ROOT = join(__dirname, "..", "..");
const WALKED_ROOTS = ["src", "e2e", "scripts", "public"];

describe("mutation controls write outside every walked root", () => {
  it("chainScratchDir lies outside src, e2e, scripts and public, and is unique per process", () => {
    const dir = chainScratchDir("probe");
    const rel = relative(ROOT, dir).split(sep);
    expect(rel[0]).not.toBe("..");
    expect(WALKED_ROOTS).not.toContain(rel[0]);
    expect(dir).toContain(String(process.pid));
  });

  it("every test that writes a mutant copy takes its directory from chainScratchDir", () => {
    const here = __dirname;
    const writers = readdirSync(here)
      .filter((f) => /\.test\.tsx?$/.test(f) && f !== "chain-scratch.test.ts")
      .filter((f) => {
        const src = readFileSync(join(here, f), "utf8");
        return /writeFileSync\(/.test(src) && /mutant/i.test(src);
      });
    console.log(`[chain-scratch] mutant writers: ${writers.join(", ")}`);
    expect(writers).toEqual(
      expect.arrayContaining([
        "e2e-headroom-chain.test.ts",
        "time-bound-chain.test.ts",
      ]),
    );
    for (const f of writers) {
      const src = readFileSync(join(here, f), "utf8");
      expect(src, f).toContain("chainScratchDir(");
      expect(src, f).not.toMatch(
        /join\(\s*(__dirname|ROOT, "e2e"|ROOT, "src")[^)]*mutant/,
      );
    }
  });
});
