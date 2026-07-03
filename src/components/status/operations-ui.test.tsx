import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { collectWebOperationsSnapshot } from "@/lib/workers/observability";
import type { WorkerOperationsSnapshot } from "@/lib/workers/observability";
import { OperationsSnapshotView, normalizeSnapshot } from "./operations-ui";

/** The same drainable config the observability suite uses (secrets are inert here). */
const DRAINABLE_ENV = {
  PDFXYZ_STORAGE_PROVIDER: "s3",
  PDFXYZ_S3_ENDPOINT: "https://s3.example.com",
  PDFXYZ_S3_REGION: "auto",
  PDFXYZ_S3_BUCKET: "pdfxyz-store",
  PDFXYZ_S3_ACCESS_KEY_ID: "AKIAEXAMPLE123",
  PDFXYZ_S3_SECRET_ACCESS_KEY: "s3-secret-value-1234567890",
  PDFXYZ_QUEUE_PROVIDER: "redis",
  PDFXYZ_REDIS_REST_URL: "https://redis.example.com",
  PDFXYZ_REDIS_REST_TOKEN: "redis-rest-token-1234",
} as const;

/** A minimal, valid base snapshot. Server free-form strings are set to placeholders
 *  the UI is expected to ignore (it renders only bounded enums → client copy). */
function makeSnapshot(
  overrides: Partial<WorkerOperationsSnapshot> = {},
): WorkerOperationsSnapshot {
  return {
    version: 1,
    vantage: "web",
    mode: "disabled",
    drainable: false,
    daemonObserved: false,
    health: "unknown",
    detail: "server-detail-should-not-render",
    recommendedAction: "confirm-worker-deployment",
    recommendedActionDetail: "server-detail-should-not-render",
    subsystems: [],
    proofs: { compressionDeep: "unknown", ocr: "unknown" },
    lifecycleVerification: {
      known: false,
      verdict: "unknown",
      health: "unknown",
      detail: "server-detail-should-not-render",
    },
    lastLoop: null,
    ...overrides,
  };
}

describe("normalizeSnapshot", () => {
  it("coerces non-object / garbage input to a safe, honest default", () => {
    for (const garbage of [null, undefined, 42, "nope", [], true]) {
      const v = normalizeSnapshot(garbage);
      expect(v.health).toBe("unknown");
      expect(v.recommendedAction).toBeNull();
      expect(v.subsystems).toEqual([]);
      expect(v.proofs).toEqual({ compressionDeep: "unknown", ocr: "unknown" });
      expect(v.lifecycleVerification.verdict).toBe("unknown");
      expect(v.lastLoop).toBeNull();
      expect(v.drainable).toBe(false);
      expect(v.daemonObserved).toBe(false);
    }
  });

  it("drops unknown enum values and unknown subsystem ids instead of trusting them", () => {
    const v = normalizeSnapshot({
      vantage: "hacker",
      mode: "root",
      health: "catastrophic",
      recommendedAction: "rm-rf",
      drainable: "yes",
      daemonObserved: 1,
      proofs: { compressionDeep: "leaked", ocr: "available" },
      subsystems: [
        { id: "storage", health: "ok" },
        { id: "not-a-subsystem", health: "ok" },
        { id: "storage", health: "warn" }, // duplicate id ignored
        "not-an-object",
      ],
      lifecycleVerification: { verdict: "sideways", health: "nope" },
      lastLoop: { mode: "warp", reason: "boom", ticks: -3, failed: 2.9, errors: "x" },
    });
    expect(v.vantage).toBe("web");
    expect(v.mode).toBeNull();
    expect(v.health).toBe("unknown");
    expect(v.recommendedAction).toBeNull();
    expect(v.drainable).toBe(false); // only literal true counts
    expect(v.daemonObserved).toBe(false);
    expect(v.proofs).toEqual({ compressionDeep: "unknown", ocr: "available" });
    expect(v.subsystems).toEqual([{ id: "storage", health: "ok" }]); // first wins, unknowns dropped
    expect(v.lifecycleVerification).toEqual({ verdict: "unknown", health: "unknown" });
    expect(v.lastLoop).toEqual({
      mode: null,
      reason: null,
      health: "unknown",
      ticks: 0, // negative clamped
      completed: 0,
      failed: 2, // floored
      requeued: 0,
      canceled: 0,
      idle: 0,
      errors: 0, // non-number → 0
    });
  });
});

describe("OperationsSnapshotView — honest end-to-end states", () => {
  it("renders the no-config web snapshot: blocked, configure-providers, daemon caveat", () => {
    render(<OperationsSnapshotView snapshot={collectWebOperationsSnapshot({})} />);

    // Overall health + the single recommended action.
    expect(screen.getAllByText("Blocked").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText("Configure the queue and storage"),
    ).toBeInTheDocument();

    // The load-bearing daemon-observability caveat is present and unambiguous.
    expect(
      screen.getByText(/can.?t see a running worker/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/cannot observe a separate worker process/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/process supervisor/i)).toBeInTheDocument();

    // The subsystem grid renders the bounded breakdown.
    expect(screen.getByText("Drainability")).toBeInTheDocument();
    expect(screen.getByText("Deployment guardrails")).toBeInTheDocument();
    // Web-vantage engine proofs are honestly unknown.
    expect(screen.getAllByText("Unknown from here").length).toBeGreaterThanOrEqual(2);
  });

  it("renders the drainable-but-lifecycle-missing snapshot: declare-lifecycle", () => {
    render(
      <OperationsSnapshotView snapshot={collectWebOperationsSnapshot(DRAINABLE_ENV)} />,
    );
    expect(screen.getByText("Declare a retention backstop")).toBeInTheDocument();
    // Drainable does NOT imply an observed worker — the caveat still shows.
    expect(
      screen.getByText(/can.?t see a running worker/i),
    ).toBeInTheDocument();
  });

  it("renders a guardrail-blocked snapshot: fix-guardrail with a blocked class", () => {
    render(
      <OperationsSnapshotView
        snapshot={makeSnapshot({
          health: "blocked",
          recommendedAction: "fix-guardrail",
          subsystems: [
            { id: "guardrails", label: "x", health: "blocked", detail: "x" },
            { id: "drainability", label: "x", health: "ok", detail: "x" },
          ],
        })}
      />,
    );
    expect(screen.getByText("Fix a deployment guardrail")).toBeInTheDocument();
    expect(screen.getByText("Deployment guardrails")).toBeInTheDocument();
    expect(screen.getAllByText("Blocked").length).toBeGreaterThanOrEqual(1);
  });

  it("renders a lifecycle-drift snapshot: reconcile action + drift verdict", () => {
    render(
      <OperationsSnapshotView
        snapshot={makeSnapshot({
          health: "warn",
          drainable: true,
          recommendedAction: "reconcile-lifecycle-drift",
          lifecycleVerification: {
            known: true,
            verdict: "drift",
            health: "warn",
            detail: "x",
          },
        })}
      />,
    );
    expect(screen.getByText("Reconcile retention drift")).toBeInTheDocument();
    expect(screen.getByText("Drift detected")).toBeInTheDocument();
  });

  it("renders a worker-vantage loop-error snapshot: investigate action + loop counts", () => {
    render(
      <OperationsSnapshotView
        snapshot={makeSnapshot({
          vantage: "worker",
          daemonObserved: true,
          health: "warn",
          drainable: true,
          recommendedAction: "investigate-loop-errors",
          lastLoop: {
            mode: "drain",
            reason: "queue_error",
            ticks: 5,
            completed: 2,
            failed: 1,
            requeued: 1,
            canceled: 0,
            idle: 1,
            errors: 2,
            health: "warn",
          },
        })}
      />,
    );
    expect(screen.getByText("Investigate worker loop errors")).toBeInTheDocument();
    expect(screen.getByText("Last worker loop")).toBeInTheDocument();
    // On the worker vantage the caveat flips to the positive, observed message.
    expect(
      screen.getByText(/worker process is observable/i),
    ).toBeInTheDocument();
    // Bounded integer counters render (Failed=1, Errors=2).
    expect(screen.getByText("Errors")).toBeInTheDocument();
    expect(screen.getByText("Ticks")).toBeInTheDocument();
  });
});

describe("OperationsSnapshotView — healthy / unknown / disabled states", () => {
  it("renders a healthy worker-vantage snapshot: no action, observed worker, ok class", () => {
    render(
      <OperationsSnapshotView
        snapshot={makeSnapshot({
          vantage: "worker",
          mode: "remote-configured",
          daemonObserved: true,
          drainable: true,
          health: "ok",
          recommendedAction: "none",
        })}
      />,
    );
    expect(screen.getByText("No action required")).toBeInTheDocument();
    expect(screen.getAllByText("Healthy").length).toBeGreaterThanOrEqual(1);
    // Worker vantage flips the caveat to the positive, observed message.
    expect(screen.getByText(/worker process is observable/i)).toBeInTheDocument();
  });

  it("renders an unknown-health snapshot as grey (never green) and falls back to generic action copy", () => {
    render(
      <OperationsSnapshotView
        snapshot={
          {
            ...makeSnapshot({ health: "unknown" }),
            // An action outside the known enum must degrade to safe, client-authored
            // generic copy — never a rendered server string.
            recommendedAction: "totally-unknown-action",
          } as unknown as WorkerOperationsSnapshot
        }
      />,
    );
    expect(
      screen.getByText("Worker health is unknown from this vantage."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Review the worker configuration")).toBeInTheDocument();
  });

  it("surfaces the disabled worker mode as a content-free fact (no-config)", () => {
    render(<OperationsSnapshotView snapshot={collectWebOperationsSnapshot({})} />);
    // No-config resolves to `disabled` mode; the health card shows it as a bounded fact.
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  it("renders a content-free source/vantage footer carrying only the schema version", () => {
    const { container } = render(
      <OperationsSnapshotView snapshot={collectWebOperationsSnapshot({})} />,
    );
    const text = container.textContent ?? "";
    expect(text).toMatch(/Source: live, point-in-time/);
    expect(text).toMatch(/web-vantage/);
    expect(text).toMatch(/schema v1/);
  });
});

describe("OperationsSnapshotView — privacy", () => {
  it("never echoes hostile endpoint / object-key / filename / secret strings from a malformed response", () => {
    const FORBIDDEN = [
      "https://",
      "s3://",
      "evil.example.com",
      "hostile.example.com",
      "drift.example.com",
      "secret-bucket",
      "object-key",
      "invoice.pdf",
      "leak-me.pdf",
      "TOKEN_SECRET_VALUE",
      "AKIASECRET",
      "/etc/passwd",
      "/tmp/",
      "EVILLABEL",
      "server-detail-should-not-render",
      // Ports, signed-URL params, and recognized OCR text must be inert too.
      ":6379",
      "X-Amz-Signature",
      "deadbeefcafe",
      "RECOGNIZED_OCR_SENTINEL",
    ];

    // A response an honest backend would never send: secrets stuffed into every
    // free-form field, plus unknown ids/fields and an injected top-level key.
    const hostile = {
      version: 1,
      vantage: "web",
      mode: "disabled",
      drainable: false,
      daemonObserved: false,
      health: "blocked",
      detail:
        "https://evil.example.com:6379/leak?X-Amz-Signature=deadbeefcafe s3://secret-bucket/object-key invoice.pdf RECOGNIZED_OCR_SENTINEL",
      recommendedAction: "configure-providers",
      recommendedActionDetail: "TOKEN_SECRET_VALUE /etc/passwd /tmp/leak-me.pdf",
      subsystems: [
        {
          id: "storage",
          label: "https://hostile.example.com",
          health: "warn",
          detail: "s3://secret-bucket/object-key AKIASECRET invoice.pdf",
        },
        {
          id: "not-a-real-subsystem",
          label: "EVILLABEL",
          health: "ok",
          detail: "leak-me.pdf",
        },
      ],
      proofs: { compressionDeep: "https://evil.example.com", ocr: "unknown" },
      lifecycleVerification: {
        known: false,
        verdict: "unknown",
        health: "unknown",
        detail: "https://drift.example.com TOKEN_SECRET_VALUE",
      },
      lastLoop: null,
      // An injected field the schema doesn't have at all.
      injected: "https://evil.example.com/AKIASECRET/invoice.pdf",
    } as unknown as WorkerOperationsSnapshot;

    const { container } = render(<OperationsSnapshotView snapshot={hostile} />);
    const text = container.textContent ?? "";
    for (const forbidden of FORBIDDEN) {
      expect(text).not.toContain(forbidden);
    }

    // It still renders honest, client-authored copy for the recognized enums.
    expect(screen.getByText("Configure the queue and storage")).toBeInTheDocument();
    expect(screen.getByText("Object storage")).toBeInTheDocument();
    // The unknown subsystem id is dropped entirely.
    expect(within(container).queryByText("EVILLABEL")).toBeNull();
  });
});
