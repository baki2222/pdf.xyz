// @vitest-environment node
/**
 * Contract for the cleanup-projection metric sink: the default no-op, the swappable sink, the
 * content-free bounded sample it forwards, and test isolation via reset. Mirrors the Phase 42
 * cleanup-verification metric contract.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  recordProjection,
  resetProjectionSink,
  setProjectionSink,
} from "./metrics";
import { PROJECTION_TARGETS, PROJECTION_VERDICTS } from "./types";

afterEach(resetProjectionSink);

describe("recordProjection", () => {
  it("is a no-op by default (never throws with no sink wired)", () => {
    expect(() => recordProjection("evidence", "projected")).not.toThrow();
  });

  it("forwards one bounded, content-free sample per call to a wired sink", () => {
    const sink = vi.fn();
    setProjectionSink(sink);
    recordProjection("inventory", "unsafe");
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0]).toEqual({
      metric: "worker_cleanup_projection_total",
      kind: "counter",
      labels: { target: "inventory", verdict: "unsafe" },
      value: 1,
    });
  });

  it("emits an on-schema sample for every target × verdict", () => {
    const sink = vi.fn();
    setProjectionSink(sink);
    for (const target of PROJECTION_TARGETS) {
      for (const verdict of PROJECTION_VERDICTS) {
        recordProjection(target, verdict);
      }
    }
    expect(sink).toHaveBeenCalledTimes(
      PROJECTION_TARGETS.length * PROJECTION_VERDICTS.length,
    );
  });

  it("stops forwarding after reset", () => {
    const sink = vi.fn();
    setProjectionSink(sink);
    resetProjectionSink();
    recordProjection("evidence", "projected");
    expect(sink).not.toHaveBeenCalled();
  });
});
