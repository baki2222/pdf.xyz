// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { runReleaseIndex, type ReleaseIndexProvider } from "./run";
import type { ReleaseIndexArgs } from "./args";
import { resetReleaseIndexSink, setReleaseIndexSink } from "./metrics";
import { artifactText, makeArtifact, sha256 } from "./fixtures";

const NOW = "2026-07-03T00:00:00.000Z";

function provider(files: Record<string, string>, stdin = ""): ReleaseIndexProvider {
  return {
    now: () => NOW,
    hash: sha256,
    readArtifact: async (path: string) => {
      if (path in files) return files[path]!;
      throw new Error("enoent");
    },
    readStdin: async () => stdin,
  };
}

function args(o: Partial<ReleaseIndexArgs> = {}): ReleaseIndexArgs {
  return { format: "json", pretty: true, artifactPaths: [], ...o };
}

afterEach(() => resetReleaseIndexSink());

describe("runReleaseIndex — file inputs", () => {
  it("indexes multiple artifact files to an ok manifest", async () => {
    const files = {
      "a.json": artifactText({ generatedAt: "2026-07-02T00:00:00.000Z", verdict: "pass" }),
      "b.json": artifactText({ generatedAt: "2026-06-20T00:00:00.000Z", verdict: "pass" }),
    };
    const run = await runReleaseIndex(args({ artifactPaths: ["a.json", "b.json"] }), provider(files));
    expect(run.exitCode).toBe(0);
    expect(run.index.rollup.verdict).toBe("ok");
    expect(run.index.retention.indexedArtifacts).toBe(2);
  });

  it("records an unreadable file path as ONE skipped input without aborting", async () => {
    const files = { "a.json": artifactText({ verdict: "pass" }) };
    const run = await runReleaseIndex(args({ artifactPaths: ["a.json", "missing.json"] }), provider(files));
    expect(run.index.retention.indexedArtifacts).toBe(1);
    expect(run.index.retention.skippedInputs).toBe(1);
    expect(run.index.rollup.verdict).toBe("warn"); // unreadable-input driver
    expect(run.index.rollup.drivers).toContain("unreadable-input");
  });

  it("resolves a tampered artifact to invalid (exit 4)", async () => {
    const art = makeArtifact({ label: "v1.0.0" });
    (art.body as { metadata: { label: string } }).metadata.label = "v2.0.0";
    const files = { "t.json": JSON.stringify(art) };
    const run = await runReleaseIndex(args({ artifactPaths: ["t.json"] }), provider(files));
    expect(run.exitCode).toBe(4);
    expect(run.index.rollup.verdict).toBe("invalid");
  });

  it("applies retention bounds", async () => {
    const files = {
      "a.json": artifactText({ generatedAt: "2026-07-02T00:00:00.000Z" }),
      "b.json": artifactText({ generatedAt: "2026-06-01T00:00:00.000Z" }),
      "c.json": artifactText({ generatedAt: "2026-01-01T00:00:00.000Z" }),
    };
    const run = await runReleaseIndex(
      args({ artifactPaths: ["a.json", "b.json", "c.json"], maxArtifacts: 2 }),
      provider(files),
    );
    expect(run.exitCode).toBe(3);
    expect(run.index.retention.overCount).toBe(true);
  });
});

describe("runReleaseIndex — stdin inputs", () => {
  it("indexes a JSON array on stdin when no --artifact was given", async () => {
    const stdin = JSON.stringify([makeArtifact({ verdict: "pass" }), makeArtifact({ verdict: "warn" })]);
    const run = await runReleaseIndex(args(), provider({}, stdin));
    expect(run.index.retention.indexedArtifacts).toBe(2);
    expect(run.index.verdictCounts).toEqual({ pass: 1, warn: 1, fail: 0, unknown: 0 });
  });

  it("indexes a single artifact object on stdin", async () => {
    const run = await runReleaseIndex(args(), provider({}, artifactText({ verdict: "pass" })));
    expect(run.index.retention.indexedArtifacts).toBe(1);
    expect(run.exitCode).toBe(0);
  });

  it("an empty archive (no inputs, empty stdin) is unknown (exit 2)", async () => {
    const run = await runReleaseIndex(args(), provider({}, ""));
    expect(run.exitCode).toBe(2);
    expect(run.index.rollup.verdict).toBe("unknown");
    expect(run.index.rollup.drivers).toEqual(["empty"]);
  });

  it("non-empty unparseable stdin is one unreadable input → insufficient (exit 2)", async () => {
    const run = await runReleaseIndex(args(), provider({}, "this is not json"));
    expect(run.exitCode).toBe(2);
    expect(run.index.retention.skippedInputs).toBe(1);
    expect(run.index.retention.indexedArtifacts).toBe(0);
  });
});

describe("runReleaseIndex — metric + format", () => {
  it("emits one metric with the composite verdict", async () => {
    const seen: { labels: Record<string, string> }[] = [];
    setReleaseIndexSink((s) => seen.push(s as never));
    await runReleaseIndex(args({ artifactPaths: ["a.json"] }), provider({ "a.json": artifactText({ verdict: "pass" }) }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.labels).toEqual({ verdict: "ok" });
  });

  it("renders text when requested", async () => {
    const run = await runReleaseIndex(
      args({ format: "text", artifactPaths: ["a.json"] }),
      provider({ "a.json": artifactText({ verdict: "pass" }) }),
    );
    expect(run.output).toContain("pdf.xyz release evidence index");
    expect(run.output).toContain("ROLLUP: OK");
  });
});
