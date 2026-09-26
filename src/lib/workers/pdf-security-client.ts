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
 * encryption/decryption. It is never logged, never put in a URL, and never stored;
 * the request is sent over the same origin as every other job call. It never
 * fabricates output: when qpdf isn't available on the worker, the first job call
 * returns the server's honest `not_implemented` / `worker_not_configured` error and
 * this driver surfaces it as a typed failure — never a fake protected/unlocked file.
 */

// Import from the leaf contract modules (not the "@/lib/jobs" barrel) so this
// browser module never pulls the server-side validators or the tools catalog into
// the client bundle. `isTerminalStatus` is the only runtime value used.
import type { Job, JobArtifact, UploadSession } from "@/lib/jobs/types";
import type { ApiError } from "@/lib/jobs/responses";
import type { PdfKeyLength } from "@/lib/jobs/pdf-security";
import type { WorkerStatus } from "./status";
import { pollJobToTerminal } from "./job-polling";
import { markUploadStarted } from "@/lib/uploads/session-uploads";
import { declaredContentTypeFor } from "@/lib/jobs/mime-by-format";
import {
  NO_SELECTABLE_TEXT_MESSAGE,
  readsOnlySelectableText,
} from "@/lib/jobs/ai-no-text";
import { withToolOutcome } from "@/lib/telemetry/tool-outcome";

const PROTECT_TOOL = "protect-pdf";
const UNLOCK_TOOL = "unlock-pdf";
const DEFAULT_POLL_INTERVAL_MS = 800;
const DEFAULT_MAX_POLL_ATTEMPTS = 150; // ~2 minutes at the default cadence.

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
  /** The password that currently opens the encrypted PDF. */
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

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "object" &&
    (value as { error: unknown }).error !== null
  );
}

/** Pull an honest message + code out of a non-OK response body. */
async function readError(
  res: Awaited<ReturnType<FetchLike>>,
  fallback: string,
): Promise<PdfSecurityWorkerFailure> {
  try {
    const body = await res.json();
    if (isApiError(body)) {
      return { ok: false, message: body.error.message, code: body.error.code };
    }
  } catch {
    // Non-JSON error body — fall through to the generic message.
  }
  return { ok: false, message: fallback };
}

/**
 * Shared driver: reserve an upload, upload the bytes, create the job with the given
 * (password-bearing) options, poll to a terminal state, and download the single
 * result. Returns the downloaded bytes or an honest, typed failure. The `options`
 * object is the ONLY place the password travels, and only in the job-create body.
 */
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
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPollAttempts = opts.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;

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
  const uploadRes = await fetchImpl(slot.url, {
    method: slot.method,
    headers: slot.headers,
    body: toArrayBuffer(bytes),
    signal,
  });
  if (!uploadRes.ok) {
    return readError(uploadRes, "Uploading the file to the worker failed.");
  }

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
  let job = (await jobRes.json()) as Job;

  // 4. Poll to a terminal state (a production worker is async; local-dev is already
  //    terminal on create, so this returns immediately).
  const polled = await pollJobToTerminal({
    job,
    fetchImpl,
    pollIntervalMs,
    maxPollAttempts,
    ...(signal ? { signal } : {}),
    ...(opts.sleep ? { sleepImpl: opts.sleep } : {}),
  });
  if (!polled.ok) {
    return {
      ok: false,
      message: polled.stillRunning
        ? `${polled.message} (job ${polled.jobId})`
        : polled.message,
      ...(polled.stillRunning ? { code: "timeout" } : {}),
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
    return { ok: false, message: "The job completed but produced no file." };
  }

  // 5. Download the real output.
  const downloadRes = await fetchImpl(artifact.url, { signal });
  if (!downloadRes.ok) {
    return readError(downloadRes, "Downloading the result failed.");
  }
  const output = new Uint8Array(await downloadRes.arrayBuffer());
  return { ok: true, job, artifact, output };
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
