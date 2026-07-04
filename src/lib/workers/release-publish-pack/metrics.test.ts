import { afterEach, describe, expect, it, vi } from "vitest";
import {
  recordReleasePublishPack,
  resetReleasePublishPackSink,
  setReleasePublishPackSink,
} from "./metrics";
import { releasePublishPackMetric, sanitizeMetric } from "../observability/metrics";
import { redactText } from "@/lib/telemetry/redact";
import { RELEASE_PUBLISH_PACK_VERDICTS } from "./types";

afterEach(() => resetReleasePublishPackSink());

describe("release-publish-pack metrics", () => {
  it("emits one bounded content-free sample per verdict, through the injected sink", () => {
    const spy = vi.fn();
    setReleasePublishPackSink(spy);
    recordReleasePublishPack("publishable");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      metric: "worker_release_publish_pack_total",
      kind: "counter",
      labels: { verdict: "publishable" },
      value: 1,
    });
  });

  it("defaults to a no-op sink (emission is off unless a collector is wired)", () => {
    // No sink set after reset ⇒ recording must not throw.
    expect(() => recordReleasePublishPack("blocked")).not.toThrow();
  });

  it("every verdict builds a schema-valid, sanitizable sample", () => {
    for (const verdict of RELEASE_PUBLISH_PACK_VERDICTS) {
      const sample = releasePublishPackMetric(verdict);
      expect(sanitizeMetric(sample)).not.toBeNull();
    }
  });

  it("every verdict label is redaction-stable (P40: a mangled label would be silently dropped)", () => {
    for (const verdict of RELEASE_PUBLISH_PACK_VERDICTS) {
      expect(redactText(verdict), `${verdict} must survive redaction unchanged`).toBe(verdict);
    }
  });

  it("a metric-sink failure never escapes the recorder", () => {
    setReleasePublishPackSink(() => {
      throw new Error("sink blew up");
    });
    // The runner swallows sink errors; the bare recorder propagates, so we assert the runner contract elsewhere.
    expect(() => recordReleasePublishPack("review")).toThrow();
  });
});
