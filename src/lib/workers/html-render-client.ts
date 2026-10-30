import type { Job } from "@/lib/jobs/types";
import type { WorkerStatus } from "./status";
import {
  canRunPdfSecurity,
  finishSecurityJob,
  runSecurityJob,
  type FetchLike,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";
import { loadJobRun } from "./job-run-lazy";
import { withToolOutcome } from "@/lib/telemetry/tool-outcome";

const HTML_TO_PDF_TOOL = "html-to-pdf";
const WEBPAGE_TO_PDF_TOOL = "webpage-to-pdf";

export type HtmlRenderWorkerResult = PdfSecurityWorkerResult;

export interface HtmlRenderWorkerInput {
  filename: string;
  bytes: Uint8Array;
  /**
   * Page layout (`@/lib/jobs/html-render-options`), as the bag
   * `htmlRenderOptionsBag` builds: only what differs from the defaults, so
   * an unchanged layout sends the request this tool always sent.
   */
  layout?: Record<string, unknown>;
}

export async function runWorkerHtmlToPdf(
  input: HtmlRenderWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<HtmlRenderWorkerResult> {
  return runSecurityJob(
    HTML_TO_PDF_TOOL,
    input.filename,
    input.bytes,
    { ...input.layout },
    options,
  );
}

function jsonBody(value: unknown): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function readError(
  res: Awaited<ReturnType<FetchLike>>,
  fallback: string,
): Promise<PdfSecurityWorkerResult> {
  const { readWorkerError } = await loadJobRun();
  return readWorkerError(res, fallback);
}

const defaultFetch: FetchLike = (input, init) =>
  fetch(input, init as RequestInit);

export async function runWorkerWebpageToPdf(
  url: string,
  options: PdfSecurityWorkerOptions = {},
  layout: Record<string, unknown> = {},
): Promise<HtmlRenderWorkerResult> {
  // This lifecycle has no upload, so it does not pass through `runSecurityJob`
  // and must report its own outcome — see `@/lib/telemetry/tool-outcome`.
  return withToolOutcome(WEBPAGE_TO_PDF_TOOL, () =>
    runWorkerWebpageToPdfSteps(url, options, layout),
  );
}

async function runWorkerWebpageToPdfSteps(
  url: string,
  options: PdfSecurityWorkerOptions,
  layout: Record<string, unknown>,
): Promise<HtmlRenderWorkerResult> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;

  const jobRes = await fetchImpl("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // The address last, so no layout key can ever replace it.
    body: jsonBody({
      tool: WEBPAGE_TO_PDF_TOOL,
      inputs: [],
      options: { ...layout, url },
    }),
    signal: options.signal,
  });
  if (!jobRes.ok)
    return readError(jobRes, "The worker could not create the webpage job.");
  const job = (await jobRes.json()) as Job;
  options.onJobCreated?.(job.jobId);
  // The same wait-and-download half every other worker tool uses — and so
  // the same structured "still running" failure a panel can resume from. This
  // copy used to fold the job id into its message and drop it.
  return finishSecurityJob(WEBPAGE_TO_PDF_TOOL, job, options);
}

/** Remote worker readiness; local-dev cannot observe Chromium through WorkerStatus yet. */
export function canRunHtmlRender(
  status: WorkerStatus | null | undefined,
): boolean {
  if (!status) return false;
  if (status.localDevOnly) return false;
  return canRunPdfSecurity(status);
}
