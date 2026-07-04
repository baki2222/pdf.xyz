import { describe, expect, it } from "vitest";
import { buildPublishPackResult } from "./build";
import {
  archivablePack,
  blockedGovernance,
  failedDrill,
  healthyGovernance,
  incompleteGovernance,
  ingestPublishPackFrom,
  makePublishPack,
  NOW,
  notADocument,
  promoteReadyReport,
  stableTrend,
  verifiedDrill,
  watchGovernance,
} from "./fixtures";
import {
  RELEASE_PUBLISH_PACK_CHECKLIST_IDS,
  RELEASE_PUBLISH_PACK_SCHEMA,
  RELEASE_PUBLISH_PACK_SOURCE_IDS,
} from "./types";
import { defaultPolicy } from "./fixtures";

/** The checklist ids on a built pack, in order. */
function checklistIds(objs: Parameters<typeof makePublishPack>[0], policy = {}) {
  return makePublishPack(objs, policy).checklist.map((c) => c.id);
}

describe("buildPublishPackResult", () => {
  it("emits a stable, well-formed result with sources in canonical order", () => {
    const result = buildPublishPackResult(
      NOW,
      ingestPublishPackFrom({
        governance: healthyGovernance(),
        archive: archivablePack(),
        restoreDrill: verifiedDrill(),
        report: promoteReadyReport(),
        trend: stableTrend(),
      }),
      defaultPolicy(),
    );
    expect(result.schema).toBe(RELEASE_PUBLISH_PACK_SCHEMA);
    expect(result.generatedAt).toBe(NOW);
    expect(result.sources.map((s) => s.id)).toEqual([...RELEASE_PUBLISH_PACK_SOURCE_IDS]);
    expect(result.metadata.governanceSchema).toBe("pdfxyz.release-governance/1");
    expect(result.metadata.restoreDrillSchema).toBe("pdfxyz.release-restore-drill/1");
    expect(result.pack.verdict).toBe("publishable");
    expect(result.disclosure.classification).toBe("share-safe");
    expect(result.receipt.category).toBe("worker-release-publish-pack");
    expect(result.receipt.verdict).toBe("publishable");
    expect(result.receipt.sourcesUsable).toBe(5);
  });

  it("is deterministic (same inputs + stamp ⇒ byte-identical)", () => {
    const objs = { governance: healthyGovernance(), archive: archivablePack() };
    const a = buildPublishPackResult(NOW, ingestPublishPackFrom(objs), defaultPolicy());
    const b = buildPublishPackResult(NOW, ingestPublishPackFrom(objs), defaultPolicy());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("the disclosure note matches the classification", () => {
    expect(makePublishPack({ governance: healthyGovernance() }).disclosure.note).toMatch(/SHARE-SAFE/);
    expect(makePublishPack({ governance: watchGovernance() }).disclosure.note).toMatch(/INTERNAL-REVIEW/);
    expect(makePublishPack({ governance: blockedGovernance() }).disclosure.note).toMatch(/do NOT share/i);
  });
});

describe("buildChecklist — the derived handoff checklist", () => {
  it("a publishable pack lists what to include + the hand-off step, always keeping the record", () => {
    const ids = checklistIds({
      governance: healthyGovernance(),
      archive: archivablePack(),
      restoreDrill: verifiedDrill(),
      report: promoteReadyReport(),
    });
    expect(ids).toContain("include-governance-summary");
    expect(ids).toContain("include-archive-manifest");
    expect(ids).toContain("include-restore-drill");
    expect(ids).toContain("include-supporting-evidence");
    expect(ids).toContain("hand-off-share-safe-pack");
    expect(ids).toContain("keep-publish-pack-record");
    expect(ids).not.toContain("resolve-blockers-before-sharing");
    expect(ids).not.toContain("mark-internal-review-only");
  });

  it("a review pack marks internal-review and does NOT offer the hand-off step", () => {
    const ids = checklistIds({ governance: watchGovernance() });
    expect(ids).toContain("mark-internal-review-only");
    expect(ids).not.toContain("hand-off-share-safe-pack");
    expect(ids).toContain("keep-publish-pack-record");
  });

  it("an incomplete pack asks to complete evidence + mark internal-review", () => {
    const ids = checklistIds({ governance: incompleteGovernance() });
    expect(ids).toContain("complete-missing-evidence");
    expect(ids).toContain("mark-internal-review-only");
  });

  it("a blocked pack asks to resolve blockers and does NOT list include-* / hand-off", () => {
    const ids = checklistIds({ governance: healthyGovernance(), restoreDrill: failedDrill() });
    expect(ids).toContain("resolve-blockers-before-sharing");
    expect(ids).not.toContain("include-governance-summary");
    expect(ids).not.toContain("hand-off-share-safe-pack");
    expect(ids).not.toContain("mark-internal-review-only"); // blocked disclosure ≠ internal-review
  });

  it("a tampered source adds recover-tampered-evidence", () => {
    const ids = checklistIds({ governance: notADocument(), archive: verifiedDrillAsTamper() });
    expect(ids).toContain("recover-tampered-evidence");
  });

  it("the checklist is emitted in canonical order", () => {
    const result = makePublishPack({ governance: incompleteGovernance() });
    const ids = result.checklist.map((c) => c.id);
    const canonical = RELEASE_PUBLISH_PACK_CHECKLIST_IDS.filter((id) => ids.includes(id));
    expect(ids).toEqual([...canonical]);
  });

  it("a strict-escalated review→blocked lists resolve-blockers + keeps the record", () => {
    const result = makePublishPack({ governance: watchGovernance() }, { strict: true });
    expect(result.pack.verdict).toBe("blocked");
    const ids = result.checklist.map((c) => c.id);
    expect(ids).toContain("resolve-blockers-before-sharing");
    expect(ids).toContain("keep-publish-pack-record");
  });
});

/** A tampered archive document (an archivable pack whose posture was flipped) — used for the checklist test. */
function verifiedDrillAsTamper(): Record<string, unknown> {
  const pack = JSON.parse(JSON.stringify(archivablePack())) as { archive: { posture: string } };
  pack.archive.posture = "archive-blocked";
  return pack as unknown as Record<string, unknown>;
}
