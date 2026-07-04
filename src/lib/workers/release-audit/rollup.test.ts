import { describe, expect, it } from "vitest";
import { computeAuditRollup } from "./rollup";
import { policy } from "./fixtures";
import {
  RELEASE_AUDIT_EXIT,
  type AuditRegressionFinding,
  type ReleaseAuditFindingStatus,
  type ReleaseAuditRegressionId,
  type ReleaseAuditSeverity,
} from "./types";

/** A minimal regression finding (the rollup keys only on id + status + severity). */
function finding(
  id: ReleaseAuditRegressionId,
  status: ReleaseAuditFindingStatus,
  severity: ReleaseAuditSeverity,
): AuditRegressionFinding {
  return { id, status, severity, detail: "" };
}

/** The "nothing fired" baseline: every check evaluated and stayed ok. */
const ALL_OK: AuditRegressionFinding[] = [
  finding("bundle-tampered", "ok", "none"),
  finding("bundle-unreadable", "ok", "none"),
  finding("verdict-worsened", "ok", "none"),
];

describe("release-audit rollup — verdict ladder + exit codes", () => {
  it("no regression over a comparable pair → pass (exit 0)", () => {
    const r = computeAuditRollup(ALL_OK, policy(), true);
    expect(r.verdict).toBe("pass");
    expect(r.exitCode).toBe(RELEASE_AUDIT_EXIT.PASS);
    expect(r.regressed).toBe(false);
    expect(r.drivers).toEqual([]);
    expect(r.comparable).toBe(true);
  });

  it("a blocking regression → fail (exit 4), dominating everything", () => {
    const findings = [
      finding("bundle-unreadable", "regressed", "unknown"),
      finding("verdict-worsened", "regressed", "block"),
      finding("warnings-increased", "regressed", "warn"),
    ];
    const r = computeAuditRollup(findings, policy(), false);
    expect(r.verdict).toBe("fail");
    expect(r.exitCode).toBe(RELEASE_AUDIT_EXIT.FAIL);
    expect(r.blockingRegressions).toBe(1);
    expect(r.warningRegressions).toBe(1);
  });

  it("an unreadable bundle → unknown (exit 2)", () => {
    const r = computeAuditRollup([finding("bundle-unreadable", "regressed", "unknown")], policy(), false);
    expect(r.verdict).toBe("unknown");
    expect(r.exitCode).toBe(RELEASE_AUDIT_EXIT.UNKNOWN);
  });

  it("NOT comparable with nothing fired → unknown, never a vacuous pass", () => {
    // The honesty guard: a not-supplied baseline / too little history cannot be a 'no regression'.
    const r = computeAuditRollup(ALL_OK, policy(), false);
    expect(r.verdict).toBe("unknown");
    expect(r.exitCode).toBe(RELEASE_AUDIT_EXIT.UNKNOWN);
    expect(r.comparable).toBe(false);
  });

  it("a warn-level drift → warn (exit 3)", () => {
    const r = computeAuditRollup([finding("warnings-increased", "regressed", "warn")], policy(), true);
    expect(r.verdict).toBe("warn");
    expect(r.exitCode).toBe(RELEASE_AUDIT_EXIT.WARN);
    expect(r.drivers).toEqual(["warnings-increased"]);
  });

  it("--allow-warn-regression softens a warn drift to pass but KEEPS it in drivers", () => {
    const findings = [finding("warnings-increased", "regressed", "warn")];
    const r = computeAuditRollup(findings, policy({ allowWarnRegression: true }), true);
    expect(r.verdict).toBe("pass");
    expect(r.warningRegressions).toBe(1); // still counted / recorded
    expect(r.drivers).toEqual(["warnings-increased"]); // accepted, but on the record
  });

  it("emits drivers in canonical RELEASE_AUDIT_REGRESSIONS order regardless of input order", () => {
    const findings = [
      finding("warnings-increased", "regressed", "warn"),
      finding("verdict-worsened", "regressed", "block"),
      finding("coverage-dropped", "regressed", "warn"),
    ];
    const r = computeAuditRollup(findings, policy(), true);
    expect(r.drivers).toEqual(["verdict-worsened", "coverage-dropped", "warnings-increased"]);
  });
});
