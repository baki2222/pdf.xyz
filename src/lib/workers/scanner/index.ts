/**
 * Public surface of the secure-worker **malware-scanner seam** and its factory.
 *
 * Every module re-exported here is node-free (no daemon, native binary, socket, or
 * scanner-process internals), so this barrel is safe to import from the executor and
 * from tests. The REAL ClamAV client (`./clamav`) is node-free too — its socket
 * lives behind an injected transport — so it is exported here; the Node socket
 * transport (`./clamav-transport`) and the runtime resolver (`./node`) are NOT, and
 * are imported directly by the Node worker runtime so importing this barrel never
 * pulls a socket into a client bundle or unit test.
 *
 * {@link createMalwareScanner} wires an injected provider or the honest no-op only;
 * the Node runtime uses `./node`'s `resolveWorkerScanner` to wire the real ClamAV
 * scanner over a real socket when an operator has configured and deployed clamd.
 */

import { notConfiguredScanner } from "./not-configured";
import type { MalwareScanner } from "./types";

export * from "./types";
export * from "./config";
export * from "./not-configured";
export * from "./fake";
export * from "./clamav";
export * from "./clamav-protocol";

type EnvSource = Record<string, string | undefined>;

/** Dependencies for {@link createMalwareScanner}. */
export interface MalwareScannerDeps {
  /**
   * Inject a scanner provider. Tests inject a fake; the Node runtime injects the
   * resolved provider from `./node`. When present, it is used verbatim.
   */
  readonly scanner?: MalwareScanner;
  /** Environment for the honest no-op's reported capability. */
  readonly env?: EnvSource;
}

/**
 * The node-free scanner factory: an injected provider wins; otherwise the honest
 * no-op is wired. It deliberately does NOT construct the real ClamAV scanner —
 * that needs a socket transport (Node-only). The Node worker runtime resolves the
 * real provider with `./node`'s `resolveWorkerScanner` (which builds ClamAV over a
 * socket when configured, else this same no-op) and injects it. Using the no-op
 * here keeps this barrel node-free and safe for the executor and unit tests.
 */
export function createMalwareScanner(
  deps: MalwareScannerDeps = {},
): MalwareScanner {
  if (deps.scanner) return deps.scanner;
  return notConfiguredScanner(deps.env);
}
