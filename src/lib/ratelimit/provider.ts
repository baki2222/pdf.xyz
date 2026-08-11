/**
 * The **production provider seam** for the abuse guard: an async limiter backend
 * (e.g. a Redis/Upstash-compatible client) that a deployment registers at boot.
 *
 * This build ships NO such backend. By default nothing is registered, so a remote
 * provider selection resolves to `remote-unimplemented` — an honest skip (see
 * `config.ts` / `guard.ts`). The seam exists so a production deployment can wire a
 * real distributed limiter WITHOUT touching a single route or the guard: implement
 * {@link RateLimitProvider}, then call {@link registerRateLimitProvider} exactly
 * once from a Next.js `instrumentation.ts` `register()` hook. When
 * `PDFXYZ_RATE_LIMIT_PROVIDER` names a remote backend and a provider is registered,
 * the guard delegates to it and reports `provider: "remote"`, `enforced: true`.
 *
 * The contract mirrors the in-memory core's verdict, but async — a real backend
 * does I/O. Critically, the provider is handed the SAME opaque, salted-hash bucket
 * token the in-memory limiter uses (never a raw IP/identity; see `identity.ts`),
 * and it returns only a bounded verdict. So a remote backend is held to the exact
 * same content-free, no-leak invariant as the rest of this module: it can key on a
 * client without ever seeing — let alone logging — who that client is.
 *
 * Node-free: pure interface + a module-level registry slot. No `node:*`, no
 * network. Tests exercise the seam with a fake in-process provider, never a real
 * client — see `provider.test.ts`.
 */

import type { RateLimitPolicy, RateLimiterVerdict } from "./types";

/**
 * A distributed/remote limiter backend. Implemented by a deployment (never by this
 * build) and registered once at boot via {@link registerRateLimitProvider}.
 */
export interface RateLimitProvider {
  /**
   * Async check for one `(policy, opaque bucket key, nowMs)` triple, returning a
   * bounded verdict. `key` is already an opaque, salted-hash token (or the shared
   * sentinel) — the backend MUST use it only as a store key and MUST NOT log,
   * persist beyond its window, or return it or any identity.
   *
   * Failure semantics, by design:
   *  - return `{ allowed: false, ... }` to deliberately DENY (fail closed);
   *  - THROW to signal an unexpected backend error (e.g. the store is
   *    unreachable) — the guard then fails OPEN (allow, `enforced: false`), so a
   *    limiter outage can never take the API down. A backend that would rather
   *    fail closed for a class of errors should return a deny instead of throwing.
   */
  check(
    policy: RateLimitPolicy,
    key: string,
    nowMs: number,
  ): Promise<RateLimiterVerdict>;
  /**
   * Report the verdict **without spending**, and without creating a window.
   *
   * Phase one of a two-phase spend, and the reason the two phases cannot be one
   * call: a limiter tests before the action, but a token spend is only known
   * after the provider replies. Optional so a backend registered before this
   * existed still satisfies the contract; callers fall back to `check` only when
   * they genuinely intend to spend a unit.
   */
  peek?(
    policy: RateLimitPolicy,
    key: string,
    nowMs: number,
  ): Promise<RateLimiterVerdict>;
  /**
   * Record `cost`, unconditionally. Phase two.
   *
   * Returns nothing on purpose: the add runs AFTER the money is spent, so
   * refusing to record an amount that overshoots would hide exactly the call
   * that broke the ceiling. It may throw on a backend error — the caller treats
   * a failed add as a lost measurement and says so, rather than assuming zero.
   */
  spend?(
    policy: RateLimitPolicy,
    key: string,
    nowMs: number,
    cost: number,
  ): Promise<void>;
}

// The single registered backend, or none. Module-level so a boot hook sets it once
// and every request in the process observes it. Never a network client by default.
let registered: RateLimitProvider | null = null;

/**
 * Register the production limiter backend. Call once from a boot hook (Next.js
 * `instrumentation.ts` → `register()`). A second call replaces the first; passing
 * the same instance is idempotent.
 */
export function registerRateLimitProvider(provider: RateLimitProvider): void {
  registered = provider;
}

/** The registered backend, or `null` when none is wired (the default build). */
export function getRateLimitProvider(): RateLimitProvider | null {
  return registered;
}

/** Clear the registered backend. Test-only; call in `afterEach`. */
export function clearRateLimitProviderForTests(): void {
  registered = null;
}
