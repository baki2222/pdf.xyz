import type { Job } from "@/lib/jobs/types";
import {
  finishSecurityJob,
  type FetchLike,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";
import { loadJobRun } from "./job-run-lazy";
import { withToolOutcome } from "@/lib/telemetry/tool-outcome";
import {
  HTML_ZIP_DECLARED_MIME,
  HTML_ZIP_ENTRY_OPTION,
} from "./html-render/zip-config";

/**
 * HTML to PDF's ZIP run: the one upload-and-wait lifecycle every worker tool
 * uses (`uploadToWorkerSlot` → `POST /api/jobs` → `finishSecurityJob`), with
 * two differences that are the whole reason this module exists:
 *
 *   - the upload is DECLARED `application/zip` — `runSecurityJob` declares a
 *     type from the file's extension through the catalogue's table, and a
 *     ZIP is not a catalogue format (`@/lib/jobs/validation`, which admits
 *     it for html-to-pdf alone);
 *   - the job carries `entry`, the page of the archive to print, so the job
 *     API can tell a ZIP job from an HTML one without reading the file.
 *
 * Its own module, loaded with the ZIP picker, so the shared runner every
 * worker tool page loads first (`./pdf-security-client`) did not grow for a
 * feature only HTML to PDF has.
 */

const HTML_TO_PDF_TOOL = "html-to-pdf";

export interface HtmlZipWorkerInput {
  filename: string;
  bytes: Uint8Array;
  /** The archive path of the page to print. */
  entry: string;
  /** Page layout, as `htmlRenderOptionsBag` builds it. */
  layout?: Record<string, unknown>;
}

const defaultFetch: FetchLike = (input, init) =>
  fetch(input, init as RequestInit);

function jsonBody(value: unknown): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export async function runWorkerHtmlZipToPdf(
  input: HtmlZipWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<PdfSecurityWorkerResult> {
  // Its own lifecycle, so it reports its own outcome
  // (`@/lib/telemetry/tool-outcome`), as `runSecurityJob` does for a file.
  return withToolOutcome(HTML_TO_PDF_TOOL, () =>
    runWorkerHtmlZipSteps(input, options),
  );
}

async function runWorkerHtmlZipSteps(
  input: HtmlZipWorkerInput,
  opts: PdfSecurityWorkerOptions,
): Promise<PdfSecurityWorkerResult> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const { signal } = opts;
  const {
    uploadToWorkerSlot,
    workerFileCeilingBytes,
    describeByteCeiling,
    readWorkerError,
  } = await loadJobRun();
  const ceiling = workerFileCeilingBytes(HTML_TO_PDF_TOOL);
  if (input.bytes.byteLength > ceiling)
    return {
      ok: false,
      code: "payload_too_large",
      message: `This file is larger than ${describeByteCeiling(ceiling)}, the most this tool accepts per file. Nothing was uploaded.`,
    };
  const uploaded = await uploadToWorkerSlot({
    tool: HTML_TO_PDF_TOOL,
    filename: input.filename,
    contentType: HTML_ZIP_DECLARED_MIME,
    bytes: input.bytes,
    fetchImpl,
    ...(signal ? { signal } : {}),
    onUploading: () => opts.onPhase?.("uploading"),
  });
  if (!uploaded.ok) return uploaded;
  opts.onPhase?.("uploaded");

  const jobRes = await fetchImpl("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: jsonBody({
      tool: HTML_TO_PDF_TOOL,
      inputs: [uploaded.slot.fileId],
      inputNames: [input.filename],
      // The page last, so no layout key can ever replace it.
      options: { ...input.layout, [HTML_ZIP_ENTRY_OPTION]: input.entry },
    }),
    signal,
  });
  if (!jobRes.ok)
    return readWorkerError(jobRes, "The worker could not create the job.");
  const job = (await jobRes.json()) as Job;
  opts.onJobCreated?.(job.jobId);
  return finishSecurityJob(HTML_TO_PDF_TOOL, job, opts);
}
