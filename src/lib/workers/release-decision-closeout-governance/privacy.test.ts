import { describe, expect, it } from "vitest";
import {
  completedReceipt,
  coherentPlan,
  makeArgs,
  makeGovernance,
  makeProvider,
  NOW,
} from "./fixtures";
import { renderReleaseDecisionCloseoutGovernance } from "./render";
import { runReleaseDecisionCloseoutGovernance } from "./run";

/** Locator-shaped hostile tokens an ingested record might try to smuggle — none may reach the bundle output. */
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
 * Clone a real record and stuff hostile strings into every non-load-bearing carrier (its own stamp, its prose, its
 * caveats / guidance, its per-reason detail, its disclosure, and a stray extra field). The trust boundary reconstructs
 * only bounded enums + integers, so none of these may survive into the bundle.
 */
function poison<T extends Record<string, unknown>>(doc: T): T {
  const p = JSON.parse(JSON.stringify(doc)) as Record<string, unknown> & {
    generatedAt?: string;
    caveats?: string[];
    guidance?: string[];
    reasons?: { detail?: string }[];
    receipt?: { disclosure?: string };
  };
  p.generatedAt = `2000-01-01T00:00:00.000Z ${HOSTILE[0]}`;
  if (Array.isArray(p.caveats)) p.caveats = [...HOSTILE];
  if (Array.isArray(p.guidance)) p.guidance = [...HOSTILE];
  if (Array.isArray(p.reasons)) for (const r of p.reasons) r.detail = HOSTILE.join(" ");
  if (p.receipt && typeof p.receipt === "object") p.receipt.disclosure = HOSTILE.join(" ");
  (p as Record<string, unknown>).smuggled = { key: HOSTILE[1], note: HOSTILE[7] };
  return p as unknown as T;
}

/** Assert no hostile token appears anywhere in `text`. */
function expectNoLeak(text: string): void {
  for (const token of HOSTILE) {
    expect(text, `leaked: ${token}`).not.toContain(token);
  }
}

describe("release-decision-closeout-governance privacy — content-free by reconstruction", () => {
  it("never echoes an ingested receipt's / record's stamp, prose, or smuggled fields (json + text)", () => {
    const result = makeGovernance({
      receipt: poison(completedReceipt() as unknown as Record<string, unknown>),
      plan: poison(coherentPlan() as Record<string, unknown>),
    });
    expectNoLeak(renderReleaseDecisionCloseoutGovernance(result, "json"));
    expectNoLeak(renderReleaseDecisionCloseoutGovernance(result, "text"));
    // The bundle carries its OWN stamp, not the ingested record's hostile one.
    expect(result.generatedAt).toBe(NOW);
    // The poisoned-but-self-consistent chain still folds cleanly (its bounded facts re-derive) → closed.
    expect(result.verdict).toBe("closed");
    expect(result.source.receiptVerdict).toBe("completed");
    expect(result.related.find((r) => r.kind === "plan")?.signal).toBe("coherent");
  });

  it("never echoes a hostile input path or stdin payload on any run", async () => {
    // A hostile, non-JSON stdin payload is an unreadable receipt → incomplete, never echoed.
    const args = makeArgs({ receipt: completedReceipt() }, { stdin: true, receiptPath: undefined });
    const run = await runReleaseDecisionCloseoutGovernance(
      args,
      makeProvider({} as never, HOSTILE.join(" ")),
    );
    expectNoLeak(run.output);
    expect(run.result.verdict).toBe("governance-incomplete");
    expect(run.result.source.state).toBe("unreadable");
  });

  it("carries no reviewer identity, path, bucket, url, or key even from a hostile chain (whole-object scan)", () => {
    const blob = JSON.stringify(
      makeGovernance({
        receipt: poison(completedReceipt() as unknown as Record<string, unknown>),
        plan: poison(coherentPlan() as Record<string, unknown>),
      }),
    );
    for (const token of ["AKIA", "s3://", "https://", "@acme", "Bearer", "/var/secrets", "SSN"]) {
      expect(blob, `leaked: ${token}`).not.toContain(token);
    }
  });
});
