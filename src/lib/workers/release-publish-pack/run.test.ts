import { afterEach, describe, expect, it, vi } from "vitest";
import { runReleasePublishPack } from "./run";
import { resetReleasePublishPackSink, setReleasePublishPackSink } from "./metrics";
import {
  archivablePack,
  failedDrill,
  healthyGovernance,
  makeArgs,
  makeProvider,
  stableTrend,
  verifiedDrill,
  watchGovernance,
} from "./fixtures";

afterEach(() => resetReleasePublishPackSink());

describe("runReleasePublishPack", () => {
  it("composes a publishable pack over healthy sources (exit 0, json)", async () => {
    const objs = { governance: healthyGovernance(), archive: archivablePack(), restoreDrill: verifiedDrill() };
    const run = await runReleasePublishPack(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(0);
    expect(run.result.pack.verdict).toBe("publishable");
    expect(JSON.parse(run.output).schema).toBe("pdfxyz.release-publish-pack/1");
  });

  it("renders text when asked", async () => {
    const objs = { governance: healthyGovernance() };
    const run = await runReleasePublishPack(makeArgs(objs, { format: "text" }), makeProvider(objs));
    expect(run.output).toMatch(/DISCLOSURE: SHARE-SAFE/);
  });

  it("blocks (exit 4) when a supplied restore drill failed", async () => {
    const objs = { governance: healthyGovernance(), restoreDrill: failedDrill() };
    const run = await runReleasePublishPack(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(4);
    expect(run.result.pack.reasons).toContain("restore-failed");
  });

  it("is incomplete (exit 2) with no governance — never a fabricated share-safe pack", async () => {
    const objs = { trend: stableTrend() };
    const run = await runReleasePublishPack(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(2);
    expect(run.result.pack.reasons).toContain("governance-missing");
  });

  it("a file that cannot be read becomes an unreadable source (path never echoed)", async () => {
    // A distinctive, non-vocabulary path so a genuine leak would be detectable (the word "archive" itself is
    // legitimate output vocabulary — a field name / source id / reason — so it cannot be used as a leak sentinel).
    const leakSentinel = "/srv/secret/leak-me-9x7z.json";
    const args = makeArgs({ governance: healthyGovernance() }, { archivePath: leakSentinel });
    const provider = {
      now: () => "2026-07-04T00:00:00.000Z",
      readFile: async (path: string) => {
        if (path === leakSentinel) throw new Error("enoent");
        return JSON.stringify(healthyGovernance());
      },
      readStdin: async () => "",
    };
    const run = await runReleasePublishPack(args, provider);
    expect(run.result.coverage.archive).toBe("unreadable");
    expect(run.output).not.toContain(leakSentinel);
    expect(run.output).not.toContain("leak-me-9x7z");
  });

  it("reads a document from stdin", async () => {
    const args = makeArgs({}, { governancePath: "-" });
    const provider = makeProvider({}, JSON.stringify(healthyGovernance()));
    const run = await runReleasePublishPack(args, provider);
    expect(run.exitCode).toBe(0);
    expect(run.result.pack.verdict).toBe("publishable");
  });

  it("records exactly one metric sample with the final verdict", async () => {
    const spy = vi.fn();
    setReleasePublishPackSink(spy);
    const objs = { governance: healthyGovernance() };
    await runReleasePublishPack(makeArgs(objs), makeProvider(objs));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      metric: "worker_release_publish_pack_total",
      labels: { verdict: "publishable" },
    });
  });

  it("a throwing metric sink never breaks the run", async () => {
    setReleasePublishPackSink(() => {
      throw new Error("collector down");
    });
    const objs = { governance: healthyGovernance() };
    const run = await runReleasePublishPack(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(0);
  });

  it("--strict escalates a watch to blocked (exit 4)", async () => {
    const objs = { governance: watchGovernance() };
    const run = await runReleasePublishPack(makeArgs(objs, { strict: true }), makeProvider(objs));
    expect(run.exitCode).toBe(4);
    expect(run.result.pack.strictEscalated).toBe(true);
  });
});
