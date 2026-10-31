/**
 * The sentence the deep-compression panel says after a target-size run
 * (2026-10-31). Every branch, each with the control that tells it apart.
 */
import { describe, expect, it } from "vitest";
import {
  KB,
  MIN_TARGET_BYTES,
  chosenTargetBytes,
  maxTargetKb,
  TARGET_SIZE_PRESETS,
  targetLabel,
  targetOutcome,
} from "./compress-target";

describe("targetLabel", () => {
  it("the presets are the sizes portals ask for, labelled as the panel shows them", () => {
    // Labels are derived from the bytes (`targetLabel`), so this pins both:
    // a preset whose bytes drifted would be relabelled, and fail here.
    expect(TARGET_SIZE_PRESETS.map((p) => p.label)).toEqual([
      "100 KB",
      "200 KB",
      "500 KB",
      "1 MB",
    ]);
    expect(TARGET_SIZE_PRESETS.map((p) => p.bytes)).toEqual([
      100 * KB,
      200 * KB,
      500 * KB,
      1024 * KB,
    ]);
  });
  it("names a custom KB value in KB", () => {
    expect(targetLabel(150 * KB)).toBe("150 KB");
    expect(targetLabel(2048 * KB)).toBe("2 MB");
  });
});

describe("chosenTargetBytes", () => {
  const file = 600 * KB;
  it("no target sends nothing", () => {
    expect(chosenTargetBytes("none", "", file)).toBe(undefined);
  });
  it("a preset under the file is its bytes; one at or over it is invalid", () => {
    expect(chosenTargetBytes(200 * KB, "", file)).toBe(200 * KB);
    expect(chosenTargetBytes(1024 * KB, "", file)).toBe("invalid");
  });
  it("a custom value is whole KB, from the floor to just under the file", () => {
    expect(chosenTargetBytes("custom", "150", file)).toBe(150 * KB);
    expect(chosenTargetBytes("custom", " 20 ", file)).toBe(MIN_TARGET_BYTES);
    expect(chosenTargetBytes("custom", String(maxTargetKb(file)), file)).toBe(
      599 * KB,
    );
    for (const bad of ["", "19", "600", "12.5", "-5", "1e3", "abc"]) {
      expect(chosenTargetBytes("custom", bad, file), bad).toBe("invalid");
    }
  });
});

describe("targetOutcome", () => {
  const base = {
    targetBytes: 200 * KB,
    appliedTargetBytes: 200 * KB,
    grayscale: false,
  };

  it("under the target: says so, with the size received", () => {
    expect(targetOutcome({ ...base, outputBytes: 184 * KB })).toEqual({
      met: true,
      text: "Now 184.0 KB — under your 200 KB target.",
    });
  });

  it("exactly at the target counts as under", () => {
    expect(targetOutcome({ ...base, outputBytes: 200 * KB }).met).toBe(true);
  });

  it("over: names the smallest and the target, and suggests Grayscale", () => {
    expect(targetOutcome({ ...base, outputBytes: 312 * KB })).toEqual({
      met: false,
      text: "The smallest we could make is 312.0 KB, above your 200 KB target. Try Grayscale, or split the file.",
    });
  });

  it("over with Grayscale already on: does not suggest what was already done", () => {
    const o = targetOutcome({
      ...base,
      grayscale: true,
      outputBytes: 312 * KB,
    });
    expect(o.text).not.toContain("Grayscale");
    expect(o.text).toContain("splitting the file");
  });

  it("met is read from the bytes received, even if the server claims otherwise", () => {
    // The panel never sees the server's `met`; it can only be the bytes.
    expect(targetOutcome({ ...base, outputBytes: 200 * KB + 1 }).met).toBe(
      false,
    );
  });

  it("a worker that did not apply the target is not reported as 'the smallest we could make'", () => {
    for (const applied of [null, 100 * KB]) {
      const o = targetOutcome({
        ...base,
        appliedTargetBytes: applied,
        outputBytes: 312 * KB,
      });
      expect(o.text).toContain("did not apply");
      expect(o.text).not.toContain("smallest we could make");
    }
  });
});
