/**
 * Trust-boundary tests for the optional ops-bundle ingest: it reads only the bounded composite
 * severity, drops every section/free-text field, and stays honest about absence/unreadability.
 */

import { describe, expect, it } from "vitest";
import {
  ingestOpsBundleSummary,
  NOT_CONFIGURED_OPS_BUNDLE,
  unreadableOpsBundle,
} from "./opsbundle";
import { OPS_BUNDLE_SCHEMA } from "../ops-bundle/types";

function bundleJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: OPS_BUNDLE_SCHEMA,
    policyId: "pdfxyz-worker-ops-evidence-bundle",
    policyVersion: 1,
    generatedAt: "2026-07-03T00:00:00.000Z",
    rollup: { severity: "ok", exitCode: 0, ok: true, detail: "healthy" },
    sections: { operations: { summary: "runtime detail here" } },
    caveats: ["c"],
    ...over,
  });
}

describe("ingestOpsBundleSummary", () => {
  it("reads a valid bundle's composite severity only", () => {
    const section = ingestOpsBundleSummary(bundleJson({ rollup: { severity: "critical" } }));
    expect(section.source).toBe("supplied");
    expect(section.present).toBe(true);
    expect(section.severity).toBe("critical");
  });

  it("does not copy any section/free-text field", () => {
    const section = ingestOpsBundleSummary(
      bundleJson({ sections: { operations: { summary: "s3://leaky-bucket/x.pdf secret AKIA" } } }),
    );
    expect(JSON.stringify(section)).not.toContain("leaky-bucket");
    expect(JSON.stringify(section)).not.toContain("AKIA");
  });

  it("treats absence as not-configured (never a fault)", () => {
    expect(ingestOpsBundleSummary(null)).toEqual(NOT_CONFIGURED_OPS_BUNDLE);
    expect(NOT_CONFIGURED_OPS_BUNDLE.severity).toBeNull();
  });

  it("treats malformed / wrong-schema / bad-severity input as unreadable (never echoed)", () => {
    for (const text of ["nope", JSON.stringify({ schema: "other" }), bundleJson({ rollup: { severity: "bogus" } })]) {
      const section = ingestOpsBundleSummary(text);
      expect(section.source).toBe("unreadable");
      expect(section.severity).toBeNull();
    }
  });

  it("surfaces a bundle-reported usage error as context with a null severity", () => {
    const section = ingestOpsBundleSummary(JSON.stringify({ schema: OPS_BUNDLE_SCHEMA, ok: false, error: "usage", exitCode: 1 }));
    expect(section.source).toBe("supplied");
    expect(section.present).toBe(true);
    expect(section.severity).toBeNull();
    expect(section.detail).toContain("usage error");
  });

  it("unreadableOpsBundle() is a bounded absent section", () => {
    expect(unreadableOpsBundle().source).toBe("unreadable");
    expect(unreadableOpsBundle().severity).toBeNull();
  });
});
