/**
 * GET /api/worker/status — the honest, presence-only view of the worker layer.
 *
 * The browser can't read environment variables, so the Compress UI asks here
 * whether the secure-worker path is actually available before offering it. The
 * response reports the resolved mode and compression capability only — never a
 * secret, a path, or a variable value. In `local-dev` mode it performs a live
 * PATH probe (lazily importing the Node-only native layer, exactly like the
 * adapter) so a newly installed engine is reflected without a restart. In every
 * other environment it answers `disabled`/`remote-configured` with no capability.
 */

import { ok } from "@/lib/jobs";
import {
  buildWorkerStatus,
  resolveWorkerMode,
  type ToolAvailability,
} from "@/lib/workers";
import { readWorkerHeartbeatLiveness } from "@/lib/workers/heartbeat";
import { enforceRateLimit } from "@/lib/ratelimit/guard";
import { respond, respondRateLimited } from "../../_lib/http";

// Reflects live host state (an engine can be installed at any time). Node runtime
// — the PATH probe uses Node built-ins, lazily imported only in local-dev mode.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  // Guard the presence probe first. The decision is content-free and, with no
  // limiter configured (the default), the check short-circuits before reading any
  // header — so this stays lightweight and never exposes request identity.
  const limit = await enforceRateLimit("worker.status", request);
  if (!limit.allowed) return respondRateLimited(limit);

  const mode = resolveWorkerMode();

  let tools: ToolAvailability | undefined;
  let securityQpdf: boolean | undefined;
  if (mode === "local-dev") {
    // Config-aware probe: honors the native-compression enable flag, engine pin,
    // and binary-path overrides, so the client status matches what the worker will
    // actually run. Reports engine *names* only — never a path or variable value.
    const { probeNativeTools } = await import("@/lib/workers/compression/native");
    tools = probeNativeTools(process.env);
    // Dedicated qpdf-security probe (honors the PDF-security enable flag / binary
    // override), so protect/unlock availability is decoupled from compression's
    // engine pin. Presence-only — reports a boolean, never a path.
    const { probeQpdf } = await import("@/lib/workers/pdf-security/native");
    securityQpdf = probeQpdf(process.env);
  }

  // OCR is not probed LOCALLY, and cannot be: the OCR engine is deliberately
  // installed on the out-of-band worker only — this tier "needs no worker
  // secrets" and ships none of those binaries — so a PATH probe here can only
  // ever answer "no". Answering on that basis is what took a working tool dark:
  // `/tools/ocr-pdf` rendered "Not enabled" and offered no uploader while real
  // OCR jobs were completing through the queue. The honest signal is the same one
  // `processor.ready` already uses — the worker's own liveness heartbeat, which
  // carries what that worker can actually do.
  //
  // Whether a worker is actually out there. `processor.ready` is the one field
  // that must not be inferred from configuration — a bucket and a broker say
  // nothing about whether anyone deployed a daemon — so it is answered from an
  // observed liveness heartbeat. Never throws: a disabled seam reads `disabled`
  // and an unreachable broker reads `unknown`, both of which are not observed.
  const { observed, capabilities } = await readWorkerHeartbeatLiveness();
  // Only trust the capability when the heartbeat was genuinely observed — a stale
  // or absent beat must not be read as "OCR is available".
  const workerOcr = observed && capabilities?.ocr === true;
  // Same rule, and it matters more here: the pipeline copy shown on every
  // worker-backed tool page claims files are scanned for malware. That claim is
  // only made when a live heartbeat positively reports an active scanner — an
  // unobserved worker reads as NOT scanning, never as scanning.
  const workerScan = observed && capabilities?.malwareScan === true;

  return respond(
    ok(
      buildWorkerStatus(
        mode,
        tools,
        undefined,
        process.env,
        securityQpdf,
        observed,
        workerOcr,
        workerScan,
      ),
    ),
  );
}
