import { describe, expect, it } from "vitest";
import {
  NOW,
  coherentPlan,
  completedReceipt,
  decisionFor,
  makeArgs,
  makeCloseout,
  makeProvider,
} from "./fixtures";
import { renderReleaseDecisionCloseout } from "./render";
import { runReleaseDecisionCloseout } from "./run";

/** Locator-shaped hostile tokens an ingested record might try to smuggle — none may reach the closeout output. */
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

/** Overwrite every non-load-bearing free-text carrier of a cloned record with hostile strings. */
function poison(clone: Record<string, unknown>): Record<string, unknown> {
  clone.generatedAt = `2000-01-01T00:00:00.000Z ${HOSTILE[0]}`;
  clone.caveats = [...HOSTILE];
  clone.guidance = [...HOSTILE];
  clone.smuggled = { key: HOSTILE[1], note: HOSTILE[7] };
  const receipt = clone.receipt as { disclosure?: string } | undefined;
  if (receipt) receipt.disclosure = HOSTILE.join(" ");
  const reasons = clone.reasons as { detail?: string }[] | undefined;
  if (Array.isArray(reasons)) for (const r of reasons) r.detail = HOSTILE.join(" ");
  return clone;
}

/** A hostile-but-usable primary receipt (its load-bearing rollup is intact → re-derives to `completed`). */
function hostileReceipt(): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(completedReceipt())) as Record<string, unknown> & {
    actionReceipt: { detail?: string };
  };
  clone.actionReceipt.detail = HOSTILE.join(" ");
  return poison(clone);
}

/** A hostile-but-coherent plan (its load-bearing facts are intact → cross-checks as coherent). */
function hostilePlan(): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(coherentPlan())) as Record<string, unknown> & {
    plan: { detail?: string };
    actions?: { label?: string }[];
  };
  clone.plan.detail = HOSTILE.join(" ");
  if (Array.isArray(clone.actions)) for (const a of clone.actions) a.label = HOSTILE.join(" ");
  return poison(clone);
}

/** A hostile-but-usable decision-ledger record. */
function hostileDecision(): Record<string, unknown> {
  return poison(JSON.parse(JSON.stringify(decisionFor("proceed"))) as Record<string, unknown>);
}

/** Assert no hostile token appears anywhere in `text`. */
function expectNoLeak(text: string): void {
  for (const token of HOSTILE) {
    expect(text, `leaked: ${token}`).not.toContain(token);
  }
}

describe("release-decision-closeout privacy — content-free by reconstruction", () => {
  it("never echoes a hostile receipt / plan / decision's stamp, prose, or smuggled fields (json + text)", () => {
    const result = makeCloseout(hostileReceipt(), { plan: hostilePlan(), decision: hostileDecision() });
    expectNoLeak(renderReleaseDecisionCloseout(result, "json"));
    expectNoLeak(renderReleaseDecisionCloseout(result, "text"));
    // The closeout carries its OWN stamp, not any ingested record's hostile one.
    expect(result.generatedAt).toBe(NOW);
    // The hostile-but-usable chain still closes out cleanly (every load-bearing fact re-derived / cross-checked).
    expect(result.verdict).toBe("closed");
    expect(result.source.receiptVerdict).toBe("completed");
    expect(result.related.find((r) => r.kind === "plan")?.signal).toBe("coherent");
  });

  it("never echoes a hostile input path or stdin payload on any run", async () => {
    // A hostile, non-JSON stdin payload is an unreadable receipt → incomplete closeout, never echoed.
    const run = await runReleaseDecisionCloseout(
      makeArgs({ stdin: true, receiptPath: undefined }),
      makeProvider({}, HOSTILE.join(" ")),
    );
    expectNoLeak(run.output);
    expect(run.result.verdict).toBe("closeout-incomplete");
    expect(run.result.source.state).toBe("unreadable");
  });

  it("carries no reviewer identity, path, bucket, url, or key even from a hostile chain (whole-object scan)", () => {
    const blob = JSON.stringify(makeCloseout(hostileReceipt(), { plan: hostilePlan(), decision: hostileDecision() }));
    for (const token of ["AKIA", "s3://", "https://", "@acme", "Bearer", "/var/secrets", "SSN"]) {
      expect(blob, `leaked: ${token}`).not.toContain(token);
    }
  });
});
