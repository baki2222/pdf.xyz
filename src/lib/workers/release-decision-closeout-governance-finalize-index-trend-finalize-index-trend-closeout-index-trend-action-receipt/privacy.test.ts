import { describe, expect, it } from "vitest";
import { NOW, clearPlan, makeArgs, makeProvider, makeReceipt, policyWith } from "./fixtures";
import { renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceipt } from "./render";
import { runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceipt } from "./run";

/** Locator-shaped hostile tokens an ingested plan might try to smuggle — none may reach the receipt output. */
const HOSTILE = [
  "AKIAIOSFODNN7EXAMPLE",
  "s3://acme-releases/prod/build-4210.json",
  "https://evil.example.com/callback?token=abc",
  "/var/secrets/reviewer.pem",
  "reviewer@acme.example.com",
  "release-2026-07-06-hotfix",
  "Bearer sk-live-0123456789abcdef",
  "OCR: patient name John Q. Public, SSN 123-45-6789",
  "us-east-1",
  "wJ/alrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
];

/**
 * Clone a real plan and stuff hostile strings into every non-load-bearing carrier (the plan's own stamp, its prose,
 * its per-reason / per-action detail, and a stray extra field). The trust boundary reconstructs only bounded enums +
 * integers, so none of these may survive into the receipt.
 */
function hostilePlan(): Record<string, unknown> {
  const p = JSON.parse(JSON.stringify(clearPlan())) as Record<string, unknown> & {
    generatedAt: string;
    caveats: string[];
    guidance: string[];
    actionPlan: { detail: string };
    reasons: { detail: string }[];
    plan: { label: string }[];
    receipt: { disclosure: string };
  };
  p.generatedAt = `2000-01-01T00:00:00.000Z ${HOSTILE[0]}`;
  p.caveats = [...HOSTILE];
  p.guidance = [...HOSTILE];
  p.actionPlan.detail = HOSTILE.join(" ");
  for (const r of p.reasons) r.detail = HOSTILE.join(" ");
  for (const a of p.plan) a.label = HOSTILE.join(" ");
  p.receipt.disclosure = HOSTILE.join(" ");
  (p as Record<string, unknown>).smuggled = { key: HOSTILE[1], note: HOSTILE[7] };
  return p;
}

/** Assert no hostile token appears anywhere in `text`. */
function expectNoLeak(text: string): void {
  for (const token of HOSTILE) {
    expect(text, `leaked: ${token}`).not.toContain(token);
  }
}

describe("finalize-index-trend-finalize-index-trend-closeout-index-trend-action-receipt privacy — content-free by reconstruction", () => {
  it("never echoes an ingested plan's stamp, prose, or smuggled fields (json + text)", () => {
    const result = makeReceipt(hostilePlan(), policyWith({ plan: true, clear: true }));
    expectNoLeak(renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceipt(result, "json"));
    expectNoLeak(renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceipt(result, "text"));
    // The receipt carries its OWN stamp, not the ingested plan's hostile one.
    expect(result.generatedAt).toBe(NOW);
    // The hostile clear plan still receipts cleanly (its verdict re-derives) as a completed receipt.
    expect(result.verdict).toBe("completed");
    expect(result.source.claimedPlanVerdict).toBe("clear");
  });

  it("never echoes a hostile input path or stdin payload on any run", async () => {
    // A hostile, non-JSON stdin payload is an unreadable plan → invalid receipt, never echoed.
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceipt(
      makeArgs({ stdin: true, planPath: undefined, ackPlan: true }),
      makeProvider(undefined, HOSTILE.join(" ")),
    );
    expectNoLeak(run.output);
    expect(run.result.verdict).toBe("invalid");
    expect(run.result.source.state).toBe("unreadable");
  });

  it("carries no reviewer identity, path, bucket, url, or key even from a hostile plan (whole-object scan)", () => {
    const blob = JSON.stringify(makeReceipt(hostilePlan(), policyWith({ plan: true })));
    for (const token of ["AKIA", "s3://", "https://", "@acme", "Bearer", "/var/secrets", "SSN"]) {
      expect(blob, `leaked: ${token}`).not.toContain(token);
    }
  });
});
