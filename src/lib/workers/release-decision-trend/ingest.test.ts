import { describe, expect, it } from "vitest";
import { ingestDecisionIndex } from "./ingest";
import {
  blockedWindow,
  insufficientWindow,
  invalidWindow,
  notADecisionIndex,
  stableWindow,
  tamperWindowCounts,
  tamperWindowVerdict,
  watchWindow,
} from "./fixtures";

/** Round-trip a window object through JSON like the CLI does before ingest. */
function ingest(obj: unknown) {
  return ingestDecisionIndex(JSON.parse(JSON.stringify(obj)));
}

describe("ingestDecisionIndex — usable windows re-derive their own index verdict", () => {
  it("a real stable window is usable and carries its verdict + facts", () => {
    const r = ingest(stableWindow());
    expect(r.recognized).toBe(true);
    expect(r.usable).toBe(true);
    expect(r.verdict).toBe("stable");
    expect(r.facts?.stable).toBe(true);
    expect(r.facts?.recordsConsidered).toBe(2);
    expect(r.facts?.recordsUsable).toBe(2);
    expect(r.facts?.decisionCounts.proceed).toBe(2);
  });

  it("each index verdict is recognized as usable", () => {
    expect(ingest(watchWindow()).verdict).toBe("watch");
    expect(ingest(insufficientWindow()).verdict).toBe("insufficient");
    expect(ingest(blockedWindow()).verdict).toBe("blocked");
    expect(ingest(invalidWindow()).verdict).toBe("invalid");
    for (const w of [watchWindow(), insufficientWindow(), blockedWindow(), invalidWindow()]) {
      expect(ingest(w).usable).toBe(true);
    }
  });
});

describe("ingestDecisionIndex — tamper evidence", () => {
  it("a hand-flipped index verdict is caught (CHECK B: verdict must re-derive from the ledger)", () => {
    const r = ingest(tamperWindowVerdict(stableWindow(), "blocked"));
    expect(r.recognized).toBe(true);
    expect(r.usable).toBe(false);
    expect(r.verdict).toBe("blocked"); // the untrusted CLAIM is surfaced
    expect(r.facts).toBeNull();
  });

  it("a lied ledger count consistent with the verdict is caught (CHECK A: ledger must match the sequence)", () => {
    // Inflating decisionCounts.proceed does NOT change the re-derived verdict (proceed is not read by the rollup),
    // so only the ledger-vs-sequence re-check catches it.
    const r = ingest(tamperWindowCounts(stableWindow()));
    expect(r.usable).toBe(false);
    expect(r.recognized).toBe(true);
  });

  it("flipping a usable point's decision (without updating the ledger) is caught", () => {
    const w = JSON.parse(JSON.stringify(stableWindow())) as {
      points: { decision: string; severity: string }[];
    };
    // Change a point's decision so the sequence no longer produces the recorded ledger counts.
    w.points[0]!.decision = "reject";
    expect(ingest(w).usable).toBe(false);
  });
});

describe("ingestDecisionIndex — malformed / unrecognized inputs", () => {
  it("a non-object / wrong-schema input is unrecognized (unreadable)", () => {
    for (const bad of [null, 42, "x", [], notADecisionIndex(), { schema: "pdfxyz.release-decision/1" }]) {
      const r = ingestDecisionIndex(bad);
      expect(r.recognized).toBe(false);
      expect(r.usable).toBe(false);
      expect(r.verdict).toBeNull();
    }
  });

  it("a recognized window missing its index / ledger / points block is a tamper", () => {
    for (const key of ["index", "ledger", "points"]) {
      const w = JSON.parse(JSON.stringify(stableWindow())) as Record<string, unknown>;
      delete w[key];
      const r = ingestDecisionIndex(w);
      expect(r.recognized, key).toBe(true);
      expect(r.usable, key).toBe(false);
    }
  });

  it("a window whose policy.strict disagrees with the recorded rollup strict is a tamper", () => {
    const w = JSON.parse(JSON.stringify(stableWindow())) as { policy: { strict: boolean } };
    w.policy.strict = !w.policy.strict;
    expect(ingestDecisionIndex(w).usable).toBe(false);
  });

  it("an off-enum index verdict is a tamper, and its claim is dropped (not echoed as a verdict)", () => {
    const w = JSON.parse(JSON.stringify(stableWindow())) as { index: { verdict: string } };
    w.index.verdict = "totally-made-up";
    const r = ingestDecisionIndex(w);
    expect(r.usable).toBe(false);
    expect(r.verdict).toBeNull(); // an unrecognized claim is not surfaced as a bounded verdict
  });
});
