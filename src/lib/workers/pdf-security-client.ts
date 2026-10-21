/**
 * Browser-side driver for the secure-worker PDF security flow (Protect / Unlock).
 *
 * This is the security counterpart to the compression client in `./client.ts` and
 * the OCR client in `./ocr-client.ts`. It runs the full documented job lifecycle
 * against the same endpoints a production worker exposes — create upload session →
 * direct upload → create job → poll status → download artifact — and returns an
 * honest, typed result. It uses nothing but `fetch` and the shared contract
 * *types*, so it is safe in a client component and fully unit-testable with an
 * injected `fetch`.
 *
 * Password handling on the client: the password is placed ONLY in the job
 * request's `options` body, which is exactly what the worker needs to perform the
 * encryption/decryption. It is never logged and never put in a URL. It IS stored
 * — in the job's queue spec, until FINALIZE deletes it (complete, fail, cancel,
 * expire) or the queue TTL lapses — sealed to the worker's key when the operator
 * has configured one (`../workers/queue/sealed-options.ts`). Until 2026-09 this
 * line said "never stored", and the panel repeated it to users. It never
 * fabricates output: when qpdf isn't available on the worker, the first job call
 * returns the server's honest `not_implemented` / `worker_not_configured` error and
 * this driver surfaces it as a typed failure — never a fake protected/unlocked file.
 */

// Import from the leaf contract modules (not the "@/lib/jobs" barrel) so this
// browser module never pulls the server-side validators or the tools catalog into
// the client bundle. `isTerminalStatus` is the only runtime value used.
import type { Job, JobArtifact, UploadSession } from "@/lib/jobs/types";
import type { PdfKeyLength } from "@/lib/jobs/pdf-security";
import type { WorkerStatus } from "./status";
import { pollJobToTerminal, type WorkerJobPhase } from "./job-polling";
import { forwardStatus } from "./phases";
import { jobPollFor } from "@/lib/jobs/client-wait";
import { markUploadStarted } from "@/lib/uploads/session-uploads";
import { declaredContentTypeFor } from "@/lib/jobs/mime-by-format";
import {
  describeByteCeiling,
  workerFileCeilingBytes,
} from "./engine-file-ceilings";
import { readWorkerError } from "./read-error";
import {
  NO_SELECTABLE_TEXT_MESSAGE,
  readsOnlySelectableText,
} from "@/lib/jobs/ai-no-text";
import { withToolOutcome } from "@/lib/telemetry/tool-outcome";

const PROTECT_TOOL = "protect-pdf";
const UNLOCK_TOOL = "unlock-pdf";

/** What the caller wants protected, and how. */
export interface ProtectWorkerInput {
  filename: string;
  bytes: Uint8Array;
  /** The user/open password (required to open the resulting PDF). */
  password: string;
  /** Optional owner/permissions password; defaults to the user password server-side. */
  ownerPassword?: string;
  /** Encryption strength; defaults to AES-256 server-side. */
  keyLength?: PdfKeyLength;
}

/** What the caller wants unlocked. */
export interface UnlockWorkerInput {
  filename: string;
  bytes: Uint8Array;
  /**
   * The password that opens the encrypted PDF — or, for one that opens without
   * a password and only restricts printing/copying/editing, its owner password.
   */
  password: string;
}

export interface PdfSecurityWorkerSuccess {
  ok: true;
  job: Job;
  artifact: JobArtifact;
  /** The real, downloaded output bytes. */
  output: Uint8Array;
}

export interface PdfSecurityWorkerFailure {
  ok: false;
  /** A client-safe, honest message (from the server's typed error when present). */
  message: string;
  /**
   * The contract error code or job error code, when one is available — or
   * `timeout` when polling stopped while the job was still running. Read by
   * the `tool_failed` telemetry (`toolErrorReason`), never shown to a user.
   */
  code?: string;
  /**
   * The job this failure is about, once one exists. It used to be folded into
   * the message as "(job job_…)" — text a user could read and nothing could
   * act on.
   */
  jobId?: string;
  /**
   * True when the client stopped WAITING, not when the job failed: it may
   * still finish, and {@link resumeSecurityJob} picks it up by `jobId`.
   */
  stillRunning?: boolean;
}

export type PdfSecurityWorkerResult =
  PdfSecurityWorkerSuccess | PdfSecurityWorkerFailure;

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

export interface PdfSecurityWorkerOptions {
  /** Injectable transport (defaults to the global `fetch`). */
  fetchImpl?: FetchLike;
  /** Abort signal wired to every request. */
  signal?: AbortSignal;
  /** Status-poll cadence and ceiling (defaults suit an async production worker). */
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  /** Injectable delay so polling is instant under test. */
  sleep?: (ms: number) => Promise<void>;
  /** Called once the job exists, with its id — what a Cancel button needs. */
  onJobCreated?: (jobId: string) => void;
  /** Called as the run moves between upload, queue, work and download. */
  onPhase?: (phase: WorkerJobPhase) => void;
}

const defaultFetch: FetchLike = (input, init) =>
  fetch(input, init as RequestInit);

/** Copy bytes into a standalone ArrayBuffer — a concrete, portable request body. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function jsonBody(value: unknown): ArrayBuffer {
  return toArrayBuffer(new TextEncoder().encode(JSON.stringify(value)));
}

/** Pull an honest message + code out of a non-OK response (see `./read-error`). */
async function readError(
  res: Awaited<ReturnType<FetchLike>>,
  fallback: string,
): Promise<PdfSecurityWorkerFailure> {
  return readWorkerError(res, fallback);
}

/**
 * Whether the PDF has selectable text: `true`, `false`, or `undefined` when the
 * browser could not tell (an encrypted or damaged file pdfjs cannot open).
 * Only a definite `false` refuses — a verdict the browser never reached is left
 * to the worker. pdfjs is imported on demand so a panel that never runs an AI
 * job never downloads it.
 */
async function selectableTextVerdict(
  bytes: Uint8Array,
): Promise<boolean | undefined> {
  try {
    const { pdfHasSelectableText } = await import("@/lib/pdf/text");
    return await pdfHasSelectableText(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Shared driver: reserve an upload, upload the bytes, create the job with the given
 * (password-bearing) options, poll to a terminal state, and download the single
 * result. Returns the downloaded bytes or an honest, typed failure. The `options`
 * object is the ONLY place the password travels, and only in the job-create body.
 */
export async function runSecurityJob(
  tool: string,
  filename: string,
  bytes: Uint8Array,
  options: Record<string, unknown>,
  opts: PdfSecurityWorkerOptions,
  /**
   * Characters of selectable text the caller counted, when it could. Travels to
   * the route so an AI job reserves what it will use instead of a whole
   * per-call ceiling. Omitted by callers that cannot count.
   */
  declaredCharacters?: number,
  /**
   * Pages WITH TEXT the caller counted. The exact half of the delivery cap —
   * both extractors read the same page tree, so unlike the character count this
   * one needs no headroom. Omitted by callers that cannot count.
   */
  declaredTextPages?: number,
): Promise<PdfSecurityWorkerResult> {
  // Every panel that runs a worker job comes through here, so this is where
  // its outcome is reported — see `@/lib/telemetry/tool-outcome`.
  return withToolOutcome(tool, () =>
    runSecurityJobSteps(
      tool,
      filename,
      bytes,
      options,
      opts,
      declaredCharacters,
      declaredTextPages,
    ),
  );
}

async function runSecurityJobSteps(
  tool: string,
  filename: string,
  bytes: Uint8Array,
  options: Record<string, unknown>,
  opts: PdfSecurityWorkerOptions,
  declaredCharacters?: number,
  declaredTextPages?: number,
): Promise<PdfSecurityWorkerResult> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const { signal } = opts;

  // 0. A tool that reads only selectable text cannot do anything with a PDF
  //    that has none — and asking the worker costs the user a whole upload AND
  //    a reservation of their daily AI allowance that a worker-side refusal
  //    never gives back (three scans locked a connection out for the day,
  //    audit at 67e8d0f). So the browser asks first, and answers with the
  //    worker's own words (`@/lib/jobs/ai-no-text`).
  if (readsOnlySelectableText(tool)) {
    const hasText = await selectableTextVerdict(bytes);
    if (hasText === false) {
      return {
        ok: false,
        message: NO_SELECTABLE_TEXT_MESSAGE[tool],
        // The code the worker's own `no_text` refusal maps to.
        code: "unprocessable_entity",
      };
    }
  }

  // 1. Reserve an upload slot for exactly this file.
  //
  // The declared type comes from the file's extension through the same table
  // the server validates against. It WAS a constant `application/pdf`, written
  // when this runner served only Protect and Unlock; once Word, Excel,
  // PowerPoint and HTML to PDF reused it, every one of their uploads was
  // refused with 415 before a byte moved (see `@/lib/jobs/mime-by-format`).
  const contentType = declaredContentTypeFor(filename);
  if (!contentType) {
    return {
      ok: false,
      message: "This tool doesn't accept that file type.",
      code: "unsupported_file_type",
    };
  }
  // Refused HERE, before a request is made, when the file is over what this
  // tool's engine accepts — the number its page states. The upload API refuses
  // the same file too; this is the half that can say so in words, without
  // `files[0].bytes`, and without the file ever being offered to the network.
  const ceiling = workerFileCeilingBytes(tool);
  if (bytes.byteLength > ceiling) {
    return {
      ok: false,
      code: "payload_too_large",
      message: `This file is larger than ${describeByteCeiling(ceiling)}, the most this tool accepts per file. Nothing was uploaded.`,
    };
  }
  const sessionRes = await fetchImpl("/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: jsonBody({
      tool,
      files: [{ filename, contentType, bytes: bytes.byteLength }],
    }),
    signal,
  });
  if (!sessionRes.ok) {
    return readError(sessionRes, "Could not start an upload session.");
  }
  const session = (await sessionRes.json()) as UploadSession;
  const slot = session.slots[0];
  if (!slot) {
    return { ok: false, message: "The worker did not return an upload slot." };
  }

  // 2. Upload the bytes directly to the slot the worker minted. Flag it before
  //    the request, not after: once bytes are on the wire a crash fallback can
  //    no longer honestly claim the file never left the device.
  markUploadStarted();
  opts.onPhase?.("uploading");
  const uploadRes = await fetchImpl(slot.url, {
    method: slot.method,
    headers: slot.headers,
    body: toArrayBuffer(bytes),
    signal,
  });
  if (!uploadRes.ok) {
    return readError(uploadRes, "Uploading the file to the worker failed.");
  }
  opts.onPhase?.("uploaded");

  // 3. Create the job with the validated options (this body carries the password).
  const jobRes = await fetchImpl("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: jsonBody({
      tool,
      inputs: [slot.fileId],
      // Display-only original name so the worker names the output after it; the
      // server re-sanitizes it and never lets it reach a key or path.
      inputNames: [filename],
      options,
      ...(declaredCharacters !== undefined ? { declaredCharacters } : {}),
      ...(declaredTextPages !== undefined ? { declaredTextPages } : {}),
    }),
    signal,
  });
  if (!jobRes.ok) {
    return readError(jobRes, "The worker could not create the job.");
  }
  const job = (await jobRes.json()) as Job;
  opts.onJobCreated?.(job.jobId);

  // 4–5. Wait for it and download the result — the half a resume re-enters.
  return finishSecurityJob(tool, job, opts);
}

/**
 * Wait for `job` to finish and download its single result. Shared by a fresh
 * run and by {@link resumeSecurityJob}, so the two cannot drift apart.
 *
 * The wait is `jobPollFor(tool)` unless the caller names one: an AI job gets
 * the AI budget here, in one place, rather than in each of four clients.
 */
export async function finishSecurityJob(
  tool: string,
  started: Job,
  opts: PdfSecurityWorkerOptions,
): Promise<PdfSecurityWorkerResult> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const { signal } = opts;
  const budget = jobPollFor(tool);

  // 4. Poll to a terminal state (a production worker is async; local-dev is already
  //    terminal on create, so this returns immediately).
  const polled = await pollJobToTerminal({
    job: started,
    fetchImpl,
    pollIntervalMs: opts.pollIntervalMs ?? budget.intervalMs,
    maxPollAttempts: opts.maxPollAttempts ?? budget.maxAttempts,
    onStatus: forwardStatus(opts.onPhase),
    ...(signal ? { signal } : {}),
    ...(opts.sleep ? { sleepImpl: opts.sleep } : {}),
  });
  if (!polled.ok) {
    // The id travels as DATA. Folded into the message it was text a user
    // could read and nothing could act on, so a job that finished a minute
    // later was unreachable.
    return {
      ok: false,
      message: polled.message,
      jobId: polled.jobId,
      // `timeout` is read by the `tool_failed` telemetry only; the resume path
      // reads `stillRunning`.
      ...(polled.stillRunning ? { stillRunning: true, code: "timeout" } : {}),
    };
  }
  const job = polled.job;

  if (job.status !== "completed") {
    return {
      ok: false,
      message:
        job.error?.message ??
        `The job ended as "${job.status}" without producing a file.`,
      code: job.error?.code,
      jobId: job.jobId,
    };
  }

  const artifact = job.artifacts?.[0];
  if (!artifact) {
    return {
      ok: false,
      message: "The job completed but produced no file.",
      jobId: job.jobId,
    };
  }

  // 5. Download the real output.
  opts.onPhase?.("downloading");
  const downloadRes = await fetchImpl(artifact.url, { signal });
  if (!downloadRes.ok) {
    return readError(downloadRes, "Downloading the result failed.");
  }
  const output = new Uint8Array(await downloadRes.arrayBuffer());
  opts.onPhase?.("done");
  return { ok: true, job, artifact, output };
}

/**
 * Pick up a job this browser stopped waiting for — by id, with no new upload,
 * no new job and no new charge — and download its result when it finishes.
 * Returns the same result shape as the run that created it.
 *
 * It reports how the job ENDED, like the run that started it: that run
 * reported `timeout` when it stopped waiting, and without this the finish a
 * reader went back for — the result they downloaded — was never counted.
 */
export function resumeSecurityJob(
  jobId: string,
  opts: PdfSecurityWorkerOptions & { tool?: string } = {},
): Promise<PdfSecurityWorkerResult> {
  const tool = opts.tool ?? "";
  // "processing" so the first read happens after one interval: the job was
  // already running when the previous wait ended.
  const job = { jobId, status: "processing" } as Job;
  return withToolOutcome(tool, () => finishSecurityJob(tool, job, opts));
}

/**
 * Encrypt a PDF on the secure worker and return the downloaded, protected file or
 * an honest failure. Assumes the caller has already confirmed the worker is
 * available (see `GET /api/worker/status` → `status.security`); otherwise this
 * returns the server's honest error rather than throwing.
 */
export async function runWorkerProtect(
  input: ProtectWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<PdfSecurityWorkerResult> {
  const jobOptions: Record<string, unknown> = { password: input.password };
  if (input.ownerPassword !== undefined) {
    jobOptions.ownerPassword = input.ownerPassword;
  }
  if (input.keyLength !== undefined) jobOptions.keyLength = input.keyLength;
  return runSecurityJob(
    PROTECT_TOOL,
    input.filename,
    input.bytes,
    jobOptions,
    options,
  );
}

/**
 * Remove the password from a PDF on the secure worker and return the downloaded,
 * unlocked file or an honest failure (e.g. a wrong password comes back as the
 * server's typed `unprocessable_entity`). Assumes availability was confirmed first.
 */
export async function runWorkerUnlock(
  input: UnlockWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<PdfSecurityWorkerResult> {
  return runSecurityJob(
    UNLOCK_TOOL,
    input.filename,
    input.bytes,
    { password: input.password },
    options,
  );
}

/**
 * True when the UI may offer the secure-worker protect/unlock flow. Mirrors
 * `canRunDeepCompression`: local-dev is honest about the actual qpdf probe
 * (`status.security.available`), while staging/production gate on configured
 * storage + queue + a drainable daemon — the web process can't see the remote
 * worker's binaries, so it lets the job run there (and fail honestly if qpdf is
 * missing) rather than trapping the user behind a capability it can't observe.
 */
export function canRunPdfSecurity(
  status: WorkerStatus | null | undefined,
): boolean {
  if (!status) return false;
  if (status.localDevOnly) return status.security.available;
  return Boolean(
    status.providers.storage.ready &&
    status.providers.queue.ready &&
    status.daemon.drainable,
  );
}
