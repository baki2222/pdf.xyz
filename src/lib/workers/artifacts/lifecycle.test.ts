// @vitest-environment node
/**
 * Contract for the pure storage-artifact lifecycle evaluator: evidence → bounded state, the
 * deliberate precedence (tombstone > expiry > live), and the load-bearing honesty rules
 * (no evidence never becomes a denial; an unreadable clock never fabricates `expired`).
 */
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_LIFECYCLE_STATES,
  evaluateArtifactLifecycle,
  type ArtifactLifecycleMetadata,
} from "./lifecycle";

const NOW = Date.UTC(2026, 0, 2, 12, 0, 0);

function meta(over: Partial<ArtifactLifecycleMetadata> = {}): ArtifactLifecycleMetadata {
  return { expiresAtMs: NOW + 60_000, deleted: false, ...over };
}

describe("evaluateArtifactLifecycle", () => {
  it("is `unknown` when there is no evidence at all (present object, no metadata)", () => {
    expect(evaluateArtifactLifecycle(null, NOW)).toBe("unknown");
  });

  it("is `live` when a recorded window has not passed", () => {
    expect(evaluateArtifactLifecycle(meta({ expiresAtMs: NOW + 1 }), NOW)).toBe("live");
  });

  it("is `expired` at or after the recorded window (matching the local store's `now >= expiry`)", () => {
    expect(evaluateArtifactLifecycle(meta({ expiresAtMs: NOW }), NOW)).toBe("expired");
    expect(evaluateArtifactLifecycle(meta({ expiresAtMs: NOW - 1 }), NOW)).toBe("expired");
  });

  it("is `deleted` for an explicit tombstone, regardless of the window (tombstone wins)", () => {
    expect(evaluateArtifactLifecycle(meta({ deleted: true, expiresAtMs: NOW + 10_000 }), NOW)).toBe("deleted");
    // Tombstone also wins over an already-passed window.
    expect(evaluateArtifactLifecycle(meta({ deleted: true, expiresAtMs: NOW - 10_000 }), NOW)).toBe("deleted");
  });

  it("never fabricates `expired` from an unreadable clock — it defers to `live`", () => {
    // A non-finite clock cannot PROVE the window passed; enforcement falls to the bucket backstop.
    expect(evaluateArtifactLifecycle(meta({ expiresAtMs: NOW - 10_000 }), Number.NaN)).toBe("live");
    // But a tombstone does not depend on the clock — it still denies.
    expect(evaluateArtifactLifecycle(meta({ deleted: true }), Number.NaN)).toBe("deleted");
  });

  it("only ever returns a member of the closed state vocabulary", () => {
    const inputs: Array<[ArtifactLifecycleMetadata | null, number]> = [
      [null, NOW],
      [meta(), NOW],
      [meta({ deleted: true }), NOW],
      [meta({ expiresAtMs: NOW - 1 }), NOW],
      [meta(), Number.POSITIVE_INFINITY],
    ];
    for (const [m, n] of inputs) {
      expect(ARTIFACT_LIFECYCLE_STATES).toContain(evaluateArtifactLifecycle(m, n));
    }
  });
});
