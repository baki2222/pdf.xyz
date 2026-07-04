import { describe, expect, it } from "vitest";
import { reduceBundle, summarizeHistory } from "./reduce";
import { UNREADABLE, tampered, usable } from "./fixtures";

describe("release-audit reduce — bundle summary", () => {
  it("a supplied usable bundle → bounded posture + rank + headline", () => {
    const s = reduceBundle("baseline", true, usable());
    expect(s.present).toBe(true);
    expect(s.recognized).toBe(true);
    expect(s.usable).toBe(true);
    expect(s.verdict).toBe("pass");
    expect(s.postureRank).toBe(0);
    expect(s.detail).toContain("pass over");
  });

  it("a not-supplied slot → present false, honest headline, safe defaults", () => {
    const s = reduceBundle("baseline", false, UNREADABLE);
    expect(s.present).toBe(false);
    expect(s.detail).toBe("baseline: not supplied.");
    // defaults never trust stale facts:
    expect(s.stagesPresent).toBe(0);
    expect(s.postureRank).toBeNull();
  });

  it("never surfaces a facts posture for a NOT-supplied slot, even if handed a usable ingest", () => {
    // Defense-in-depth: the composer only ever hands a not-supplied slot an unrecognized bundle, but a
    // stray usable ingest must still not leak a posture into a slot the operator did not supply.
    const s = reduceBundle("baseline", false, usable({ verdict: "pass", stagesPresent: 4 }));
    expect(s.present).toBe(false);
    expect(s.verdict).toBeNull();
    expect(s.stagesPresent).toBe(0);
  });

  it("an unreadable slot → recognized false, no comparable posture", () => {
    const s = reduceBundle("current", true, UNREADABLE);
    expect(s.recognized).toBe(false);
    expect(s.usable).toBe(false);
    expect(s.detail).toMatch(/not a recognized release CI bundle/);
  });

  it("a tampered slot → usable false, surfaces its claimed verdict as untrusted", () => {
    const s = reduceBundle("current", true, tampered("fail"));
    expect(s.recognized).toBe(true);
    expect(s.usable).toBe(false);
    expect(s.verdict).toBe("fail");
    expect(s.detail).toMatch(/tampered|does NOT re-derive/);
  });
});

describe("release-audit reduce — history distribution", () => {
  it("counts each posture; a tampered member counts as fail, an unrecognized as unreadable", () => {
    const h = summarizeHistory([
      usable({ verdict: "pass" }),
      usable({ verdict: "warn" }),
      tampered("pass"),
      UNREADABLE,
    ]);
    expect(h.count).toBe(4);
    expect(h.usable).toBe(2);
    expect(h.verdictCounts).toEqual({ pass: 1, warn: 1, unknown: 0, fail: 1, unreadable: 1 });
  });
});
