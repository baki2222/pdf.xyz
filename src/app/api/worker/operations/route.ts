/**
 * GET /api/worker/operations — the content-free worker **operations / SLO snapshot**.
 *
 * The operator counterpart of `/api/worker/status`: where that endpoint answers the
 * Compress UI's "can the worker do this for me?", this answers an operator's (or a
 * dashboard's / alert rule's) "is the worker stack healthy, and what's the one next
 * action?". It reports the resolved mode, drainability, per-subsystem SLO health
 * classes, engine/OCR proof tri-states, a recommended-next-action enum, and honest
 * caveats — never a secret, path, object key, endpoint, variable name, or value.
 *
 * It is collected from the **web vantage**, so it is honest about what this process
 * cannot observe: whether a separate worker daemon is actually deployed and running
 * (`daemonObserved: false`), and a separate worker image's installed engines / OCR
 * runner (reported `unknown`). In `local-dev` mode the web app *is* the in-process
 * worker, so it performs the same live PATH probe the status route does (lazily
 * importing the Node-only native layer) and its engine proof reflects the real host.
 */

import { ok } from "@/lib/jobs";
import { resolveWorkerMode, type ToolAvailability } from "@/lib/workers";
import { collectWebOperationsSnapshot } from "@/lib/workers/observability";
import { respond } from "../../_lib/http";

// Reflects live host + config state. Node runtime — the PATH probe uses Node built-ins,
// lazily imported only in local-dev mode (every other mode reads config only).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const mode = resolveWorkerMode();

  let tools: ToolAvailability | undefined;
  if (mode === "local-dev") {
    // The web app is the in-process worker in local-dev, so probing its own host for
    // native engines is honest — the engine proof then reflects real deep-compression
    // availability. Config-aware (honors the enable flag / engine pin / path override);
    // reports engine *names* only, never a path or value. In every other mode we skip
    // the probe, so the engine/OCR proofs stay honestly `unknown` (a separate worker
    // image cannot be observed from here).
    const { probeNativeTools } = await import("@/lib/workers/compression/native");
    tools = probeNativeTools(process.env);
  }

  return respond(ok(collectWebOperationsSnapshot(process.env, { tools })));
}
