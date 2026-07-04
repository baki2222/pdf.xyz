import { afterEach, describe, expect, it, vi } from "vitest";
import { recordReleaseAck, resetReleaseAckSink, setReleaseAckSink } from "./metrics";
import { releaseAckMetric, sanitizeMetric } from "../observability/metrics";
import { redactText } from "@/lib/telemetry/redact";
import { RELEASE_ACK_VERDICTS } from "./types";

afterEach(() => resetReleaseAckSink());

describe("release-ack metrics", () => {
  it("emits one bounded content-free sample per verdict, through the injected sink", () => {
    const spy = vi.fn();
    setReleaseAckSink(spy);
    recordReleaseAck("acknowledged");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      metric: "worker_release_ack_total",
      kind: "counter",
      labels: { verdict: "acknowledged" },
      value: 1,
    });
  });

  it("defaults to a no-op sink (emission is off unless a collector is wired)", () => {
    expect(() => recordReleaseAck("rejected")).not.toThrow();
  });

  it("every verdict builds a schema-valid, sanitizable sample (registered metric)", () => {
    for (const verdict of RELEASE_ACK_VERDICTS) {
      expect(sanitizeMetric(releaseAckMetric(verdict)), `${verdict} must sanitize`).not.toBeNull();
    }
  });

  it("every verdict label is redaction-stable (P40: a mangled label would be silently dropped)", () => {
    for (const verdict of RELEASE_ACK_VERDICTS) {
      expect(redactText(verdict), `${verdict} must survive redaction unchanged`).toBe(verdict);
    }
  });

  it("a metric-sink failure propagates from the bare recorder (the runner swallows it)", () => {
    setReleaseAckSink(() => {
      throw new Error("sink blew up");
    });
    expect(() => recordReleaseAck("invalid")).toThrow();
  });
});
