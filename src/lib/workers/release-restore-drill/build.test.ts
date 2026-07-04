import { describe, expect, it } from "vitest";
import { buildRestoreResult } from "./build";
import {
  NOW,
  archivablePack,
  blockedPack,
  defaultDrillPolicy,
  healthyPackObjects,
  incompletePack,
  ingestDrillFrom,
  makeArchivePack,
  makeGovernance,
  promoteReadyReport,
  stableTrend,
  tamperArchivePack,
  tamperReport,
  warningTrend,
  watchPack,
} from "./fixtures";

/** A pack over governance ONLY (so its trend/report/audit/bundle record classes are recorded absent). */
function governanceOnlyPack() {
  const { governance } = healthyPackObjects();
  return makeArchivePack({ governance });
}

describe("release restore drill", () => {
  it("verifies an archive-only drill over a clean archivable pack", () => {
    const result = buildRestoreResult(NOW, ingestDrillFrom(archivablePack()), defaultDrillPolicy({ archiveOnly: true }), false);
    expect(result.schema).toBe("pdfxyz.release-restore-drill/1");
    expect(result.drill.verdict).toBe("restore-verified");
    expect(result.drill.exitCode).toBe(0);
    expect(result.coverage.hasArchive).toBe(true);
  });

  it("verifies a full restore that matches the archive record", () => {
    const { governance, trend, report, audit } = healthyPackObjects();
    const result = buildRestoreResult(NOW, ingestDrillFrom(archivablePack(), { governance, trend, report, audit }), defaultDrillPolicy(), false);
    expect(result.drill.verdict).toBe("restore-verified");
    expect(result.coverage.recordsMatched).toBe(4);
    expect(result.coverage.recordsFailed).toBe(0);
  });

  it("is incomplete when a usable pack is drilled but nothing is restored (never a fabricated verified)", () => {
    const result = buildRestoreResult(NOW, ingestDrillFrom(archivablePack()), defaultDrillPolicy(), false);
    expect(result.drill.verdict).toBe("restore-incomplete");
    expect(result.drill.reasons).toContain("restore-not-exercised");
    expect(result.drill.exitCode).toBe(2);
  });

  it("fails a restored record whose posture does not match the archive record (restore integrity)", () => {
    // Archive kept a STABLE trend; the operator restores a WARNING trend — a mismatch.
    const result = buildRestoreResult(NOW, ingestDrillFrom(archivablePack(), { trend: warningTrend() }), defaultDrillPolicy(), false);
    expect(result.drill.verdict).toBe("restore-failed");
    expect(result.drill.reasons).toContain("restore-mismatch");
    expect(result.records.find((r) => r.id === "trend")?.restoreState).toBe("restored-mismatch");
  });

  it("fails a corrupt restored record (recognized but no longer re-derives)", () => {
    const hostile = tamperReport(promoteReadyReport(), "hold-fail");
    const result = buildRestoreResult(NOW, ingestDrillFrom(archivablePack(), { report: hostile }), defaultDrillPolicy(), false);
    expect(result.drill.verdict).toBe("restore-failed");
    expect(result.drill.reasons).toContain("restore-corrupt");
  });

  it("fails a tampered pack whose recorded posture no longer re-derives", () => {
    const tampered = tamperArchivePack(archivablePack());
    const result = buildRestoreResult(NOW, ingestDrillFrom(tampered), defaultDrillPolicy({ archiveOnly: true }), false);
    expect(result.drill.verdict).toBe("restore-failed");
    expect(result.drill.reasons).toContain("archive-tampered");
    expect(result.archive.state).toBe("tampered");
  });

  it("surfaces the pack's own posture: watch → drift, blocked → failed, incomplete → incomplete", () => {
    const watch = buildRestoreResult(NOW, ingestDrillFrom(watchPack()), defaultDrillPolicy({ archiveOnly: true }), false);
    const blocked = buildRestoreResult(NOW, ingestDrillFrom(blockedPack()), defaultDrillPolicy({ archiveOnly: true }), false);
    const incomplete = buildRestoreResult(NOW, ingestDrillFrom(incompletePack()), defaultDrillPolicy({ archiveOnly: true }), false);
    expect(watch.drill.verdict).toBe("restore-drift");
    expect(watch.drill.reasons).toContain("archive-watch");
    expect(blocked.drill.verdict).toBe("restore-failed");
    expect(blocked.drill.reasons).toContain("archive-blocked");
    expect(incomplete.drill.verdict).toBe("restore-incomplete");
    expect(incomplete.drill.reasons).toContain("archive-incomplete");
  });

  it("flags an out-of-band restored record the archive did not index (drift), escalated by --strict-drift", () => {
    // A governance-only pack keeps no trend record; restoring a trend is unexpected.
    const ingest = ingestDrillFrom(governanceOnlyPack(), { trend: stableTrend() });
    const drift = buildRestoreResult(NOW, ingest, defaultDrillPolicy(), false);
    expect(drift.drill.verdict).toBe("restore-drift");
    expect(drift.drill.reasons).toContain("restore-unexpected");
    expect(drift.records.find((r) => r.id === "trend")?.restoreState).toBe("restored-unexpected");
    const strict = buildRestoreResult(NOW, ingest, defaultDrillPolicy({ strictDrift: true }), false);
    expect(strict.drill.verdict).toBe("restore-failed");
    expect(strict.drill.strictDriftEscalated).toBe(true);
  });

  it("--require-full-restore makes an un-restored usable record incomplete", () => {
    const { governance } = healthyPackObjects();
    const partial = buildRestoreResult(NOW, ingestDrillFrom(archivablePack(), { governance }), defaultDrillPolicy({ requireFullRestore: true }), false);
    expect(partial.drill.verdict).toBe("restore-incomplete");
    expect(partial.drill.reasons).toContain("restore-coverage-incomplete");
  });

  it("records digests when hashing is available and 'none' otherwise", () => {
    const withHash = buildRestoreResult(NOW, ingestDrillFrom(archivablePack(), {}, true), defaultDrillPolicy({ archiveOnly: true }), true);
    expect(withHash.digests.algorithm).toBe("sha256");
    expect(withHash.digests.archive).not.toBeNull();
    const noHash = buildRestoreResult(NOW, ingestDrillFrom(archivablePack()), defaultDrillPolicy({ archiveOnly: true }), false);
    expect(noHash.digests.algorithm).toBe("none");
    expect(noHash.digests.archive).toBeNull();
  });

  it("a governance-blocked composed with makeGovernance is caught as blocked", () => {
    const pack = makeArchivePack({ governance: makeGovernance({ trend: warningTrend() }) });
    const result = buildRestoreResult(NOW, ingestDrillFrom(pack), defaultDrillPolicy({ archiveOnly: true }), false);
    expect(result.drill.verdict).toBe("restore-drift");
  });
});
