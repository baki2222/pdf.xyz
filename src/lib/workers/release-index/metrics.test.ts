import { afterEach, describe, expect, it, vi } from "vitest";
import { recordReleaseIndex, resetReleaseIndexSink, setReleaseIndexSink } from "./metrics";
import { sanitizeMetric } from "../observability/metrics";
import { RELEASE_INDEX_VERDICTS } from "./types";

afterEach(() => resetReleaseIndexSink());

describe("recordReleaseIndex", () => {
  it("emits one bounded, schema-conformant sample per verdict", () => {
    const seen: unknown[] = [];
    setReleaseIndexSink((s) => seen.push(s));
    for (const v of RELEASE_INDEX_VERDICTS) recordReleaseIndex(v);
    expect(seen).toHaveLength(RELEASE_INDEX_VERDICTS.length);
    for (const s of seen) {
      const clean = sanitizeMetric(s as never);
      expect(clean).not.toBeNull();
      expect(clean!.metric).toBe("worker_release_index_total");
      expect(clean!.kind).toBe("counter");
      expect(clean!.value).toBe(1);
    }
  });

  it("defaults to a no-op sink (emits nothing after reset)", () => {
    const spy = vi.fn();
    setReleaseIndexSink(spy);
    resetReleaseIndexSink();
    recordReleaseIndex("ok");
    expect(spy).not.toHaveBeenCalled();
  });

  it("carries the verdict as a bounded label", () => {
    let sample: { labels: Record<string, string> } | undefined;
    setReleaseIndexSink((s) => (sample = s as never));
    recordReleaseIndex("invalid");
    expect(sample!.labels).toEqual({ verdict: "invalid" });
  });
});
