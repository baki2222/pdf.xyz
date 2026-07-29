/**
 * The single, shared answer to "may the UI offer an AI tool right now?" for
 * `summarize-pdf`, `translate-pdf`, `chat-with-pdf`, and `ai-extract`.
 *
 * These four tools need strictly more than the other secure-worker tools: the
 * whole upload → queue → worker → download pipeline (exactly what
 * {@link canRunPdfSecurity} checks) AND a declared AI provider for the worker to
 * call. Before this module the second half was unchecked, so a deployment with a
 * healthy pipeline and no model wired would happily show the builder, take the
 * user's document, upload it, and only then fail with `not_configured`. Asking a
 * user to hand over a private PDF for work that provably cannot happen is exactly
 * the dishonesty this codebase refuses elsewhere, so the check moved up front.
 *
 * Keeping it in one place means the four tools can never drift apart on what
 * "available" means, and the panels share one explanation of what is missing.
 */

import type { WorkerStatus } from "./status";
import { canRunPdfSecurity } from "./pdf-security-client";

/**
 * True when the UI may offer a secure-worker AI flow. Three conditions, all
 * required:
 *  - not local-dev-only: the AI engines live on the remote worker, and local-dev's
 *    probes are about native binaries, so it never advertises them;
 *  - a declared AI provider (`status.ai.ready`), so a model exists to call;
 *  - a usable pipeline (storage + queue + a drainable daemon).
 *
 * Note what this deliberately does NOT claim: that a valid API key was verified.
 * The key lives on the out-of-band worker (see `./ai/readiness`), so a declared
 * deployment whose worker is missing its key still fails — but it fails honestly,
 * server-side, with nothing fabricated.
 */
export function canRunAiTool(status: WorkerStatus | null | undefined): boolean {
  if (!status) return false;
  if (status.localDevOnly) return false;
  if (!status.ai.ready) return false;
  return canRunPdfSecurity(status);
}

/**
 * The honest, client-safe explanation of why an AI tool is not being offered,
 * picking whichever piece is actually missing so the user is never told about the
 * wrong one. AI comes first when the pipeline is otherwise fine, because that is
 * then the only blocker; otherwise the daemon's own detail explains the pipeline.
 */
export function aiToolUnavailableDetail(
  status: WorkerStatus | null | undefined,
): string {
  if (!status) return "The secure worker is not drainable here.";
  if (status.localDevOnly) {
    return "AI tools run on the out-of-band secure worker, not the local-dev in-process worker, so they can't run here.";
  }
  if (!status.ai.ready) return status.ai.detail;
  return status.daemon.detail;
}
