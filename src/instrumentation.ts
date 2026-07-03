/**
 * Next.js **boot instrumentation** — the one place a production deployment wires the
 * distributed rate-limit provider into the running server.
 *
 * Next calls `register()` exactly once when a server process starts. Here we resolve
 * the abuse-guard configuration from the environment and, when a remote backend is
 * selected AND a valid store is configured, build and register the distributed
 * provider (`@/lib/ratelimit`). From then on the guard the public-API routes call
 * delegates to it and reports `enforced: true`, `provider: "remote"` — a real,
 * cross-instance throttle. With nothing configured (the default) this is a complete
 * no-op: no provider is registered, so the guard keeps its honest `disabled` /
 * `local-memory` / `remote-unimplemented` behavior and the default build, the e2e
 * suite, and every local-first tool are byte-for-byte unaffected.
 *
 * Two safety rails:
 *  - We register only in the **Node.js server runtime** (`NEXT_RUNTIME === "nodejs"`),
 *    where the `runtime = "nodejs"` route handlers run and share this module state.
 *    Registering in the edge runtime would be a dead write against a separate module
 *    graph.
 *  - The whole hook is wrapped so a boot-time wiring hiccup can NEVER crash the server:
 *    if registration fails, no provider is registered and the guard simply fails open
 *    (allow, unenforced) — exactly its designed degraded mode.
 *
 * Honest + content-free: the single boot line reports only the bounded status *code*
 * (e.g. `remote-configured`), never an endpoint, token, key, or any env value. It is
 * emitted only when a provider is actually selected, so a default deployment stays
 * silent.
 */

import {
  createConfiguredRateLimitProvider,
  registerRateLimitProvider,
  resolveRateLimitStatus,
} from "@/lib/ratelimit";

export function register(): void {
  // Only the Node.js server runtime serves the API routes that consult the guard.
  const runtime = process.env.NEXT_RUNTIME;
  if (runtime !== undefined && runtime !== "nodejs") return;

  try {
    const provider = createConfiguredRateLimitProvider(process.env);
    if (provider !== null) registerRateLimitProvider(provider);

    // A single content-free confirmation, only when a provider is actually selected —
    // it names the bounded status code and nothing else. `disabled` stays silent so a
    // default deployment prints nothing.
    const status = resolveRateLimitStatus(process.env, {
      providerRegistered: provider !== null,
    });
    if (status.code !== "disabled") {
      console.info(`[pdf.xyz] rate-limit provider: ${status.code}`);
    }
  } catch {
    // Never let boot wiring take down the server: with no provider registered the
    // guard fails open (allow, unenforced), which is its designed safe degraded mode.
  }
}
