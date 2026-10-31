/**
 * Browser-side driver for the secure-worker compression flow.
 *
 * This runs the full documented job lifecycle against the same endpoints a
 * production worker exposes — create upload session → direct upload → create job
 * → poll status → download artifact — and returns an honest, typed result. It
 * deliberately uses nothing but `fetch` and the shared contract *types*, so it is
 * safe in a client component and fully unit-testable with an injected `fetch`.
 *
 * It never fabricates output: a `failed` job (e.g. deep compression with no
 * native engine on the worker) comes back as an honest failure carrying the
 * server's typed error, not a fake file.
 */

// Import from the leaf contract modules (not the "@/lib/jobs" barrel) so this
// browser module never pulls the server-side validators or the tools catalog
// into the client bundle. `isTerminalStatus` is the only runtime value used.
import type { Job, JobArtifact } from "@/lib/jobs/types";
import type { CompressionProfile } from "./compression/engine";
import type { WorkerJobPhase } from "./job-polling";
import { forwardStatus } from "./phases";
import { loadJobRun } from "./job-run-lazy";
import { withToolOutcome } from "@/lib/telemetry/tool-outcome";

const COMPRESS_TOOL = "compress-pdf";

/** What the caller wants compressed, and how. */
export interface CompressWorkerInput {
  filename: string;
  bytes: Uint8Array;
  profile: CompressionProfile;
  /** Target DPI for the `deep` profile; ignored for `lossless`. */
  targetDpi?: number;
  /** Convert colour to gray (`deep` only; needs Ghostscript on the worker). */
  grayscale?: boolean;
  /** The size the file must fit, in bytes (`deep` only); absent ⇒ no target. */
  targetBytes?: number;
}

export interface CompressWorkerSuccess {
  ok: true;
  job: Job;
  artifact: JobArtifact;
  /** The real, downloaded output bytes. */
  output: Uint8Array;
}

export interface CompressWorkerFailure {
  ok: false;
  /** A client-safe, honest message (from the server's typed error when present). */
  message: string;
  /** The contract error code or job error code, when one is available. */
  code?: string;
}

export type CompressWorkerResult =
  CompressWorkerSuccess | CompressWorkerFailure;

/** Minimal `fetch` shape, so tests can inject a stub without the DOM lib. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: ArrayBuffer;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  /** Optional so stubs need not carry it; read for a 429's `Retry-After`. */
  headers?: { get(name: string): string | null };
}>;

export interface CompressWorkerOptions {
  /** Injectable transport (defaults to the global `fetch`). */
  fetchImpl?: FetchLike;
  /** Abort signal wired to every request. */
  signal?: AbortSignal;
  /** Status-poll cadence and ceiling (defaults suit an async production worker). */
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  /** Injectable delay so polling is instant under test. */
  sleep?: (ms: number) => Promise<void>;
  /** Called as the run moves between upload, queue, work and download. */
  onPhase?: (phase: WorkerJobPhase) => void;
}

const CONTENT_TYPE = "application/pdf";
const DEFAULT_POLL_INTERVAL_MS = 800;
const DEFAULT_MAX_POLL_ATTEMPTS = 150; // ~2 minutes at the default cadence

/** The global fetch, adapted to {@link FetchLike}. */
const defaultFetch: FetchLike = (input, init) =>
  fetch(input, init as RequestInit);

/** Copy bytes into a standalone ArrayBuffer — a concrete, portable request body. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/** Pull an honest message + code out of a non-OK response (see `./read-error`). */
async function readError(
  res: Awaited<ReturnType<FetchLike>>,
  fallback: string,
): Promise<CompressWorkerFailure> {
  const { readWorkerError } = await loadJobRun();
  return readWorkerError(res, fallback);
}

/**
 * Run a compression job on the secure worker and return the downloaded result
 * or an honest failure. Assumes the caller has already confirmed the worker is
 * available (see `GET /api/worker/status`); if it is not, this returns the
 * server's honest not-configured / not-implemented error rather than throwing.
 */
export async function runWorkerCompression(
  input: CompressWorkerInput,
  options: CompressWorkerOptions = {},
): Promise<CompressWorkerResult> {
  // The run's outcome is reported here, where every deep-compression job
  // passes — see `@/lib/telemetry/tool-outcome`. It was not, until the audit
  // after 6a2fc17: compress-pdf, the most-used tool, sent no outcome at all.
  return withToolOutcome(COMPRESS_TOOL, () =>
    runWorkerCompressionSteps(input, options),
  );
}

async function runWorkerCompressionSteps(
  input: CompressWorkerInput,
  options: CompressWorkerOptions,
): Promise<CompressWorkerResult> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const { signal } = options;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPollAttempts = options.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;

  // 1–2. Reserve a slot and upload the bytes to it — the one shared upload,
  //      with its timeout, one retry and plain-language failure
  //      (`./slot-upload`). The job uses the slot it RETURNS: a 403 may have
  //      moved the bytes to a fresh one.
  const { uploadToWorkerSlot, pollJobToTerminal } = await loadJobRun();
  const uploaded = await uploadToWorkerSlot({
    tool: COMPRESS_TOOL,
    filename: input.filename,
    contentType: CONTENT_TYPE,
    bytes: input.bytes,
    fetchImpl,
    ...(signal ? { signal } : {}),
    onUploading: () => options.onPhase?.("uploading"),
  });
  if (!uploaded.ok) return uploaded;
  const { slot } = uploaded;
  options.onPhase?.("uploaded");

  // 3. Create the job.
  const options_: Record<string, unknown> = { profile: input.profile };
  if (input.profile === "deep" && input.targetDpi !== undefined) {
    options_.targetDpi = input.targetDpi;
  }
  // Sent only when on, so a colour run's request is byte-for-byte what it was.
  if (input.profile === "deep" && input.grayscale === true) {
    options_.grayscale = true;
  }
  // Likewise only when set: a run with "No target" sends what it always did.
  if (input.profile === "deep" && input.targetBytes !== undefined) {
    options_.targetBytes = input.targetBytes;
  }
  const jobRes = await fetchImpl("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: toArrayBuffer(
      new TextEncoder().encode(
        JSON.stringify({
          tool: COMPRESS_TOOL,
          inputs: [slot.fileId],
          // Carry the original filename as display-only metadata so the worker
          // names the output after it. The server re-sanitizes it and never lets
          // it reach an object/broker key. Backward-compatible (optional field).
          inputNames: [input.filename],
          options: options_,
        }),
      ),
    ),
    signal,
  });
  if (!jobRes.ok) {
    return readError(jobRes, "The worker could not create the job.");
  }
  let job = (await jobRes.json()) as Job;

  // 4. Poll to a terminal state (a production worker is async; local-dev is
  //    already terminal on create, so this returns immediately).
  const polled = await pollJobToTerminal({
    job,
    fetchImpl,
    pollIntervalMs,
    maxPollAttempts,
    onStatus: forwardStatus(options.onPhase),
    ...(signal ? { signal } : {}),
    ...(options.sleep ? { sleepImpl: options.sleep } : {}),
  });
  if (!polled.ok) {
    return {
      ok: false,
      message: polled.stillRunning
        ? `${polled.message} (job ${polled.jobId})`
        : polled.message,
    };
  }
  job = polled.job;

  if (job.status !== "completed") {
    return {
      ok: false,
      message:
        job.error?.message ??
        `The job ended as "${job.status}" without producing a file.`,
      code: job.error?.code,
    };
  }

  const artifact = job.artifacts?.[0];
  if (!artifact) {
    return {
      ok: false,
      message: "The job completed but produced no artifact.",
    };
  }

  // 5. Download the real output.
  options.onPhase?.("downloading");
  const downloadRes = await fetchImpl(artifact.url, { signal });
  if (!downloadRes.ok) {
    return readError(downloadRes, "Downloading the compressed file failed.");
  }
  const output = new Uint8Array(await downloadRes.arrayBuffer());
  options.onPhase?.("done");

  return { ok: true, job, artifact, output };
}
