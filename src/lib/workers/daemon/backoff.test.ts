import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_IDLE_SLEEP_MS,
  IDLE_GRACE_TICKS,
  idleBackoffMs,
} from "./backoff";

const BASE = 1_000;
const MAX = DEFAULT_MAX_IDLE_SLEEP_MS;

describe("idleBackoffMs", () => {
  it("holds the base cadence through the grace window", () => {
    for (const n of [1, 2, IDLE_GRACE_TICKS - 1, IDLE_GRACE_TICKS]) {
      expect(idleBackoffMs(BASE, MAX, n)).toBe(BASE);
    }
  });

  it("doubles once past the grace window", () => {
    expect(idleBackoffMs(BASE, MAX, IDLE_GRACE_TICKS + 1)).toBe(2_000);
    expect(idleBackoffMs(BASE, MAX, IDLE_GRACE_TICKS + 2)).toBe(4_000);
    expect(idleBackoffMs(BASE, MAX, IDLE_GRACE_TICKS + 3)).toBe(8_000);
  });

  it("never exceeds the cap, however long it stays quiet", () => {
    for (const n of [IDLE_GRACE_TICKS + 4, 100, 10_000, 1e6]) {
      expect(idleBackoffMs(BASE, MAX, n)).toBe(MAX);
    }
  });

  it("treats a cap below the base as the base", () => {
    expect(idleBackoffMs(5_000, 1_000, IDLE_GRACE_TICKS + 9)).toBe(5_000);
  });

  it("stays finite for absurd idle counts", () => {
    const result = idleBackoffMs(BASE, MAX, Number.MAX_SAFE_INTEGER);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBe(MAX);
  });

  it("cuts an idle day's polling by well over an order of magnitude", () => {
    // The whole point: a worker left alone must stop paying to hear silence.
    // Before, every idle tick cost one base-cadence poll, all day long.
    const flatPollsPerDay = 86_400_000 / BASE;

    let ms = 0;
    let ticks = 0;
    while (ms < 86_400_000) {
      ticks += 1;
      ms += idleBackoffMs(BASE, MAX, ticks);
    }

    expect(flatPollsPerDay).toBe(86_400);
    expect(ticks).toBeLessThan(flatPollsPerDay / 10);
  });
});
