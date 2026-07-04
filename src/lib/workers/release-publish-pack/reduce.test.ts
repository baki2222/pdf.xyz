import { describe, expect, it } from "vitest";
import {
  computeCoverage,
  reduceArchiveSource,
  reduceGovernanceSource,
  reduceReportSource,
  reduceRestoreDrillSource,
  reduceTrendSource,
  sourceState,
} from "./reduce";
import {
  archivablePack,
  healthyGovernance,
  notADocument,
  promoteReadyReport,
  stableTrend,
  tamperedArchive,
  verifiedDrill,
} from "./fixtures";
import {
  ingestArchiveSource,
  ingestGovernanceSource,
  ingestReportSource,
  ingestRestoreDrill,
  ingestTrendSource,
} from "./ingest";

describe("sourceState", () => {
  it("maps supplied/recognized/usable to the coverage state", () => {
    expect(sourceState(false, false, false)).toBe("absent");
    expect(sourceState(true, false, false)).toBe("unreadable");
    expect(sourceState(true, true, false)).toBe("tampered");
    expect(sourceState(true, true, true)).toBe("usable");
  });
});

describe("per-source reducers", () => {
  it("reduces a usable governance source to its native verdict + ready severity", () => {
    const s = reduceGovernanceSource({ supplied: true, ingested: ingestGovernanceSource(healthyGovernance()) });
    expect(s.id).toBe("governance");
    expect(s.state).toBe("usable");
    expect(s.verdict).toBe("healthy");
    expect(s.severity).toBe("ready");
  });

  it("reduces a usable archive source (posture field) to its native posture", () => {
    const s = reduceArchiveSource({ supplied: true, ingested: ingestArchiveSource(archivablePack()) });
    expect(s.id).toBe("archive");
    expect(s.verdict).toBe("archivable");
    expect(s.severity).toBe("ready");
  });

  it("reduces a usable restore-drill source to its native verdict", () => {
    const s = reduceRestoreDrillSource({ supplied: true, ingested: ingestRestoreDrill(verifiedDrill()) });
    expect(s.id).toBe("restore-drill");
    expect(s.verdict).toBe("restore-verified");
    expect(s.severity).toBe("ready");
  });

  it("reduces a usable report source (recommendation field) to its native recommendation", () => {
    const s = reduceReportSource({ supplied: true, ingested: ingestReportSource(promoteReadyReport()) });
    expect(s.id).toBe("report");
    expect(s.verdict).toBe("promote-ready");
    expect(s.severity).toBe("ready");
  });

  it("reduces a usable trend source to its native verdict", () => {
    const s = reduceTrendSource({ supplied: true, ingested: ingestTrendSource(stableTrend()) });
    expect(s.id).toBe("trend");
    expect(s.verdict).toBe("stable");
    expect(s.severity).toBe("ready");
  });

  it("an absent source has no severity; an unreadable one is insufficient; a tampered one is blocking", () => {
    const absent = reduceArchiveSource({ supplied: false, ingested: ingestArchiveSource(undefined) });
    expect(absent.state).toBe("absent");
    expect(absent.severity).toBeNull();
    expect(absent.verdict).toBeNull();

    const unreadable = reduceArchiveSource({ supplied: true, ingested: ingestArchiveSource(notADocument()) });
    expect(unreadable.state).toBe("unreadable");
    expect(unreadable.severity).toBe("insufficient");

    const tampered = reduceArchiveSource({ supplied: true, ingested: ingestArchiveSource(tamperedArchive()) });
    expect(tampered.state).toBe("tampered");
    expect(tampered.severity).toBe("blocking");
    // A tampered source surfaces its untrusted CLAIMED posture (never trusted).
    expect(tampered.verdict).not.toBeNull();
  });
});

describe("computeCoverage", () => {
  it("counts supplied + usable and records per-source states", () => {
    const governance = reduceGovernanceSource({ supplied: true, ingested: ingestGovernanceSource(healthyGovernance()) });
    const archive = reduceArchiveSource({ supplied: true, ingested: ingestArchiveSource(archivablePack()) });
    const restoreDrill = reduceRestoreDrillSource({ supplied: true, ingested: ingestRestoreDrill(verifiedDrill()) });
    const report = reduceReportSource({ supplied: false, ingested: ingestReportSource(undefined) });
    const trend = reduceTrendSource({ supplied: true, ingested: ingestTrendSource(notADocument()) });
    const cov = computeCoverage(governance, archive, restoreDrill, report, trend);
    expect(cov.sourcesSupplied).toBe(4);
    expect(cov.sourcesUsable).toBe(3);
    expect(cov.hasGovernance).toBe(true);
    expect(cov.hasReport).toBe(false);
    expect(cov.trend).toBe("unreadable");
    expect(cov.restoreDrill).toBe("usable");
  });
});
