// @vitest-environment node
/**
 * Unit proofs for the release-report reducer (Phase 52): coverage-state derivation, common-ladder severity
 * mapping, and the bounded coverage fold. A not-usable / not-supplied source gets safe, bounded defaults so
 * the rollup never trusts stale facts.
 */

import { describe, expect, it } from "vitest";
import { computeCoverage, reduceAuditSource, reduceBundleSource, sourceState } from "./reduce";
import type { IngestedAudit, IngestedBundle, SourceIngest } from "./ingest";
import { failBundle, ingestSourcesFrom, notADocument, passAudit, passBundle, tamperBundle, warnBundle } from "./fixtures";

const bundleIngest = (obj: unknown): SourceIngest<IngestedBundle> => ingestSourcesFrom({ bundle: obj }).bundle;
const auditIngest = (obj: unknown): SourceIngest<IngestedAudit> => ingestSourcesFrom({ audit: obj }).audit;

describe("release-report reduce — coverage state", () => {
  it("maps supplied/recognized/usable to the four states", () => {
    expect(sourceState(false, false, false)).toBe("absent");
    expect(sourceState(true, false, false)).toBe("unreadable");
    expect(sourceState(true, true, false)).toBe("tampered");
    expect(sourceState(true, true, true)).toBe("usable");
  });

  it("a not-supplied source is absent with a null severity and null facts", () => {
    const s = reduceBundleSource({ supplied: false, ingested: ingestSourcesFrom({}).bundle.ingested });
    expect(s.state).toBe("absent");
    expect(s.severity).toBeNull();
    expect(s.facts).toBeNull();
    expect(s.verdict).toBeNull();
  });
});

describe("release-report reduce — bundle source", () => {
  it("a usable pass bundle maps to a `ready` severity with bounded facts", () => {
    const s = reduceBundleSource(bundleIngest(passBundle()));
    expect(s).toMatchObject({ id: "bundle", state: "usable", severity: "ready", verdict: "pass" });
    expect(s.facts).not.toBeNull();
    if (s.id === "bundle") expect(typeof s.facts?.stagesPresent).toBe("number");
  });

  it("verdict → severity: warn→advisory, fail→blocking", () => {
    expect(reduceBundleSource(bundleIngest(warnBundle())).severity).toBe("advisory");
    expect(reduceBundleSource(bundleIngest(failBundle())).severity).toBe("blocking");
  });

  it("a tampered bundle is `tampered` (blocking), surfaces its claimed verdict, drops trusted facts", () => {
    const s = reduceBundleSource(bundleIngest(tamperBundle(passBundle())));
    expect(s.state).toBe("tampered");
    expect(s.severity).toBe("blocking");
    expect(s.facts).toBeNull();
    expect(s.verdict).not.toBeNull(); // the untrusted claimed verdict is surfaced
  });

  it("an unreadable bundle is `unreadable` (insufficient) with null facts", () => {
    const s = reduceBundleSource(bundleIngest(notADocument()));
    expect(s.state).toBe("unreadable");
    expect(s.severity).toBe("insufficient");
    expect(s.facts).toBeNull();
  });
});

describe("release-report reduce — audit source", () => {
  it("a usable pass audit maps to a `ready` severity with bounded facts", () => {
    const s = reduceAuditSource(auditIngest(passAudit()));
    expect(s).toMatchObject({ id: "audit", state: "usable", severity: "ready", verdict: "pass" });
    if (s.id === "audit") expect(s.facts?.mode).toBe("pair");
  });
});

describe("release-report reduce — coverage fold", () => {
  it("counts supplied + usable and records each source's state", () => {
    const i = ingestSourcesFrom({ bundle: passBundle(), audit: passAudit() });
    const cov = computeCoverage(reduceBundleSource(i.bundle), reduceAuditSource(i.audit));
    expect(cov).toMatchObject({
      sourcesSupplied: 2,
      sourcesUsable: 2,
      bundle: "usable",
      audit: "usable",
      hasBundle: true,
      hasAudit: true,
    });
  });

  it("a bundle-only run reports one usable source, audit absent", () => {
    const i = ingestSourcesFrom({ bundle: passBundle() });
    const cov = computeCoverage(reduceBundleSource(i.bundle), reduceAuditSource(i.audit));
    expect(cov).toMatchObject({ sourcesSupplied: 1, sourcesUsable: 1, audit: "absent", hasBundle: true, hasAudit: false });
  });

  it("a tampered source does not count as usable", () => {
    const i = ingestSourcesFrom({ bundle: tamperBundle(passBundle()) });
    const cov = computeCoverage(reduceBundleSource(i.bundle), reduceAuditSource(i.audit));
    expect(cov).toMatchObject({ sourcesUsable: 0, bundle: "tampered", hasBundle: false });
  });
});
