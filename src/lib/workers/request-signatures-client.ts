import type { WorkerStatus } from "./status";
import { canRunPdfSecurity, runSecurityJob, type PdfSecurityWorkerOptions, type PdfSecurityWorkerResult } from "./pdf-security-client";
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

export function runWorkerRequestSignatures(
  input: RequestSignaturesWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<RequestSignaturesWorkerResult> {
  const jobOptions: Record<string, unknown> = {
    signers: input.signers,
    fields: input.fields,
  };
  if (input.routing !== undefined) jobOptions.routing = input.routing;
  if (input.title !== undefined) jobOptions.title = input.title;
  if (input.message !== undefined) jobOptions.message = input.message;
  if (input.deliver !== undefined) jobOptions.deliver = input.deliver;
  return runSecurityJob("request-signatures", input.filename, input.bytes, jobOptions, options);
}

/**
 * True when the UI may offer the secure-worker Request Signatures flow. Mirrors the
 * table-extract gate: the pdf-lib preparer lives on the remote worker, so local-dev
 * (whose probes are about native binaries) never advertises it, and
 * staging/production gate on storage + queue + a drainable daemon.
 */
export function canRunRequestSignatures(status: WorkerStatus | null | undefined): boolean {
  if (!status) return false;
  if (status.localDevOnly) return false;
  return canRunPdfSecurity(status);
}
