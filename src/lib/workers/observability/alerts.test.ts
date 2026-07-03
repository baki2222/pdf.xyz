// @vitest-environment node
/**
 * Alert-policy proofs (Phase 31). Every mapping is a pure function of a content-free
 * snapshot (+ optional SLO report); the load-bearing honesty rules are: a stale/absent
 * heartbeat is actionable only when observation is enabled, a `disabled` seam is a
 * neutral confirm-out-of-band, `unknown` never over-pages, and nothing the policy
 * emits is anything but a bounded enum or prose authored here (no snapshot string is
 * ever echoed).
 */
import { describe, expect, it } from "vitest";
import {
  OPERATIONS_SNAPSHOT_VERSION,
  type DaemonLivenessState,
  type HealthClass,
  type RecommendedAction,
  type SnapshotSubsystem,
  type SnapshotSubsystemId,
  type WorkerOperationsSnapshot,
} from "./snapshot";
import type { SloEvaluation, SloId, SloReport, SloStatus } from "./slo";
import {
  ALERT_ACTION_DETAIL,
  OPS_CHECK_EXIT,
  evaluateOperationsAlerts,
  exitCodeForSeverity,
  livenessAlert,
  severityForHealth,
  severityForSlo,
  worstSeverity,
  type AlertReason,
  type AlertSeverity,
} from "./alerts";

/* ------------------------------------------------------------------ *
 *  Fixtures
 * ------------------------------------------------------------------ */

const SECRET = "s3://leaky-bucket/secret-file.pdf?sig=deadbeef";

interface SnapshotOverrides {
  health?: HealthClass;
  recommendedAction?: RecommendedAction;
  daemonState?: DaemonLivenessState;
  drainable?: boolean;
  subsystems?: SnapshotSubsystem[];
  poisonProse?: boolean;
}

function sub(id: SnapshotSubsystemId, health: HealthClass): SnapshotSubsystem {
  return { id, label: id, health, detail: "authored elsewhere" };
}

/** A minimal, valid snapshot with targeted overrides. */
function makeSnapshot(o: SnapshotOverrides = {}): WorkerOperationsSnapshot {
  const health = o.health ?? "ok";
  const action = o.recommendedAction ?? "none";
  const state = o.daemonState ?? "disabled";
  const prose = o.poisonProse ? SECRET : "content-free prose";
  return {
    version: OPERATIONS_SNAPSHOT_VERSION,
    vantage: "web",
    mode: "remote-configured",
    drainable: o.drainable ?? true,
    daemonObserved: state === "observed",
    daemon: {
      state,
      source: state === "disabled" ? "none" : "queue-broker",
      lastSeen: state === "observed" ? "under-30s" : null,
      mode: null,
      detail: prose,
    },
    health,
    detail: prose,
    recommendedAction: action,
    recommendedActionDetail: prose,
    subsystems: o.subsystems ?? [],
    proofs: { compressionDeep: "unknown", ocr: "unknown" },
    lifecycleVerification: { known: false, verdict: "unknown", health: "unknown", detail: prose },
    lastLoop: null,
  };
}

function sloEval(
  id: SloId,
  status: SloStatus,
  observed = "x",
  threshold = "y",
): SloEvaluation {
  return { id, status, observed, threshold, detail: "authored by evaluateSlos" };
}

function sloReport(...slos: SloEvaluation[]): SloReport {
  const worst = slos.reduce<SloStatus>((acc, s) => {
    const rank: Record<SloStatus, number> = { ok: 0, unknown: 0, warn: 1, breach: 2 };
    return rank[s.status] > rank[acc] ? s.status : acc;
  }, "ok");
  return { slos, worst };
}

/* ------------------------------------------------------------------ *
 *  Class → severity projections + fold
 * ------------------------------------------------------------------ */

describe("severity projections", () => {
  it("maps health classes to the alert ladder", () => {
    expect(severityForHealth("ok")).toBe("ok");
    expect(severityForHealth("warn")).toBe("warn");
    expect(severityForHealth("blocked")).toBe("critical");
    expect(severityForHealth("unknown")).toBe("unknown");
  });

  it("maps SLO statuses to the alert ladder", () => {
    expect(severityForSlo("ok")).toBe("ok");
    expect(severityForSlo("warn")).toBe("warn");
    expect(severityForSlo("breach")).toBe("critical");
    expect(severityForSlo("unknown")).toBe("unknown");
  });

  it("folds to the worst, with unknown never beating ok", () => {
    expect(worstSeverity(["ok", "unknown", "ok"])).toBe("ok");
    expect(worstSeverity(["ok", "warn", "unknown"])).toBe("warn");
    expect(worstSeverity(["warn", "critical"])).toBe("critical");
    expect(worstSeverity([])).toBe("ok");
  });
});

/* ------------------------------------------------------------------ *
 *  Exit-code policy
 * ------------------------------------------------------------------ */

describe("exit-code policy", () => {
  it("maps each severity to its documented operational code", () => {
    expect(exitCodeForSeverity("ok")).toBe(OPS_CHECK_EXIT.OK);
    expect(exitCodeForSeverity("warn")).toBe(OPS_CHECK_EXIT.WARN);
    expect(exitCodeForSeverity("critical")).toBe(OPS_CHECK_EXIT.CRITICAL);
    expect(exitCodeForSeverity("unknown")).toBe(OPS_CHECK_EXIT.UNKNOWN);
  });

  it("pins the documented Phase 31 exit ladder and keeps usage a distinct band", () => {
    // The contract cron jobs / monitors / CI pin: 0 ok, 1 usage, 2 unknown, 3 warn,
    // 4 critical. `1` is the "the check itself was misused" band, never an operational
    // severity, so a misconfigured monitor is never read as a (un)healthy worker.
    expect(OPS_CHECK_EXIT).toEqual({ OK: 0, USAGE: 1, UNKNOWN: 2, WARN: 3, CRITICAL: 4 });
    const all = Object.values(OPS_CHECK_EXIT);
    expect(new Set(all).size).toBe(all.length); // every code is distinct
    const operational = [
      OPS_CHECK_EXIT.OK,
      OPS_CHECK_EXIT.UNKNOWN,
      OPS_CHECK_EXIT.WARN,
      OPS_CHECK_EXIT.CRITICAL,
    ];
    expect(operational).not.toContain(OPS_CHECK_EXIT.USAGE);
  });
});

/* ------------------------------------------------------------------ *
 *  Liveness (Phase 30 heartbeat) → alert
 * ------------------------------------------------------------------ */

describe("liveness alert", () => {
  const cases: Array<{
    state: DaemonLivenessState;
    severity: AlertSeverity;
    reason: AlertReason;
    action: string;
  }> = [
    { state: "observed", severity: "ok", reason: "liveness-observed", action: "monitor" },
    {
      state: "stale",
      severity: "warn",
      reason: "liveness-stale",
      action: "investigate-worker-liveness",
    },
    {
      state: "unknown",
      severity: "warn",
      reason: "liveness-absent",
      action: "investigate-worker-liveness",
    },
    {
      state: "disabled",
      severity: "ok",
      reason: "liveness-disabled",
      action: "confirm-worker-deployment",
    },
  ];

  for (const c of cases) {
    it(`classifies ${c.state} → ${c.severity}/${c.reason}`, () => {
      const a = livenessAlert(makeSnapshot({ daemonState: c.state }));
      expect(a.state).toBe(c.state);
      expect(a.severity).toBe(c.severity);
      expect(a.reason).toBe(c.reason);
      expect(a.action).toBe(c.action);
      expect(a.detail.length).toBeGreaterThan(0);
    });
  }

  it("a disabled heartbeat is neutral — never in the actionable alerts list", () => {
    const report = evaluateOperationsAlerts(makeSnapshot({ daemonState: "disabled" }));
    expect(report.liveness.state).toBe("disabled");
    expect(report.alerts.find((a) => a.source === "liveness")).toBeUndefined();
    expect(report.severity).toBe("ok");
  });

  it("a stale heartbeat surfaces as an actionable warn and lifts the overall severity", () => {
    const report = evaluateOperationsAlerts(
      makeSnapshot({
        daemonState: "stale",
        health: "warn",
        recommendedAction: "investigate-worker-liveness",
      }),
    );
    const live = report.alerts.find((a) => a.source === "liveness");
    expect(live?.severity).toBe("warn");
    expect(live?.reason).toBe("liveness-stale");
    expect(report.severity).toBe("warn");
    expect(exitCodeForSeverity(report.severity)).toBe(OPS_CHECK_EXIT.WARN);
  });

  it("an observed heartbeat keeps the stack OK and out of the alerts list", () => {
    const report = evaluateOperationsAlerts(
      makeSnapshot({ daemonState: "observed", health: "ok", recommendedAction: "none" }),
    );
    expect(report.liveness.reason).toBe("liveness-observed");
    expect(report.alerts.find((a) => a.source === "liveness")).toBeUndefined();
    expect(report.severity).toBe("ok");
  });
});

/* ------------------------------------------------------------------ *
 *  Subsystem → alert mapping
 * ------------------------------------------------------------------ */

describe("subsystem alert mapping", () => {
  it("maps a not-drainable stack to a critical drainability alert + provider warns", () => {
    const report = evaluateOperationsAlerts(
      makeSnapshot({
        health: "blocked",
        drainable: false,
        recommendedAction: "configure-providers",
        subsystems: [
          sub("drainability", "blocked"),
          sub("storage", "warn"),
          sub("queue", "warn"),
        ],
      }),
    );
    expect(report.severity).toBe("critical");
    expect(exitCodeForSeverity(report.severity)).toBe(OPS_CHECK_EXIT.CRITICAL);
    expect(report.action).toBe("configure-providers");
    const drain = report.alerts.find((a) => a.source === "drainability");
    expect(drain?.severity).toBe("critical");
    expect(drain?.reason).toBe("not-drainable");
    expect(report.alerts.find((a) => a.source === "storage")?.reason).toBe(
      "storage-unconfigured",
    );
    expect(report.alerts.find((a) => a.source === "queue")?.reason).toBe(
      "queue-unconfigured",
    );
    // Most-severe first.
    expect(report.alerts[0]?.severity).toBe("critical");
  });

  const warnCases: Array<{ id: SnapshotSubsystemId; reason: AlertReason; action: string }> = [
    { id: "compression-engine", reason: "engine-degraded", action: "install-deep-engine" },
    { id: "ocr", reason: "ocr-unavailable", action: "install-ocr-engine" },
    { id: "malware-scan", reason: "scanner-unavailable", action: "fix-scanner" },
    { id: "guardrails", reason: "guardrail-warning", action: "monitor" },
    { id: "daemon-loop", reason: "loop-errors", action: "investigate-loop-errors" },
  ];

  for (const c of warnCases) {
    it(`maps a warn ${c.id} to ${c.reason}/${c.action}`, () => {
      const report = evaluateOperationsAlerts(
        makeSnapshot({ health: "warn", subsystems: [sub(c.id, "warn")] }),
      );
      const alert = report.alerts.find((a) => a.source === c.id);
      expect(alert?.severity).toBe("warn");
      expect(alert?.reason).toBe(c.reason);
      expect(alert?.action).toBe(c.action);
      expect(alert?.detail).toBe(ALERT_ACTION_DETAIL[alert!.action]);
    });
  }

  it("maps a lifecycle-verification drift to a page-worthy lifecycle-drift alert", () => {
    // A proven retention-backstop breach means objects can outlive the deletion ceiling.
    // The alert layer surfaces it as `lifecycle-drift` / `reconcile-lifecycle-drift`; the
    // exact escalation of its severity (a warn health class, optionally raised to
    // critical as a privacy incident) is a policy detail, so we assert only that it is a
    // real, actionable alert — never silently ok/unknown.
    const report = evaluateOperationsAlerts(
      makeSnapshot({
        health: "warn",
        recommendedAction: "reconcile-lifecycle-drift",
        subsystems: [sub("lifecycle-verification", "warn")],
      }),
    );
    const alert = report.alerts.find((a) => a.source === "lifecycle-verification");
    expect(alert).toBeDefined();
    expect(alert?.reason).toBe("lifecycle-drift");
    expect(alert?.action).toBe("reconcile-lifecycle-drift");
    expect(["warn", "critical"]).toContain(alert?.severity);
  });

  it("disambiguates an undeclared vs unverified lifecycle backstop via recommendedAction", () => {
    const undeclared = evaluateOperationsAlerts(
      makeSnapshot({
        health: "warn",
        recommendedAction: "declare-lifecycle",
        subsystems: [sub("lifecycle", "warn")],
      }),
    );
    expect(undeclared.alerts.find((a) => a.source === "lifecycle")?.reason).toBe(
      "lifecycle-undeclared",
    );

    const unverified = evaluateOperationsAlerts(
      makeSnapshot({
        health: "warn",
        recommendedAction: "verify-lifecycle",
        subsystems: [sub("lifecycle", "warn")],
      }),
    );
    expect(unverified.alerts.find((a) => a.source === "lifecycle")?.reason).toBe(
      "lifecycle-unverified",
    );
  });

  it("maps a blocked guardrails subsystem to a critical guardrail-error", () => {
    const report = evaluateOperationsAlerts(
      makeSnapshot({
        health: "blocked",
        recommendedAction: "fix-guardrail",
        subsystems: [sub("guardrails", "blocked")],
      }),
    );
    const g = report.alerts.find((a) => a.source === "guardrails");
    expect(g?.severity).toBe("critical");
    expect(g?.reason).toBe("guardrail-error");
    expect(g?.action).toBe("fix-guardrail");
  });

  it("never emits an alert for an ok or unknown subsystem (no data is not a problem)", () => {
    const report = evaluateOperationsAlerts(
      makeSnapshot({
        subsystems: [sub("compression-engine", "unknown"), sub("ocr", "ok")],
      }),
    );
    expect(report.alerts).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 *  SLO → alert mapping
 * ------------------------------------------------------------------ */

describe("SLO alert mapping", () => {
  it("maps an SLO breach to a critical alert carrying observed/threshold", () => {
    const report = evaluateOperationsAlerts(
      makeSnapshot({ health: "ok" }),
      sloReport(sloEval("job_success_rate", "breach", "80.00%", "warn <99%")),
    );
    const a = report.alerts.find((x) => x.source === "job_success_rate");
    expect(a?.severity).toBe("critical");
    expect(a?.reason).toBe("slo-breach");
    expect(a?.action).toBe("investigate-failures");
    expect(a?.observed).toBe("80.00%");
    expect(a?.threshold).toBe("warn <99%");
    expect(report.severity).toBe("critical");
  });

  it("maps an SLO warn to a warn alert with the routed action", () => {
    const report = evaluateOperationsAlerts(
      makeSnapshot(),
      sloReport(sloEval("queue_depth", "warn", "51-200", "warn ≥51-200")),
    );
    const a = report.alerts.find((x) => x.source === "queue_depth");
    expect(a?.reason).toBe("slo-warn");
    expect(a?.action).toBe("investigate-backlog");
    expect(report.severity).toBe("warn");
  });

  it("ignores ok/unknown SLO indicators", () => {
    const report = evaluateOperationsAlerts(
      makeSnapshot(),
      sloReport(sloEval("retry_rate", "unknown"), sloEval("engine_readiness", "ok")),
    );
    expect(report.alerts).toHaveLength(0);
    expect(report.severity).toBe("ok");
  });
});

/* ------------------------------------------------------------------ *
 *  Overall verdict + unknown escalation
 * ------------------------------------------------------------------ */

describe("overall verdict", () => {
  it("is OK for a fully healthy stack with no alerts", () => {
    const report = evaluateOperationsAlerts(
      makeSnapshot({ health: "ok", recommendedAction: "none", daemonState: "observed" }),
    );
    expect(report.severity).toBe("ok");
    expect(report.alerts).toHaveLength(0);
    expect(report.summary).toContain("OK");
  });

  it("escalates to UNKNOWN only when the snapshot's own health is indeterminate", () => {
    const report = evaluateOperationsAlerts(makeSnapshot({ health: "unknown" }));
    expect(report.severity).toBe("unknown");
    expect(exitCodeForSeverity(report.severity)).toBe(OPS_CHECK_EXIT.UNKNOWN);
  });

  it("does not escalate to UNKNOWN when a concrete signal outranks it", () => {
    const report = evaluateOperationsAlerts(
      makeSnapshot({ health: "warn", subsystems: [sub("malware-scan", "warn")] }),
    );
    expect(report.severity).toBe("warn");
  });

  it("carries the snapshot's single recommendedAction verbatim", () => {
    const report = evaluateOperationsAlerts(
      makeSnapshot({ health: "warn", recommendedAction: "install-ocr-engine" }),
    );
    expect(report.action).toBe("install-ocr-engine");
    expect(report.actionDetail).toBe(ALERT_ACTION_DETAIL["install-ocr-engine"]);
  });
});

/* ------------------------------------------------------------------ *
 *  No-leak: the policy authors all prose, never echoes the snapshot's
 * ------------------------------------------------------------------ */

describe("no-leak sanitization", () => {
  it("never surfaces a snapshot's content-bearing prose in the report", () => {
    const poisoned = makeSnapshot({
      poisonProse: true,
      health: "blocked",
      recommendedAction: "configure-providers",
      daemonState: "stale",
      subsystems: [sub("drainability", "blocked"), sub("malware-scan", "warn")],
    });
    const report = evaluateOperationsAlerts(
      poisoned,
      sloReport(sloEval("job_success_rate", "breach", "80.00%", "warn <99%")),
    );
    expect(JSON.stringify(report)).not.toContain(SECRET);
    // And it still produced a meaningful, authored verdict.
    expect(report.severity).toBe("critical");
    expect(report.alerts.length).toBeGreaterThan(0);
    for (const alert of report.alerts) {
      expect(alert.detail.length).toBeGreaterThan(0);
      expect(alert.detail).not.toContain(SECRET);
    }
  });
});
