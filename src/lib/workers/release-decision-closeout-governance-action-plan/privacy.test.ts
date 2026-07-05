import { describe, expect, it } from "vitest";
import { NOW, makeArgs, makePlan, makeProvider, stableTrend } from "./fixtures";
import { renderReleaseDecisionCloseoutGovernanceActionPlan } from "./render";
import { runReleaseDecisionCloseoutGovernanceActionPlan } from "./run";

/** Locator-shaped hostile tokens an ingested trend might try to smuggle — none may reach the plan output. */
const HOSTILE = [
  "AKIAIOSFODNN7EXAMPLE",
  "s3://acme-releases/prod/build-4210.json",
  "https://evil.example.com/callback?token=abc",
  "/var/secrets/reviewer.pem",
  "reviewer@acme.example.com",
  "release-2026-07-05-hotfix",
  "Bearer sk-live-0123456789abcdef",
  "OCR: patient name John Q. Public, SSN 123-45-6789",
  "us-east-1",
  "wJ/alrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
];

/**
 * Clone a real trend and stuff hostile strings into every non-load-bearing carrier (the trend's own stamp, its prose,
 * its per-point / per-reason detail, and a stray extra field). The trust boundary reconstructs only bounded enums +
 * integers, so none of these may survive into the plan.
 */
function hostileTrend(): Record<string, unknown> {
  const t = JSON.parse(JSON.stringify(stableTrend())) as Record<string, unknown> & {
    generatedAt: string;
    caveats: string[];
    guidance: string[];
    governanceIndexTrend: { detail: string };
    points: { detail: string }[];
    reasons: { detail: string }[];
  };
  t.generatedAt = `2000-01-01T00:00:00.000Z ${HOSTILE[0]}`;
  t.caveats = [...HOSTILE];
  t.guidance = [...HOSTILE];
  t.governanceIndexTrend.detail = HOSTILE.join(" ");
  for (const p of t.points) p.detail = HOSTILE.join(" ");
  for (const r of t.reasons) r.detail = HOSTILE.join(" ");
  (t as Record<string, unknown>).smuggled = { key: HOSTILE[1], note: HOSTILE[7] };
  return t;
}

/** Assert no hostile token appears anywhere in `text`. */
function expectNoLeak(text: string): void {
  for (const token of HOSTILE) {
    expect(text, `leaked: ${token}`).not.toContain(token);
  }
}

describe("release-decision-closeout-governance-action-plan privacy — content-free by reconstruction", () => {
  it("never echoes an ingested trend's stamp, prose, or smuggled fields (json + text)", () => {
    const result = makePlan(hostileTrend());
    expectNoLeak(renderReleaseDecisionCloseoutGovernanceActionPlan(result, "json"));
    expectNoLeak(renderReleaseDecisionCloseoutGovernanceActionPlan(result, "text"));
    // The plan carries its OWN stamp, not the ingested trend's hostile one.
    expect(result.generatedAt).toBe(NOW);
    // The hostile stable trend still plans cleanly as a usable clear plan.
    expect(result.verdict).toBe("clear");
    expect(result.sourceTrendVerdict).toBe("trend-stable");
  });

  it("never echoes a hostile input path or stdin payload on any run", async () => {
    // A hostile, non-JSON stdin payload is an unreadable trend → block-release plan, never echoed.
    const run = await runReleaseDecisionCloseoutGovernanceActionPlan(
      makeArgs({ stdin: true, trendPath: undefined }),
      makeProvider(undefined, HOSTILE.join(" ")),
    );
    expectNoLeak(run.output);
    expect(run.result.verdict).toBe("block-release");
    expect(run.result.source.state).toBe("unreadable");
  });

  it("carries no reviewer identity, path, bucket, url, or key even from a hostile trend (whole-object scan)", () => {
    const blob = JSON.stringify(makePlan(hostileTrend()));
    for (const token of ["AKIA", "s3://", "https://", "@acme", "Bearer", "/var/secrets", "SSN"]) {
      expect(blob, `leaked: ${token}`).not.toContain(token);
    }
  });
});
