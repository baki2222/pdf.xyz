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
import { respond } from "../../_lib/http";

// Reflects live host state (an engine can be installed at any time). Node runtime
// — the PATH probe uses Node built-ins, lazily imported only in local-dev mode.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const mode = resolveWorkerMode();

  let tools: ToolAvailability | undefined;
  if (mode === "local-dev") {
    // Config-aware probe: honors the native-compression enable flag, engine pin,
    // and binary-path overrides, so the client status matches what the worker will
    // actually run. Reports engine *names* only — never a path or variable value.
    const { probeNativeTools } = await import("@/lib/workers/compression/native");
    tools = probeNativeTools(process.env);
  }

  // OCR is intentionally NOT probed: this build ships no OCR pipeline in any
  // mode (the local-dev worker only compresses), so passing no OCR engines makes
  // `buildWorkerStatus` report OCR honestly unavailable everywhere. When a real
  // OCR processor is wired behind the adapter, probe it here (presence-only),
  // exactly like compression, and pass the result as the third argument.
  return respond(ok(buildWorkerStatus(mode, tools)));
}
