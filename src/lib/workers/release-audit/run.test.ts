import { describe, expect, it } from "vitest";
import { runReleaseAudit } from "./run";
import {
  failBundle,
  makeAuditArgs,
  makeAuditProvider,
  notABundle,
  pairArgs,
  passBundle,
  tamper,
  warnBundle,
} from "./fixtures";
import { RELEASE_AUDIT_SCHEMA } from "./types";

describe("release-audit run — pair mode verdicts + exit codes", () => {
  it("two coherent pass bundles → pass (exit 0)", async () => {
    const provider = makeAuditProvider({ baseline: passBundle(), current: passBundle() });
    const run = await runReleaseAudit(pairArgs(), provider);
    expect(run.result.schema).toBe(RELEASE_AUDIT_SCHEMA);
    expect(run.result.rollup.verdict).toBe("pass");
    expect(run.exitCode).toBe(0);
  });

  it("a current bundle that dropped to fail → fail (exit 4)", async () => {
    const provider = makeAuditProvider({ baseline: passBundle(), current: failBundle() });
    const run = await runReleaseAudit(pairArgs(), provider);
    expect(run.result.rollup.verdict).toBe("fail");
    expect(run.exitCode).toBe(4);
    expect(run.result.rollup.drivers).toContain("verdict-worsened");
  });

  it("a softened (warn) current → warn (exit 3); --allow-warn-regression accepts it (exit 0)", async () => {
    const provider = makeAuditProvider({ baseline: passBundle(), current: warnBundle() });
    const strict = await runReleaseAudit(pairArgs(), provider);
    expect(strict.result.rollup.verdict).toBe("warn");
    expect(strict.exitCode).toBe(3);

    const accepted = await runReleaseAudit(pairArgs({ allowWarnRegression: true }), provider);
    expect(accepted.result.rollup.verdict).toBe("pass");
    expect(accepted.exitCode).toBe(0);
    // the accepted drift is still on the record:
    expect(accepted.result.rollup.warningRegressions).toBeGreaterThan(0);
  });

  it("a recognized-but-self-inconsistent (tampered) current → fail (exit 4)", async () => {
    const provider = makeAuditProvider({ baseline: passBundle(), current: tamper(passBundle()) });
    const run = await runReleaseAudit(pairArgs(), provider);
    expect(run.result.rollup.verdict).toBe("fail");
    expect(run.exitCode).toBe(4);
    expect(run.result.rollup.drivers).toContain("bundle-tampered");
  });

  it("an unreadable current bundle → unknown (exit 2), never a fabricated pass", async () => {
    const provider = makeAuditProvider({ baseline: passBundle(), current: notABundle() });
    const run = await runReleaseAudit(pairArgs(), provider);
    expect(run.result.rollup.verdict).toBe("unknown");
    expect(run.exitCode).toBe(2);
  });

  it("a missing current file (read throws) is unreadable and the path is never echoed", async () => {
    const provider = makeAuditProvider({ baseline: passBundle() }); // serves no "current"
    const run = await runReleaseAudit(
      { ...pairArgs({ currentPath: "/tmp/leak/customer-secret.json" }), format: "text" },
      provider,
    );
    expect(run.result.rollup.verdict).toBe("unknown");
    expect(run.output).not.toContain("/tmp/leak");
  });

  it("is deterministic — same input + stamp yields byte-identical output", async () => {
    const provider = makeAuditProvider({ baseline: passBundle(), current: warnBundle() });
    const a = await runReleaseAudit(pairArgs(), provider);
    const b = await runReleaseAudit(pairArgs(), provider);
    expect(a.output).toBe(b.output);
  });
});

describe("release-audit run — history mode", () => {
  it("diffs the newest bundle against the previous (exit 3 on a warn tail)", async () => {
    const provider = makeAuditProvider({ a: passBundle(), b: passBundle(), c: warnBundle() });
    const run = await runReleaseAudit(
      makeAuditArgs({ mode: "history", bundlePaths: ["a", "b", "c"] }),
      provider,
    );
    expect(run.result.mode).toBe("history");
    expect(run.result.history?.count).toBe(3);
    expect(run.exitCode).toBe(3);
  });

  it("fewer than two comparable bundles → unknown (exit 2), the honest 'too little history'", async () => {
    const provider = makeAuditProvider({ a: passBundle() });
    const run = await runReleaseAudit(makeAuditArgs({ mode: "history", bundlePaths: ["a"] }), provider);
    expect(run.result.rollup.verdict).toBe("unknown");
    expect(run.exitCode).toBe(2);
    expect(run.result.current.present).toBe(true);
    expect(run.result.baseline.present).toBe(false);
  });

  it("reads a JSON array of bundles from stdin (blocking regression → exit 4)", async () => {
    const stdin = JSON.stringify([passBundle(), failBundle()]);
    const provider = makeAuditProvider({}, stdin);
    const run = await runReleaseAudit(makeAuditArgs({ mode: "history", stdin: true }), provider);
    expect(run.exitCode).toBe(4);
  });

  it("a malformed stdin payload → empty history → unknown (exit 2), never a throw", async () => {
    const provider = makeAuditProvider({}, "not json at all");
    const run = await runReleaseAudit(makeAuditArgs({ mode: "history", stdin: true }), provider);
    expect(run.result.rollup.verdict).toBe("unknown");
    expect(run.exitCode).toBe(2);
  });
});
