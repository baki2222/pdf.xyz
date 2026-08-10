// @vitest-environment node
/**
 * Contract for the pure storage-artifact cleanup verifier: the per-object classification
 * taxonomy (absence-mechanism attribution, retrieval-denial vs drift across the reap grace,
 * the honest `unknown`/`unavailable` states), the aggregate verdict fold, the `not-configured`
 * short-circuit, and content-free-by-construction output. Pure and node-free — no store, no
 * route, no real clock.
 */
import { describe, expect, it } from "vitest";
import {
  CLEANUP_OBJECT_STATES,
  CLEANUP_VERIFICATION_VERDICTS,
  type CleanupObjectEvidence,
} from "./types";
import {
  classifyCleanupObject,
  verifyArtifactCleanup,
  DEFAULT_REAP_GRACE_MS,
} from "./verify";

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const GRACE = DEFAULT_REAP_GRACE_MS; // 48h

/** A terse evidence builder. */
function ev(partial: Partial<CleanupObjectEvidence>): CleanupObjectEvidence {
  return {
    presence: partial.presence ?? "present",
    lifecycle: partial.lifecycle ?? null,
    activeDelete: partial.activeDelete ?? false,
  };
}

describe("classifyCleanupObject", () => {
  it("attributes an absent object with a delete-now receipt to active deletion", () => {
    expect(
      classifyCleanupObject(
        ev({ presence: "absent", activeDelete: true }),
        NOW,
      ),
    ).toBe("absent-active");
  });

  it("attributes an absent object with no receipt to the lifecycle backstop", () => {
    expect(
      classifyCleanupObject(
        ev({ presence: "absent", activeDelete: false }),
        NOW,
      ),
    ).toBe("absent-backstop");
  });

  it("classifies a present, in-window object as live (not a cleanup target)", () => {
    const evidence = ev({
      presence: "present",
      lifecycle: { expiresAtMs: NOW + HOUR, deleted: false },
    });
    expect(classifyCleanupObject(evidence, NOW)).toBe("live");
  });

  it("classifies a present object with no lifecycle evidence as unknown", () => {
    expect(
      classifyCleanupObject(ev({ presence: "present", lifecycle: null }), NOW),
    ).toBe("unknown");
  });

  it("classifies a present, recently-expired object (within grace) as retrieval-denied", () => {
    const evidence = ev({
      presence: "present",
      lifecycle: { expiresAtMs: NOW - HOUR, deleted: false },
    });
    expect(classifyCleanupObject(evidence, NOW, GRACE)).toBe(
      "retrieval-denied",
    );
  });

  it("classifies a present, long-expired object (past grace) as drift", () => {
    const evidence = ev({
      presence: "present",
      lifecycle: { expiresAtMs: NOW - (GRACE + HOUR), deleted: false },
    });
    expect(classifyCleanupObject(evidence, NOW, GRACE)).toBe("drift");
  });

  it("classifies a present tombstoned object within grace as retrieval-denied", () => {
    const evidence = ev({
      presence: "present",
      lifecycle: { expiresAtMs: NOW - HOUR, deleted: true },
    });
    expect(classifyCleanupObject(evidence, NOW, GRACE)).toBe(
      "retrieval-denied",
    );
  });

  it("classifies a present tombstoned object past grace as drift", () => {
    const evidence = ev({
      presence: "present",
      lifecycle: { expiresAtMs: NOW - (GRACE + HOUR), deleted: true },
    });
    expect(classifyCleanupObject(evidence, NOW, GRACE)).toBe("drift");
  });

  it("never fabricates drift for a tombstoned object with no usable expiry", () => {
    // A tombstone with a placeholder (0) expiry is `deleted` but has no deadline to grace
    // against — it must fall toward retrieval-denied, never a fabricated drift.
    const evidence = ev({
      presence: "present",
      lifecycle: { expiresAtMs: 0, deleted: true },
    });
    expect(classifyCleanupObject(evidence, NOW, GRACE)).toBe(
      "retrieval-denied",
    );
  });

  it("treats the grace boundary as inclusive (now === expiry + grace ⇒ drift)", () => {
    const evidence = ev({
      presence: "present",
      lifecycle: { expiresAtMs: NOW - GRACE, deleted: false },
    });
    expect(classifyCleanupObject(evidence, NOW, GRACE)).toBe("drift");
  });

  it("classifies a failed probe as unavailable", () => {
    expect(classifyCleanupObject(ev({ presence: "error" }), NOW)).toBe(
      "unavailable",
    );
  });

  it("resolves lifecycle exactly as the Phase 41 evaluator (unreadable clock never expires)", () => {
    // With a non-finite clock, evaluateArtifactLifecycle refuses to assert expiry → live,
    // so a present object is neither denied nor drift.
    const evidence = ev({
      presence: "present",
      lifecycle: { expiresAtMs: NOW - HOUR, deleted: false },
    });
    expect(classifyCleanupObject(evidence, Number.NaN, GRACE)).toBe("live");
  });

  it("only ever returns a value from the bounded state enum", () => {
    const samples: CleanupObjectEvidence[] = [
      ev({ presence: "absent", activeDelete: true }),
      ev({ presence: "absent" }),
      ev({
        presence: "present",
        lifecycle: { expiresAtMs: NOW - GRACE - HOUR, deleted: false },
      }),
      ev({
        presence: "present",
        lifecycle: { expiresAtMs: NOW - HOUR, deleted: false },
      }),
      ev({ presence: "present", lifecycle: null }),
      ev({ presence: "error" }),
    ];
    for (const s of samples) {
      expect(CLEANUP_OBJECT_STATES).toContain(
        classifyCleanupObject(s, NOW, GRACE),
      );
    }
  });
});

describe("verifyArtifactCleanup — aggregate verdict", () => {
  const opts = {
    provider: "remote-configured" as const,
    now: NOW,
    graceMs: GRACE,
  };

  it("short-circuits to not-configured, ignoring any evidence", () => {
    const result = verifyArtifactCleanup(
      [
        ev({
          presence: "present",
          lifecycle: { expiresAtMs: NOW - GRACE - HOUR, deleted: false },
        }),
      ],
      { provider: "not-configured", now: NOW, graceMs: GRACE },
    );
    expect(result.verdict).toBe("not-configured");
    expect(result.total).toBe(0); // evidence is never inspected
    expect(result.drift).toBe(0);
  });

  it("reports unknown for an empty evidence set on a configured provider", () => {
    const result = verifyArtifactCleanup([], opts);
    expect(result.verdict).toBe("unknown");
    expect(result.total).toBe(0);
    expect(result.summary).toMatch(/no cleanup evidence/i);
  });

  it("reports verified when every should-be-gone object is confirmed absent", () => {
    const result = verifyArtifactCleanup(
      [
        ev({ presence: "absent", activeDelete: true }),
        ev({ presence: "absent" }),
      ],
      opts,
    );
    expect(result.verdict).toBe("verified");
    expect(result.reaped).toBe(2);
    expect(result.counts["absent-active"]).toBe(1);
    expect(result.counts["absent-backstop"]).toBe(1);
  });

  it("does NOT report verified when reaping is mixed with present-but-denied (cleanup pending)", () => {
    const result = verifyArtifactCleanup(
      [
        ev({ presence: "absent" }),
        ev({
          presence: "present",
          lifecycle: { expiresAtMs: NOW - HOUR, deleted: false },
        }),
      ],
      opts,
    );
    expect(result.verdict).toBe("unknown");
    expect(result.reaped).toBe(1);
    expect(result.counts["retrieval-denied"]).toBe(1);
    expect(result.summary).toMatch(/awaiting reap/i);
  });

  it("reports drift when any object is present past its reap grace", () => {
    const result = verifyArtifactCleanup(
      [
        ev({ presence: "absent" }),
        ev({
          presence: "present",
          lifecycle: { expiresAtMs: NOW - GRACE - HOUR, deleted: false },
        }),
      ],
      opts,
    );
    expect(result.verdict).toBe("drift");
    expect(result.drift).toBe(1);
  });

  it("ranks drift above unavailable (a confirmed problem outranks an incomplete run)", () => {
    const result = verifyArtifactCleanup(
      [
        ev({ presence: "error" }),
        ev({
          presence: "present",
          lifecycle: { expiresAtMs: NOW - GRACE - HOUR, deleted: false },
        }),
      ],
      opts,
    );
    expect(result.verdict).toBe("drift");
  });

  it("reports unavailable when a probe failed and nothing drifted", () => {
    const result = verifyArtifactCleanup(
      [ev({ presence: "absent" }), ev({ presence: "error" })],
      opts,
    );
    expect(result.verdict).toBe("unavailable");
  });

  it("reports unknown when only present-without-evidence objects are seen", () => {
    const result = verifyArtifactCleanup(
      [ev({ presence: "present", lifecycle: null })],
      opts,
    );
    expect(result.verdict).toBe("unknown");
    expect(result.counts.unknown).toBe(1);
  });

  it("excludes live objects from the should-be-gone accounting", () => {
    // Only a live object present: not a cleanup target, and no reaping evidence → unknown,
    // never verified (there is nothing proven gone).
    const result = verifyArtifactCleanup(
      [
        ev({
          presence: "present",
          lifecycle: { expiresAtMs: NOW + HOUR, deleted: false },
        }),
      ],
      opts,
    );
    expect(result.verdict).toBe("unknown");
    expect(result.counts.live).toBe(1);
  });

  it("always produces a verdict from the bounded verdict enum", () => {
    const result = verifyArtifactCleanup([ev({ presence: "absent" })], opts);
    expect(CLEANUP_VERIFICATION_VERDICTS).toContain(result.verdict);
  });

  it("carries the provider through unchanged", () => {
    const result = verifyArtifactCleanup([ev({ presence: "absent" })], opts);
    expect(result.provider).toBe("remote-configured");
  });

  it("defaults the clock and grace when omitted (does not throw)", () => {
    const result = verifyArtifactCleanup([ev({ presence: "absent" })], {
      provider: "remote-configured",
    });
    expect(result.verdict).toBe("verified");
  });
});
