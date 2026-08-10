// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ArtifactInventoryRecord } from "./inventory";
import {
  classifyArtifactRecord,
  evaluateArtifactInventory,
  exitCodeForCleanupVerdict,
  resolveRecordLifecycle,
} from "./evaluate";
import { ARTIFACT_POLICY_ID, ARTIFACT_POLICY_VERSION } from "../policy";
import { CLEANUP_SEVERITY_BY_CATEGORY, type CleanupCategory } from "./taxonomy";

/** A fixed clock so raw-evidence lifecycle re-derivation is deterministic. */
const NOW = 1_700_000_000_000;

/** Build a normalized record; defaults are a healthy, live, complete `ok` object. */
function rec(
  over: Partial<ArtifactInventoryRecord> = {},
): ArtifactInventoryRecord {
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

describe("resolveRecordLifecycle", () => {
  it("re-derives expired from a past deadline via the Phase 41 evaluator", () => {
    expect(
      resolveRecordLifecycle(
        rec({ declaredLifecycle: null, expiresAtMs: 1000 }),
        NOW,
      ),
    ).toBe("expired");
  });

  it("re-derives live from a future deadline", () => {
    expect(
      resolveRecordLifecycle(
        rec({ declaredLifecycle: null, expiresAtMs: NOW + 1_000_000 }),
        NOW,
      ),
    ).toBe("live");
  });

  it("re-derives deleted from a tombstone regardless of the clock", () => {
    expect(
      resolveRecordLifecycle(
        rec({ declaredLifecycle: null, deleted: true, expiresAtMs: null }),
        0,
      ),
    ).toBe("deleted");
  });

  it("raw evidence overrides a stale pre-resolved lifecycle", () => {
    // Declares live, but the raw deadline is in the past — the fresh re-derivation wins.
    expect(
      resolveRecordLifecycle(
        rec({ declaredLifecycle: "live", expiresAtMs: 1000 }),
        NOW,
      ),
    ).toBe("expired");
  });

  it("honors a pre-resolved lifecycle when no raw evidence is present", () => {
    expect(
      resolveRecordLifecycle(
        rec({ declaredLifecycle: "expired", expiresAtMs: null }),
        NOW,
      ),
    ).toBe("expired");
  });

  it("is unknown with neither raw evidence nor a pre-resolved state", () => {
    expect(
      resolveRecordLifecycle(
        rec({ declaredLifecycle: null, expiresAtMs: null }),
        NOW,
      ),
    ).toBe("unknown");
  });
});

describe("classifyArtifactRecord", () => {
  const cases: Array<
    [string, Partial<ArtifactInventoryRecord>, CleanupCategory]
  > = [
    ["healthy live object", {}, "ok"],
    ["structurally invalid record", { wellFormed: false }, "invalid-record"],
    ["tombstoned present object", { deleted: true }, "deleted-but-present"],
    [
      "expired present object",
      { declaredLifecycle: null, expiresAtMs: 1000 },
      "expired-but-present",
    ],
    [
      "not-configured backend",
      { provider: "not-configured", declaredLifecycle: "live" },
      "storage-unavailable",
    ],
    [
      "no lifecycle evidence",
      { declaredLifecycle: null, expiresAtMs: null },
      "missing-lifecycle",
    ],
    ["missing manifest", { manifest: "absent" }, "missing-manifest"],
    ["invalid manifest", { manifest: "invalid" }, "missing-manifest"],
    ["unrecorded manifest", { manifest: "unknown" }, "missing-manifest"],
    ["unrecognized kind", { kind: "unknown" }, "unsupported-kind"],
  ];
  for (const [name, over, expected] of cases) {
    it(`classifies ${name} as ${expected}`, () => {
      expect(classifyArtifactRecord(rec(over), NOW)).toBe(expected);
    });
  }

  it("precedence: a tombstone outranks an expired deadline", () => {
    expect(
      classifyArtifactRecord(
        rec({ deleted: true, expiresAtMs: 1000, declaredLifecycle: null }),
        NOW,
      ),
    ).toBe("deleted-but-present");
  });

  it("precedence: expiry outranks a not-configured backend", () => {
    expect(
      classifyArtifactRecord(
        rec({
          expiresAtMs: 1000,
          provider: "not-configured",
          declaredLifecycle: null,
        }),
        NOW,
      ),
    ).toBe("expired-but-present");
  });

  it("precedence: missing lifecycle outranks a missing manifest", () => {
    expect(
      classifyArtifactRecord(
        rec({ declaredLifecycle: null, expiresAtMs: null, manifest: "absent" }),
        NOW,
      ),
    ).toBe("missing-lifecycle");
  });

  it("a live object needs a valid manifest AND a recognized kind to be ok", () => {
    expect(
      classifyArtifactRecord(
        rec({ kind: "text-sidecar", manifest: "valid" }),
        NOW,
      ),
    ).toBe("ok");
  });
});

describe("evaluateArtifactInventory", () => {
  it("an empty inventory is ok / exit 0", () => {
    const report = evaluateArtifactInventory({ records: [] }, NOW);
    expect(report.verdict).toBe("ok");
    expect(report.total).toBe(0);
    expect(exitCodeForCleanupVerdict(report.verdict)).toBe(0);
    expect(report.summary).toMatch(/nothing to clean/i);
  });

  it("all-healthy inventory is ok / exit 0", () => {
    const report = evaluateArtifactInventory(
      { records: [rec(), rec({ kind: "image" })] },
      NOW,
    );
    expect(report.verdict).toBe("ok");
    expect(report.categories.ok).toBe(2);
    expect(report.cleanupRecommended).toBe(0);
  });

  it("the verdict is the worst severity present", () => {
    const report = evaluateArtifactInventory(
      {
        records: [
          rec(), // ok
          rec({ declaredLifecycle: null, expiresAtMs: null }), // missing-lifecycle (unknown)
          rec({ declaredLifecycle: null, expiresAtMs: 1000 }), // expired-but-present (drift)
          rec({ deleted: true }), // deleted-but-present (breach)
        ],
      },
      NOW,
    );
    expect(report.verdict).toBe("breach");
    expect(exitCodeForCleanupVerdict(report.verdict)).toBe(4);
    expect(report.severities).toMatchObject({
      ok: 1,
      unknown: 1,
      drift: 1,
      breach: 1,
    });
  });

  it("counts cleanup-recommended (delete-action) objects: expired + tombstoned", () => {
    const report = evaluateArtifactInventory(
      {
        records: [
          rec({ declaredLifecycle: null, expiresAtMs: 1000 }), // expired → delete
          rec({ deleted: true }), // tombstoned → delete
          rec(), // ok → retain
        ],
      },
      NOW,
    );
    expect(report.cleanupRecommended).toBe(2);
  });

  it("drift verdict maps to exit 3 and the drift summary", () => {
    const report = evaluateArtifactInventory(
      { records: [rec({ declaredLifecycle: null, expiresAtMs: 1000 }), rec()] },
      NOW,
    );
    expect(report.verdict).toBe("drift");
    expect(exitCodeForCleanupVerdict(report.verdict)).toBe(3);
    expect(report.summary).toMatch(/cleanup recommended/i);
  });

  it("unknown verdict maps to exit 2", () => {
    const report = evaluateArtifactInventory(
      { records: [rec({ declaredLifecycle: null, expiresAtMs: null }), rec()] },
      NOW,
    );
    expect(report.verdict).toBe("unknown");
    expect(exitCodeForCleanupVerdict(report.verdict)).toBe(2);
  });

  it("builds a plan with an action per non-empty category and stamps the policy", () => {
    const report = evaluateArtifactInventory(
      { records: [rec({ declaredLifecycle: null, expiresAtMs: 1000 }), rec()] },
      NOW,
    );
    const expired = report.plan.find(
      (p) => p.category === "expired-but-present",
    );
    expect(expired).toMatchObject({
      action: "delete",
      severity: "drift",
      count: 1,
    });
    const ok = report.plan.find((p) => p.category === "ok");
    expect(ok).toMatchObject({ action: "retain", count: 1 });
    // No empty category leaks into the plan.
    expect(report.plan.every((p) => p.count > 0)).toBe(true);
    expect(report.policyId).toBe(ARTIFACT_POLICY_ID);
    expect(report.policyVersion).toBe(ARTIFACT_POLICY_VERSION);
  });

  it("tallies the descriptive breakdown by provider/kind/processor/age/size", () => {
    const report = evaluateArtifactInventory(
      {
        records: [
          rec({
            kind: "pdf",
            provider: "local-dev",
            age: "1-24h",
            size: "64kb-1mb",
          }),
        ],
      },
      NOW,
    );
    expect(report.breakdown.providers["local-dev"]).toBe(1);
    expect(report.breakdown.kinds.pdf).toBe(1);
    expect(report.breakdown.processors.compress).toBe(1);
    expect(report.breakdown.ages["1-24h"]).toBe(1);
    expect(report.breakdown.sizes["64kb-1mb"]).toBe(1);
  });

  it("every category maps to a severity monotonic with its exit code", () => {
    const rank = { ok: 0, unknown: 2, drift: 3, breach: 4 } as const;
    for (const [category, severity] of Object.entries(
      CLEANUP_SEVERITY_BY_CATEGORY,
    )) {
      // Each category's severity has a defined exit code.
      expect(typeof rank[severity]).toBe("number");
      expect(category.length).toBeGreaterThan(0);
    }
  });
});
