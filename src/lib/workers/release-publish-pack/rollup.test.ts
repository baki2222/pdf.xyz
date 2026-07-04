import { describe, expect, it } from "vitest";
import { computePublishRollup, derivePublishReasons, type PublishPackSources } from "./rollup";
import type {
  ReleasePublishPackPolicy,
  ReleasePublishPackSource,
  ReleasePublishPackSourceId,
  ReleasePublishPackSourceState,
} from "./types";

/** A bounded reduced source in a given state / verdict — enough for the fold. */
function src(
  id: ReleasePublishPackSourceId,
  state: ReleasePublishPackSourceState,
  verdict: string | null,
): ReleasePublishPackSource {
  return {
    id,
    state,
    supplied: state !== "absent",
    recognized: state === "tampered" || state === "usable",
    usable: state === "usable",
    verdict: state === "absent" ? null : verdict,
    severity: null,
    detail: "",
  };
}

const ABSENT = (id: ReleasePublishPackSourceId) => src(id, "absent", null);

/** Assemble the five sources, defaulting each to absent. */
function sources(over: Partial<PublishPackSources> = {}): PublishPackSources {
  return {
    governance: over.governance ?? ABSENT("governance"),
    archive: over.archive ?? ABSENT("archive"),
    restoreDrill: over.restoreDrill ?? ABSENT("restore-drill"),
    report: over.report ?? ABSENT("report"),
    trend: over.trend ?? ABSENT("trend"),
  };
}

const POLICY: ReleasePublishPackPolicy = { requireArchive: false, requireRestoreDrill: false, strict: false };
const policy = (over: Partial<ReleasePublishPackPolicy> = {}): ReleasePublishPackPolicy => ({ ...POLICY, ...over });

describe("computePublishRollup — the composite publish verdict + disclosure", () => {
  it("a usable healthy governance alone is publishable / share-safe", () => {
    const { rollup } = computePublishRollup(
      sources({ governance: src("governance", "usable", "healthy") }),
      policy(),
    );
    expect(rollup.verdict).toBe("publishable");
    expect(rollup.exitCode).toBe(0);
    expect(rollup.disclosure).toBe("share-safe");
    expect(rollup.publishable).toBe(true);
    expect(rollup.reasons).toEqual([]);
  });

  it("NEVER a vacuous publishable — an absent governance is incomplete (governance-missing)", () => {
    const { rollup } = computePublishRollup(
      sources({ trend: src("trend", "usable", "stable"), archive: src("archive", "usable", "archivable") }),
      policy(),
    );
    expect(rollup.verdict).toBe("incomplete");
    expect(rollup.disclosure).toBe("internal-review");
    expect(rollup.reasons).toContain("governance-missing");
  });

  it("folds each source's advisory posture to review / internal-review", () => {
    for (const [key, verdict, reason] of [
      ["governance", "watch", "governance-watch"],
      ["archive", "archive-watch", "archive-watch"],
      ["restoreDrill", "restore-drift", "restore-drift"],
      ["report", "hold-warning", "report-hold-warning"],
      ["trend", "warning", "trend-warning"],
    ] as const) {
      const id: ReleasePublishPackSourceId = key === "restoreDrill" ? "restore-drill" : key;
      const { rollup } = computePublishRollup(
        sources({
          governance: src("governance", "usable", "healthy"),
          [key]: src(id, "usable", verdict),
        }),
        policy(),
      );
      expect(rollup.verdict, reason).toBe("review");
      expect(rollup.disclosure).toBe("internal-review");
      expect(rollup.reasons).toContain(reason);
    }
  });

  it("folds each source's blocking posture to blocked (dominates a healthy governance)", () => {
    for (const [key, verdict, reason] of [
      ["governance", "blocked", "governance-blocked"],
      ["archive", "archive-blocked", "archive-blocked"],
      ["restoreDrill", "restore-failed", "restore-failed"],
      ["report", "hold-fail", "report-hold-fail"],
      ["trend", "failing", "trend-failing"],
    ] as const) {
      const id: ReleasePublishPackSourceId = key === "restoreDrill" ? "restore-drill" : key;
      const { rollup } = computePublishRollup(
        sources({
          governance: src("governance", "usable", "healthy"),
          [key]: src(id, "usable", verdict),
        }),
        policy(),
      );
      expect(rollup.verdict, reason).toBe("blocked");
      expect(rollup.disclosure).toBe("blocked");
      expect(rollup.reasons).toContain(reason);
    }
  });

  it("a tampered source is blocking regardless of its claimed verdict", () => {
    const { rollup } = computePublishRollup(
      sources({
        governance: src("governance", "usable", "healthy"),
        archive: src("archive", "tampered", "archivable"),
      }),
      policy(),
    );
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.reasons).toContain("archive-tampered");
  });

  it("blocking precedence dominates insufficiency and advisory", () => {
    const { rollup } = computePublishRollup(
      sources({
        governance: src("governance", "usable", "blocked"), // blocking
        archive: src("archive", "unreadable", null), // insufficient
        trend: src("trend", "usable", "warning"), // advisory
      }),
      policy(),
    );
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.blocking).toBeGreaterThan(0);
    expect(rollup.insufficiencies).toBeGreaterThan(0);
    expect(rollup.advisories).toBeGreaterThan(0);
  });

  it("insufficiency masks a mere advisory but not a blocker", () => {
    const { rollup } = computePublishRollup(
      sources({
        governance: src("governance", "usable", "healthy"),
        archive: src("archive", "unreadable", null), // insufficient
        trend: src("trend", "usable", "warning"), // advisory
      }),
      policy(),
    );
    expect(rollup.verdict).toBe("incomplete");
  });

  it("--require-archive / --require-restore-drill make an absent secondary an insufficiency", () => {
    const gov = { governance: src("governance", "usable", "healthy") };
    expect(computePublishRollup(sources(gov), policy({ requireArchive: true })).rollup.reasons).toContain(
      "archive-missing",
    );
    expect(
      computePublishRollup(sources(gov), policy({ requireRestoreDrill: true })).rollup.reasons,
    ).toContain("restore-missing");
    // Without the flags, an absent secondary contributes nothing.
    expect(computePublishRollup(sources(gov), policy()).rollup.verdict).toBe("publishable");
  });

  it("--strict escalates a review to blocked, recording the origin", () => {
    const { rollup } = computePublishRollup(
      sources({ governance: src("governance", "usable", "watch") }),
      policy({ strict: true }),
    );
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.disclosure).toBe("blocked");
    expect(rollup.strictEscalated).toBe(true);
    expect(rollup.strictEscalatedFrom).toBe("review");
    expect(rollup.blocking).toBe(0); // the escalation is not itself a blocking reason
  });

  it("--strict escalates an incomplete to blocked, recording the origin", () => {
    const { rollup } = computePublishRollup(
      sources({ governance: src("governance", "usable", "incomplete") }),
      policy({ strict: true }),
    );
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.strictEscalated).toBe(true);
    expect(rollup.strictEscalatedFrom).toBe("incomplete");
  });

  it("--strict never downgrades a publishable or upgrades an already-blocked", () => {
    const pub = computePublishRollup(
      sources({ governance: src("governance", "usable", "healthy") }),
      policy({ strict: true }),
    ).rollup;
    expect(pub.verdict).toBe("publishable");
    expect(pub.strictEscalated).toBe(false);
    expect(pub.strictEscalatedFrom).toBeNull();

    const blk = computePublishRollup(
      sources({ governance: src("governance", "usable", "blocked") }),
      policy({ strict: true }),
    ).rollup;
    expect(blk.verdict).toBe("blocked");
    expect(blk.strictEscalated).toBe(false); // already blocked without strict
  });

  it("emits reasons in canonical order (a superset view of every condition)", () => {
    const fired = derivePublishReasons(
      sources({
        governance: src("governance", "usable", "watch"),
        archive: src("archive", "tampered", null),
        trend: src("trend", "unreadable", null),
      }),
      policy(),
    );
    // archive-tampered (blocking) precedes trend-unreadable (insufficient) precedes governance-watch (advisory).
    expect(fired.indexOf("archive-tampered")).toBeLessThan(fired.indexOf("trend-unreadable"));
    expect(fired.indexOf("trend-unreadable")).toBeLessThan(fired.indexOf("governance-watch"));
  });
});
