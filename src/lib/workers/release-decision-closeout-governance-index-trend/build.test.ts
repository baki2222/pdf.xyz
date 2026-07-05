import { describe, expect, it } from "vitest";
import { buildChecklist, buildTrendResult, buildTrendMetadata } from "./build";
import {
  blockedWindow,
  defaultPolicy,
  incompleteWindow,
  indexedWindow,
  ingestWindowsFrom,
  makeTrend,
  NOW,
  tamperedWindow,
  watchWindow,
} from "./fixtures";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_CHECKLIST_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_SCHEMA,
} from "./types";

describe("buildTrendResult — the full stable result", () => {
  it("carries the schema, its own stamp, metadata, and the top-level governanceIndexTrend rollup", () => {
    const r = makeTrend([indexedWindow(), indexedWindow()]);
    expect(r.schema).toBe(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_SCHEMA);
    expect(r.generatedAt).toBe(NOW);
    expect(r.metadata).toEqual(buildTrendMetadata());
    expect(r.metadata.governanceIndexSchema).toBe(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_SCHEMA);
    expect(r.governanceIndexTrend.verdict).toBe("trend-stable");
    expect(r.receipt.category).toBe("worker-release-decision-closeout-governance-index-trend");
    expect(r.guidance.length).toBeGreaterThan(0);
    expect(r.caveats.length).toBeGreaterThan(0);
  });

  it("emits points oldest → newest with per-window state + verdict", () => {
    const r = makeTrend([indexedWindow(), watchWindow(), blockedWindow()]);
    expect(r.points.map((p) => p.position)).toEqual([0, 1, 2]);
    expect(r.points.map((p) => p.verdict)).toEqual(["indexed", "index-open", "index-blocked"]);
    expect(r.points.every((p) => p.state === "usable")).toBe(true);
  });

  it("is deterministic (same history + stamp + policy ⇒ byte-identical)", () => {
    const objs = [indexedWindow(), watchWindow()];
    const a = buildTrendResult(NOW, ingestWindowsFrom(objs), defaultPolicy());
    const b = buildTrendResult(NOW, ingestWindowsFrom(objs), defaultPolicy());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("buildChecklist — ordered, deduped, always keep-last", () => {
  const ids = (items: readonly { id: string }[]) => items.map((i) => i.id);

  it("a stable history recommends continue-indexing then keep (in canonical order)", () => {
    const r = makeTrend([indexedWindow(), indexedWindow()]);
    expect(ids(r.checklist)).toEqual(["continue-indexing-governance", "keep-governance-index-trend"]);
  });

  it("a blocked / tampered history recommends recovery + review steps, keep last", () => {
    const r = makeTrend([indexedWindow(), tamperedWindow(), blockedWindow()]);
    expect(ids(r.checklist)).toContain("recover-tampered-indexes");
    expect(ids(r.checklist)).toContain("review-blocked-indexes");
    expect(ids(r.checklist).at(-1)).toBe("keep-governance-index-trend");
  });

  it("an improving stable history notes the improvement", () => {
    const r = makeTrend([incompleteWindow(), indexedWindow()], { maxIncomplete: 1 });
    expect(ids(r.checklist)).toContain("note-improving-trend");
    expect(ids(r.checklist)).toContain("continue-indexing-governance");
  });

  it("the checklist is always a subset of the canonical ids in canonical order", () => {
    const r = makeTrend([indexedWindow(), watchWindow(), incompleteWindow(), blockedWindow(), tamperedWindow()]);
    const order = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_CHECKLIST_IDS as readonly string[];
    const positions = ids(r.checklist).map((id) => order.indexOf(id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every((p) => p >= 0)).toBe(true);
  });

  it("standalone buildChecklist maps a no-usable history to supply + keep", () => {
    const items = buildChecklist(["no-indexes"], "trend-incomplete");
    expect(items.map((i) => i.id)).toEqual(["supply-governance-indexes", "keep-governance-index-trend"]);
  });
});
