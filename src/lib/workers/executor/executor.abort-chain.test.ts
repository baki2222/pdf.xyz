// @vitest-environment node
/**
 * The COMPOSED chain (CLAUDE.md: verify the chain, not the units): a lost lease
 * kills the engine's child process.
 *
 * `executor.lease.test.ts` proves a rejected renewal aborts the processor's
 * signal, with a fake processor that honours it. `engines-honour-abort.test.ts`
 * proves each engine kills its child when handed an aborted signal. Each can
 * pass while the path through both drops it — the executor building a signal
 * nobody reads, or a processor reading one the executor never passes. So here
 * the REAL executor drains the REAL local-dev queue into the REAL compression
 * processor, whose native runner is the production one with its production
 * exec (`defaultNativeExec`); only Ghostscript's command and argv are swapped
 * for a Node child that sleeps for a minute. A second worker then takes the
 * job, exactly as the lease test does, and the property is asked of the
 * process table and the storage: the child is gone, nothing was written,
 * attempt 2's inputs are intact.
 *
 * Real timers: the child is a real process, so the lease is short (600 ms,
 * renewed every 200 ms) instead of faked.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { DEFAULT_RETENTION, type Job, type JobArtifact } from "@/lib/jobs";
import {
  isAlive,
  longChild,
  waitForExit,
  waitForPid,
} from "@/tests/long-child";
import { DevWorkerStore } from "../store";
import { createLocalDevQueue } from "../queue/local-dev";
import { ProcessorRegistry } from "../processor/registry";
import { createCompressionProcessor } from "../processor/compression";
import {
  defaultNativeExec,
  nativeCompressionDeps,
  type NativeExec,
} from "../compression/native";
import { createWorkerExecutor } from "./executor";
import type { ExecutorLogEvent, ExecutorStorage } from "./types";

const LEASE_MS = 600;
const JOB = "job_abortchain01";
const INPUT = "f_abortchain001";

let PDF: Uint8Array;
const ROOT = mkdtempSync(path.join(tmpdir(), "pdfxyz-abort-chain-"));
beforeAll(async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  PDF = await doc.save();
});
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

function queuedJob(): Job {
  const now = Date.now();
  return {
    jobId: JOB,
    tool: "compress-pdf",
    capability: "secure-worker",
    status: "queued",
    progress: 0,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60 * 60_000).toISOString(),
    retention: DEFAULT_RETENTION,
  };
}

function recordingStorage() {
  const written: string[] = [];
  const deletedInputs: string[] = [];
  const storage: ExecutorStorage = {
    async readInput(fileId) {
      return fileId === INPUT
        ? {
            fileId: INPUT,
            filename: "in.pdf",
            contentType: "application/pdf",
            bytes: PDF,
          }
        : null;
    },
    async writeArtifact(input) {
      const artifactId = `art_chain${written.length}0000`;
      written.push(artifactId);
      const record: JobArtifact = {
        artifactId,
        filename: input.filename,
        contentType: input.contentType,
        bytes: input.bytes.byteLength,
        url: `/api/artifacts/local/${artifactId}`,
        expiresAt: new Date(0).toISOString(),
      };
      return record;
    },
    async deleteInput(fileId) {
      deletedInputs.push(fileId);
    },
    async deleteArtifact() {},
  };
  return { storage, written, deletedInputs };
}

describe("executor → processor → engine → child, through a lost lease", () => {
  it("a stolen lease kills the Ghostscript child: nothing written, inputs kept", async () => {
    const store = new DevWorkerStore(() => Date.now());
    const queue = createLocalDevQueue({ store, now: () => Date.now() });
    const submitted = await queue.submit({
      job: queuedJob(),
      inputs: [INPUT],
      options: { profile: "deep" },
    });
    expect(submitted.ok).toBe(true);

    const child = longChild(mkdtempSync(path.join(ROOT, "gs-")), "gs");
    const tempDirs: string[] = [];
    const exec: NativeExec = (command, args, options) => {
      const out = args.find((a) => a.startsWith("-sOutputFile="));
      if (out) tempDirs.push(path.dirname(out.slice("-sOutputFile=".length)));
      return defaultNativeExec(child.command, child.args, options);
    };
    const rec = recordingStorage();
    const events: ExecutorLogEvent[] = [];
    const executor = createWorkerExecutor({
      queue,
      storage: rec.storage,
      registry: new ProcessorRegistry().register(
        createCompressionProcessor(
          nativeCompressionDeps({}, { resolveOnPath: () => true, exec }),
        ),
      ),
      leaseMs: LEASE_MS,
      log: (e) => events.push(e),
    });

    const tick = executor.runOnce();
    const pid = await waitForPid(child.pidFile);
    expect(isAlive(pid)).toBe(true);
    // Health: the stand-in really is the engine's child, run in its temp dir.
    expect(tempDirs).toHaveLength(1);

    // A second worker takes the job (the lease forced past its deadline, as
    // after a GC pause); this attempt's next renewal is REJECTED.
    const lease = store.getLease(JOB);
    if (!lease) throw new Error("no lease on the running job");
    store.setLease(JOB, { ...lease, leaseExpiresAt: 0 });
    const second = await queue.claim({ leaseMs: 60_000 });
    expect(second.ok && second.value?.attempt).toBe(2);

    const stolenAt = Date.now();
    const result = await tick;
    // Renewal every 200 ms, then the kill: well under the child's 60 s.
    expect(Date.now() - stolenAt).toBeLessThan(5_000);
    expect(result).toMatchObject({ outcome: "lease_lost", jobId: JOB });
    expect(await waitForExit(pid, 5_000)).toBe(true);

    // The zombie wrote nothing and left attempt 2's input alone.
    expect(rec.written).toEqual([]);
    expect(rec.deletedInputs).toEqual([]);
    const status = await queue.status(JOB);
    expect(status.ok && status.value.artifacts).toBeUndefined();
    // Alive under attempt 2 (claimed, not yet past its scan), as in the lease test.
    expect(status.ok && status.value.status).toBe("scanning");
    // Reported as a lost lease, not as a failed or canceled job.
    const names = events.map((e) => e.event);
    expect(names).toContain("lease_lost");
    expect(names).not.toContain("failed");
    expect(names).not.toContain("canceled");
    // The engine's temp dir went with it.
    expect(existsSync(tempDirs[0]!)).toBe(false);
  }, 30_000);
});
