import { describe, expect, it } from "vitest";
import {
  ingestArchiveSource,
  ingestGovernanceSource,
  ingestReportSource,
  ingestRestoreDrill,
  ingestTrendSource,
} from "./ingest";
import {
  archivablePack,
  blockedGovernance,
  driftDrill,
  failedDrill,
  healthyGovernance,
  holdFailReport,
  incompleteDrill,
  notADocument,
  promoteReadyReport,
  stableTrend,
  tamperArchive,
  tamperGovernance,
  tamperReport,
  tamperRestoreDrill,
  tamperTrend,
  verifiedDrill,
  watchPack,
} from "./fixtures";

/** Deep-clone a document so a test can mutate it without disturbing the shared builder output. */
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

describe("ingest — the reused tested boundaries (governance / archive / report / trend)", () => {
  it("ingests a self-consistent governance bundle as usable with its verdict", () => {
    const i = ingestGovernanceSource(healthyGovernance());
    expect(i.recognized).toBe(true);
    expect(i.usable).toBe(true);
    expect(i.verdict).toBe("healthy");
  });

  it("catches a tampered governance verdict (recognized, not usable)", () => {
    const i = ingestGovernanceSource(tamperGovernance(healthyGovernance()));
    expect(i.recognized).toBe(true);
    expect(i.usable).toBe(false);
  });

  it("ingests archive / report / trend and catches each one's tamper", () => {
    expect(ingestArchiveSource(archivablePack()).usable).toBe(true);
    expect(ingestArchiveSource(tamperArchive(archivablePack())).usable).toBe(false);
    expect(ingestReportSource(promoteReadyReport()).usable).toBe(true);
    expect(ingestReportSource(tamperReport(promoteReadyReport())).usable).toBe(false);
    expect(ingestTrendSource(stableTrend()).usable).toBe(true);
    expect(ingestTrendSource(tamperTrend(stableTrend())).usable).toBe(false);
  });

  it("an unrecognized / non-object input is not recognized (⇒ unreadable), never throws", () => {
    for (const fn of [ingestGovernanceSource, ingestArchiveSource, ingestReportSource, ingestTrendSource, ingestRestoreDrill]) {
      expect(fn(notADocument()).recognized).toBe(false);
      expect(fn(undefined).recognized).toBe(false);
      expect(fn("a string").recognized).toBe(false);
      expect(fn(42).recognized).toBe(false);
      expect(fn(null).recognized).toBe(false);
      expect(fn([1, 2, 3]).recognized).toBe(false);
    }
  });

  it("archive ingest surfaces a tampered pack's untrusted claimed posture", () => {
    const i = ingestArchiveSource(tamperArchive(archivablePack()));
    expect(i.recognized).toBe(true);
    expect(i.usable).toBe(false);
    expect(i.posture).not.toBeNull(); // the untrusted claim, surfaced
  });
});

describe("ingestRestoreDrill — the NEW Phase 56 → 57 boundary (re-run coverage + rollup)", () => {
  it("ingests each self-consistent drill posture as usable with its verdict", () => {
    expect(ingestRestoreDrill(verifiedDrill())).toMatchObject({ usable: true, verdict: "restore-verified" });
    expect(ingestRestoreDrill(driftDrill())).toMatchObject({ usable: true, verdict: "restore-drift" });
    expect(ingestRestoreDrill(incompleteDrill())).toMatchObject({ usable: true, verdict: "restore-incomplete" });
    expect(ingestRestoreDrill(failedDrill())).toMatchObject({ usable: true, verdict: "restore-failed" });
  });

  it("catches a hand-flipped drill verdict (recognized, not usable, claim surfaced)", () => {
    const i = ingestRestoreDrill(tamperRestoreDrill(verifiedDrill()));
    expect(i.recognized).toBe(true);
    expect(i.usable).toBe(false);
    expect(i.verdict).toBe("restore-failed"); // the untrusted claim after the flip
  });

  it("catches a lied coverage count (the re-derived coverage no longer matches)", () => {
    const doc = clone(verifiedDrill()) as unknown as { coverage: { recordsMatched: number } };
    doc.coverage.recordsMatched += 1; // lie about how many records matched
    const i = ingestRestoreDrill(doc);
    expect(i.usable).toBe(false);
  });

  it("catches a flipped per-record restoreState (the rollup no longer re-derives)", () => {
    const doc = clone(verifiedDrill()) as unknown as { records: Array<{ restoreState: string }> };
    doc.records[0]!.restoreState = "restored-mismatch"; // would make the drill restore-failed
    const i = ingestRestoreDrill(doc);
    expect(i.usable).toBe(false);
  });

  it("catches a flipped policy flag that no longer produces the recorded verdict", () => {
    const doc = clone(incompleteDrill()) as unknown as { policy: { archiveOnly: boolean } };
    doc.policy.archiveOnly = true; // with archive-only, the not-exercised insufficiency would clear
    const i = ingestRestoreDrill(doc);
    expect(i.usable).toBe(false);
  });

  it("catches a malformed / off-position record and a wrong record count", () => {
    const badId = clone(verifiedDrill()) as unknown as { records: Array<{ id: string }> };
    badId.records[0]!.id = "not-a-record-id";
    expect(ingestRestoreDrill(badId).usable).toBe(false);

    const short = clone(verifiedDrill()) as unknown as { records: unknown[] };
    short.records = short.records.slice(0, 4); // fewer than five records ⇒ corrupt
    expect(ingestRestoreDrill(short).usable).toBe(false);
  });

  it("a wrong schema tag is not recognized", () => {
    const doc = clone(verifiedDrill()) as unknown as { schema: string };
    doc.schema = "pdfxyz.release-archive/1";
    expect(ingestRestoreDrill(doc).recognized).toBe(false);
  });

  it("distinguishes drill postures across usable documents (drift / incomplete / failed differ)", () => {
    // Sanity that the four builders really produce four distinct usable verdicts (guards the re-derivation).
    const verdicts = [verifiedDrill(), driftDrill(), incompleteDrill(), failedDrill()].map(
      (d) => ingestRestoreDrill(d).verdict,
    );
    expect(new Set(verdicts).size).toBe(4);
  });

  // A blocked governance is still a *usable* document (self-consistent) — usability is about tamper, not verdict.
  it("a usable-but-blocked governance is usable (usability ≠ a good verdict)", () => {
    const i = ingestGovernanceSource(blockedGovernance());
    expect(i.usable).toBe(true);
    expect(i.verdict).toBe("blocked");
  });

  it("a hold-fail report is usable (self-consistent), surfacing the hold-fail recommendation", () => {
    const i = ingestReportSource(holdFailReport());
    expect(i.usable).toBe(true);
    expect(i.recommendation).toBe("hold-fail");
  });

  it("an archive-watch pack is usable, surfacing the archive-watch posture", () => {
    const i = ingestArchiveSource(watchPack());
    expect(i.usable).toBe(true);
    expect(i.posture).toBe("archive-watch");
  });
});
