import { describe, expect, it } from "vitest";
import { buildNextActions, buildTrendMetadata, buildTrendResult } from "./build";
import {
  blockedWindow,
  defaultPolicy,
  incompleteWindow,
  indexedWindow,
  ingestWindowsFrom,
  makeTrend,
  NOW,
  openWindow,
  tamperedWindow,
} from "./fixtures";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_NEXT_ACTION_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_SCHEMA,
} from "./types";

describe("buildTrendResult — the full stable result", () => {
  it("carries the schema, its own stamp, metadata, and the top-level verdict + trend block", () => {
    const r = makeTrend([indexedWindow(), indexedWindow()]);
    expect(r.schema).toBe(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_SCHEMA);
    expect(r.generatedAt).toBe(NOW);
    expect(r.metadata).toEqual(buildTrendMetadata());
    expect(r.metadata.closeoutIndexSchema).toBe(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_SCHEMA);
    expect(r.verdict).toBe("stable");
    expect(r.exitCode).toBe(0);
    expect(r.trend.direction).toBe("stable");
    expect(r.trend.class).toBe("clean");
    expect(r.receipt.category).toBe(
      "worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend",
    );
    expect(r.guidance.length).toBeGreaterThan(0);
    expect(r.caveats.length).toBeGreaterThan(0);
  });

  it("maps the summary onto coverage / windowDistribution / closeoutDistribution / latest", () => {
    const r = makeTrend([indexedWindow(), openWindow()]);
    expect(r.coverage.indexesUsable).toBe(2);
    expect(r.windowDistribution.verdictCounts).toEqual({
      indexed: 1,
      "index-open": 1,
      "index-incomplete": 0,
      "index-blocked": 0,
      "index-invalid": 0,
    });
    expect(r.windowDistribution.newest).toBe("index-open");
    expect(r.closeoutDistribution.totalUsable).toBeGreaterThan(0);
    expect(r.latest!.verdict).toBe("index-open");
    expect(r.latest!.indexed).toBe(false);
  });

  it("emits points oldest → newest with per-window state + verdict", () => {
    const r = makeTrend([indexedWindow(), openWindow(), blockedWindow()]);
    expect(r.points.map((p) => p.position)).toEqual([0, 1, 2]);
    expect(r.points.map((p) => p.verdict)).toEqual(["indexed", "index-open", "index-blocked"]);
    expect(r.points.every((p) => p.state === "usable")).toBe(true);
  });

  it("is deterministic (same history + stamp + policy ⇒ byte-identical)", () => {
    const objs = [indexedWindow(), openWindow(), indexedWindow()];
    const a = buildTrendResult(NOW, ingestWindowsFrom(objs), defaultPolicy());
    const b = buildTrendResult(NOW, ingestWindowsFrom(objs), defaultPolicy());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("buildNextActions — ordered, deduped, always keep-last", () => {
  const ids = (items: readonly { id: string }[]) => items.map((i) => i.id);

  it("a stable history recommends continue-indexing then keep (in canonical order)", () => {
    const r = makeTrend([indexedWindow(), indexedWindow()]);
    expect(ids(r.nextActions)).toEqual(["continue-indexing-closeouts", "keep-closeout-index-trend"]);
  });

  it("a blocked / tampered history recommends recovery + review steps, keep last", () => {
    const r = makeTrend([indexedWindow(), tamperedWindow(), blockedWindow()]);
    expect(ids(r.nextActions)).toContain("recover-tampered-indexes");
    expect(ids(r.nextActions)).toContain("review-blocked-indexes");
    expect(ids(r.nextActions).at(-1)).toBe("keep-closeout-index-trend");
  });

  it("an improving history notes the improvement", () => {
    const r = makeTrend([openWindow(), indexedWindow()]);
    expect(r.verdict).toBe("improving");
    expect(ids(r.nextActions)).toContain("note-improving-trend");
  });

  it("the list is always a subset of the canonical ids in canonical order", () => {
    const r = makeTrend([indexedWindow(), openWindow(), incompleteWindow(), blockedWindow(), tamperedWindow()]);
    const positions = r.nextActions.map((i) =>
      RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_NEXT_ACTION_IDS.indexOf(i.id),
    );
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions]).toEqual([...positions].sort((a, b) => a - b));
  });

  it("standalone buildNextActions maps a no-index history to supply + keep", () => {
    const items = buildNextActions(["no-indexes"], "insufficient");
    expect(items.map((i) => i.id)).toEqual(["supply-closeout-indexes", "keep-closeout-index-trend"]);
  });
});
