import { describe, expect, it } from "vitest";
import { buildChecklist, buildCloseoutIndexResult, buildCloseoutIndexMetadata } from "./build";
import {
  NOW,
  blockedCloseout,
  closedCloseout,
  defaultPolicy,
  ingestCloseoutsFrom,
  notACloseout,
  openCloseout,
  tamperedCloseout,
} from "./fixtures";
import {
  RELEASE_DECISION_CLOSEOUT_INDEX_CHECKLIST_IDS,
  RELEASE_DECISION_CLOSEOUT_INDEX_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_SCHEMA,
} from "./types";

const build = (objs: unknown[], policy = {}) =>
  buildCloseoutIndexResult(NOW, ingestCloseoutsFrom(objs), defaultPolicy(policy));

describe("buildCloseoutIndexResult — stable composite", () => {
  it("pins the schema + metadata + the run's OWN stamp", () => {
    const r = build([closedCloseout()]);
    expect(r.schema).toBe(RELEASE_DECISION_CLOSEOUT_INDEX_SCHEMA);
    expect(r.generatedAt).toBe(NOW);
    expect(r.metadata.closeoutSchema).toBe(RELEASE_DECISION_CLOSEOUT_SCHEMA);
    expect(buildCloseoutIndexMetadata().policyId).toBe("pdfxyz-worker-release-decision-closeout-index");
  });

  it("is deterministic: the same history + stamp + policy is byte-identical", () => {
    const a = build([closedCloseout(), openCloseout()]);
    const b = build([closedCloseout(), openCloseout()]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("carries the guidance + caveats + a disclosure in the receipt", () => {
    const r = build([closedCloseout()]);
    expect(r.guidance.length).toBeGreaterThan(0);
    expect(r.caveats.length).toBeGreaterThan(0);
    expect(r.receipt.disclosure).toMatch(/INDEX SUMMARY ONLY/);
    expect(r.receipt.category).toBe("worker-release-decision-closeout-index");
  });

  it("the reasons are in canonical order (superset view)", () => {
    const r = build([closedCloseout(), blockedCloseout()]);
    const order = RELEASE_DECISION_CLOSEOUT_INDEX_REASON_IDS as readonly string[];
    const idxs = r.reasons.map((x) => order.indexOf(x.id));
    expect(idxs).toEqual([...idxs].sort((a, b) => a - b));
  });
});

describe("buildChecklist — reason → action, canonical + deduped, keep-index last", () => {
  it("a coherent history recommends continue + keep", () => {
    expect(buildChecklist(["latest-closed", "history-coherent"]).map((c) => c.id)).toEqual([
      "continue-recording-closeouts",
      "keep-closeout-index",
    ]);
  });

  it("blocking/open/incomplete reasons map to their action, keep is always last", () => {
    const ids = buildChecklist([
      "closeout-tampered",
      "latest-blocked",
      "closeout-unreadable",
      "latest-open",
      "latest-incomplete",
    ]).map((c) => c.id);
    expect(ids).toContain("recover-tampered-closeouts");
    expect(ids).toContain("review-blocked-closeouts");
    expect(ids).toContain("recover-unreadable-closeouts");
    expect(ids).toContain("review-open-closeouts");
    expect(ids).toContain("complete-incomplete-closeouts");
    expect(ids).not.toContain("continue-recording-closeouts"); // not clean
    expect(ids[ids.length - 1]).toBe("keep-closeout-index");
  });

  it("no-closeouts recommends supply-closeout-records", () => {
    expect(buildChecklist(["no-closeouts"]).map((c) => c.id)).toEqual([
      "supply-closeout-records",
      "keep-closeout-index",
    ]);
  });

  it("every emitted checklist id is a known bounded id", () => {
    const known = new Set<string>(RELEASE_DECISION_CLOSEOUT_INDEX_CHECKLIST_IDS);
    for (const objs of [[closedCloseout()], [notACloseout()], [closedCloseout(), tamperedCloseout()]]) {
      for (const item of build(objs).checklist) expect(known.has(item.id)).toBe(true);
    }
  });
});
