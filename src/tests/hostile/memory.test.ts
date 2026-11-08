import { describe, expect, test } from "vitest";
import { runBounded } from "./bounded";

// Controls for the memory meter every hostile bomb test reads (./memory.ts).
// The first CI run of PR #297 showed what a blind meter does: the lifetime
// peak (`maxRSS`) was already high after a child's startup on Linux, so
// 64 MiB positive controls read 0 and every "grew less than" bound passed
// whatever happened.
const CHILD = "src/tests/hostile/memory-control.child.ts";

interface Reading {
  method: "linux-hwm" | "max-rss";
  growthMb: number;
}
async function read(mode: string): Promise<Reading> {
  const r = await runBounded(CHILD, [mode], 60_000, { maxOldSpaceMb: 1024 });
  expect(r, JSON.stringify(r)).toMatchObject({ kind: "settled" });
  return (r as { value: Reading }).value;
}

describe("memory meter", () => {
  test("sees 100 MiB touched after it starts", async () => {
    const r = await read("plain");
    expect(r.growthMb).toBeGreaterThan(80);
    expect(r.growthMb).toBeLessThan(400);
  }, 90_000);

  test("on Linux, still sees it after startup left the lifetime peak far higher", async () => {
    const r = await read("high-start");
    if (process.platform !== "linux") {
      // Nothing can reset the lifetime mark here, so this case cannot be
      // read on this platform. Its premise is checked instead: the fallback
      // is what ran, and the CI platform (Linux) is where the case runs.
      expect(r.method).toBe("max-rss");
      return;
    }
    expect(r.method).toBe("linux-hwm");
    expect(r.growthMb).toBeGreaterThan(80);
  }, 90_000);
});
