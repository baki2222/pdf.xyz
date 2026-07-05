import { describe, expect, it } from "vitest";
import { buildChecklist, buildGovernanceIndexResult, buildGovernanceIndexMetadata } from "./build";
import {
  NOW,
  blockedGovernance,
  closedGovernance,
  defaultPolicy,
  ingestGovernanceFrom,
  notAGovernance,
  openGovernance,
  tamperedGovernance,
} from "./fixtures";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_CHECKLIST_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_SCHEMA,
} from "./types";

const build = (objs: unknown[], policy = {}) =>
  buildGovernanceIndexResult(NOW, ingestGovernanceFrom(objs), defaultPolicy(policy));

describe("buildGovernanceIndexResult — stable composite", () => {
  it("pins the schema + metadata + the run's OWN stamp", () => {
    const r = build([closedGovernance()]);
    expect(r.schema).toBe(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_SCHEMA);
    expect(r.generatedAt).toBe(NOW);
    expect(r.metadata.governanceSchema).toBe(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_SCHEMA);
    expect(buildGovernanceIndexMetadata().policyId).toBe(
      "pdfxyz-worker-release-decision-closeout-governance-index",
    );
  });

  it("is deterministic: the same history + stamp + policy is byte-identical", () => {
    const a = build([closedGovernance(), openGovernance()]);
    const b = build([closedGovernance(), openGovernance()]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("carries the guidance + caveats + a disclosure in the receipt", () => {
    const r = build([closedGovernance()]);
    expect(r.guidance.length).toBeGreaterThan(0);
    expect(r.caveats.length).toBeGreaterThan(0);
    expect(r.receipt.disclosure).toMatch(/INDEX SUMMARY ONLY/);
    expect(r.receipt.category).toBe("worker-release-decision-closeout-governance-index");
  });

  it("the reasons are in canonical order (superset view)", () => {
    const r = build([closedGovernance(), blockedGovernance()]);
    const order = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_REASON_IDS as readonly string[];
    const idxs = r.reasons.map((x) => order.indexOf(x.id));
    expect(idxs).toEqual([...idxs].sort((a, b) => a - b));
  });
});

describe("buildChecklist — reason → action, canonical + deduped, keep-index last", () => {
  it("a coherent history recommends continue + keep", () => {
    expect(buildChecklist(["latest-closed", "history-coherent"]).map((c) => c.id)).toEqual([
      "continue-recording-governance",
      "keep-governance-index",
    ]);
  });

  it("blocking/open/incomplete reasons map to their action, keep is always last", () => {
    const ids = buildChecklist([
      "governance-tampered",
      "latest-blocked",
      "governance-unreadable",
      "latest-open",
      "latest-incomplete",
    ]).map((c) => c.id);
    expect(ids).toContain("recover-tampered-governance");
    expect(ids).toContain("review-blocked-governance");
    expect(ids).toContain("recover-unreadable-governance");
    expect(ids).toContain("review-open-governance");
    expect(ids).toContain("complete-incomplete-governance");
    expect(ids).not.toContain("continue-recording-governance"); // not clean
    expect(ids[ids.length - 1]).toBe("keep-governance-index");
  });

  it("no-governance recommends supply-governance-records", () => {
    expect(buildChecklist(["no-governance"]).map((c) => c.id)).toEqual([
      "supply-governance-records",
      "keep-governance-index",
    ]);
  });

  it("every emitted checklist id is a known bounded id", () => {
    const known = new Set<string>(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_CHECKLIST_IDS);
    for (const objs of [[closedGovernance()], [notAGovernance()], [closedGovernance(), tamperedGovernance()]]) {
      for (const item of build(objs).checklist) expect(known.has(item.id)).toBe(true);
    }
  });
});
