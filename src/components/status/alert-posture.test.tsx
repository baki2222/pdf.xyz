import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AlertPostureCallout, normalizeAlertPosture } from "./alert-posture";

/** A hostile string the UI must never surface (it maps codes → client copy only). */
const SECRET = "s3://leaky-bucket/secret-invoice.pdf?sig=deadbeef";

/** Wrap an `alerts` report the way `/api/worker/operations` attaches it to the body. */
function withAlerts(report: unknown): unknown {
  return { version: 1, vantage: "web", health: "warn", alerts: report };
}

describe("normalizeAlertPosture", () => {
  it("returns null when the response carries no recognizable alert report", () => {
    expect(normalizeAlertPosture({ version: 1 })).toBeNull();
    expect(normalizeAlertPosture(null)).toBeNull();
    expect(normalizeAlertPosture("nope")).toBeNull();
    expect(normalizeAlertPosture(withAlerts({ severity: "nonsense", alerts: [] }))).toBeNull();
  });

  it("reads bounded severity, counts contributing alerts, and dedupes reasons", () => {
    const posture = normalizeAlertPosture(
      withAlerts({
        severity: "critical",
        alerts: [
          { severity: "critical", reason: "not-drainable" },
          { severity: "warn", reason: "scanner-unavailable" },
          { severity: "warn", reason: "scanner-unavailable" }, // duplicate reason
          { severity: "ok", reason: "liveness-observed" }, // ok never contributes
        ],
      }),
    );
    expect(posture).toEqual({
      severity: "critical",
      critical: 1,
      warn: 2,
      reasons: ["not-drainable", "scanner-unavailable"],
    });
  });

  it("drops an out-of-enum reason (an injected string can never become a reason)", () => {
    const posture = normalizeAlertPosture(
      withAlerts({
        severity: "warn",
        alerts: [{ severity: "warn", reason: SECRET }],
      }),
    );
    expect(posture?.warn).toBe(1);
    expect(posture?.reasons).toEqual([]); // the hostile reason is dropped, not rendered
  });
});

describe("AlertPostureCallout", () => {
  it("renders client-authored copy for the severity and reasons, never server prose", () => {
    render(
      <AlertPostureCallout
        snapshot={withAlerts({
          severity: "critical",
          summary: SECRET, // hostile top-level prose
          alerts: [{ severity: "critical", reason: "lifecycle-drift", detail: SECRET }],
        })}
      />,
    );
    // Client-authored copy is present…
    expect(screen.getByText(/retention backstop has drifted/i)).toBeInTheDocument();
    expect(screen.getByText(/monitor would page/i)).toBeInTheDocument();
    // …and no server-provided string reaches the DOM.
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("shows the OK posture with no reasons and no page", () => {
    render(<AlertPostureCallout snapshot={withAlerts({ severity: "ok", alerts: [] })} />);
    expect(screen.getByText(/no alert would fire/i)).toBeInTheDocument();
  });

  it("renders nothing when the response has no alerts report (graceful degrade)", () => {
    const { container } = render(<AlertPostureCallout snapshot={{ version: 1 }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
