import { describe, expect, it } from "vitest";
import {
  applyWindow,
  computeGovernanceIndexRollup,
  deriveIndexReasons,
  deriveTrendClass,
  reduceIndex,
} from "./reduce";
import {
  blockedGovernance,
  closedGovernance,
  defaultPolicy,
  governanceFor,
  incompleteGovernance,
  ingestGovernanceFrom,
  notAGovernance,
  openGovernance,
  tamperedGovernance,
} from "./fixtures";
import type { ReleaseDecisionCloseoutGovernanceVerdict } from "./types";

const ingest = (objs: unknown[]) => ingestGovernanceFrom(objs);

describe("applyWindow — bounded newest-N history", () => {
  it("keeps the newest N and surfaces how many older were dropped (never silent)", () => {
    const list = ingest([closedGovernance(), openGovernance(), blockedGovernance()]);
    const w = applyWindow(list, 2);
    expect(w.considered).toHaveLength(2);
    expect(w.governanceSupplied).toBe(3);
    expect(w.truncated).toBe(true);
    expect(w.droppedOldest).toBe(1);
    // the NEWEST 2 are kept (open, blocked), the oldest (closed) dropped
    expect(w.considered.map((c) => c.verdict)).toEqual(["governance-open", "governance-blocked"]);
  });

  it("a cap ≥ length keeps everything; a non-positive cap keeps nothing", () => {
    const list = ingest([closedGovernance(), closedGovernance()]);
    expect(applyWindow(list, 10).droppedOldest).toBe(0);
    expect(applyWindow(list, 0).considered).toHaveLength(0);
  });
});

describe("reduceIndex — points + ledger + latest", () => {
  it("reduces each considered bundle to a bounded point, oldest → newest", () => {
    const { points, latest } = reduceIndex(ingest([closedGovernance(), blockedGovernance()]), 100);
    expect(points.map((p) => p.position)).toEqual([0, 1]);
    expect(points.map((p) => p.verdict)).toEqual(["closed", "governance-blocked"]);
    expect(points[0]!.severity).toBe("informational");
    expect(points[1]!.severity).toBe("blocking");
    expect(latest).toBe("governance-blocked"); // newest usable
  });

  it("counts the verdict distribution over usable records only", () => {
    const { ledger } = reduceIndex(
      ingest([closedGovernance(), openGovernance(), notAGovernance(), tamperedGovernance()]),
      100,
    );
    expect(ledger.governanceUsable).toBe(2);
    expect(ledger.governanceUnreadable).toBe(1);
    expect(ledger.governanceTampered).toBe(1);
    expect(ledger.verdictCounts.closed).toBe(1);
    expect(ledger.verdictCounts["governance-open"]).toBe(1);
    expect(ledger.newest).toBe("governance-open");
    expect(ledger.oldest).toBe("closed");
  });

  it("latest is the newest USABLE bundle, skipping a tampered/unreadable newest", () => {
    const { latest } = reduceIndex(ingest([closedGovernance(), tamperedGovernance()]), 100);
    expect(latest).toBe("closed");
  });

  it("zero usable records → null latest/oldest and a no-usable / incomplete-present class", () => {
    expect(reduceIndex(ingest([notAGovernance()]), 100).latest).toBeNull();
    expect(reduceIndex(ingest([]), 100).ledger.trendClass).toBe("no-usable");
    expect(reduceIndex(ingest([notAGovernance()]), 100).ledger.trendClass).toBe("incomplete-present");
  });
});

describe("deriveTrendClass — worst-present, strict-independent", () => {
  const z = { closed: 0, "governance-incomplete": 0, "governance-open": 0, "governance-blocked": 0 };
  it("orders tampered > blocked > open > incomplete(unreadable) > all-closed", () => {
    expect(deriveTrendClass(1, 0, 1, z)).toBe("tampered-present");
    expect(deriveTrendClass(1, 0, 0, { ...z, "governance-blocked": 1 })).toBe("blocked-present");
    expect(deriveTrendClass(1, 0, 0, { ...z, "governance-open": 1 })).toBe("open-present");
    expect(deriveTrendClass(1, 0, 0, { ...z, "governance-incomplete": 1 })).toBe("incomplete-present");
    expect(deriveTrendClass(1, 1, 0, { ...z, closed: 1 })).toBe("incomplete-present"); // unreadable present
    expect(deriveTrendClass(2, 0, 0, { ...z, closed: 2 })).toBe("all-closed");
    expect(deriveTrendClass(0, 0, 0, z)).toBe("no-usable");
  });
});

describe("deriveIndexReasons — latest-focused + thresholds", () => {
  const P = defaultPolicy();
  const reduceOf = (objs: unknown[], policy = P) => {
    const { ledger, latest } = reduceIndex(ingest(objs), policy.maxGovernance);
    return deriveIndexReasons(ledger, latest, policy);
  };

  it("a coherent history fires only informational reasons", () => {
    expect(reduceOf([closedGovernance(), closedGovernance()])).toEqual(["latest-closed", "history-coherent"]);
  });

  it("a latest-open history fires the latest + threshold open reasons", () => {
    expect(reduceOf([closedGovernance(), openGovernance()])).toContain("latest-open");
    expect(reduceOf([closedGovernance(), openGovernance()])).toContain("open-threshold-exceeded");
  });

  it("an older-only open (latest closed) fires the threshold but not latest-open (default max-open=0)", () => {
    const r = reduceOf([openGovernance(), closedGovernance()]);
    expect(r).toContain("open-threshold-exceeded");
    expect(r).toContain("latest-closed");
    expect(r).not.toContain("latest-open");
  });

  it("--max-open tolerates a bounded number of older opens", () => {
    const r = reduceOf([openGovernance(), closedGovernance()], defaultPolicy({ maxOpen: 1 }));
    expect(r).not.toContain("open-threshold-exceeded");
    expect(r).toEqual(["latest-closed"]);
  });

  it("the latest is never tolerated by a threshold (latest-blocked fires even under a high --max-blocked)", () => {
    const r = reduceOf([closedGovernance(), blockedGovernance()], defaultPolicy({ maxBlocked: 5 }));
    expect(r).toContain("latest-blocked");
    expect(r).not.toContain("blocked-threshold-exceeded");
  });

  it("a tampered / unreadable bundle fires the coverage reasons", () => {
    expect(reduceOf([closedGovernance(), tamperedGovernance()])).toContain("governance-tampered");
    expect(reduceOf([closedGovernance(), notAGovernance()])).toContain("governance-unreadable");
    expect(reduceOf([notAGovernance()])).toContain("no-governance");
  });
});

describe("computeGovernanceIndexRollup — the fold + strict-open", () => {
  const foldOf = (objs: unknown[], policy = defaultPolicy()) => {
    const { ledger, latest } = reduceIndex(ingest(objs), policy.maxGovernance);
    return computeGovernanceIndexRollup(ledger, latest, policy).rollup;
  };

  it("maps each governance verdict pairing to the right index verdict + exit", () => {
    const cases: Array<[ReleaseDecisionCloseoutGovernanceVerdict, string, number]> = [
      ["closed", "indexed", 0],
      ["governance-incomplete", "index-incomplete", 2],
      ["governance-open", "index-open", 3],
      ["governance-blocked", "index-blocked", 4],
    ];
    for (const [latest, verdict, exit] of cases) {
      const r = foldOf([closedGovernance(), governanceFor(latest)]);
      expect(r.verdict, latest).toBe(verdict);
      expect(r.exitCode, latest).toBe(exit);
      expect(r.latest, latest).toBe(latest);
    }
  });

  it("fail-closed precedence: blocking > open > incomplete > indexed", () => {
    // an open latest + a blocked older ⇒ blocked dominates
    const r = foldOf([blockedGovernance(), openGovernance()]);
    expect(r.verdict).toBe("index-blocked");
  });

  it("--strict-open escalates an open index to blocked and records the escalation", () => {
    const r = foldOf([closedGovernance(), openGovernance()], defaultPolicy({ strictOpen: true }));
    expect(r.verdict).toBe("index-blocked");
    expect(r.strictOpenEscalated).toBe(true);
    expect(r.strictOpenEscalatedFrom).toBe("index-open");
    expect(r.reasons).toContain("strict-open-escalation");
  });

  it("--strict-open leaves an incomplete / already-blocked / indexed verdict untouched", () => {
    expect(foldOf([incompleteGovernance()], defaultPolicy({ strictOpen: true })).verdict).toBe("index-incomplete");
    expect(foldOf([blockedGovernance()], defaultPolicy({ strictOpen: true })).strictOpenEscalated).toBe(false);
    expect(foldOf([closedGovernance()], defaultPolicy({ strictOpen: true })).verdict).toBe("indexed");
  });

  it("indexed requires latest-closed AND a coherent-within-thresholds history", () => {
    expect(foldOf([closedGovernance(), closedGovernance()]).indexed).toBe(true);
    expect(foldOf([openGovernance(), closedGovernance()]).indexed).toBe(false); // older open, default threshold 0
  });
});
