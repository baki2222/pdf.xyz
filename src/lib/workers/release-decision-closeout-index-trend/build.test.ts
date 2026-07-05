import { describe, expect, it } from "vitest";
import { buildChecklist, buildTrendResult, buildTrendMetadata } from "./build";
import {
  blockedIndex,
  defaultPolicy,
  incompleteIndex,
  indexedIndex,
  ingestIndexesFrom,
  makeTrend,
  NOW,
  openIndex,
  tamperedIndex,
} from "./fixtures";
import {
  RELEASE_DECISION_CLOSEOUT_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CHECKLIST_IDS,
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_SCHEMA,
} from "./types";

describe("buildTrendResult — the full stable result", () => {
  it("carries the schema, its own stamp, metadata, and the top-level closeoutIndexTrend rollup", () => {
    const r = makeTrend([indexedIndex(), indexedIndex()]);
    expect(r.schema).toBe(RELEASE_DECISION_CLOSEOUT_INDEX_TREND_SCHEMA);
    expect(r.generatedAt).toBe(NOW);
    expect(r.metadata).toEqual(buildTrendMetadata());
    expect(r.metadata.indexSchema).toBe(RELEASE_DECISION_CLOSEOUT_INDEX_SCHEMA);
    expect(r.closeoutIndexTrend.verdict).toBe("trend-stable");
    expect(r.receipt.category).toBe("worker-release-decision-closeout-index-trend");
    expect(r.guidance.length).toBeGreaterThan(0);
    expect(r.caveats.length).toBeGreaterThan(0);
  });

  it("emits points oldest → newest with per-window state + verdict", () => {
    const r = makeTrend([indexedIndex(), openIndex(), blockedIndex()]);
    expect(r.points.map((p) => p.position)).toEqual([0, 1, 2]);
    expect(r.points.map((p) => p.verdict)).toEqual(["indexed", "index-open", "index-blocked"]);
    expect(r.points.every((p) => p.state === "usable")).toBe(true);
  });

  it("is deterministic (same history + stamp + policy ⇒ byte-identical)", () => {
    const objs = [indexedIndex(), openIndex()];
    const a = buildTrendResult(NOW, ingestIndexesFrom(objs), defaultPolicy());
    const b = buildTrendResult(NOW, ingestIndexesFrom(objs), defaultPolicy());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("buildChecklist — ordered, deduped, always keep-last", () => {
  const ids = (items: readonly { id: string }[]) => items.map((i) => i.id);

  it("a stable history recommends continue-indexing then keep (in canonical order)", () => {
    const r = makeTrend([indexedIndex(), indexedIndex()]);
    expect(ids(r.checklist)).toEqual(["continue-indexing-closeouts", "keep-closeout-index-trend"]);
  });

  it("a blocked / tampered history recommends recovery + review steps, keep last", () => {
    const r = makeTrend([indexedIndex(), tamperedIndex(), blockedIndex()]);
    expect(ids(r.checklist)).toContain("recover-tampered-indexes");
    expect(ids(r.checklist)).toContain("review-blocked-indexes");
    expect(ids(r.checklist).at(-1)).toBe("keep-closeout-index-trend");
  });

  it("an improving stable history notes the improvement", () => {
    const r = makeTrend([incompleteIndex(), indexedIndex()], { maxIncomplete: 1 });
    expect(ids(r.checklist)).toContain("note-improving-trend");
    expect(ids(r.checklist)).toContain("continue-indexing-closeouts");
  });

  it("the checklist is always a subset of the canonical ids in canonical order", () => {
    const r = makeTrend([indexedIndex(), openIndex(), incompleteIndex(), blockedIndex(), tamperedIndex()]);
    const order = RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CHECKLIST_IDS as readonly string[];
    const positions = ids(r.checklist).map((id) => order.indexOf(id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every((p) => p >= 0)).toBe(true);
  });

  it("standalone buildChecklist maps a no-usable history to supply + keep", () => {
    const items = buildChecklist(["no-indexes"], "trend-incomplete");
    expect(items.map((i) => i.id)).toEqual(["supply-closeout-indexes", "keep-closeout-index-trend"]);
  });
});
