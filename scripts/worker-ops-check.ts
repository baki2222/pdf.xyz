/**
 * pdf.xyz secure-worker operations healthcheck — the out-of-band operator CLI.
 *
 * `pnpm worker:ops-check` evaluates the SAME content-free runtime operations evidence
 * the daemon reports (readiness, deployment, guardrails, engine/OCR/scanner health,
 * lifecycle backstop) plus the Phase 30 liveness heartbeat, and prints a stable alert
 * verdict with a documented exit code — the piece a cron job, uptime monitor, CI gate,
 * or process supervisor keys on. It is deliberately a thin shell over unit-tested,
 * node-free modules under `src/lib/workers/ops-check/`; this file only reads argv/env,
 * resolves the (Node-only) runtime, reads stdin/files, writes the output, and exits.
 *
 * Like the daemon, it is NEVER imported by the web app (it lives outside `src/` and is
 * invoked only as `pnpm worker:ops-check`), so importing the app never resolves a
 * runtime or probes the host.
 *
 * Honesty & privacy:
 *  - It NEVER fakes a running worker. Even on the `--runtime` source (run on the worker
 *    host), liveness is heartbeat-driven — observed only on a fresh beat, a warning when
 *    stale/absent (with observation enabled), and a neutral "confirm out-of-band" when
 *    the feature is off. A short-lived probe executing is not evidence a daemon drains.
 *  - Its output is content-free by construction: bounded enums, booleans, small counts,
 *    and prose authored by the alert policy — never a filename, key, endpoint, value,
 *    host, env-var name, or secret, even when it ingests a monitor-supplied snapshot.
 *  - It exits with the documented Phase 31 ladder (0 ok / 2 unknown / 3 warn / 4
 *    critical) for operational states and a distinct 1 for usage/config errors (bad
 *    flag, unreadable/malformed input), so a misconfigured check is never mistaken for
 *    a healthy or unhealthy worker.
 *
 * Run it in worker infrastructure alongside (never inside) the web app, e.g.:
 *   pnpm worker:ops-check                       # on the worker host: full runtime evidence
 *   pnpm worker:ops-check --web                 # on a monitor host: config-only + heartbeat
 *   curl -s .../api/worker/operations | pnpm worker:ops-check --stdin   # evaluate a scraped snapshot
 *   pnpm worker:ops-check --file=snapshot.json --prometheus             # for a Prometheus scrape
 */

import {
  OPS_CHECK_USAGE,
  parseOpsCheckArgs,
  runOpsCheck,
  collectRuntimeOperations,
  type CollectedOperations,
  type OpsCheckProvider,
} from "@/lib/workers/ops-check";
import { OPS_CHECK_EXIT } from "@/lib/workers/observability";
import { resolveWorkerRuntime } from "@/lib/workers/daemon/runtime";
import { readWorkerHeartbeatLiveness } from "@/lib/workers/heartbeat";
import { collectWebOperationsSnapshot } from "@/lib/workers/observability";
import { readCleanupEvidencePosture } from "@/lib/workers/cleanup-evidence/read";
import { resolveWorkerMode, type ToolAvailability } from "@/lib/workers";
import { readFileSync, statSync } from "node:fs";

/** Hard cap on an ingested snapshot; a content-free operations snapshot is tiny. */
const MAX_INPUT_BYTES = 1_048_576; // 1 MiB

/**
 * Collect the live operations for a source. `runtime` resolves this host's real
 * runtime (the daemon's own evidence) and reads the heartbeat; `web` produces the
 * config-only web-vantage snapshot (probing native engines only in `local-dev`, where
 * the web app IS the in-process worker) and reads the heartbeat. Neither self-asserts
 * liveness — a stale/absent/disabled heartbeat is handled honestly downstream.
 */
async function collectLive(
  source: "runtime" | "web",
): Promise<CollectedOperations> {
  const env = process.env;
  const daemonLiveness = await readWorkerHeartbeatLiveness(env);
  // Read the cleanup evidence posture from the operator-configured content-free report
  // summaries (Phase 44). A pure no-op returning the `disabled` posture unless a report
  // path is configured; never contacts the cloud, never throws, never leaks a path.
  const cleanupEvidence = readCleanupEvidencePosture(env);

  if (source === "runtime") {
    // The same wiring the daemon uses: real provider config + a live native-engine
    // probe. Logs nothing; the executor is built but never ticked (no job is claimed).
    const runtime = resolveWorkerRuntime(env);
    return collectRuntimeOperations(runtime, daemonLiveness, cleanupEvidence);
  }

  // `web`: no host probe except in local-dev, where the web app is the in-process
  // worker so probing its own PATH is honest (mirrors the /api/worker/operations route).
  let tools: ToolAvailability | undefined;
  if (resolveWorkerMode() === "local-dev") {
    const { probeNativeTools } =
      await import("@/lib/workers/compression/native");
    tools = probeNativeTools(env);
  }
  const snapshot = collectWebOperationsSnapshot(env, {
    ...(tools ? { tools } : {}),
    daemonLiveness,
    cleanupEvidence,
  });
  return { snapshot, slo: null, metrics: null };
}

/** Read the raw ingest text for `stdin`/`file`, bounding the size. Throws on any failure. */
async function readInput(
  source: "stdin" | "file",
  filePath: string | undefined,
): Promise<string> {
  if (source === "file") {
    // The path is the operator's own file reference; it is never logged. Bound the size
    // before reading, then read defensively.
    const path = filePath ?? "";
    if (statSync(path).size > MAX_INPUT_BYTES)
      throw new Error("input-too-large");
    return readFileSync(path, "utf8");
  }
  // stdin (fd 0): read to EOF (a monitor pipes the snapshot), then bound the size.
  const buf = readFileSync(0);
  if (buf.length > MAX_INPUT_BYTES) throw new Error("input-too-large");
  return buf.toString("utf8");
}

const provider: OpsCheckProvider = {
  collectLive,
  readInput,
  now: () => new Date().toISOString(),
};

async function main(): Promise<number> {
  const parsed = parseOpsCheckArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${OPS_CHECK_USAGE}\n`);
    return OPS_CHECK_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${OPS_CHECK_USAGE}\n`);
    return OPS_CHECK_EXIT.OK;
  }

  const { output, exitCode } = await runOpsCheck(parsed.args, provider);
  process.stdout.write(output);
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch(() => {
    // Never print the raw error — it could carry a message we must not log. A genuine
    // internal fault means we could not determine worker health → UNKNOWN.
    process.exit(OPS_CHECK_EXIT.UNKNOWN);
  });
