import { describe, expect, it } from "vitest";
import { completedReceipt, coherentPlan, makeArgs, makeFinalize, makeProvider, NOW } from "./fixtures";
import { renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalize as render } from "./render";
import { runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalize } from "./run";

/** Locator- / secret-shaped hostile tokens an ingested record might try to smuggle — none may reach the output. */
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
 * Clone a real document and stuff hostile strings into every non-load-bearing carrier (its own stamp, its prose, its
 * per-reason / per-record detail, its receipt disclosure, and a stray extra field). The trust boundary reconstructs only
 * bounded enums + integers, so none of these may survive into the finalization record.
 */
function stuff(doc: Record<string, unknown>): Record<string, unknown> {
  const d = JSON.parse(JSON.stringify(doc)) as Record<string, unknown> & {
    generatedAt?: string;
    caveats?: string[];
    guidance?: string[];
    reasons?: { detail?: string }[];
    receipt?: { disclosure?: string };
  };
  d.generatedAt = `2000-01-01T00:00:00.000Z ${HOSTILE[0]}`;
  d.caveats = [...HOSTILE];
  d.guidance = [...HOSTILE];
  if (Array.isArray(d.reasons)) for (const r of d.reasons) r.detail = HOSTILE.join(" ");
  if (d.receipt) d.receipt.disclosure = HOSTILE.join(" ");
  (d as Record<string, unknown>).smuggled = { key: HOSTILE[1], note: HOSTILE[7] };
  return d;
}

/** Assert no hostile token appears anywhere in `text`. */
function expectNoLeak(text: string): void {
  for (const token of HOSTILE) {
    expect(text, `leaked: ${token}`).not.toContain(token);
  }
}

describe("finalize-index-trend-finalize privacy — content-free by reconstruction", () => {
  it("never echoes a hostile receipt's stamp, prose, or smuggled fields (json + text)", () => {
    const result = makeFinalize(stuff(completedReceipt() as unknown as Record<string, unknown>));
    expectNoLeak(render(result, "json"));
    expectNoLeak(render(result, "text"));
    // The record carries its OWN stamp, not the ingested receipt's hostile one.
    expect(result.generatedAt).toBe(NOW);
    // The hostile-but-self-consistent completed receipt still finalizes cleanly.
    expect(result.verdict).toBe("finalized");
    expect(result.source.receiptVerdict).toBe("completed");
  });

  it("never echoes hostile strings smuggled into a supplied source-chain record", () => {
    const result = makeFinalize(completedReceipt(), {
      plan: stuff(coherentPlan()),
    });
    expectNoLeak(render(result, "json"));
    expectNoLeak(render(result, "text"));
    // The hostile clear plan still cross-checks coherently (its bounded verdict re-derives).
    expect(result.verdict).toBe("finalized");
  });

  it("never echoes a hostile input path or stdin payload on any run", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalize(
      makeArgs({ stdin: true, receiptPath: undefined }),
      makeProvider(undefined, {}, HOSTILE.join(" ")),
    );
    expectNoLeak(run.output);
    expect(run.result.verdict).toBe("finalize-invalid");
    expect(run.result.source.state).toBe("unreadable");
  });

  it("carries no reviewer identity, path, bucket, url, or key even from a hostile chain (whole-object scan)", () => {
    const blob = JSON.stringify(
      makeFinalize(stuff(completedReceipt() as unknown as Record<string, unknown>), { plan: stuff(coherentPlan()) }),
    );
    for (const token of ["AKIA", "s3://", "https://", "@acme", "Bearer", "/var/secrets", "SSN"]) {
      expect(blob, `leaked: ${token}`).not.toContain(token);
    }
  });
});
