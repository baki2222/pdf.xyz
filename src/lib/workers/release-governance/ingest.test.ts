import { describe, expect, it } from "vitest";
import { ingestAuditSource, ingestReportSource, ingestTrend } from "./ingest";
import {
  failingTrend,
  holdFailReport,
  notADocument,
  passAudit,
  promoteReadyReport,
  stableTrend,
  tamperAudit,
  tamperReport,
  tamperTrend,
  unknownTrend,
  warningTrend,
} from "./fixtures";

type Obj = Record<string, unknown>;
const clone = (o: unknown): Obj => JSON.parse(JSON.stringify(o)) as Obj;

describe("ingestTrend — usable trends re-derive their own verdict", () => {
  it("a stable trend is usable and carries its window facts", () => {
    const t = ingestTrend(stableTrend());
    expect(t.recognized).toBe(true);
    expect(t.usable).toBe(true);
    expect(t.verdict).toBe("stable");
    expect(t.facts?.stable).toBe(true);
    expect(t.facts?.newest).toBe("promote-ready");
    expect(t.facts?.reportsUsable).toBe(3);
  });

  it.each([
    ["warning", warningTrend],
    ["unknown", unknownTrend],
    ["failing", failingTrend],
  ] as const)("a %s trend is usable with its verdict", (verdict, make) => {
    const t = ingestTrend(make());
    expect(t.usable).toBe(true);
    expect(t.verdict).toBe(verdict);
  });
});

describe("ingestTrend — unrecognized inputs", () => {
  it.each([
    ["a non-object", 42],
    ["null", null],
    ["an array", []],
    ["a wrong-schema object", { schema: "pdfxyz.release-report/1" }],
    ["a not-a-document blob", notADocument()],
  ])("%s is unreadable (recognized=false)", (_label, input) => {
    const t = ingestTrend(input);
    expect(t.recognized).toBe(false);
    expect(t.usable).toBe(false);
    expect(t.verdict).toBeNull();
    expect(t.facts).toBeNull();
  });
});

describe("ingestTrend — tamper detection (recognized but self-inconsistent)", () => {
  it("a hand-flipped verdict is tampered, surfacing the untrusted claim", () => {
    const t = ingestTrend(tamperTrend(stableTrend()));
    expect(t.recognized).toBe(true);
    expect(t.usable).toBe(false);
    expect(t.verdict).toBe("failing"); // the claimed (untrusted) verdict is surfaced
    expect(t.facts).toBeNull();
  });

  it("catches a verdict + history smuggle that keeps the two internally consistent but ignores the points", () => {
    const bad = clone(failingTrend());
    (bad.trend as Obj).verdict = "stable";
    (bad.trend as Obj).exitCode = 0;
    (bad.trend as Obj).stable = true;
    (bad.trend as Obj).reasons = [];
    (bad.trend as Obj).blocking = 0;
    (bad.history as Obj).newest = "promote-ready";
    (bad.history as Obj).counts = { "promote-ready": 2, "hold-warning": 0, "needs-evidence": 0, "hold-fail": 0 };
    expect(ingestTrend(bad).usable).toBe(false);
  });

  it("catches a point whose severity does not derive from its recommendation", () => {
    const bad = clone(stableTrend());
    const points = bad.points as Obj[];
    (points[points.length - 1] as Obj).recommendation = "hold-fail"; // severity stays "ready"
    expect(ingestTrend(bad).usable).toBe(false);
  });

  it("catches a dropped point (history / window arithmetic no longer matches)", () => {
    const bad = clone(failingTrend());
    bad.points = (bad.points as Obj[]).filter((p) => p.recommendation !== "hold-fail");
    (bad.points as Obj[]).forEach((p, i) => (p.position = i));
    expect(ingestTrend(bad).usable).toBe(false);
  });

  it("catches an out-of-position point", () => {
    const bad = clone(stableTrend());
    (bad.points as Obj[])[0]!.position = 99;
    expect(ingestTrend(bad).usable).toBe(false);
  });

  it.each(["trend", "history", "policy", "points"])("a malformed `%s` block is tampered", (key) => {
    const bad = clone(stableTrend());
    bad[key] = key === "points" ? "not-an-array" : 42;
    const t = ingestTrend(bad);
    expect(t.recognized).toBe(true);
    expect(t.usable).toBe(false);
  });

  it("catches an off-enum recorded verdict / reason", () => {
    const badVerdict = clone(stableTrend());
    (badVerdict.trend as Obj).verdict = "totally-made-up";
    expect(ingestTrend(badVerdict).usable).toBe(false);

    const badReason = clone(stableTrend());
    (badReason.trend as Obj).reasons = ["not-a-real-reason"];
    expect(ingestTrend(badReason).usable).toBe(false);
  });

  it("catches a lied window (reportsSupplied < reportsConsidered)", () => {
    const bad = clone(stableTrend());
    (bad.history as Obj).reportsSupplied = 1; // 3 considered but only 1 supplied is impossible
    (bad.history as Obj).droppedOldest = 0;
    (bad.history as Obj).truncated = false;
    expect(ingestTrend(bad).usable).toBe(false);
  });
});

describe("ingestReportSource / ingestAuditSource — delegate to the tested boundaries", () => {
  it("a usable report re-derives its recommendation", () => {
    const r = ingestReportSource(promoteReadyReport());
    expect(r.usable).toBe(true);
    expect(r.recommendation).toBe("promote-ready");
  });

  it("a tampered report is recognized but not usable", () => {
    const r = ingestReportSource(tamperReport(promoteReadyReport(), "hold-fail"));
    expect(r.recognized).toBe(true);
    expect(r.usable).toBe(false);
  });

  it("a usable audit re-derives its verdict", () => {
    const a = ingestAuditSource(passAudit());
    expect(a.usable).toBe(true);
    expect(a.verdict).toBe("pass");
  });

  it("a tampered audit is recognized but not usable", () => {
    const a = ingestAuditSource(tamperAudit(passAudit()));
    expect(a.recognized).toBe(true);
    expect(a.usable).toBe(false);
  });

  it("a not-a-document blob is unreadable for every source", () => {
    expect(ingestReportSource(notADocument()).recognized).toBe(false);
    expect(ingestAuditSource(notADocument()).recognized).toBe(false);
    // a hold-fail report is a fine usable input (sanity that fixtures build real docs)
    expect(ingestReportSource(holdFailReport()).usable).toBe(true);
  });
});
