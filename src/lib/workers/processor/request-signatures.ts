/**
 * The Request Signatures {@link Processor}: the pdf-lib-backed signature-request
 * *preparation* engine (`../request-signatures/engine`) wrapped behind the shared
 * processor contract, so the worker executor and the local-dev adapter dispatch
 * **Request Signatures** exactly like any other secure-worker capability.
 *
 * It changes none of the engine's honesty guarantees: the package status is always
 * `prepared` (never "signed"/"completed"), and a request that asks for external
 * delivery without a configured e-signature provider fails as `not_implemented`
 * with clear operator requirements — never a fabricated "sent" result. The pdf-lib
 * preparer is injected (the same {@link SignatureRequestDeps} the engine takes), so
 * this module stays free of Node built-ins and is fully unit-testable.
 */

import type { JobError } from "@/lib/jobs";
import {
  parseSignatureRequestOptions,
  signatureRequestOutputName,
} from "@/lib/jobs/request-signatures";
import {
  REQUEST_SIGNATURES_TOOL,
  runSignatureRequest,
  type SignatureRequestDeps,
  type SignatureRequestMeta,
  type SignatureRequestRun,
} from "../request-signatures/engine";
import {
  processorFail,
  processorOk,
  type Processor,
  type ProcessorMeta,
  type ProcessorResult,
} from "./types";

type Failure = Extract<SignatureRequestRun, { ok: false }>;

/** Deterministic output name for the request package (re-exported for tests/UI). */
export function requestSignaturesOutputName(originalName: unknown): string {
  return signatureRequestOutputName(originalName);
}

function jobError(run: Failure): JobError {
  switch (run.kind) {
    case "unsupported":
      return {
        code: "not_implemented",
        message: `${run.message} See docs/WORKER_ARCHITECTURE.md.`,
        retryable: false,
      };
    case "delivery_unconfigured":
      return {
        code: "not_implemented",
        message: `${run.message} See docs/WORKER_ARCHITECTURE.md.`,
        retryable: false,
      };
    case "too_large":
      return {
        code: "payload_too_large",
        message: run.message,
        retryable: false,
      };
    case "invalid_request":
      return {
        code: "unprocessable_entity",
        message: run.message,
        retryable: false,
      };
    case "failed":
    default:
      return { code: "internal_error", message: run.message, retryable: true };
  }
}

function meta(m: SignatureRequestMeta): ProcessorMeta {
  return {
    engine: m.engine,
    tool: m.tool,
    signerCount: m.signerCount,
    fieldCount: m.fieldCount,
    pageCount: m.pageCount,
    inputBytes: m.inputBytes,
    outputBytes: m.outputBytes,
  };
}

export function createRequestSignaturesProcessor(
  deps: SignatureRequestDeps,
): Processor {
  const ready = deps.inspect != null && deps.place != null;
  return {
    id: "request-signatures",
    tools: [REQUEST_SIGNATURES_TOOL],
    supports(tool) {
      return tool === REQUEST_SIGNATURES_TOOL;
    },
    capability() {
      return {
        id: "request-signatures",
        tools: [REQUEST_SIGNATURES_TOOL],
        ready,
        detail: ready
          ? "Request Signatures ready: a PDF is prepared with real fillable fields for each signer and packaged as a signature-request ZIP (prepared PDF + manifest + audit trail) on an auto-deleting secure worker. Delivery/collection needs a configured e-signature provider."
          : "Request Signatures needs the PDF form preparer, which isn't available on this worker.",
      };
    },
    async process(input): Promise<ProcessorResult> {
      if (input.tool !== REQUEST_SIGNATURES_TOOL) {
        return processorFail({
          code: "not_implemented",
          message: "This processor only handles request-signatures.",
          retryable: false,
        });
      }
      const file = input.inputs[0];
      if (input.inputs.length !== 1 || !file) {
        return processorFail({
          code: "unprocessable_entity",
          message: "Request Signatures accepts exactly one PDF input.",
          retryable: false,
        });
      }
      const parsed = parseSignatureRequestOptions(input.options);
      if (!parsed.ok) {
        return processorFail({
          code: parsed.error.body.error.code,
          message: parsed.error.body.error.message,
          retryable: false,
        });
      }
      const run = await runSignatureRequest(file.bytes, parsed.value, deps);
      if (!run.ok) return processorFail(jobError(run));
      return processorOk(
        [
          {
            filename: requestSignaturesOutputName(file.filename),
            contentType: run.contentType,
            bytes: run.output,
          },
        ],
        meta(run.meta),
      );
    },
  };
}
