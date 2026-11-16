/**
 * What the Compress size guide tells a reader to type in Split PDF's "By file
 * size" field (audit #2, 2026-11-17). The comparisons are in whole steps
 * (tenths of an MB) times bytes, never in floats.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KB, MB } from "./size-presets";
import { COMPRESS_TABLE_SIZES, decimalBytes } from "./size-targets";
import { SPLIT_MB, SPLIT_STEPS_PER_MB } from "./split-size";
import {
  splitPortalSafeMb,
  splitTypedMb,
  typeableInSplit,
} from "./split-size-guide";

/** A typed value as whole steps ("1.9" -> 19), checked to be exactly that. */
function steps(typed: string): number {
  const n = Math.round(Number(typed) * SPLIT_STEPS_PER_MB);
  expect(String(n / SPLIT_STEPS_PER_MB)).toBe(typed);
  return n;
}

describe("Split PDF's size field, as the guide quotes it", () => {
  const typeable = COMPRESS_TABLE_SIZES.filter(typeableInSplit);

  it("only the whole-MB rows can be typed exactly (health check: some, not all)", () => {
    expect(typeable.length).toBeGreaterThan(0);
    expect(typeable.length).toBeLessThan(COMPRESS_TABLE_SIZES.length);
    expect(typeable).toEqual([MB, 2 * MB]);
  });

  it("a KB row cannot (positive control)", () => {
    expect(typeableInSplit(500 * KB)).toBe(false);
    expect(() => splitTypedMb(500 * KB)).toThrow();
  });

  it("the typed value means the row's bytes, by the runner's own arithmetic", () => {
    // split-runner.tsx: targetBytes = Number(targetMb) * MB
    for (const b of typeable)
      expect(Number(splitTypedMb(b)) * SPLIT_MB).toBe(b);
    expect(typeable.map(splitTypedMb)).toEqual(["1", "2"]);
  });

  it("the form-safe value stays under the form's size, and one step more does not", () => {
    for (const b of typeable) {
      const n = steps(splitPortalSafeMb(b));
      expect(n * MB).toBeLessThan(decimalBytes(b) * SPLIT_STEPS_PER_MB);
      expect((n + 1) * MB).toBeGreaterThan(
        decimalBytes(b) * SPLIT_STEPS_PER_MB,
      );
    }
  });

  it("matches the values worked out by hand", () => {
    expect(typeable.map(splitPortalSafeMb)).toEqual(["0.9", "1.9"]);
  });
});

/**
 * Split PDF's runner loads `split-size.ts`, so whatever that module imports
 * at runtime ships on Split's page. An import of `./size-targets` there put
 * the guides' table lists and `?size=` parser into it (review of 2026-11-17,
 * +248 B gz); the guide's arithmetic lives in `split-size-guide.ts` instead.
 */
describe("split-size.ts stays constants only", () => {
  /** The specifiers a source imports or re-exports at runtime (not `import type`). */
  const runtimeImports = (source: string) =>
    [
      ...source.matchAll(
        /^(?:import|export)(?!\s+type\b)[^;]*?\sfrom\s+"([^"]+)";/gms,
      ),
    ].map((m) => m[1]!);

  it("imports nothing but ./size-presets", () => {
    const source = readFileSync(join(__dirname, "split-size.ts"), "utf8");
    expect(runtimeImports(source)).toEqual(["./size-presets"]);
  });

  it("the reader sees a runtime import, and skips a type-only one (controls)", () => {
    expect(
      runtimeImports(
        [
          'import { MB } from "./size-presets";',
          'import type { X } from "./a";',
          "import {",
          "  decimalBytes,",
          '} from "./size-targets";',
          'export { Y } from "./b";',
        ].join(String.fromCharCode(10)),
      ),
    ).toEqual(["./size-presets", "./size-targets", "./b"]);
  });
});
