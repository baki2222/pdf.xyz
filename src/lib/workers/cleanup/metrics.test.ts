// @vitest-environment node
/**
 * Contract for the cleanup-verification metric sink: the default no-op, the swappable sink, the
 * content-free bounded sample it forwards, and test isolation via reset.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  recordCleanupVerification,
  resetCleanupVerificationSink,
  setCleanupVerificationSink,
} from "./metrics";
import { CLEANUP_VERIFICATION_VERDICTS } from "./types";
import { RETRIEVAL_STORAGE_PROVIDERS } from "../artifacts/access";

afterEach(resetCleanupVerificationSink);

describe("recordCleanupVerification", () => {
  it("is a no-op by default (never throws with no sink wired)", () => {
    expect(() =>
      recordCleanupVerification("verified", "remote-configured"),
    ).not.toThrow();
  });

  it("forwards one bounded sample per call to a wired sink", () => {
    const sink = vi.fn();
    setCleanupVerificationSink(sink);
    recordCleanupVerification("drift", "remote-configured");
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0]).toEqual({
      metric: "worker_cleanup_verification_total",
      kind: "counter",
      labels: { verdict: "drift", provider: "remote-configured" },
      value: 1,
    });
  });

  it("emits an on-schema sample for every verdict × provider", () => {
    const sink = vi.fn();
    setCleanupVerificationSink(sink);
    for (const verdict of CLEANUP_VERIFICATION_VERDICTS) {
      for (const provider of RETRIEVAL_STORAGE_PROVIDERS) {
        recordCleanupVerification(verdict, provider);
      }
    }
    expect(sink).toHaveBeenCalledTimes(
      CLEANUP_VERIFICATION_VERDICTS.length * RETRIEVAL_STORAGE_PROVIDERS.length,
    );
  });

  it("stops forwarding after reset", () => {
    const sink = vi.fn();
    setCleanupVerificationSink(sink);
    resetCleanupVerificationSink();
    recordCleanupVerification("verified", "local-dev");
    expect(sink).not.toHaveBeenCalled();
  });
});
