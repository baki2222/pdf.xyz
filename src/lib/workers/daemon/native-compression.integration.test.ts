// @vitest-environment node
/**
 * Phase 17 integration proof: a real `compress-pdf` job completes end-to-end
 * through the whole out-of-band worker stack — `resolveWorkerRuntime` →
 * `createWorkerDaemon` → `createWorkerExecutor` → the compression processor —
 * reading and writing bytes through the PRODUCTION worker-side storage seam
 * (`createS3ExecutorStorage`), not the in-process local-dev store. The daemon is
 * driven exactly as the CLI drives it (`--once` / `--drain`), so this exercises
 * the same wiring a deployment runs.
 *
 * The S3 network is a stateful in-memory fake bucket keyed by signed-URL path: a
 * PUT stores bytes, a GET serves them back, a DELETE removes them. Nothing is
 * mocked away between the executor and storage — the executor signs and issues
 * genuine GET/PUT/DELETE requests, and a job reaches `completed` ONLY after real
 * artifact bytes were read from, processed, and written back to the bucket.
 *
 * It proves the honesty boundary in both directions:
 *  - `lossless` always completes (pure-JS repack) with a valid PDF really landed
 *    in the bucket and the input object wiped;
 *  - `deep` completes when a native engine is available, using a deterministic
 *    injected native runner so the native path is proven without shipping a binary;
 *  - `deep` with no native engine fails honestly (`not_implemented`) — no artifact
 *    is written and the job never reaches `completed`.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { DEFAULT_RETENTION, type Job } from "@/lib/jobs";
import { DevWorkerStore } from "../store";
import { newFileId } from "../ids";
import { createLocalDevQueue } from "../queue/local-dev";
import {
  createS3ExecutorStorage,
  type S3ObjectFetch,
  type S3ObjectResponse,
} from "../executor/s3-storage";
import type { ExecutorLogEvent } from "../executor/types";
import { parseS3Config, type S3StorageConfig } from "../storage/s3-config";
import { buildObjectKey, signingTarget } from "../storage/s3-keys";
import {
  FILENAME_METADATA_HEADER,
  encodeFilenameMetadata,
} from "../storage/s3-metadata";
import type { StorageObjectKind } from "../storage/types";
import type { CompressionDeps, NativeCompressor } from "../compression/engine";
import { createWorkerDaemon, type DaemonLogEvent } from "./daemon";
import { resolveWorkerRuntime } from "./runtime";

// A fixed clock keeps signing dates and expiries deterministic (no Date.now).
const CLOCK = Date.UTC(2026, 6, 2, 3, 4, 5);
const now = () => CLOCK;

// Never a real credential — a shape-valid fixture routed through the real parser.
const S3_SECRET = "s3-secret-value-1234567890";

const CFG: S3StorageConfig = (() => {
  const parsed = parseS3Config({
    PDFXYZ_STORAGE_PROVIDER: "s3",
    PDFXYZ_S3_ENDPOINT: "https://s3.example.com",
    PDFXYZ_S3_REGION: "auto",
    PDFXYZ_S3_BUCKET: "pdfxyz-store",
    PDFXYZ_S3_ACCESS_KEY_ID: "AKIAEXAMPLE123",
    PDFXYZ_S3_SECRET_ACCESS_KEY: S3_SECRET,
  });
  if (!parsed.ok) throw new Error("fixture S3 config should parse");
  return parsed.config;
})();

const noEngines: CompressionDeps = {
  tools: { ghostscript: false, qpdf: false, mutool: false },
};

/** The bucket path a signed URL for `id` targets — how we seed inputs / assert artifacts. */
function keyPath(kind: StorageObjectKind, id: string): string {
  return signingTarget(CFG, buildObjectKey(CFG, kind, id)).path;
}

interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
  /** Raw `x-amz-meta-filename` value stored on the object (as S3 would keep it). */
  filenameMeta?: string;
}

/**
 * A stateful in-memory S3 bucket behind the {@link S3ObjectFetch} seam, keyed by
 * the signed URL's path. GET serves a stored object (404 when absent), PUT stores
 * the request bytes + content-type, DELETE removes it. Records every call so a
 * test can assert exactly which object operations happened.
 */
function fakeBucket() {
  const objects = new Map<string, StoredObject>();
  const calls: { method: string; key: string }[] = [];

  const respond = (status: number, obj?: StoredObject): S3ObjectResponse => ({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => {
        const key = name.toLowerCase();
        if (key === "content-type") return obj?.contentType ?? null;
        if (key === FILENAME_METADATA_HEADER) return obj?.filenameMeta ?? null;
        return null;
      },
    },
    arrayBuffer: async () =>
      (obj?.bytes ?? new Uint8Array()).slice().buffer as ArrayBuffer,
  });

  const fn: S3ObjectFetch = async (url, init) => {
    const key = new URL(url).pathname;
    calls.push({ method: init.method, key });
    switch (init.method) {
      case "GET": {
        const obj = objects.get(key);
        return obj ? respond(200, obj) : respond(404);
      }
      case "PUT": {
        const filenameMeta = init.headers?.[FILENAME_METADATA_HEADER];
        objects.set(key, {
          bytes: init.body ?? new Uint8Array(),
          contentType:
            init.headers?.["content-type"] ?? "application/octet-stream",
          ...(filenameMeta ? { filenameMeta } : {}),
        });
        return respond(200);
      }
      case "DELETE": {
        objects.delete(key);
        return respond(204);
      }
      default:
        return respond(400);
    }
  };

  return { objects, calls, fn };
}

async function makePdf(
  pages: number,
  opts: { withText?: boolean } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = opts.withText
    ? await doc.embedFont(StandardFonts.Helvetica)
    : undefined;
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([300, 300]);
    if (font) {
      for (let line = 0; line < 8; line += 1) {
        page.drawText(`content line ${line}`, {
          x: 10,
          y: 280 - line * 20,
          size: 9,
          font,
        });
      }
    }
  }
  return doc.save();
}

function queuedJob(jobId: string, tool: string): Job {
  const iso = new Date(CLOCK).toISOString();
  return {
    jobId,
    tool,
    capability: "secure-worker",
    status: "queued",
    progress: 0,
    createdAt: iso,
    updatedAt: iso,
    expiresAt: new Date(CLOCK + 60 * 60_000).toISOString(),
    retention: DEFAULT_RETENTION,
  };
}

/** Build the queue + S3 storage over a fresh bucket, sharing the fixed clock. */
function harness(bucket: ReturnType<typeof fakeBucket>) {
  const store = new DevWorkerStore(now);
  const queue = createLocalDevQueue({ store, now });
  const storage = createS3ExecutorStorage(CFG, { now, fetchImpl: bucket.fn });
  return { store, queue, storage };
}

describe("native compression worker path — S3 seam, end-to-end", () => {
  it("completes a lossless compress-pdf job over signed S3 byte I/O (--once)", async () => {
    const bucket = fakeBucket();
    const { store, queue, storage } = harness(bucket);

    const fileId = newFileId();
    const pdf = await makePdf(5);
    bucket.objects.set(keyPath("input", fileId), {
      bytes: pdf,
      contentType: "application/pdf",
    });
    await queue.submit({
      job: queuedJob("job_lossless0001", "compress-pdf"),
      inputs: [fileId],
      options: { profile: "lossless" },
    });

    const runtime = resolveWorkerRuntime(
      {},
      {
        queue,
        storage,
        compression: noEngines,
      },
    );
    expect(runtime.executor).toBeDefined();
    // Health is honest: a worker with no native engine is lossless-only.
    expect(runtime.compression).toMatchObject({
      lossless: true,
      deep: false,
      engines: [],
    });

    const summary = await createWorkerDaemon({
      executor: runtime.executor!,
    }).run({ mode: "once" });
    expect(summary).toMatchObject({ mode: "once", ticks: 1, completed: 1 });

    const job = store.getJob("job_lossless0001");
    expect(job?.status).toBe("completed");
    expect(job?.progress).toBe(100);

    const artifact = job?.artifacts?.[0];
    expect(artifact).toBeDefined();
    // Legacy object with no filename metadata → safe content-type-derived name.
    expect(artifact!.filename).toBe("document-compressed.pdf");
    // The client-facing URL is this app's OPAQUE retrieval route — never a signed
    // object-store URL (the route reads the bytes from the bucket server-side and
    // streams them through the guarded access boundary).
    expect(artifact!.url).toBe(`/api/artifacts/${artifact!.artifactId}`);
    expect(artifact!.url).not.toContain("X-Amz-Signature=");
    expect(artifact!.url).not.toContain(S3_SECRET);

    // The artifact bytes REALLY landed in the bucket and are a valid PDF.
    const stored = bucket.objects.get(
      keyPath("artifact", artifact!.artifactId),
    );
    expect(stored).toBeDefined();
    expect(stored!.bytes.byteLength).toBe(artifact!.bytes);
    const reloaded = await PDFDocument.load(stored!.bytes);
    expect(reloaded.getPageCount()).toBe(5);

    // The input object was wiped (signed DELETE) after processing.
    expect(bucket.objects.has(keyPath("input", fileId))).toBe(false);
    expect(
      bucket.calls.some(
        (c) => c.method === "DELETE" && c.key === keyPath("input", fileId),
      ),
    ).toBe(true);
  });

  it("names the output from x-amz-meta-filename recovered off the input object", async () => {
    const bucket = fakeBucket();
    const { store, queue, storage } = harness(bucket);

    const fileId = newFileId();
    const pdf = await makePdf(4);
    // Seed the input object exactly as the app-server reservation would: bytes,
    // content-type, AND the sanitized filename in object metadata.
    bucket.objects.set(keyPath("input", fileId), {
      bytes: pdf,
      contentType: "application/pdf",
      filenameMeta: encodeFilenameMetadata("Board Deck.pdf"),
    });
    // No inputNames on the submission — recovery is purely from S3 metadata.
    await queue.submit({
      job: queuedJob("job_meta00000001", "compress-pdf"),
      inputs: [fileId],
      options: { profile: "lossless" },
    });

    const runtime = resolveWorkerRuntime(
      {},
      {
        queue,
        storage,
        compression: noEngines,
      },
    );
    await createWorkerDaemon({ executor: runtime.executor! }).run({
      mode: "once",
    });

    const artifact = store.getJob("job_meta00000001")?.artifacts?.[0];
    expect(artifact!.filename).toBe("Board Deck-compressed.pdf");
    // The recovered filename never appears in any object key touched on the bucket.
    for (const call of bucket.calls) {
      expect(call.key).not.toContain("Board");
      expect(call.key).not.toContain("Deck");
    }
  });

  it("lets the job spec's inputNames override the object metadata name", async () => {
    const bucket = fakeBucket();
    const { store, queue, storage } = harness(bucket);

    const fileId = newFileId();
    bucket.objects.set(keyPath("input", fileId), {
      bytes: await makePdf(3),
      contentType: "application/pdf",
      filenameMeta: encodeFilenameMetadata("stale-name.pdf"),
    });
    await queue.submit({
      job: queuedJob("job_override001", "compress-pdf"),
      inputs: [fileId],
      inputNames: ["Authoritative Report.pdf"],
      options: { profile: "lossless" },
    });

    const runtime = resolveWorkerRuntime(
      {},
      {
        queue,
        storage,
        compression: noEngines,
      },
    );
    await createWorkerDaemon({ executor: runtime.executor! }).run({
      mode: "once",
    });

    const artifact = store.getJob("job_override001")?.artifacts?.[0];
    // The spec name is authoritative; the (stale) object metadata is ignored.
    expect(artifact!.filename).toBe("Authoritative Report-compressed.pdf");
  });

  it("completes a deep compress-pdf job with a deterministic injected native runner", async () => {
    const bucket = fakeBucket();
    const { store, queue, storage } = harness(bucket);

    const fileId = newFileId();
    const original = await makePdf(8, { withText: true });
    bucket.objects.set(keyPath("input", fileId), {
      bytes: original,
      contentType: "application/pdf",
    });
    await queue.submit({
      job: queuedJob("job_deep00000001", "compress-pdf"),
      inputs: [fileId],
      options: { profile: "deep", targetDpi: 150 },
    });

    // A deterministic stand-in for Ghostscript: returns a real, smaller PDF so the
    // native path is exercised faithfully without shipping a binary in CI.
    // 8 pages in, 8 pages out — fewer bytes, every page intact.
    //
    // This was `makePdf(2)`: a "deep compression" mock returning a 2-page
    // document for an 8-page input, with the test asserting the job completed.
    // The fixture did not merely describe the wrong world, it encoded the exact
    // defect TASK-49 exists to stop and blessed it as the expected outcome.
    const deepOutput = await makePdf(8);
    const runnerCalls: {
      engine: string;
      inputBytes: number;
      targetDpi: number;
    }[] = [];
    const native: NativeCompressor = async (input, ctx) => {
      runnerCalls.push({
        engine: ctx.engine,
        inputBytes: input.byteLength,
        targetDpi: ctx.options.targetDpi,
      });
      return deepOutput;
    };
    const compression: CompressionDeps = {
      tools: { ghostscript: true, qpdf: false, mutool: false },
      native,
    };

    const runtime = resolveWorkerRuntime({}, { queue, storage, compression });
    // Health now reports deep available on the injected engine.
    expect(runtime.compression).toMatchObject({
      deep: true,
      engines: ["ghostscript"],
    });

    const summary = await createWorkerDaemon({
      executor: runtime.executor!,
    }).run({ mode: "once" });
    expect(summary.completed).toBe(1);

    // The native runner really ran, over the exact input bytes read from S3.
    expect(runnerCalls).toEqual([
      {
        engine: "ghostscript",
        inputBytes: original.byteLength,
        targetDpi: 150,
      },
    ]);

    const job = store.getJob("job_deep00000001");
    expect(job?.status).toBe("completed");
    const artifact = job?.artifacts?.[0];
    expect(artifact).toBeDefined();

    // The artifact persisted to the bucket is EXACTLY the native runner's output.
    const stored = bucket.objects.get(
      keyPath("artifact", artifact!.artifactId),
    );
    expect(stored!.bytes).toEqual(deepOutput);
    expect(artifact!.bytes).toBe(deepOutput.byteLength);
    expect(bucket.objects.has(keyPath("input", fileId))).toBe(false);
  });

  it("fails a deep job honestly with no native engine (--drain): no artifact, never completed", async () => {
    const bucket = fakeBucket();
    const { store, queue, storage } = harness(bucket);

    const fileId = newFileId();
    bucket.objects.set(keyPath("input", fileId), {
      bytes: await makePdf(4),
      contentType: "application/pdf",
    });
    await queue.submit({
      job: queuedJob("job_nodeep00001", "compress-pdf"),
      inputs: [fileId],
      options: { profile: "deep" },
    });

    const runtime = resolveWorkerRuntime(
      {},
      {
        queue,
        storage,
        compression: noEngines,
      },
    );
    expect(runtime.compression.deep).toBe(false);

    const summary = await createWorkerDaemon({
      executor: runtime.executor!,
    }).run({ mode: "drain" });
    expect(summary).toMatchObject({
      completed: 0,
      failed: 1,
      reason: "drained",
    });

    const job = store.getJob("job_nodeep00001");
    expect(job?.status).toBe("failed");
    expect(job?.error?.code).toBe("not_implemented");
    expect(job?.artifacts ?? []).toHaveLength(0);

    // "Real completion only": no artifact object was ever written to the bucket.
    const artifactPuts = bucket.calls.filter(
      (c) => c.method === "PUT" && c.key.includes("/artifacts/"),
    );
    expect(artifactPuts).toHaveLength(0);
    expect(
      [...bucket.objects.keys()].some((k) => k.includes("/artifacts/")),
    ).toBe(false);
    // The input was still wiped after the terminal failure.
    expect(bucket.objects.has(keyPath("input", fileId))).toBe(false);
  });

  it("keeps daemon + executor logs content-free through a real S3-backed run", async () => {
    const bucket = fakeBucket();
    const { queue, storage } = harness(bucket);

    const fileId = newFileId();
    // Seed a REAL filename via object metadata AND submit a spec display name, so
    // the assertion proves neither source ever reaches a log line.
    bucket.objects.set(keyPath("input", fileId), {
      bytes: await makePdf(3),
      contentType: "application/pdf",
      filenameMeta: encodeFilenameMetadata("Confidential Salaries.pdf"),
    });
    await queue.submit({
      job: queuedJob("job_logs0000001", "compress-pdf"),
      inputs: [fileId],
      inputNames: ["Confidential Salaries.pdf"],
      options: { profile: "lossless" },
    });

    const executorLogs: ExecutorLogEvent[] = [];
    const daemonLogs: DaemonLogEvent[] = [];
    const runtime = resolveWorkerRuntime(
      {},
      {
        queue,
        storage,
        compression: noEngines,
        log: (e) => executorLogs.push(e),
      },
    );
    await createWorkerDaemon({
      executor: runtime.executor!,
      log: (e) => daemonLogs.push(e),
    }).run({ mode: "drain" });

    const serialized = JSON.stringify({ executorLogs, daemonLogs });
    // Safe to log: the outcome and the opaque job id.
    expect(serialized).toContain("completed");
    expect(serialized).toContain("job_logs0000001");
    // Never logged: secrets, filenames, object keys, or the input id.
    expect(serialized).not.toContain(S3_SECRET);
    expect(serialized).not.toContain("document.pdf");
    expect(serialized).not.toContain("Confidential");
    expect(serialized).not.toContain("Salaries");
    expect(serialized).not.toContain("/artifacts/");
    expect(serialized).not.toContain("/inputs/");
    expect(serialized).not.toContain(fileId);
  });
});
