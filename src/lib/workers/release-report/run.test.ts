// @vitest-environment node
/**
 * Unit proofs for the release-report orchestrator (Phase 52). It drives the whole CLI behavior over the
 * injected provider seam: reading documents (file or stdin), the ingest failure modes, the fold, and both
 * output formats — and NEVER throws on an operational/input problem (those become a structured result + exit
 * code).
 */

import { describe, expect, it } from "vitest";
import { runReleaseReport } from "./run";
import type { ReleaseReportProvider } from "./run";
import { failAudit, makeArgs, makeProvider, NOW, notADocument, passAudit, passBundle, warnAudit } from "./fixtures";

describe("release-report run — resolves the recommendation + exit code", () => {
  it("a usable pass bundle + pass audit → promote-ready (exit 0)", async () => {
    const objs = { bundle: passBundle(), audit: passAudit() };
    const run = await runReleaseReport(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(0);
    expect(run.result.recommendation.recommendation).toBe("promote-ready");
    expect(JSON.parse(run.output).schema).toBe("pdfxyz.release-report/1");
  });

  it("a bundle-only run → promote-ready (the audit is optional)", async () => {
    const objs = { bundle: passBundle() };
    expect((await runReleaseReport(makeArgs(objs), makeProvider(objs))).exitCode).toBe(0);
  });

  it("an audit-only run → needs-evidence (exit 2), never a promote", async () => {
    const objs = { audit: passAudit() };
    const run = await runReleaseReport(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(2);
    expect(run.result.recommendation.recommendation).toBe("needs-evidence");
  });

  it("a blocking audit regression → hold-fail (exit 4)", async () => {
    const objs = { bundle: passBundle(), audit: failAudit() };
    expect((await runReleaseReport(makeArgs(objs), makeProvider(objs))).exitCode).toBe(4);
  });

  it("--strict escalates an audit drift to hold-fail (exit 4)", async () => {
    const objs = { bundle: passBundle(), audit: warnAudit() };
    expect((await runReleaseReport(makeArgs(objs), makeProvider(objs)).then((r) => r.exitCode))).toBe(3);
    expect((await runReleaseReport(makeArgs(objs, { strict: true }), makeProvider(objs))).exitCode).toBe(4);
  });
});

describe("release-report run — input reading", () => {
  it("an unreadable file (the provider throws) → an unreadable source (never a fabricated promote)", async () => {
    const provider: ReleaseReportProvider = {
      now: () => NOW,
      readFile: async () => Promise.reject(new Error("enoent")),
      readStdin: async () => "",
    };
    const run = await runReleaseReport({ format: "json", pretty: true, strict: false, bundlePath: "missing" }, provider);
    expect(run.exitCode).toBe(2); // needs-evidence
    expect(run.result.coverage.bundle).toBe("unreadable");
  });

  it("reads a document from stdin (the `-` sentinel)", async () => {
    const provider = makeProvider({}, JSON.stringify(passBundle()));
    const run = await runReleaseReport({ format: "json", pretty: true, strict: false, bundlePath: "-" }, provider);
    expect(run.exitCode).toBe(0);
    expect(run.result.coverage.bundle).toBe("usable");
  });

  it("invalid JSON on a supplied path → an unreadable source (never throws)", async () => {
    const provider = makeProvider({ bundle: "{not json" });
    const run = await runReleaseReport({ format: "json", pretty: true, strict: false, bundlePath: "bundle" }, provider);
    expect(run.exitCode).toBe(2);
    expect(run.result.coverage.bundle).toBe("unreadable");
  });
});

describe("release-report run — output + robustness", () => {
  it("renders text when requested", async () => {
    const objs = { bundle: passBundle() };
    const run = await runReleaseReport(makeArgs(objs, { format: "text" }), makeProvider(objs));
    expect(run.output).toContain("RECOMMENDATION: PROMOTE-READY");
  });

  it("never throws on a hostile input document", async () => {
    const objs = { bundle: notADocument(), audit: notADocument() };
    await expect(runReleaseReport(makeArgs(objs), makeProvider(objs))).resolves.toBeDefined();
  });

  it("the output never contains the source-key 'path' (a stand-in for a real path)", async () => {
    const objs = { bundle: passBundle(), audit: passAudit() };
    const run = await runReleaseReport(makeArgs(objs, { format: "text" }), makeProvider(objs));
    // 'bundle'/'audit' appear as source IDS but never as a "path=" locator.
    expect(run.output).not.toContain("path=");
  });
});
