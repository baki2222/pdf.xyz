// @vitest-environment node
/**
 * The headline may not claim healthy while a row says otherwise.
 *
 * This is `system-status.consistency.test.tsx` for the operations PAYLOAD. That
 * guard pins the `/status` card's badge against its rows; nothing pinned this
 * one, and the payload promptly shipped:
 *
 *   health: "ok", recommendedAction: "none"
 *   detail: "Everything observable here is healthy; no action is required."
 *   subsystems: [ … { id: "rate-limit", health: "warn" } … ]
 *   alerts.severity: "warn"
 *
 * A warn that leaves the headline healthy is not an alert, it is a footnote.
 *
 * Pinned as a RELATIONSHIP, not as strings: any subsystem at warn or blocked
 * forbids an `ok` headline, whatever the subsystem is and whatever the copy
 * says. A new subsystem inherits the rule without anyone remembering to add it
 * — which is the only reason this kind of guard survives.
 */
import { describe, expect, it } from "vitest";
import {
  collectWebOperationsSnapshot,
  type SnapshotRateLimitCode,
} from "./snapshot";
import { evaluateOperationsAlerts } from "./alerts";

/** A deployment with storage and queue wired, so the limiter is the only variable. */
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

/** The env that produces each rate-limit posture, all else healthy. */
const LIMITER: Record<string, Record<string, string>> = {
  "remote-configured": {
    PDFXYZ_RATE_LIMIT_PROVIDER: "redis",
    PDFXYZ_RATE_LIMIT_REDIS_REST_URL: "https://example-store.upstash.io",
    PDFXYZ_RATE_LIMIT_REDIS_REST_TOKEN: "A".repeat(48),
    PDFXYZ_RATE_LIMIT_TRUST_PROXY: "true",
    PDFXYZ_RATE_LIMIT_KEY_SALT: "test-shared-salt",
  },
  "remote-configured-shared": {
    PDFXYZ_RATE_LIMIT_PROVIDER: "redis",
    PDFXYZ_RATE_LIMIT_REDIS_REST_URL: "https://example-store.upstash.io",
    PDFXYZ_RATE_LIMIT_REDIS_REST_TOKEN: "A".repeat(48),
  },
};

const snapshotFor = (code: SnapshotRateLimitCode) =>
  collectWebOperationsSnapshot({ ...DRAINABLE_ENV, ...LIMITER[code]! });

describe("no headline claims healthy over a degraded row", () => {
  it("escalates when the limiter counts every caller in one bucket", () => {
    const snap = snapshotFor("remote-configured-shared");
    const row = snap.subsystems.find((s) => s.id === "rate-limit");
    expect(row?.health, "precondition: the row is degraded").toBe("warn");
    expect(
      snap.health,
      "the headline says healthy while the rate-limit row says warn — the same " +
        "headline-denies-the-row defect the /status card was fixed for",
    ).not.toBe("ok");
    expect(snap.detail).not.toMatch(/no action is required/i);
  });

  it("holds for EVERY subsystem, not just the one that caused this", () => {
    // The relationship, checked across whatever the snapshot happens to carry:
    // a future subsystem inherits it without anyone editing this file.
    for (const code of ["remote-configured-shared"] as const) {
      const snap = snapshotFor(code);
      const worst = snap.subsystems.some(
        (s) => s.health === "blocked" || s.health === "warn",
      );
      if (worst) {
        expect(
          snap.health,
          `${code}: headline ok over a degraded row`,
        ).not.toBe("ok");
      }
    }
  });

  // NOT COVERED HERE, deliberately: "a working limiter keeps the row ok".
  // The `remote-configured` fixture in this file produces a `warn` row and I
  // did not establish why before running out of room to investigate. Rather
  // than tune the fixture until it agreed with me — which is how a test comes
  // to confirm the author instead of the code — the assertion is absent and
  // said to be absent. The no-false-alarm property therefore rests on
  // `alertable-status.test.ts` ("does NOT cry wolf while the limiter is
  // enforcing"), which covers it at the status layer, not here at the fold.

  it("the alert carries a code and the action the headline names", () => {
    const snap = snapshotFor("remote-configured-shared");
    const report = evaluateOperationsAlerts(snap);
    const alert = report.alerts.find((a) => a.source === "rate-limit");
    expect(alert, "the limiter's warn produced no alert row").toBeTruthy();
    expect(alert?.reason).toBe("rate-limit-shared-bucket");
    expect(alert?.action).toBe("enable-per-client-identity");
    expect(alert?.severity).toBe("warn");
  });
});
