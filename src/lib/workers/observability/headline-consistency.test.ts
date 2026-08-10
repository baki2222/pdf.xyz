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

/**
 * A deployment with storage, queue AND a validated lifecycle backstop wired,
 * so the limiter really is the only variable.
 *
 * The first version of this file wired storage and queue only, under the
 * comment "all else healthy" — which was a CLAIM, and nothing checked it. The
 * unset scanner/lifecycle/heartbeat produced their own warn, so the
 * `remote-configured` arm could not distinguish "the limiter is fine" from
 * "something else is not". Third instance this week of a fixture whose premise
 * the suite could only confirm. `precondition()` below turns the sentence into
 * an assertion.
 */
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
  PDFXYZ_LIFECYCLE_PROVIDER: "aws-s3",
  PDFXYZ_LIFECYCLE_VALIDATED: "true",
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

/**
 * Assert what the fixture's comment used to merely say: every subsystem OTHER
 * than the limiter is healthy. Without this, a new subsystem that defaults to
 * warn would silently make every arm below test the wrong thing — which is
 * precisely how the missing ok-arm went uncovered the first time.
 */
function precondition(snap: ReturnType<typeof snapshotFor>): void {
  const others = snap.subsystems.filter((s) => s.id !== "rate-limit");
  const degraded = others.filter(
    (s) => s.health !== "ok" && s.health !== "unknown",
  );
  expect(
    degraded.map((s) => `${s.id}=${s.health}`),
    "the fixture is no longer 'all else healthy', so these arms would be " +
      "measuring some other subsystem's warn instead of the limiter's",
  ).toEqual([]);
}

describe("no headline claims healthy over a degraded row", () => {
  it("escalates when the limiter counts every caller in one bucket", () => {
    const snap = snapshotFor("remote-configured-shared");
    precondition(snap);
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

  it("a working limiter keeps the row AND the headline ok", () => {
    // The no-false-alarm half, at the FOLD rather than borrowed from
    // alertable-status.test.ts, which covers it one layer down. Absent until
    // the precondition above existed, because the fixture could not tell a
    // healthy limiter from a healthy limiter beside an unhealthy something-else.
    const snap = snapshotFor("remote-configured");
    precondition(snap);
    expect(snap.subsystems.find((s) => s.id === "rate-limit")?.health).toBe(
      "ok",
    );
    expect(snap.health, "the guard must not manufacture alarm").toBe("ok");
    expect(snap.recommendedAction).not.toBe("enable-per-client-identity");
  });

  // PREVIOUSLY NOT COVERED, and now is — kept as a record of why:
  // The `remote-configured` fixture in this file produces a `warn` row and I
  // did not establish why before running out of room to investigate, so the
  // assertion was absent and said to be absent rather than tuned until it
  // agreed with me. The cause was the fixture's own unasserted premise, which
  // `precondition()` now checks.

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
