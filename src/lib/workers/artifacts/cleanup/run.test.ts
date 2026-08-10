// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runArtifactCleanup, ARTIFACT_CLEANUP_SCHEMA } from "./run";
import type { ArtifactCleanupArgs } from "./args";

const NOW = 1_700_000_000_000;
const AT = new Date(NOW).toISOString();

/** Build args; defaults to JSON with no optional sections. */
function args(over: Partial<ArtifactCleanupArgs> = {}): ArtifactCleanupArgs {
  return {
    source: "stdin",
    format: "json",
    includePlan: false,
    includeBreakdown: false,
    includeMetrics: false,
    ...over,
  };
}

const CLEAN = JSON.stringify({
  artifacts: [
    {
      lifecycle: "live",
      manifest: "valid",
      provider: "remote-configured",
      kind: "pdf",
    },
  ],
});
const DRIFT = JSON.stringify({
  artifacts: [
    {
      expiresAtMs: 1000,
      manifest: "valid",
      provider: "remote-configured",
      kind: "pdf",
    },
  ],
});
const BREACH = JSON.stringify({
  artifacts: [
    {
      deleted: true,
      manifest: "valid",
      provider: "remote-configured",
      kind: "pdf",
    },
  ],
});

describe("runArtifactCleanup", () => {
  it("maps verdicts to the documented exit codes", () => {
    expect(runArtifactCleanup(CLEAN, args(), NOW, AT).exitCode).toBe(0);
    expect(runArtifactCleanup(DRIFT, args(), NOW, AT).exitCode).toBe(3);
    expect(runArtifactCleanup(BREACH, args(), NOW, AT).exitCode).toBe(4);
    expect(
      runArtifactCleanup(
        JSON.stringify({ artifacts: [{ provider: "not-configured" }] }),
        args(),
        NOW,
        AT,
      ).exitCode,
    ).toBe(2);
  });

  it("a malformed inventory is an input error (exit 1), content-free", () => {
    const r = runArtifactCleanup("{ not json", args(), NOW, AT);
    expect(r.exitCode).toBe(1);
    expect(r.report).toBeNull();
    const parsed = JSON.parse(r.output);
    expect(parsed.error).toMatchObject({
      reason: "invalid-inventory",
      issues: ["malformed-json"],
    });
  });

  it("emits a stable JSON document with report + receipt", () => {
    const parsed = JSON.parse(
      runArtifactCleanup(DRIFT, args(), NOW, AT).output,
    );
    expect(parsed.tool).toBe("worker-artifact-cleanup");
    expect(parsed.schema).toBe(ARTIFACT_CLEANUP_SCHEMA);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.report.verdict).toBe("drift");
    expect(parsed.report.cleanupRecommended).toBe(1);
    expect(parsed.receipt).toMatchObject({
      category: "artifact-cleanup",
      verdict: "drift",
    });
  });

  it("gates the plan and breakdown behind their flags", () => {
    const bare = JSON.parse(runArtifactCleanup(DRIFT, args(), NOW, AT).output);
    expect(bare.report.plan).toBeUndefined();
    expect(bare.report.breakdown).toBeUndefined();

    const full = JSON.parse(
      runArtifactCleanup(
        DRIFT,
        args({ includePlan: true, includeBreakdown: true }),
        NOW,
        AT,
      ).output,
    );
    expect(Array.isArray(full.report.plan)).toBe(true);
    expect(full.report.breakdown.providers["remote-configured"]).toBe(1);
  });

  it("includes derived content-free metric samples under --metrics", () => {
    const parsed = JSON.parse(
      runArtifactCleanup(DRIFT, args({ includeMetrics: true }), NOW, AT).output,
    );
    expect(Array.isArray(parsed.metrics)).toBe(true);
    for (const sample of parsed.metrics) {
      expect(sample.metric).toBe("worker_artifact_cleanup_total");
      expect(Object.keys(sample.labels).sort()).toEqual([
        "category",
        "severity",
      ]);
    }
  });

  it("renders human-readable text", () => {
    const out = runArtifactCleanup(
      DRIFT,
      args({ format: "text", includePlan: true }),
      NOW,
      AT,
    ).output;
    expect(out).toMatch(/cleanup verifier \(dry-run\)/i);
    expect(out).toMatch(/verdict\s+drift \(exit 3\)/);
    expect(out).toMatch(/never deletes/i);
  });
});

describe("no-leak contract against hostile inventory input", () => {
  const HOSTILE = JSON.stringify({
    artifacts: [
      {
        // hostile EXTRA fields (ignored) ...
        objectKey: "artifacts/2024/ACME-Q3-SECRET.pdf",
        bucket: "prod-user-uploads",
        signedUrl:
          "https://prod.s3.amazonaws.com/x?X-Amz-Signature=deadbeefcafe",
        filename: "Bank Statement.pdf",
        ocrText: "Account 1234 balance is 9999 dollars",
        env: "AWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE",
        // ... and hostile VALUES in recognized fields (rejected to sentinels) ...
        lifecycle: "s3://evil-bucket/key",
        kind: "/etc/passwd",
        provider: "https://leak.example",
        expiresAtMs: 1000,
        manifest: "valid",
      },
    ],
  });

  const FORBIDDEN = [
    "acme",
    "secret",
    "prod-user-uploads",
    "amazonaws",
    "x-amz-signature",
    "deadbeef",
    "bank statement",
    "account 1234",
    "akia",
    "aws_secret",
    "/etc/passwd",
    "evil-bucket",
    "leak.example",
    "s3://",
    "://",
    ".pdf",
  ];

  it("leaks nothing from a hostile inventory into JSON output (plan + breakdown + metrics)", () => {
    const out = runArtifactCleanup(
      HOSTILE,
      args({ includePlan: true, includeBreakdown: true, includeMetrics: true }),
      NOW,
      AT,
    ).output.toLowerCase();
    for (const needle of FORBIDDEN) expect(out).not.toContain(needle);
    // The hostile object still classifies (expired evidence honored).
    const parsed = JSON.parse(
      runArtifactCleanup(HOSTILE, args(), NOW, AT).output,
    );
    expect(parsed.report.categories["expired-but-present"]).toBe(1);
  });

  it("leaks nothing into text output", () => {
    const out = runArtifactCleanup(
      HOSTILE,
      args({ format: "text", includePlan: true, includeBreakdown: true }),
      NOW,
      AT,
    ).output.toLowerCase();
    for (const needle of FORBIDDEN) expect(out).not.toContain(needle);
  });
});
