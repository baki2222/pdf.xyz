// @vitest-environment node
/**
 * Contract for the cleanup-check orchestrator: each source (none / stdin / file), the honest
 * env-resolved posture, ingest failures as usage errors (never crashes), and the best-effort
 * metric + receipt emission. All seams are injected — no runtime, bucket, or filesystem.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCleanupCheck, type CleanupCheckProvider } from "./run";
import type { CleanupCheckArgs } from "./args";
import type { RetrievalStorageProvider } from "../artifacts/access";
import {
  resetCleanupVerificationSink,
  setCleanupVerificationSink,
} from "./metrics";
import {
  resetCleanupVerificationObserverForTests,
  setCleanupVerificationObserver,
} from "./receipt";

const NOW = 1_700_000_000_000;

function args(partial: Partial<CleanupCheckArgs>): CleanupCheckArgs {
  return {
    source: partial.source ?? "none",
    ...(partial.filePath !== undefined ? { filePath: partial.filePath } : {}),
    format: partial.format ?? "json",
    graceHours: partial.graceHours ?? 48,
  };
}

function fakeProvider(over: {
  provider?: RetrievalStorageProvider;
  input?: string | Error;
}): CleanupCheckProvider {
  return {
    resolveProvider: () => over.provider ?? "remote-configured",
    readInput: async () => {
      if (over.input instanceof Error) throw over.input;
      return over.input ?? "[]";
    },
    now: () => NOW,
  };
}

afterEach(() => {
  resetCleanupVerificationSink();
  resetCleanupVerificationObserverForTests();
});

describe("runCleanupCheck — none source", () => {
  it("reports not-configured (exit 2) when storage is not wired", async () => {
    const run = await runCleanupCheck(
      args({ source: "none" }),
      fakeProvider({ provider: "not-configured" }),
    );
    expect(run.exitCode).toBe(2);
    expect(run.outcome).toMatchObject({ verdict: "not-configured", ok: false });
  });

  it("reports unknown (exit 2) when configured but no evidence was supplied", async () => {
    const run = await runCleanupCheck(
      args({ source: "none" }),
      fakeProvider({ provider: "remote-configured" }),
    );
    expect(run.exitCode).toBe(2);
    expect(run.outcome).toMatchObject({ verdict: "unknown", total: 0 });
  });
});

describe("runCleanupCheck — ingested evidence", () => {
  it("reports verified (exit 0) for a healthy absent-after-cleanup document", async () => {
    const doc = JSON.stringify([
      { presence: "absent", activeDelete: true },
      { presence: "absent" },
    ]);
    const run = await runCleanupCheck(
      args({ source: "stdin" }),
      fakeProvider({ input: doc }),
    );
    expect(run.exitCode).toBe(0);
    expect(run.outcome).toMatchObject({
      verdict: "verified",
      ok: true,
      reaped: 2,
    });
  });

  it("reports drift (exit 3) for an object present past its reap grace", async () => {
    const doc = JSON.stringify([
      {
        presence: "present",
        expiresAtMs: NOW - 1000 * 60 * 60 * 100,
        deleted: false,
      },
    ]);
    const run = await runCleanupCheck(
      args({ source: "file", filePath: "x.json" }),
      fakeProvider({ input: doc }),
    );
    expect(run.exitCode).toBe(3);
    expect(run.outcome).toMatchObject({ verdict: "drift", drift: 1 });
  });

  it("turns an unreadable input into a usage error (exit 1), never a crash", async () => {
    const run = await runCleanupCheck(
      args({ source: "file", filePath: "missing.json" }),
      fakeProvider({ input: new Error("ENOENT") }),
    );
    expect(run.exitCode).toBe(1);
    expect(run.outcome).toMatchObject({
      error: "usage",
      issues: ["input-unreadable"],
    });
  });

  it("turns malformed evidence into a usage error (exit 1)", async () => {
    const run = await runCleanupCheck(
      args({ source: "stdin" }),
      fakeProvider({ input: "{ broken" }),
    );
    expect(run.exitCode).toBe(1);
    expect(run.outcome).toMatchObject({
      error: "usage",
      issues: ["malformed-json"],
    });
  });
});

describe("runCleanupCheck — observability", () => {
  it("emits one content-free metric + receipt for a completed verification", async () => {
    const metric = vi.fn();
    const receipt = vi.fn();
    setCleanupVerificationSink(metric);
    setCleanupVerificationObserver(receipt);

    await runCleanupCheck(
      args({ source: "stdin" }),
      fakeProvider({ input: JSON.stringify([{ presence: "absent" }]) }),
    );

    expect(metric).toHaveBeenCalledTimes(1);
    expect(metric.mock.calls[0]![0]).toMatchObject({
      metric: "worker_cleanup_verification_total",
      labels: { verdict: "verified", provider: "remote-configured" },
    });
    expect(receipt).toHaveBeenCalledTimes(1);
    expect(receipt.mock.calls[0]![0]).toMatchObject({
      category: "cleanup",
      verdict: "verified",
      at: new Date(NOW).toISOString(),
    });
  });

  it("does NOT emit a verdict metric for a usage error", async () => {
    const metric = vi.fn();
    setCleanupVerificationSink(metric);
    await runCleanupCheck(
      args({ source: "stdin" }),
      fakeProvider({ input: "{ broken" }),
    );
    expect(metric).not.toHaveBeenCalled();
  });

  it("survives a throwing metric sink (observability never breaks a check)", async () => {
    setCleanupVerificationSink(() => {
      throw new Error("collector down");
    });
    const run = await runCleanupCheck(
      args({ source: "stdin" }),
      fakeProvider({ input: JSON.stringify([{ presence: "absent" }]) }),
    );
    expect(run.outcome).toMatchObject({ verdict: "verified" });
  });
});
