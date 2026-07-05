import { describe, expect, it } from "vitest";
import {
  applyWindow,
  computeCloseoutIndexRollup,
  deriveIndexReasons,
  deriveTrendClass,
  reduceIndex,
} from "./reduce";
import { ingestCloseoutsFrom, defaultPolicy } from "./fixtures";
import { closedCloseout, blockedCloseout, incompleteCloseout, openCloseout, notACloseout, tamperedCloseout, closeoutFor } from "./fixtures";
import type { ReleaseDecisionCloseoutVerdict } from "./types";

const ingest = (objs: unknown[]) => ingestCloseoutsFrom(objs);

describe("applyWindow — bounded newest-N history", () => {
  it("keeps the newest N and surfaces how many older were dropped (never silent)", () => {
    const list = ingest([closedCloseout(), openCloseout(), blockedCloseout()]);
    const w = applyWindow(list, 2);
    expect(w.considered).toHaveLength(2);
    expect(w.closeoutsSupplied).toBe(3);
    expect(w.truncated).toBe(true);
    expect(w.droppedOldest).toBe(1);
    // the NEWEST 2 are kept (open, blocked), the oldest (closed) dropped
    expect(w.considered.map((c) => c.verdict)).toEqual(["closeout-open", "closeout-blocked"]);
  });

  it("a cap ≥ length keeps everything; a non-positive cap keeps nothing", () => {
    const list = ingest([closedCloseout(), closedCloseout()]);
    expect(applyWindow(list, 10).droppedOldest).toBe(0);
    expect(applyWindow(list, 0).considered).toHaveLength(0);
  });
});

describe("reduceIndex — points + ledger + latest", () => {
  it("reduces each considered closeout to a bounded point, oldest → newest", () => {
    const { points, latest } = reduceIndex(ingest([closedCloseout(), blockedCloseout()]), 100);
    expect(points.map((p) => p.position)).toEqual([0, 1]);
    expect(points.map((p) => p.verdict)).toEqual(["closed", "closeout-blocked"]);
    expect(points[0]!.severity).toBe("informational");
    expect(points[1]!.severity).toBe("blocking");
    expect(latest).toBe("closeout-blocked"); // newest usable
  });

  it("counts the verdict distribution over usable records only", () => {
    const { ledger } = reduceIndex(ingest([closedCloseout(), openCloseout(), notACloseout(), tamperedCloseout()]), 100);
    expect(ledger.closeoutsUsable).toBe(2);
    expect(ledger.closeoutsUnreadable).toBe(1);
    expect(ledger.closeoutsTampered).toBe(1);
    expect(ledger.verdictCounts.closed).toBe(1);
    expect(ledger.verdictCounts["closeout-open"]).toBe(1);
    expect(ledger.newest).toBe("closeout-open");
    expect(ledger.oldest).toBe("closed");
  });

  it("latest is the newest USABLE closeout, skipping a tampered/unreadable newest", () => {
    // newest supplied is tampered → latest usable is the closed one
    const { latest } = reduceIndex(ingest([closedCloseout(), tamperedCloseout()]), 100);
    expect(latest).toBe("closed");
  });

  it("zero usable records → null latest/oldest and a no-usable / incomplete-present class", () => {
    expect(reduceIndex(ingest([notACloseout()]), 100).latest).toBeNull();
    expect(reduceIndex(ingest([]), 100).ledger.trendClass).toBe("no-usable");
    expect(reduceIndex(ingest([notACloseout()]), 100).ledger.trendClass).toBe("incomplete-present");
  });
});

describe("deriveTrendClass — worst-present, strict-independent", () => {
  const z = { closed: 0, "closeout-incomplete": 0, "closeout-open": 0, "closeout-blocked": 0 };
  it("orders tampered > blocked > open > incomplete(unreadable) > all-closed", () => {
    expect(deriveTrendClass(1, 0, 1, z)).toBe("tampered-present");
    expect(deriveTrendClass(1, 0, 0, { ...z, "closeout-blocked": 1 })).toBe("blocked-present");
    expect(deriveTrendClass(1, 0, 0, { ...z, "closeout-open": 1 })).toBe("open-present");
    expect(deriveTrendClass(1, 0, 0, { ...z, "closeout-incomplete": 1 })).toBe("incomplete-present");
    expect(deriveTrendClass(1, 1, 0, { ...z, closed: 1 })).toBe("incomplete-present"); // unreadable present
    expect(deriveTrendClass(2, 0, 0, { ...z, closed: 2 })).toBe("all-closed");
    expect(deriveTrendClass(0, 0, 0, z)).toBe("no-usable");
  });
});

describe("deriveIndexReasons — latest-focused + thresholds", () => {
  const P = defaultPolicy();
  const reduceOf = (objs: unknown[], policy = P) => {
    const { ledger, latest } = reduceIndex(ingest(objs), policy.maxCloseouts);
    return deriveIndexReasons(ledger, latest, policy);
  };

  it("a coherent history fires only informational reasons", () => {
    expect(reduceOf([closedCloseout(), closedCloseout()])).toEqual(["latest-closed", "history-coherent"]);
  });

  it("a latest-open history fires the latest + threshold open reasons", () => {
    expect(reduceOf([closedCloseout(), openCloseout()])).toContain("latest-open");
    expect(reduceOf([closedCloseout(), openCloseout()])).toContain("open-threshold-exceeded");
  });

  it("an older-only open (latest closed) fires the threshold but not latest-open (default max-open=0)", () => {
    const r = reduceOf([openCloseout(), closedCloseout()]);
    expect(r).toContain("open-threshold-exceeded");
    expect(r).toContain("latest-closed");
    expect(r).not.toContain("latest-open");
  });

  it("--max-open tolerates a bounded number of older opens", () => {
    const r = reduceOf([openCloseout(), closedCloseout()], defaultPolicy({ maxOpen: 1 }));
    expect(r).not.toContain("open-threshold-exceeded");
    expect(r).toEqual(["latest-closed"]);
  });

  it("the latest is never tolerated by a threshold (latest-blocked fires even under a high --max-blocked)", () => {
    const r = reduceOf([closedCloseout(), blockedCloseout()], defaultPolicy({ maxBlocked: 5 }));
    expect(r).toContain("latest-blocked");
    expect(r).not.toContain("blocked-threshold-exceeded");
  });

  it("a tampered / unreadable closeout fires the coverage reasons", () => {
    expect(reduceOf([closedCloseout(), tamperedCloseout()])).toContain("closeout-tampered");
    expect(reduceOf([closedCloseout(), notACloseout()])).toContain("closeout-unreadable");
    expect(reduceOf([notACloseout()])).toContain("no-closeouts");
  });
});

describe("computeCloseoutIndexRollup — the fold + strict-open", () => {
  const foldOf = (objs: unknown[], policy = defaultPolicy()) => {
    const { ledger, latest } = reduceIndex(ingest(objs), policy.maxCloseouts);
    return computeCloseoutIndexRollup(ledger, latest, policy).rollup;
  };

  it("maps each closeout verdict pairing to the right index verdict + exit", () => {
    const cases: Array<[ReleaseDecisionCloseoutVerdict, string, number]> = [
      ["closed", "indexed", 0],
      ["closeout-incomplete", "index-incomplete", 2],
      ["closeout-open", "index-open", 3],
      ["closeout-blocked", "index-blocked", 4],
    ];
    for (const [latest, verdict, exit] of cases) {
      const r = foldOf([closedCloseout(), closeoutFor(latest)]);
      expect(r.verdict, latest).toBe(verdict);
      expect(r.exitCode, latest).toBe(exit);
      expect(r.latest, latest).toBe(latest);
    }
  });

  it("fail-closed precedence: blocking > open > incomplete > indexed", () => {
    // an open latest + a blocked older ⇒ blocked dominates
    const r = foldOf([blockedCloseout(), openCloseout()]);
    expect(r.verdict).toBe("index-blocked");
  });

  it("--strict-open escalates an open index to blocked and records the escalation", () => {
    const r = foldOf([closedCloseout(), openCloseout()], defaultPolicy({ strictOpen: true }));
    expect(r.verdict).toBe("index-blocked");
    expect(r.strictOpenEscalated).toBe(true);
    expect(r.strictOpenEscalatedFrom).toBe("index-open");
    expect(r.reasons).toContain("strict-open-escalation");
  });

  it("--strict-open leaves an incomplete / already-blocked / indexed verdict untouched", () => {
    expect(foldOf([incompleteCloseout()], defaultPolicy({ strictOpen: true })).verdict).toBe("index-incomplete");
    expect(foldOf([blockedCloseout()], defaultPolicy({ strictOpen: true })).strictOpenEscalated).toBe(false);
    expect(foldOf([closedCloseout()], defaultPolicy({ strictOpen: true })).verdict).toBe("indexed");
  });

  it("indexed requires latest-closed AND a coherent-within-thresholds history", () => {
    expect(foldOf([closedCloseout(), closedCloseout()]).indexed).toBe(true);
    expect(foldOf([openCloseout(), closedCloseout()]).indexed).toBe(false); // older open, default threshold 0
  });
});
