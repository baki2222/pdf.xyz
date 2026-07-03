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
 * cannot observe *by itself*: a separate worker image's installed engines / OCR
 * runner (reported `unknown`). For daemon liveness it reads the Phase 30 heartbeat
 * from the shared broker when that feature is enabled and configured: a recent beat
 * makes `daemonObserved` true, a stale/absent one keeps it false (a warn), and with
 * the feature off it stays the honest "confirm a worker out-of-band" residual — the
 * read is a disabled no-op with no network. In `local-dev` mode the web app *is* the
 * in-process worker, so it performs the same live PATH probe the status route does
 * (lazily importing the Node-only native layer) and its engine proof reflects the host.
 */

import { ok } from "@/lib/jobs";
import { resolveWorkerMode, type ToolAvailability } from "@/lib/workers";
import {
  collectWebOperationsSnapshot,
  evaluateOperationsAlerts,
} from "@/lib/workers/observability";
import { readWorkerHeartbeatLiveness } from "@/lib/workers/heartbeat";
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

  // Read cross-process daemon liveness from the shared broker (Phase 30). This is a
  // disabled no-op — no network — unless `PDFXYZ_WORKER_HEARTBEAT` is enabled AND a
  // broker is configured; a broker outage classifies as `unknown`, never a fabricated
  // "observed". It never throws.
  const daemonLiveness = await readWorkerHeartbeatLiveness(process.env);

  const snapshot = collectWebOperationsSnapshot(process.env, { tools, daemonLiveness });
  // Phase 31: attach the content-free alert posture (overall severity + the bounded
  // reasons/actions of each contributing alert) the operator dashboard renders and any
  // monitor scraping this endpoint keys on — the SAME verdict `pnpm worker:ops-check`
  // produces from this snapshot. No SLO window is available from the web route (it runs
  // no jobs), so this is the snapshot-derived posture only; the CLI folds in SLOs from a
  // supplied metrics series. Every field is a bounded enum or policy-authored prose.
  const alerts = evaluateOperationsAlerts(snapshot);
  return respond(ok({ ...snapshot, alerts }));
}
