/**
 * The worker-daemon runtime: wires the real providers a deployed worker drains.
 *
 * It is the Node-runtime seam the CLI (`scripts/worker-daemon.ts`) calls to turn
 * an environment into a ready-to-tick {@link WorkerExecutor}:
 *  - the job queue comes from the existing {@link createQueueProvider} factory
 *    (the real Redis/Upstash broker when configured, else the honest
 *    not-configured provider), narrowed to a {@link ClaimableQueue} — only a
 *    broker that can `claim`/`complete` is drainable;
 *  - object storage comes from {@link createS3ExecutorStorage} (genuine signed
 *    byte I/O) when S3/R2 is configured, else `null`;
 *  - the processor registry is built with a live native-engine probe, so
 *    compression's lossless repack is always available and its deep path plus OCR
 *    light up only when a real engine/runner is present — never faked.
 *
 * An executor is returned ONLY when the queue is drainable AND storage is
 * configured (a job's inputs and outputs both live in the bucket). Otherwise the
 * runtime reports honestly *why* it cannot run, so the CLI exits with a truthful
 * "not configured" status rather than pretending to process. Every dependency is
 * injectable, so the wiring is unit-tested without touching real Redis, S3, or a
 * native binary.
 *
 * Node-only: it pulls the queue factory (node:crypto), the S3 signer (node:crypto),
 * and the native-compression probe (node:child_process). It is imported by the CLI
 * and its tests only — never re-exported from an eager worker barrel.
 */

import {
  createWorkerExecutor,
  type WorkerExecutor,
} from "../executor/executor";
import type { ExecutorLogEvent, ExecutorStorage } from "../executor/types";
import {
  createS3ExecutorStorage,
  type S3ExecutorStorageDeps,
} from "../executor/s3-storage";
import { parseS3Config } from "../storage/s3-config";
import { createQueueProvider } from "../queue/factory";
import type { RedisQueueDeps } from "../queue/redis";
import type { ClaimableQueue } from "../queue/claim";
import type { QueueProvider } from "../queue/types";
import { createProcessorRegistry } from "../processor";
import type { ProcessorRegistry } from "../processor/registry";
import type { ProcessorCapability } from "../processor/types";
import {
  DEEP_COMPRESSION_TOOLS,
  type CompressionDeps,
  type CompressionTool,
  type ToolAvailability,
} from "../compression/engine";
import { nativeCompressionDeps } from "../compression/native";
import { resolveDaemonReadiness, type DaemonReadiness } from "./readiness";

type EnvSource = Record<string, string | undefined>;

/** Why no executor could be built, when the runtime is not runnable. Content-free. */
export type RuntimeBlock =
  | "not_configured" // neither a drainable queue nor storage is configured
  | "queue_not_drainable" // storage is configured, but no drainable queue is
  | "storage_not_configured"; // a drainable queue exists, but storage is not configured

/**
 * Presence-only health of the worker's compression engine — deliberately distinct
 * from daemon *drainability*. `drainable` answers "are the queue and storage wired
 * so this worker can claim and complete jobs at all?"; this answers the orthogonal
 * "will `deep` image compression actually run on THIS worker image, or only the
 * always-available lossless repack?". A deployment can be perfectly drainable and
 * still be lossless-only because no native engine is installed — an operator wants
 * to smoke-test that before advertising deep compression. Names engines by binary
 * name only (presence on PATH); never a path, version, key, or value.
 */
export interface CompressionEngineHealth {
  /** Lossless structural repack — always available (pure-JS pdf-lib repack). */
  lossless: true;
  /** Deep image compression — available only when a native engine is installed. */
  deep: boolean;
  /** Native engines detected on the host, in preference order. Names only. */
  engines: CompressionTool[];
  /** One-line, client-safe explanation. Never a path, version, key, or value. */
  detail: string;
}

/** The resolved runtime: readiness + processor capabilities, and an executor iff runnable. */
export interface WorkerRuntime {
  /** Presence-only provider/daemon readiness for logging and `--dry-run-status`. */
  readiness: DaemonReadiness;
  /**
   * Presence-only compression-engine health (lossless always; deep only with a
   * native engine). Reported even when the runtime is not drainable, so a smoke
   * check can distinguish "no queue/storage" from "no deep engine".
   */
  compression: CompressionEngineHealth;
  /** Honest, presence-only capability of every registered processor. */
  processors: ProcessorCapability[];
  /** The executor to tick — present ONLY when the queue is drainable and storage is ready. */
  executor?: WorkerExecutor;
  /** Why `executor` is absent (content-free). Present iff `executor` is undefined. */
  blocked?: RuntimeBlock;
}

/**
 * Derive the presence-only {@link CompressionEngineHealth} from the compression
 * dependencies the runtime wired. Pure and deterministic — it reads only the
 * already-probed tool availability, never re-touching the host — so the readout
 * always matches the engine the executor will actually run.
 */
export function deriveCompressionHealth(
  tools: ToolAvailability,
): CompressionEngineHealth {
  const engines = DEEP_COMPRESSION_TOOLS.filter((tool) => tools[tool]);
  const deep = engines.length > 0;
  return {
    lossless: true,
    deep,
    engines,
    detail: deep
      ? `Lossless structural repack and deep image compression are available (deep runs on ${engines[0]}).`
      : "Lossless structural repack is available; deep image compression is not — no native engine (Ghostscript, qpdf, or mutool) is installed on this worker, so `deep` jobs fail honestly as not_implemented.",
  };
}

/** Injectable seams so the whole wiring is testable without real Redis/S3/binaries. */
export interface WorkerRuntimeDeps {
  /** Override the queue provider (tests inject a fake `ClaimableQueue`/`QueueProvider`). */
  queue?: QueueProvider;
  /** Injectable provider deps for the real queue factory (clock/transport/client). */
  queueDeps?: RedisQueueDeps;
  /**
   * Override the executor storage. `undefined` → resolve from S3 config;
   * `null` → force "no storage configured".
   */
  storage?: ExecutorStorage | null;
  /** Injectable seams (clock/transport) for the real S3 executor storage. */
  storageDeps?: S3ExecutorStorageDeps;
  /** Override the processor registry entirely. */
  registry?: ProcessorRegistry;
  /** Override the compression deps (tests avoid probing the host PATH / shelling out). */
  compression?: CompressionDeps;
  /** Lease each claimed job for this long (ms); forwarded to the executor. */
  leaseMs?: number;
  /** Max delivery attempts before a retryable failure becomes terminal. */
  maxAttempts?: number;
  /** Content-free executor log sink (claimed/scanning/…); forwarded to the executor. */
  log?: (event: ExecutorLogEvent) => void;
}

/** A queue that can also `submit`/`claim` (store execution specs) is drainable. */
function isClaimableQueue(queue: QueueProvider): queue is ClaimableQueue {
  return (
    typeof (queue as Partial<ClaimableQueue>).claim === "function" &&
    typeof (queue as Partial<ClaimableQueue>).complete === "function"
  );
}

/**
 * Resolve the worker-side {@link ExecutorStorage} from the environment: a genuine
 * S3/R2 byte-I/O storage when S3 is configured, else `null` (honest "no storage").
 * The counterpart of {@link createQueueProvider} for the executor's byte seam.
 */
export function resolveExecutorStorage(
  env: EnvSource = process.env,
  deps: S3ExecutorStorageDeps = {},
): ExecutorStorage | null {
  const parsed = parseS3Config(env);
  return parsed.ok ? createS3ExecutorStorage(parsed.config, deps) : null;
}

/**
 * Build the daemon runtime from an environment. Deterministic given its injected
 * deps; with none, it reads real provider config from `env` and probes the host
 * for native engines. Returns an executor only when the queue is drainable AND
 * storage is configured; otherwise `blocked` says honestly why not.
 */
export function resolveWorkerRuntime(
  env: EnvSource = process.env,
  deps: WorkerRuntimeDeps = {},
): WorkerRuntime {
  const readiness = resolveDaemonReadiness(env);

  // Resolve the compression dependencies ONCE so the wired processor and the
  // health readout can never disagree about which native engines are present.
  // The host PATH probe (`nativeCompressionDeps`) runs only when neither explicit
  // compression deps nor a full registry override was supplied — tests inject one
  // of those, so they never touch the host.
  const compressionDeps = deps.compression ?? nativeCompressionDeps();
  const registry =
    deps.registry ?? createProcessorRegistry({ compression: compressionDeps });
  const processors = registry.capabilities();
  const compression = deriveCompressionHealth(compressionDeps.tools);

  const queue = deps.queue ?? createQueueProvider(env, deps.queueDeps);
  const storage =
    deps.storage !== undefined
      ? deps.storage
      : resolveExecutorStorage(env, deps.storageDeps);

  const drainable = isClaimableQueue(queue);
  const hasStorage = storage !== null;

  if (drainable && hasStorage) {
    const executor = createWorkerExecutor({
      queue,
      storage,
      registry,
      ...(deps.leaseMs !== undefined ? { leaseMs: deps.leaseMs } : {}),
      ...(deps.maxAttempts !== undefined ? { maxAttempts: deps.maxAttempts } : {}),
      ...(deps.log ? { log: deps.log } : {}),
    });
    return { readiness, compression, processors, executor };
  }

  const blocked: RuntimeBlock =
    !drainable && !hasStorage
      ? "not_configured"
      : !drainable
        ? "queue_not_drainable"
        : "storage_not_configured";
  return { readiness, compression, processors, blocked };
}
