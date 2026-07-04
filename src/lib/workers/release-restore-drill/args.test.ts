import { describe, expect, it } from "vitest";
import { parseReleaseRestoreDrillArgs } from "./args";

function run(argv: string[]) {
  const r = parseReleaseRestoreDrillArgs(argv);
  if (!r.ok || r.kind !== "run") throw new Error("expected run");
  return r.args;
}

describe("parseReleaseRestoreDrillArgs", () => {
  it("requires the --archive anchor", () => {
    const r = parseReleaseRestoreDrillArgs([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/--archive/);
  });

  it("parses the anchor + restored records with defaults", () => {
    const a = run(["--archive=a.json", "--governance=g.json", "--trend=t.json"]);
    expect(a.archivePath).toBe("a.json");
    expect(a.governancePath).toBe("g.json");
    expect(a.trendPath).toBe("t.json");
    expect(a.format).toBe("json");
    expect(a.pretty).toBe(true);
    expect(a.archiveOnly).toBe(false);
    expect(a.requireFullRestore).toBe(false);
    expect(a.strictDrift).toBe(false);
  });

  it("parses the policy knobs and text format", () => {
    const a = run(["--archive=a.json", "--archive-only", "--require-full-restore", "--strict-drift", "--text"]);
    expect(a.archiveOnly).toBe(true);
    expect(a.requireFullRestore).toBe(true);
    expect(a.strictDrift).toBe(true);
    expect(a.format).toBe("text");
  });

  it("accepts a bare - as the stdin sentinel for the anchor", () => {
    expect(run(["--archive=-"]).archivePath).toBe("-");
    expect(run(["--archive", "-"]).archivePath).toBe("-");
  });

  it("rejects two stdin inputs", () => {
    const r = parseReleaseRestoreDrillArgs(["--archive=-", "--governance=-"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/one input/i);
  });

  it("rejects a value-less flag, a duplicate, an unknown flag, and conflicting formats", () => {
    expect(parseReleaseRestoreDrillArgs(["--archive"]).ok).toBe(false);
    expect(parseReleaseRestoreDrillArgs(["--archive=a.json", "--archive=b.json"]).ok).toBe(false);
    expect(parseReleaseRestoreDrillArgs(["--archive=a.json", "--nope"]).ok).toBe(false);
    expect(parseReleaseRestoreDrillArgs(["--archive=a.json", "--json", "--text"]).ok).toBe(false);
  });

  it("rejects stdin as the --output target", () => {
    expect(parseReleaseRestoreDrillArgs(["--archive=a.json", "--output=-"]).ok).toBe(false);
  });

  it("returns help on -h/--help", () => {
    expect(parseReleaseRestoreDrillArgs(["--help"])).toEqual({ ok: true, kind: "help" });
    expect(parseReleaseRestoreDrillArgs(["-h"])).toEqual({ ok: true, kind: "help" });
  });
});
