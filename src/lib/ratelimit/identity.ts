/**
 * Request → **opaque client bucket token**. The one node-touching leaf of the
 * abuse guard (it uses `node:crypto`), imported only by the guard, which is only
 * imported by `runtime = "nodejs"` route handlers.
 *
 * A rate limiter must partition traffic by *some* client identity to function.
 * This module derives that identity as narrowly and privately as possible:
 *  - It reads a client address ONLY from the proxy forwarding header, and ONLY
 *    when the operator has declared that header trusted
 *    (`trustForwardedFor`). That header is client-spoofable unless a trusted edge
 *    overwrites it, so by default we do not trust it — and then every request
 *    keys into one shared bucket (a coarse global throttle), never an attacker's
 *    rotating fake address.
 *  - Whatever raw address it does read is immediately **salted-hashed** with a
 *    per-process random salt and truncated. The returned token is opaque: it is
 *    used only as an in-memory map key and is never logged, returned, persisted,
 *    or placed in a {@link RateLimitDecision}. The raw address is never retained.
 *
 * The net effect: the guard can throttle a specific client without the raw
 * address ever living anywhere but the transient local variable it is hashed from.
 */

import { createHash } from "node:crypto";
import type { RateLimitConfig } from "./config";

/** The single bucket every request shares when no client can be attributed. */
export const SHARED_BUCKET_TOKEN = "shared";

/**
 * The salt that keeps bucket keys from being a plain, brute-forceable hash of a
 * client address.
 *
 * It MUST come from configuration, because it must be identical on every
 * instance. Until 2026-08-10 it was `randomBytes(16)` generated lazily per
 * process, under a comment that read:
 *
 *   "because the limiter is per-process anyway, cross-process instability is
 *    irrelevant"
 *
 * That was TRUE when written and was invalidated by adding the Upstash
 * provider — after which every serverless instance salted differently, so the
 * same caller hashed to a different bucket on each one, and every cold start
 * rotated it again. Measured on production: four distinct `c_` buckets from two
 * machines. The posture claimed `distributed: true` throughout, which the key
 * derivation could not support.
 *
 * THE REUSABLE PREDICATE, because this defect was created by adding a
 * distributed backend rather than by anyone writing bad code: is a per-process
 * random an INPUT TO A DERIVATION that must agree across processes, or does it
 * MINT a value that is then persisted? The first breaks the moment a second
 * process exists; the second never cares. `workers/ids.ts` and `handoff/ids.ts`
 * are the second kind and are fine. This was the only one of the first kind.
 */
function salt(config: Pick<RateLimitConfig, "keySalt">): string | undefined {
  return config.keySalt;
}

/** The forwarded client address, if the proxy set one. Leftmost hop = client. */
/**
 * The client address, in the order the headers can be trusted.
 *
 * `x-vercel-forwarded-for` first: Vercel documents it as identical to
 * `x-forwarded-for` EXCEPT that plain `x-forwarded-for` "could be overwritten
 * if you're using a proxy on top of Vercel". Preferring the vendor-scoped
 * spelling costs nothing and survives a proxy layered above the platform.
 *
 * None of these is trusted unless the operator says so — see the docblock on
 * {@link deriveClientToken}. The ORDER is about which is most likely to be the
 * real client when trust has already been granted; it is not itself the trust
 * decision.
 */
function forwardedAddress(headers: Headers): string | undefined {
  for (const header of [
    "x-vercel-forwarded-for",
    "x-forwarded-for",
    "x-real-ip",
  ]) {
    const raw = headers.get(header);
    if (!raw) continue;
    // A forwarding chain lists the origin client first.
    const first = raw.split(",")[0]?.trim();
    if (first) return first;
  }
  return undefined;
}

/**
 * Derive the opaque bucket token for a request. Returns {@link SHARED_BUCKET_TOKEN}
 * when the forwarding header is untrusted or absent; otherwise a salted-hash of the
 * forwarded address (prefixed so it can never collide with the shared sentinel).
 * The result is content-free by construction — it does not contain the address.
 */
export function deriveClientToken(
  headers: Headers,
  config: Pick<RateLimitConfig, "trustForwardedFor" | "keySalt">,
): string {
  if (!config.trustForwardedFor) return SHARED_BUCKET_TOKEN;
  const configuredSalt = salt(config);
  // No shared salt ⇒ REFUSE to key per client. Generating one here would make
  // every instance bucket the same caller differently, which is not a weaker
  // limit but effectively none — the exact defect measured on production. The
  // shared bucket is stricter and, unlike per-instance keys, it is a state the
  // posture names (`remote-configured-shared`) and alerts on.
  if (!configuredSalt) return SHARED_BUCKET_TOKEN;
  const address = forwardedAddress(headers);
  if (!address) return SHARED_BUCKET_TOKEN;
  const digest = createHash("sha256")
    .update(configuredSalt)
    .update("\0")
    .update(address.toLowerCase())
    .digest("hex")
    .slice(0, 32);
  return `c_${digest}`;
}
