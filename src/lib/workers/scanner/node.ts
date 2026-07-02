/**
 * The **Node-only scanner resolver**: turns an environment into the concrete
 * {@link MalwareScanner} a deployed worker runs.
 *
 * It is the one seam that combines the node-free config/selection (`./config`), the
 * node-free ClamAV client (`./clamav`), and the Node socket transport
 * (`./clamav-transport`) — so it is Node-only and imported ONLY by the worker
 * runtime, never by the node-free scanner barrel or a client bundle. When a usable
 * clamd endpoint is configured it wires the real scanner over a real socket;
 * otherwise (disabled / not-configured / selected-but-misconfigured) it wires the
 * honest no-op, which never claims a file was scanned.
 *
 * Every dependency is injectable, so a test can drive the wiring (including a
 * clamav-configured environment) with a fake transport and never open a socket.
 */

import { createClamavScanner, type ClamavTransport } from "./clamav";
import { createSocketClamavTransport } from "./clamav-transport";
import {
  parseClamavConfig,
  resolveScannerReadiness,
  scannerProviderToken,
} from "./config";
import { notConfiguredScanner } from "./not-configured";
import type { MalwareScanner } from "./types";

type EnvSource = Record<string, string | undefined>;

/** Injectable seams so the resolver is unit-tested without a socket. */
export interface WorkerScannerDeps {
  /** Use this scanner verbatim (tests inject a fake; wins over env resolution). */
  readonly scanner?: MalwareScanner;
  /** Override the clamd transport (tests inject a fake instead of a real socket). */
  readonly transport?: ClamavTransport;
}

/**
 * Resolve the malware scanner for a worker. An injected scanner wins; otherwise, a
 * usable clamd endpoint wires the real {@link createClamavScanner} over a socket
 * transport (required-ness comes from {@link resolveScannerReadiness}); every other
 * state wires the honest no-op. Deterministic given its injected deps.
 */
export function resolveWorkerScanner(
  env: EnvSource = process.env,
  deps: WorkerScannerDeps = {},
): MalwareScanner {
  if (deps.scanner) return deps.scanner;

  if (scannerProviderToken(env) === "clamav") {
    const parsed = parseClamavConfig(env);
    if (parsed.ok) {
      const { endpoint, timeoutMs, maxBytes } = parsed.config;
      const transport = deps.transport ?? createSocketClamavTransport(endpoint);
      return createClamavScanner({
        transport,
        config: {
          timeoutMs,
          maxBytes,
          required: resolveScannerReadiness(env).required,
        },
      });
    }
  }

  // disabled / not-configured / unavailable (selected but misconfigured) → no-op.
  return notConfiguredScanner(env);
}
