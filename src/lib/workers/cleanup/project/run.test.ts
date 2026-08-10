// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import {
  runProject,
  exitCodeForProjectionVerdict,
  PROJECT_EXIT_INPUT_ERROR,
} from "./run";
import {
  setProjectionObserver,
  resetProjectionObserverForTests,
} from "./receipt";
import { setProjectionSink, resetProjectionSink } from "./metrics";
import { parseCleanupEvidence } from "../ingest";
import { parseArtifactInventory } from "../../artifacts/cleanup/inventory";
import { encodeArtifactLifecycleMetadata } from "../../storage/s3-lifecycle-metadata";
import type { ProjectArgs } from "./args";
import type { ProjectionReceipt } from "./types";

const NOW = 1_700_000_000_000;
const AT = new Date(NOW).toISOString();
const FUTURE = NOW + 3_600_000;

function args(overrides: Partial<ProjectArgs>): ProjectArgs {
  return {
    source: "stdin",
    target: "evidence",
    provider: "aws-s3",
    ...overrides,
  };
}

afterEach(() => {
  resetProjectionObserverForTests();
  resetProjectionSink();
});

describe("exitCodeForProjectionVerdict", () => {
  it("maps the ladder 0 / 2 / 4", () => {
    expect(exitCodeForProjectionVerdict("projected")).toBe(0);
    expect(exitCodeForProjectionVerdict("insufficient")).toBe(2);
    expect(exitCodeForProjectionVerdict("unsafe")).toBe(4);
  });
});

describe("runProject", () => {
  it("emits a document the downstream verifier can parse (evidence → objects)", () => {
    const text = JSON.stringify({
      objects: [{ Error: { Code: "NoSuchKey" }, Key: "a/b" }],
    });
    const run = runProject(text, args({ target: "evidence" }), NOW, AT);
    expect(run.exitCode).toBe(0);
    const doc = JSON.parse(run.output);
    expect(doc.objects).toEqual([{ presence: "absent" }]);
    expect(doc.receipt.category).toBe("cleanup-projection");
    // The projected document is directly ingestible by the Phase 42 verifier.
    const reparsed = parseCleanupEvidence(run.output);
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok)
      expect(reparsed.objects).toEqual([
        { presence: "absent", lifecycle: null, activeDelete: false },
      ]);
  });

  it("emits a document the downstream sweeper can parse (inventory → records)", () => {
    const text = JSON.stringify({
      objects: [
        {
          httpStatusCode: 200,
          Metadata: {
            "artifact-lifecycle": encodeArtifactLifecycleMetadata({
              expiresAtMs: FUTURE,
              deleted: false,
            }),
          },
          ContentType: "application/pdf",
        },
      ],
    });
    const run = runProject(text, args({ target: "inventory" }), NOW, AT);
    expect(run.exitCode).toBe(0);
    const doc = JSON.parse(run.output);
    expect(Array.isArray(doc.records)).toBe(true);
    const reparsed = parseArtifactInventory(run.output);
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) {
      expect(reparsed.inventory.records[0]).toMatchObject({
        expiresAtMs: FUTURE,
        kind: "pdf",
      });
    }
  });

  it("returns exit 2 for a metadata-thin export", () => {
    const run = runProject(
      JSON.stringify({ objects: [] }),
      args({ target: "inventory" }),
      NOW,
      AT,
    );
    expect(run.exitCode).toBe(2);
  });

  it("returns exit 4 for a present-tombstoned object", () => {
    const text = JSON.stringify({
      objects: [
        {
          httpStatusCode: 200,
          Metadata: {
            "artifact-lifecycle": encodeArtifactLifecycleMetadata({
              expiresAtMs: 1000,
              deleted: true,
            }),
          },
        },
      ],
    });
    const run = runProject(text, args({ target: "inventory" }), NOW, AT);
    expect(run.exitCode).toBe(4);
  });

  it("returns exit 1 with a content-free body on a malformed export", () => {
    const run = runProject("{not json", args({ target: "evidence" }), NOW, AT);
    expect(run.exitCode).toBe(PROJECT_EXIT_INPUT_ERROR);
    const doc = JSON.parse(run.output);
    expect(doc.error).toEqual({
      reason: "invalid-export",
      issue: "malformed-json",
    });
    expect(doc.objects).toBeUndefined();
  });

  it("pushes the receipt to a registered observer (default-off otherwise)", () => {
    const seen: ProjectionReceipt[] = [];
    setProjectionObserver((r) => seen.push(r));
    runProject(
      JSON.stringify({ objects: [{ presence: "absent" }] }),
      args({ provider: "generic" }),
      NOW,
      AT,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.at).toBe(AT);
  });

  it("never lets a throwing observer break the run", () => {
    setProjectionObserver(() => {
      throw new Error("sink is down");
    });
    const run = runProject(
      JSON.stringify({ objects: [{ presence: "absent" }] }),
      args({ provider: "generic" }),
      NOW,
      AT,
    );
    expect(run.exitCode).toBe(0);
  });

  it("emits one run-level metric sample keyed on the target × verdict", () => {
    const samples: unknown[] = [];
    setProjectionSink((s) => samples.push(s));
    const text = JSON.stringify({
      objects: [
        {
          httpStatusCode: 200,
          Metadata: {
            "artifact-lifecycle": encodeArtifactLifecycleMetadata({
              expiresAtMs: 1000,
              deleted: true,
            }),
          },
        },
      ],
    });
    runProject(text, args({ target: "inventory" }), NOW, AT);
    expect(samples).toEqual([
      {
        metric: "worker_cleanup_projection_total",
        kind: "counter",
        labels: { target: "inventory", verdict: "unsafe" },
        value: 1,
      },
    ]);
  });

  it("stamps the receipt with the generatedAt the caller derived", () => {
    const run = runProject(
      JSON.stringify({ objects: [{ presence: "absent" }] }),
      args({ provider: "generic" }),
      NOW,
      AT,
    );
    expect(run.result.ok).toBe(true);
    if (run.result.ok) expect(run.result.receipt.at).toBe(AT);
  });
});
