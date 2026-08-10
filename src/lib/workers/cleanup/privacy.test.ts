// @vitest-environment node
/**
 * The no-leak contract for the cleanup verifier — the load-bearing privacy guarantee.
 *
 * It drives the FULL pipeline (ingest → verify → render → receipt) with a hostile evidence
 * document stuffed with object keys, bucket names, signed URLs, OCR text, and provider exception
 * messages, and asserts that NONE of those substrings survive into any output. It also proves the
 * verdict metric labels are redaction-stable — a label the shared redactor would mangle is
 * silently dropped by `sanitizeMetric`, which would make the metric disappear, so every
 * verdict×provider label must pass through the redactor unchanged.
 */
import { describe, expect, it } from "vitest";
import { CLEANUP_VERIFICATION_VERDICTS, type CleanupVerdict } from "./types";
import { parseCleanupEvidence } from "./ingest";
import { verifyArtifactCleanup } from "./verify";
import { buildCleanupCheckResult, renderCleanupCheck } from "./render";
import { buildCleanupVerificationReceipt } from "./receipt";
import { RETRIEVAL_STORAGE_PROVIDERS } from "../artifacts/access";
import {
  cleanupVerificationMetric,
  sanitizeMetric,
} from "../observability/metrics";
import { redactText } from "@/lib/telemetry";

/** Substrings that must NEVER appear in any output the tool produces. */
const HOSTILE = [
  "artifacts/2026/invoice-secret.pdf",
  "prod-user-uploads-bucket",
  "https://s3.amazonaws.com/b/k?X-Amz-Signature=deadbeef",
  "Bank Statement March 2026 balance 12345",
  "AccessDenied: user arn:aws:iam::999:user/leak",
  "h_livehandofftoken123",
];

/** A hostile evidence document: valid observations, each carrying forbidden extra fields. */
const HOSTILE_DOC = JSON.stringify({
  bucket: HOSTILE[1],
  endpoint: "https://minio.internal:9000",
  objects: [
    {
      presence: "present",
      expiresAtMs: 1700000000000,
      deleted: false,
      objectKey: HOSTILE[0],
      signedUrl: HOSTILE[2],
      ocrText: HOSTILE[3],
      providerMessage: HOSTILE[4],
      handoff: HOSTILE[5],
    },
    {
      presence: "absent",
      activeDelete: true,
      jobId: "job_leak_9",
      userId: "user_42",
    },
    { presence: "error", providerException: HOSTILE[4] },
  ],
});

describe("no-leak: hostile evidence never survives the pipeline", () => {
  it("drops every forbidden substring across json / prometheus / text", () => {
    const parsed = parseCleanupEvidence(HOSTILE_DOC);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const verification = verifyArtifactCleanup(parsed.objects, {
      provider: "remote-configured",
      now: 1700000000000 + 60_000,
      graceMs: 60 * 60 * 1000,
    });
    const result = buildCleanupCheckResult(verification, {
      source: "stdin",
      generatedAt: "2026-07-03T00:00:00.000Z",
      graceHours: 1,
    });

    for (const format of ["json", "prometheus", "text"] as const) {
      const out = renderCleanupCheck(result, format);
      for (const secret of HOSTILE) {
        expect(out).not.toContain(secret);
      }
      // Belt-and-braces: no obvious locator fragments at all.
      expect(out).not.toMatch(
        /invoice|bucket-|X-Amz|arn:aws|Bank Statement|job_leak|user_42/,
      );
    }
  });

  it("the ingested evidence object retains only the three bounded fields", () => {
    const parsed = parseCleanupEvidence(HOSTILE_DOC);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const obj of parsed.objects) {
      expect(Object.keys(obj).sort()).toEqual([
        "activeDelete",
        "lifecycle",
        "presence",
      ]);
    }
  });
});

describe("no-leak: receipts are content-free across every verdict × provider", () => {
  it("carries only bounded enums, counts, and the policy stamp", () => {
    for (const verdict of CLEANUP_VERIFICATION_VERDICTS) {
      for (const provider of RETRIEVAL_STORAGE_PROVIDERS) {
        const receipt = buildCleanupVerificationReceipt({
          verdict,
          provider,
          total: 7,
          reaped: 3,
          drift: 1,
          at: "2026-07-03T00:00:00.000Z",
        });
        const serialized = JSON.stringify(receipt);
        for (const secret of HOSTILE) expect(serialized).not.toContain(secret);
        expect(receipt.category).toBe("cleanup");
        expect(receipt.policyId).toBe("pdfxyz-worker-cleanup-verifier");
        // Redaction is a no-op on every field value (they are pristine enums / prose).
        expect(redactText(serialized)).toBe(serialized);
      }
    }
  });

  it("clamps hostile counts to safe non-negative integers", () => {
    const receipt = buildCleanupVerificationReceipt({
      verdict: "drift",
      provider: "remote-configured",
      total: Number.NaN,
      reaped: -5,
      drift: 2.9,
      at: "2026-07-03T00:00:00.000Z",
    });
    expect(receipt.total).toBe(0);
    expect(receipt.reaped).toBe(0);
    expect(receipt.drift).toBe(2);
  });
});

describe("redaction-stability: verdict metric labels survive sanitizeMetric", () => {
  it("keeps every verdict × provider label (a mangled label would be dropped)", () => {
    for (const verdict of CLEANUP_VERIFICATION_VERDICTS) {
      for (const provider of RETRIEVAL_STORAGE_PROVIDERS) {
        const sample = cleanupVerificationMetric(
          verdict as CleanupVerdict,
          provider,
        );
        // The redactor must not alter either label value...
        expect(redactText(verdict)).toBe(verdict);
        expect(redactText(provider)).toBe(provider);
        // ...so sanitizeMetric accepts the sample rather than silently dropping it.
        const clean = sanitizeMetric(sample);
        expect(clean).not.toBeNull();
        expect(clean!.labels).toEqual({ verdict, provider });
      }
    }
  });

  it("real authored summaries for every verdict are redaction-stable", () => {
    const now = 1700000000000;
    const grace = 60 * 60 * 1000;
    const scenarios = [
      { provider: "not-configured" as const, evidence: [] }, // → not-configured
      { provider: "remote-configured" as const, evidence: [] }, // → unknown (empty)
      {
        provider: "remote-configured" as const,
        evidence: [
          { presence: "absent" as const, lifecycle: null, activeDelete: false },
        ],
      }, // → verified
      {
        provider: "remote-configured" as const,
        evidence: [
          {
            presence: "present" as const,
            lifecycle: { expiresAtMs: now - grace * 100, deleted: false },
            activeDelete: false,
          },
        ],
      }, // → drift
      {
        provider: "remote-configured" as const,
        evidence: [
          { presence: "error" as const, lifecycle: null, activeDelete: false },
        ],
      }, // → unavailable
    ];
    const seen = new Set<CleanupVerdict>();
    for (const s of scenarios) {
      const v = verifyArtifactCleanup(s.evidence, {
        provider: s.provider,
        now,
        graceMs: grace,
      });
      seen.add(v.verdict);
      expect(redactText(v.summary)).toBe(v.summary);
    }
    // The scenarios above exercise every verdict at least once.
    expect(seen).toEqual(new Set(CLEANUP_VERIFICATION_VERDICTS));
  });
});
