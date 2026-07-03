// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderArtifactCleanupText } from "./render";
import { evaluateArtifactInventory, type ArtifactCleanupReport } from "./evaluate";
import type { ArtifactInventoryRecord } from "./inventory";

const NOW = 1_700_000_000_000;

function rec(over: Partial<ArtifactInventoryRecord> = {}): ArtifactInventoryRecord {
  return {
    declaredLifecycle: "live",
    expiresAtMs: null,
    deleted: false,
    manifest: "valid",
    provider: "remote-configured",
    kind: "pdf",
    processor: "compress",
    age: "1-24h",
    size: "64kb-1mb",
    wellFormed: true,
    ...over,
  };
}

const REPORT: ArtifactCleanupReport = evaluateArtifactInventory(
  { records: [rec(), rec({ declaredLifecycle: null, expiresAtMs: 1000 })] },
  NOW,
);

describe("renderArtifactCleanupText", () => {
  it("renders the verdict, exit code, counts, and summary", () => {
    const out = renderArtifactCleanupText(REPORT);
    expect(out).toMatch(/verdict\s+drift \(exit 3\)/);
    expect(out).toMatch(/artifacts evaluated\s+2/);
    expect(out).toMatch(/cleanup recommended\s+1/);
    expect(out).toMatch(/expired-but-present=1/);
    expect(out).toMatch(/policy\s+pdfxyz-worker-artifact-manifest v1/);
  });

  it("omits the plan and breakdown by default", () => {
    const out = renderArtifactCleanupText(REPORT);
    expect(out).not.toMatch(/plan \(dry-run/);
    expect(out).not.toMatch(/breakdown:/);
  });

  it("includes the plan (with the never-deletes disclaimer) when asked", () => {
    const out = renderArtifactCleanupText(REPORT, { includePlan: true });
    expect(out).toMatch(/plan \(dry-run — this tool never deletes/);
    expect(out).toMatch(/delete\s+expired-but-present/);
  });

  it("includes the breakdown when asked", () => {
    const out = renderArtifactCleanupText(REPORT, { includeBreakdown: true });
    expect(out).toMatch(/breakdown:/);
    expect(out).toMatch(/providers\s+remote-configured=2/);
  });

  it("is deterministic (identical reports render byte-identically)", () => {
    expect(renderArtifactCleanupText(REPORT, { includePlan: true })).toBe(
      renderArtifactCleanupText(REPORT, { includePlan: true }),
    );
  });
});
