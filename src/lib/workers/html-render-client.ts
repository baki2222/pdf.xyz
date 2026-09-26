import type { Job, JobArtifact } from "@/lib/jobs/types";
import type { ApiError } from "@/lib/jobs/responses";
import type { WorkerStatus } from "./status";
import {
  canRunPdfSecurity,
  runSecurityJob,
  type FetchLike,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";
import { pollJobToTerminal } from "./job-polling";
import { withToolOutcome } from "@/lib/telemetry/tool-outcome";

const HTML_TO_PDF_TOOL = "html-to-pdf";
const WEBPAGE_TO_PDF_TOOL = "webpage-to-pdf";
const DEFAULT_POLL_INTERVAL_MS = 800;
const DEFAULT_MAX_POLL_ATTEMPTS = 150;

export type HtmlRenderWorkerResult = PdfSecurityWorkerResult;

export interface HtmlRenderWorkerInput {
  filename: string;
  bytes: Uint8Array;
}

export async function runWorkerHtmlToPdf(
  input: HtmlRenderWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<HtmlRenderWorkerResult> {
  return runSecurityJob(
    HTML_TO_PDF_TOOL,
    input.filename,
    input.bytes,
    {},
    options,
  );
}

function jsonBody(value: unknown): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function isApiError(value: unknown): value is ApiError {
  return typeof value === "object" && value !== null && "error" in value;
}

async function readError(
  res: Awaited<ReturnType<FetchLike>>,
  fallback: string,
): Promise<PdfSecurityWorkerResult> {
  try {
    const body = await res.json();
    if (isApiError(body))
      return { ok: false, message: body.error.message, code: body.error.code };
  } catch {}
  return { ok: false, message: fallback };
}

const defaultFetch: FetchLike = (input, init) =>
  fetch(input, init as RequestInit);

export async function runWorkerWebpageToPdf(
  url: string,
  options: PdfSecurityWorkerOptions = {},
): Promise<HtmlRenderWorkerResult> {
  // This lifecycle has no upload, so it does not pass through `runSecurityJob`
  // and must report its own outcome — see `@/lib/telemetry/tool-outcome`.
  return withToolOutcome(WEBPAGE_TO_PDF_TOOL, () =>
    runWorkerWebpageToPdfSteps(url, options),
  );
}

async function runWorkerWebpageToPdfSteps(
  url: string,
  options: PdfSecurityWorkerOptions,
): Promise<HtmlRenderWorkerResult> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPollAttempts = options.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;

  const jobRes = await fetchImpl("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: jsonBody({ tool: WEBPAGE_TO_PDF_TOOL, inputs: [], options: { url } }),
    signal: options.signal,
  });
  if (!jobRes.ok)
    return readError(jobRes, "The worker could not create the webpage job.");
  let job = (await jobRes.json()) as Job;
  const polled = await pollJobToTerminal({
    job,
    fetchImpl,
    pollIntervalMs,
    maxPollAttempts,
    ...(options.signal ? { signal: options.signal } : {}),
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
        `The job ended as "${job.status}" without producing a result.`,
      code: job.error?.code,
    };
  }
  const artifact: JobArtifact | undefined = job.artifacts?.[0];
  if (!artifact)
    return { ok: false, message: "The job completed but produced no output." };
  const out = await fetchImpl(artifact.url, { signal: options.signal });
  if (!out.ok) return readError(out, "Downloading the PDF result failed.");
  return {
    ok: true,
    job,
    artifact,
    output: new Uint8Array(await out.arrayBuffer()),
  };
}

/** Remote worker readiness; local-dev cannot observe Chromium through WorkerStatus yet. */
export function canRunHtmlRender(
  status: WorkerStatus | null | undefined,
): boolean {
  if (!status) return false;
  if (status.localDevOnly) return false;
  return canRunPdfSecurity(status);
}
