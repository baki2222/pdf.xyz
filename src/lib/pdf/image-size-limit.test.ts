/**
 * JPG / PNG to PDF's "Max file size" (2026-10-31): the ladder that refits a
 * PDF under a limit, and the sentence the panel says afterwards.
 *
 * The ladder is driven by a FAKE builder here — a table of sizes per rung —
 * so each property is checked against sizes chosen to tell it apart: the
 * first fit (not the smallest), the smallest tried on a miss (not the last),
 * a builder whose sizes do NOT fall rung by rung (the lesson of PR #244:
 * real encoders are not monotonic), and the attempt and time bounds. The real
 * browser encoder is proven by the e2e case (`e2e/client-proof/cases.ts`).
 */
import { describe, expect, it } from "vitest";
import {
  KB,
  LIMIT_TIME_BUDGET_MS,
  MAX_LIMIT_ATTEMPTS,
  MAX_SIZE_LABELS,
  MAX_SIZE_PRESETS,
  MIN_LIMIT_BYTES,
  MIN_LONG_EDGE_PX,
  REENCODE_LADDER,
  chosenLimitBytes,
  fitUnderLimit,
  limitOutcome,
  rungPixelSize,
} from "./image-size-limit";
import { TARGET_SIZE_PRESETS } from "./compress-target";

/** A builder that makes a file of `sizes[rung]` bytes and records each call. */
function fakeBuilder(sizes: number[]) {
  const calls: number[] = [];
  return {
    calls,
    build: async (rung: number) => {
      calls.push(rung);
      const size = sizes[rung];
      if (size === undefined) throw new Error(`no rung ${rung}`);
      return new Uint8Array(size);
    },
  };
}

const clock = () => ({ now: () => 0 });

describe("the presets", () => {
  it("are Compress PDF's Target size presets — the same list, not a copy", () => {
    expect(MAX_SIZE_PRESETS).toBe(TARGET_SIZE_PRESETS);
    expect(MAX_SIZE_PRESETS.map((p) => p.label)).toEqual([
      "100 KB",
      "200 KB",
      "500 KB",
      "1 MB",
    ]);
  });
  it("name the panel's choices", () => {
    expect(MAX_SIZE_LABELS).toEqual({
      heading: "Max file size",
      none: "No limit",
      custom: "Custom",
    });
  });
});

describe("chosenLimitBytes", () => {
  it("No limit sends nothing; a preset is its bytes", () => {
    expect(chosenLimitBytes("none", "")).toBe(undefined);
    expect(chosenLimitBytes(100 * KB, "")).toBe(100 * KB);
  });
  it("a custom value is a whole number of KB from the floor up", () => {
    expect(chosenLimitBytes("custom", " 150 ")).toBe(150 * KB);
    expect(chosenLimitBytes("custom", String(MIN_LIMIT_BYTES / KB))).toBe(
      MIN_LIMIT_BYTES,
    );
    for (const bad of ["", "9", "12.5", "-5", "1e3", "abc", "99999999"])
      expect(chosenLimitBytes("custom", bad), bad).toBe("invalid");
  });
});

describe("the rung table", () => {
  it("is bounded, and steps quality and pixel size down, never up", () => {
    expect(REENCODE_LADDER.length).toBeGreaterThanOrEqual(4);
    expect(MAX_LIMIT_ATTEMPTS).toBe(REENCODE_LADDER.length + 1);
    for (const [i, rung] of REENCODE_LADDER.entries()) {
      expect(rung.quality).toBeGreaterThan(0);
      expect(rung.quality).toBeLessThan(1);
      expect(rung.scale).toBeGreaterThan(0);
      expect(rung.scale).toBeLessThanOrEqual(1);
      if (i > 0) {
        const prev = REENCODE_LADDER[i - 1]!;
        expect(rung.quality).toBeLessThanOrEqual(prev.quality);
        expect(rung.scale).toBeLessThanOrEqual(prev.scale);
        expect(
          rung.quality < prev.quality || rung.scale < prev.scale,
          `rung ${i} repeats rung ${i - 1}`,
        ).toBe(true);
      }
    }
  });
  it("scales an image's pixels, never below the long-edge floor or above its own size", () => {
    expect(rungPixelSize(4000, 3000, 0.25)).toEqual({
      width: 1000,
      height: 750,
    });
    // The floor holds the long edge, and the shape is kept.
    expect(rungPixelSize(1000, 500, 0.1)).toEqual({
      width: MIN_LONG_EDGE_PX,
      height: MIN_LONG_EDGE_PX / 2,
    });
    // An image already under the floor keeps its own size.
    expect(rungPixelSize(200, 100, 0.1)).toEqual({ width: 200, height: 100 });
    expect(rungPixelSize(1, 5000, 0.18).width).toBeGreaterThanOrEqual(1);
  });
});

describe("fitUnderLimit", () => {
  it("a file already under the limit is the file as built: one attempt, nothing re-encoded", async () => {
    const b = fakeBuilder([50_000, 10]);
    const { output, report } = await fitUnderLimit(
      100_000,
      MAX_LIMIT_ATTEMPTS,
      b.build,
      clock(),
    );
    expect(b.calls).toEqual([0]);
    expect(output.byteLength).toBe(50_000);
    expect(report).toMatchObject({
      chosenRung: 0,
      met: true,
      stoppedBy: "fit",
    });
  });

  it("returns the FIRST rung that fits — the best quality — not the smallest", async () => {
    // Rungs 2 and 3 both fit; 3 is smaller. The answer is 2.
    const b = fakeBuilder([300, 250, 90, 40, 20]);
    const { output, report } = await fitUnderLimit(100, 5, b.build, clock());
    expect(output.byteLength).toBe(90);
    expect(report.chosenRung).toBe(2);
    expect(report.met).toBe(true);
    // The rungs below the fit never ran.
    expect(b.calls).toEqual([0, 1, 2]);
    expect(report.tried).toEqual([
      { rung: 0, bytes: 300 },
      { rung: 1, bytes: 250 },
      { rung: 2, bytes: 90 },
    ]);
  });

  it("when nothing fits, returns the SMALLEST file made, not the last one", async () => {
    // Not monotonic: rung 2 is the smallest, the floor (4) is bigger.
    const b = fakeBuilder([500, 400, 150, 300, 260]);
    const { output, report } = await fitUnderLimit(100, 5, b.build, clock());
    expect(b.calls).toEqual([0, 1, 2, 3, 4]);
    expect(output.byteLength).toBe(150);
    expect(report).toMatchObject({
      chosenRung: 2,
      met: false,
      stoppedBy: "exhausted",
    });
    expect(Math.min(...report.tried.map((t) => t.bytes))).toBe(
      output.byteLength,
    );
  });

  it("does not stop at a rung that grew: a bigger file mid-ladder is measured and passed", async () => {
    // Rung 1 is BIGGER than the original (a re-encode can be); rung 3 fits.
    const b = fakeBuilder([200, 260, 180, 80]);
    const { output, report } = await fitUnderLimit(100, 4, b.build, clock());
    expect(output.byteLength).toBe(80);
    expect(report.chosenRung).toBe(3);
  });

  it("never runs more than the attempts it is given", async () => {
    const b = fakeBuilder(Array.from({ length: 50 }, () => 1_000));
    const { report } = await fitUnderLimit(
      100,
      MAX_LIMIT_ATTEMPTS,
      b.build,
      clock(),
    );
    expect(b.calls.length).toBe(MAX_LIMIT_ATTEMPTS);
    expect(report.tried.length).toBe(MAX_LIMIT_ATTEMPTS);
  });

  it("stops when the time budget is spent, and says so — the first attempt always runs", async () => {
    let t = 0;
    const b = fakeBuilder([500, 400, 300, 200, 100]);
    const timed = async (rung: number) => {
      t += 40_000;
      return b.build(rung);
    };
    const { output, report } = await fitUnderLimit(50, 5, timed, {
      now: () => t,
      budgetMs: LIMIT_TIME_BUDGET_MS,
    });
    // 0 → 40 s, 1 → 80 s: over the 60 s budget, so rung 2 never starts.
    expect(LIMIT_TIME_BUDGET_MS).toBe(60_000);
    expect(b.calls).toEqual([0, 1]);
    expect(report.stoppedBy).toBe("budget");
    expect(output.byteLength).toBe(400);
    expect(report.met).toBe(false);
  });

  it("yields to the page between attempts", async () => {
    const order: string[] = [];
    const b = fakeBuilder([500, 400, 50]);
    await fitUnderLimit(
      100,
      3,
      async (r) => {
        order.push(`build ${r}`);
        return b.build(r);
      },
      { now: () => 0, pause: async () => void order.push("pause") },
    );
    expect(order).toEqual(["build 0", "pause", "build 1", "pause", "build 2"]);
  });

  it("a rung that throws after the first ends the ladder with what it has", async () => {
    const { output, report } = await fitUnderLimit(
      100,
      4,
      async (r) => {
        if (r === 2) throw new Error("canvas out of memory");
        return new Uint8Array(r === 0 ? 500 : 300);
      },
      clock(),
    );
    expect(output.byteLength).toBe(300);
    expect(report).toMatchObject({ stoppedBy: "error", met: false });
  });

  it("the first attempt failing is the run failing", async () => {
    await expect(
      fitUnderLimit(
        100,
        4,
        async () => {
          throw new Error("bad image");
        },
        clock(),
      ),
    ).rejects.toThrow("bad image");
  });

  it("met is the bytes against the limit: exactly at the limit fits, one over does not", async () => {
    expect(
      (await fitUnderLimit(100, 1, fakeBuilder([100]).build, clock())).report
        .met,
    ).toBe(true);
    expect(
      (await fitUnderLimit(100, 1, fakeBuilder([101]).build, clock())).report
        .met,
    ).toBe(false);
  });
});

describe("limitOutcome", () => {
  const base = {
    limitBytes: 100 * KB,
    reencoded: false,
    flattened: false,
    images: 2,
  };
  it("under the limit, as built: the size and the limit, nothing else", () => {
    expect(limitOutcome({ ...base, outputBytes: 93 * KB })).toEqual({
      met: true,
      text: "Now 93.0 KB — under your 100 KB limit.",
    });
  });
  it("under the limit after re-encoding: says the images were saved again", () => {
    const o = limitOutcome({ ...base, outputBytes: 93 * KB, reencoded: true });
    expect(o.met).toBe(true);
    expect(o.text).toBe(
      "Now 93.0 KB — under your 100 KB limit. The images were saved again as JPEGs at a lower quality to make it smaller, so they can look softer.",
    );
  });
  it("transparency flattened onto white is said, never silent", () => {
    const o = limitOutcome({
      ...base,
      outputBytes: 93 * KB,
      reencoded: true,
      flattened: true,
    });
    expect(o.text).toContain(
      "Transparent areas were filled with white, the colour of the page.",
    );
    expect(
      limitOutcome({ ...base, outputBytes: 93 * KB, reencoded: true }).text,
    ).not.toContain("Transparent");
  });
  it("over: names the smallest and the limit, with a suggestion that fits the run", () => {
    expect(limitOutcome({ ...base, outputBytes: 140 * KB })).toEqual({
      met: false,
      text: "The smallest we could make is 140.0 KB, above your 100 KB limit. Try fewer images, or choose One PDF per image (ZIP).",
    });
    expect(
      limitOutcome({ ...base, images: 1, outputBytes: 140 * KB }).text,
    ).toBe(
      "The smallest we could make is 140.0 KB, above your 100 KB limit. Try a larger limit.",
    );
  });
  it('over after re-encoding: the note reads true on a miss too (it once said "To get there")', () => {
    const o = limitOutcome({ ...base, outputBytes: 140 * KB, reencoded: true });
    expect(o.text).toBe(
      "The smallest we could make is 140.0 KB, above your 100 KB limit. Try fewer images, or choose One PDF per image (ZIP). The images were saved again as JPEGs at a lower quality to make it smaller, so they can look softer.",
    );
  });
  it("met is read from the bytes: one byte over is over", () => {
    expect(limitOutcome({ ...base, outputBytes: 100 * KB }).met).toBe(true);
    expect(limitOutcome({ ...base, outputBytes: 100 * KB + 1 }).met).toBe(
      false,
    );
  });
});
