/**
 * The pure soundness evaluation: given a bounded {@link SoundnessPolicy} and a job's
 * already-read inputs, decide `sound` / `unsound` / `skipped` with a content-free
 * {@link SoundnessResult}.
 *
 * It reuses the intake layer's bounded, node-free byte sniff ({@link sniffPdf}), its
 * MIME-family classifier ({@link familyForMime}), and its filename-extension family
 * table ({@link familyForExtension}) so the worker and the web boundary agree on what
 * a PDF envelope looks like and which families exist. It reads at most
 * `headerScanBytes + trailerScanBytes` bytes of each input regardless of file size —
 * it NEVER decompresses, parses objects, counts pages, or reads text — so it can
 * never trigger a decompression/parse bomb; deep validation stays in the processor
 * under its own resource limits.
 *
 * The checks run in a fixed, cheapest-first order and the FIRST failing check on the
 * FIRST failing input wins, so the outcome is deterministic and the returned reason
 * is stable. No filename, key, size, or content ever influences the result beyond
 * the presence of the two fixed markers, the coarse declared-family comparison, and
 * the fetched-vs-declared byte-count equality — none of which is ever echoed.
 */

import { getToolInputKind } from "@/lib/jobs/capabilities";
import {
  familyForExtension,
  familyForMime,
  normalizeContentType,
  sniffPdf,
  type UploadFamily,
} from "@/lib/uploads/intake";
import type { ProcessorInputFile } from "../processor/types";
import {
  acceptedFamiliesForTool,
  inputExpectedAsPdf,
  type SoundnessPolicy,
} from "./policy";
import {
  soundnessPass,
  soundnessReject,
  soundnessSkipped,
  type SoundnessInput,
  type SoundnessResult,
} from "./types";

/** Evaluate one input against the policy; `null` when it passes every applicable check. */
function checkOne(
  policy: SoundnessPolicy,
  accepted: ReadonlySet<UploadFamily>,
  file: ProcessorInputFile,
): SoundnessResult | null {
  const bytes = file.bytes;

  // 1. Empty — universal; an empty object is never a valid input for any tool.
  if (!bytes || bytes.length === 0) return soundnessReject("empty");

  // 2. Max-bytes ceiling (opt-in; `0` disables). A worker-side backstop distinct
  //    from the web-intake and scanner limits.
  if (policy.maxBytes > 0 && bytes.length > policy.maxBytes) {
    return soundnessReject("file_too_large");
  }

  // 3. Fetched-vs-declared byte count. Only checked when the storage layer recovered
  //    a declared/expected size for this input (local-dev carries it from the upload
  //    reservation; an S3 deployment supplies it only if the object metadata records
  //    one). This is the worker's final proof that the exact bytes it fetched still
  //    match the size the upload contract declared. A `0`/negative/non-finite
  //    declared size is treated as "not recorded" and skips the check.
  if (
    policy.checkSize &&
    typeof file.declaredBytes === "number" &&
    Number.isFinite(file.declaredBytes) &&
    file.declaredBytes > 0 &&
    file.declaredBytes !== bytes.length
  ) {
    return soundnessReject("size_mismatch");
  }

  // 4. Content-type consistency (governed by one knob):
  //    a. tool-family: a POSITIVELY-recognized declared family the tool does not
  //       accept is rejected; an unknown/absent content-type is deferred (the
  //       envelope sniff below is the authoritative structural signal);
  //    b. self-coherence: a recognized declared MIME family that disagrees with the
  //       filename's recognized extension family is an internally-inconsistent input
  //       (mirrors the intake `classifyDeclaredType` "mismatch"). Only judged when
  //       BOTH families are recognized, so an odd/absent extension is never grounds.
  const declaredFamily = familyForMime(normalizeContentType(file.contentType));
  if (policy.checkContentType) {
    if (
      accepted.size > 0 &&
      declaredFamily !== null &&
      !accepted.has(declaredFamily)
    ) {
      return soundnessReject("unsupported_family");
    }
    const extFamily = familyForExtension(file.filename);
    if (declaredFamily !== null && extFamily !== null && extFamily !== declaredFamily) {
      return soundnessReject("metadata_mismatch");
    }
  }

  // 5. Bounded PDF envelope — only for inputs this tool expects to be PDFs, so a
  //    valid image handed to a multi-format tool (e.g. OCR) is never gated as a PDF.
  if (inputExpectedAsPdf(accepted, declaredFamily)) {
    const sniff = sniffPdf(bytes, {
      pdfHeaderScanBytes: policy.headerScanBytes,
      pdfTrailerScanBytes: policy.trailerScanBytes,
    });
    if (policy.requireHeader && !sniff.hasHeader) {
      return soundnessReject("malformed_pdf");
    }
    if (policy.requireEof && !sniff.hasEof) {
      return soundnessReject("malformed_pdf");
    }
  }

  return null;
}

/**
 * Evaluate a job's inputs against the policy. Total and pure: any input yields a
 * verdict, never a throw. A malformed/absent policy fails closed (`unsound` /
 * `policy_unavailable`) so the gate never passes an input it could not evaluate; a
 * disabled policy returns `skipped` without inspecting a single byte; otherwise the
 * job's input count is bounded, then the first failing check on the first failing
 * input decides the (content-free) reason.
 */
export function checkSoundness(
  policy: SoundnessPolicy,
  input: SoundnessInput,
): SoundnessResult {
  // Defensive: a resolved policy is always a well-formed object, but if a caller
  // ever hands a nullish/malformed one, fail closed rather than pass unchecked.
  if (!policy || typeof policy !== "object") {
    return soundnessReject("policy_unavailable");
  }
  if (!policy.enabled) return soundnessSkipped();

  // A URL-input tool (webpage-to-pdf) legitimately carries no file inputs: the job
  // API validated `options.url` as a public http(s) URL and produced an empty
  // `inputs`. There are no bytes to inspect, so report honestly that nothing was
  // checked rather than rejecting a well-formed job as if a file had gone missing.
  if (input.inputs.length === 0) {
    return getToolInputKind(input.tool) === "url"
      ? soundnessSkipped()
      : soundnessReject("missing_input");
  }
  if (input.inputs.length > policy.maxInputs) {
    return soundnessReject("too_many_inputs");
  }

  const accepted = acceptedFamiliesForTool(input.tool);
  for (const file of input.inputs) {
    const rejection = checkOne(policy, accepted, file);
    if (rejection) return rejection;
  }
  return soundnessPass();
}
