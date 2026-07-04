import { describe, expect, it } from "vitest";
import { ingestBundle } from "./ingest";
import {
  failBundle,
  notABundle,
  passBundle,
  unknownBundle,
  warnBundle,
} from "./fixtures";
import type { ReleaseCiBundleResult } from "../release-ci-bundle/types";

type Obj = Record<string, unknown>;

/** Deep-clone a real bundle to a mutable plain object (the audit ingests untrusted `unknown` roots). */
function clone(bundle: ReleaseCiBundleResult): Obj {
  return JSON.parse(JSON.stringify(bundle)) as Obj;
}

describe("release-audit ingest — usable (self-consistent) bundles", () => {
  it("a coherent PASS bundle re-derives its own rollup → usable", () => {
    const ing = ingestBundle(passBundle());
    expect(ing.recognized).toBe(true);
    expect(ing.usable).toBe(true);
    expect(ing.facts?.verdict).toBe("pass");
    expect(ing.facts?.stagesPresent).toBe(2);
    expect(ing.facts?.decisionStage).toBe("policy");
    expect(ing.facts?.links["index-policy-agreement"]).toBe("ok");
    expect(ing.facts?.inconsistencies).toBe(0);
  });

  it("a coherent WARN bundle carries advisory pressure", () => {
    const ing = ingestBundle(warnBundle());
    expect(ing.usable).toBe(true);
    expect(ing.facts?.verdict).toBe("warn");
    expect(ing.facts?.warnStages).toBeGreaterThanOrEqual(1);
    expect(ing.facts?.warningSignals).toBeGreaterThan(0);
  });

  it("a coherent FAIL bundle is usable with verdict fail", () => {
    const ing = ingestBundle(failBundle());
    expect(ing.usable).toBe(true);
    expect(ing.facts?.verdict).toBe("fail");
  });

  it("a decision-less (gate+artifact) bundle is a usable UNKNOWN posture", () => {
    const ing = ingestBundle(unknownBundle());
    expect(ing.usable).toBe(true);
    expect(ing.facts?.verdict).toBe("unknown");
    // No index/policy stage, so the archive decision cannot be certified…
    expect(ing.facts?.archiveVerdict).toBeNull();
    // …though the most-authoritative PRESENT stage is still recorded as the (non-decision) decision stage.
    expect(ing.facts?.decisionStage).toBe("artifact");
  });
});

describe("release-audit ingest — unrecognized inputs", () => {
  it("a non-object / non-bundle is not recognized", () => {
    for (const input of [undefined, null, 42, "x", [], notABundle()]) {
      const ing = ingestBundle(input);
      expect(ing.recognized).toBe(false);
      expect(ing.usable).toBe(false);
      expect(ing.facts).toBeNull();
    }
  });
});

describe("release-audit ingest — tamper detection (recognized but not usable)", () => {
  it("a flipped rollup VERDICT is caught (recognized, not usable, claimed verdict surfaced)", () => {
    const b = clone(passBundle());
    (b.rollup as Obj).verdict = "warn"; // re-derives to pass ≠ warn
    const ing = ingestBundle(b);
    expect(ing.recognized).toBe(true);
    expect(ing.usable).toBe(false);
    expect(ing.facts?.verdict).toBe("warn"); // the untrusted CLAIM is surfaced for the summary
    expect(ing.facts?.stagesPresent).toBe(0); // but no trusted detail
  });

  it("a lied stagesPresent is caught", () => {
    const b = clone(passBundle());
    (b.rollup as Obj).stagesPresent = 99;
    expect(ingestBundle(b).usable).toBe(false);
  });

  it("a lied decisionStage is caught", () => {
    const b = clone(passBundle());
    (b.rollup as Obj).decisionStage = "gate";
    expect(ingestBundle(b).usable).toBe(false);
  });

  it("a lied drivers list is caught", () => {
    const b = clone(passBundle());
    (b.rollup as Obj).drivers = ["stage-failed"];
    expect(ingestBundle(b).usable).toBe(false);
  });

  it("a structurally broken bundle (wrong stage count) is recognized-but-not-usable", () => {
    const b = clone(passBundle());
    (b.stages as unknown[]).pop();
    const ing = ingestBundle(b);
    expect(ing.recognized).toBe(true);
    expect(ing.usable).toBe(false);
  });

  it("a bundle with a missing rollup is recognized-but-not-usable", () => {
    const b = clone(passBundle());
    delete b.rollup;
    const ing = ingestBundle(b);
    expect(ing.recognized).toBe(true);
    expect(ing.usable).toBe(false);
  });
});
