/**
 * The PDF security {@link Processor}: the qpdf-backed protect/unlock engine
 * (`../pdf-security/engine`) wrapped behind the shared processor contract, so the
 * worker executor and the local-dev adapter dispatch **Protect PDF** and **Unlock
 * PDF** exactly like any other secure-worker capability.
 *
 * It changes none of the engine's honesty guarantees. Encryption and decryption
 * genuinely require the native qpdf binary; when it isn't wired the processor
 * returns a typed `not_implemented` failure — never a fabricated "protected" or
 * "unlocked" file. The qpdf runner is injected (the same {@link PdfSecurityDeps}
 * the engine takes), so this module stays free of Node built-ins and is fully
 * unit-testable without shipping a binary.
 *
 * Password discipline: the validated password lives in `input.options`, is parsed
 * here into typed options, and is handed straight to the engine. It is NEVER placed
 * in the success metadata, an artifact name, or ANY error message this module
 * returns — every failure below is content-free.
 */

import type { JobError } from "@/lib/jobs";
import {
  parseProtectPdfOptions,
  parseUnlockPdfOptions,
  protectedOutputName,
  unlockedOutputName,
} from "@/lib/jobs/pdf-security";
import {
  PDF_SECURITY_TOOLS,
  PROTECT_TOOL,
  UNLOCK_TOOL,
  runProtect,
  runUnlock,
  type PdfSecurityDeps,
  type PdfSecurityResultMeta,
  type PdfSecurityRun,
} from "../pdf-security/engine";
import {
  processorFail,
  processorOk,
  type Processor,
  type ProcessorMeta,
  type ProcessorResult,
} from "./types";

const OUTPUT_CONTENT_TYPE = "application/pdf";

type PdfSecurityFailure = Extract<PdfSecurityRun, { ok: false }>;

/**
 * Map an honest engine failure to a typed, client-safe job error. Every mode is
 * non-retryable except a genuine engine crash (`failed`), which MAY be transient:
 *  - `unsupported` → `not_implemented` (retrying won't install qpdf);
 *  - `too_large` → `payload_too_large` (retrying the same bytes can't shrink them);
 *  - `invalid_pdf` / `already_encrypted` / `restrictions_only` / `not_encrypted` /
 *    `wrong_password` → `unprocessable_entity` (a deterministic property of THIS
 *    input/request);
 *  - `failed` → retryable `internal_error` (a transient worker failure the executor
 *    may re-attempt, bounded by the attempt cap).
 * The message is the engine's fixed, content-free string — never a password.
 *
 * Exhaustive by type. The `default` arm used to share `failed`'s return, so a
 * newly added kind landed there silently as a RETRYABLE internal error — a
 * deterministic refusal re-run up to the attempt cap and then reported as a
 * crash. It is now a `never` check: a new kind fails `tsc` until it is mapped.
 */
export function pdfSecurityJobError(run: PdfSecurityFailure): JobError {
  switch (run.kind) {
    case "unsupported":
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
    case "invalid_pdf":
    case "already_encrypted":
    case "restrictions_only":
    case "not_encrypted":
    case "wrong_password":
      return {
        code: "unprocessable_entity",
        message: run.message,
        retryable: false,
      };
    case "failed":
      return { code: "internal_error", message: run.message, retryable: true };
    default: {
      // Unreachable while the switch is exhaustive; `tsc` enforces that. At
      // runtime a kind from a newer engine still yields a well-formed error.
      const unmapped: never = run;
      return {
        code: "internal_error",
        message: (unmapped as PdfSecurityFailure).message,
        retryable: false,
      };
    }
  }
}

/** Flatten the engine's content-free run meta to the flat processor logging meta. */
function toProcessorMeta(meta: PdfSecurityResultMeta): ProcessorMeta {
  const flat: ProcessorMeta = {
    engine: meta.engine,
    operation: meta.operation,
    inputBytes: meta.inputBytes,
    outputBytes: meta.outputBytes,
  };
  if (meta.keyLength !== undefined) flat.keyLength = meta.keyLength;
  return flat;
}

/**
 * Build the PDF security processor over the host's qpdf dependencies.
 * `capability().ready` is true only when a qpdf runner is wired (the engine can
 * actually encrypt/decrypt here); the detail states honestly whether it can run.
 */
export function createPdfSecurityProcessor(deps: PdfSecurityDeps): Processor {
  const ready = deps.qpdf != null;

  return {
    id: "pdf-security",
    tools: [...PDF_SECURITY_TOOLS],

    supports(tool) {
      return tool === PROTECT_TOOL || tool === UNLOCK_TOOL;
    },

    capability() {
      return {
        id: "pdf-security",
        tools: [...PDF_SECURITY_TOOLS],
        ready,
        detail: ready
          ? "PDF password protection ready: encrypt and unlock with qpdf on an encrypted, auto-deleting secure worker."
          : "PDF password protection needs the native qpdf engine, which isn't installed on this worker.",
      };
    },

    async process(input): Promise<ProcessorResult> {
      if (input.tool !== PROTECT_TOOL && input.tool !== UNLOCK_TOOL) {
        return processorFail({
          code: "not_implemented",
          message: "This processor only handles PDF protect/unlock.",
          retryable: false,
        });
      }

      // Exactly one PDF input. Enforced before parsing options so a malformed
      // batch fails the same way regardless of the tool.
      const file = input.inputs[0];
      if (input.inputs.length !== 1 || !file) {
        return processorFail({
          code: "unprocessable_entity",
          message: "This tool accepts exactly one PDF input.",
          retryable: false,
        });
      }

      if (input.tool === PROTECT_TOOL) {
        // Defensive re-validation of the raw options bag (the password lives here).
        const parsed = parseProtectPdfOptions(input.options);
        if (!parsed.ok) {
          return processorFail({
            code: parsed.error.body.error.code,
            message: parsed.error.body.error.message,
            retryable: false,
          });
        }
        const run = await runProtect(file.bytes, parsed.value, deps);
        if (!run.ok) return processorFail(pdfSecurityJobError(run));
        return processorOk(
          [
            {
              filename: protectedOutputName(file.filename),
              contentType: OUTPUT_CONTENT_TYPE,
              bytes: run.output,
            },
          ],
          toProcessorMeta(run.meta),
        );
      }

      // Unlock.
      const parsed = parseUnlockPdfOptions(input.options);
      if (!parsed.ok) {
        return processorFail({
          code: parsed.error.body.error.code,
          message: parsed.error.body.error.message,
          retryable: false,
        });
      }
      const run = await runUnlock(file.bytes, parsed.value, deps);
      if (!run.ok) return processorFail(pdfSecurityJobError(run));
      return processorOk(
        [
          {
            filename: unlockedOutputName(file.filename),
            contentType: OUTPUT_CONTENT_TYPE,
            bytes: run.output,
          },
        ],
        toProcessorMeta(run.meta),
      );
    },
  };
}
