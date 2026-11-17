import type { WorkerStatus } from "./status";
import {
  canRunPdfSecurity,
  runSecurityJob,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";
import type {
  RequestSignatureField,
  RequestSignatureRouting,
  RequestSigner,
} from "@/lib/jobs/request-signatures";

/**
 * Browser-side driver for the secure-worker Request Signatures flow
 * (`request-signatures`).
 *
 * It reuses the shared job lifecycle in `./pdf-security-client` (create upload →
 * upload → create job → poll → download) — the request definition (signers, fields,
 * routing) travels in the job's `options` body. It never fabricates output: when
 * the worker can't prepare the package (or external delivery is requested without a
 * configured provider) it surfaces the server's honest typed error, never a fake
 * "signed" document.
 */

export type RequestSignaturesWorkerResult = PdfSecurityWorkerResult;

export interface RequestSignaturesWorkerInput {
  filename: string;
  bytes: Uint8Array;
  signers: RequestSigner[];
  fields: RequestSignatureField[];
  routing?: RequestSignatureRouting;
  title?: string;
  message?: string;
  /** Ask for external provider-backed delivery; fails honestly if none is configured. */
  deliver?: boolean;
}

/**
 * Free text as the worker takes it: its parser refuses any C0 control
 * character or DEL (`parseText`), and a textarea makes line breaks likely, so
 * each run of them becomes one space. Blank after that means "not given".
 */
const sendable = (text: string | undefined) =>
  text?.replace(/[\u0000-\u001F\u007F]+/g, " ").trim() || undefined;

/**
 * The exact `options` object a request's job is created with — one
 * definition, so the panel can measure the bytes the server's 8 KB options
 * ceiling will measure (`JOB_LIMITS.maxOptionsBytes`) before anything is
 * uploaded, instead of a copy that could drift from what is sent. Title,
 * message and box labels go through {@link sendable}; a field without a label
 * is passed through as the same object, so an untouched layout is sent
 * byte for byte as before.
 */
export function requestSignaturesJobOptions(
  input: Omit<RequestSignaturesWorkerInput, "filename" | "bytes">,
): Record<string, unknown> {
  const jobOptions: Record<string, unknown> = {
    signers: input.signers,
    fields: input.fields.map((field) => {
      if (field.label === undefined) return field;
      const { label, ...rest } = field;
      const text = sendable(label);
      return text ? { ...rest, label: text } : rest;
    }),
  };
  if (input.routing !== undefined) jobOptions.routing = input.routing;
  const title = sendable(input.title);
  if (title !== undefined) jobOptions.title = title;
  const message = sendable(input.message);
  if (message !== undefined) jobOptions.message = message;
  if (input.deliver !== undefined) jobOptions.deliver = input.deliver;
  return jobOptions;
}

export function runWorkerRequestSignatures(
  input: RequestSignaturesWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<RequestSignaturesWorkerResult> {
  return runSecurityJob(
    "request-signatures",
    input.filename,
    input.bytes,
    requestSignaturesJobOptions(input),
    options,
  );
}

/**
 * True when the UI may offer the secure-worker Request Signatures flow. Mirrors the
 * table-extract gate: the pdf-lib preparer lives on the remote worker, so local-dev
 * (whose probes are about native binaries) never advertises it, and
 * staging/production gate on storage + queue + a drainable daemon.
 */
export function canRunRequestSignatures(
  status: WorkerStatus | null | undefined,
): boolean {
  if (!status) return false;
  if (status.localDevOnly) return false;
  return canRunPdfSecurity(status);
}
