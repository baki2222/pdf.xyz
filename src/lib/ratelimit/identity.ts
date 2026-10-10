/**
 * Request → **opaque client bucket token**. The one node-touching leaf of the
 * abuse guard (it uses `node:crypto`), imported only by the guard, which is only
 * imported by `runtime = "nodejs"` route handlers.
 *
 * A rate limiter must partition traffic by *some* client identity to function.
 * This module derives that identity as narrowly and privately as possible:
 *  - It reads a client address ONLY from the single header the operator names
 *    (`PDFXYZ_RATE_LIMIT_CLIENT_IP_HEADER`), and ONLY when the operator has
 *    declared it trusted (`trustForwardedFor`). A header is client-spoofable
 *    unless a trusted edge overwrites it, so by default we do not trust one —
 *    and then every request keys into one shared bucket (a coarse global
 *    throttle), never an attacker's rotating fake address.
 *  - Whatever raw address it does read is immediately **salted-hashed** with
 *    the configured shared salt and truncated. The returned token is opaque: it
 *    is never logged, returned, or placed in a {@link RateLimitDecision}, and the
 *    raw address is never retained. It IS persisted: the distributed limiter
 *    stores it in its Redis key, with the counter, until the policy's window
 *    ends (up to a day). This line used to say "never … persisted", true of the
 *    in-memory limiter it was written for and false of the Redis one that
 *    replaced it — so the privacy policy now describes the token, and the
 *    limiter cannot produce one until it does (`isTrustForwardedFor`).
 *
 * The net effect: the guard can throttle a specific client without the raw
 * address ever living anywhere but the transient local variable it is hashed from.
 */

import { createHash } from "node:crypto";
import { parseIpv4, parseIpv6 } from "@/lib/net/public-address";
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

/**
 * The client address, from the ONE header the operator named — whole, or not
 * at all.
 *
 * History, because the previous shape was a live bypass: until 2026-09 this
 * walked `x-vercel-forwarded-for` → `x-forwarded-for` → `x-real-ip` and took
 * the LEFTMOST hop of the first one present. The site is not on Vercel and
 * nothing in front of it (Cloudflare → Traefik) strips `x-vercel-forwarded-for`,
 * so any caller could name their own bucket. Measured on production: 130
 * requests with `x-vercel-forwarded-for: 198.51.100.91` → 120 × 400, 10 × 429;
 * the next request with `…92` got a fresh budget. `x-forwarded-for` fell the
 * same way (Cloudflare APPENDS to a client-sent XFF, so its leftmost hop is
 * whatever the client wrote): 117 × 400, 8 × 429 on a spoofed value.
 *
 * Now:
 *  - exactly one header, named by `PDFXYZ_RATE_LIMIT_CLIENT_IP_HEADER`; no
 *    list, no fallback, no default;
 *  - its WHOLE value, which must be a single IP address. A list (`a, b`) is
 *    refused rather than split: every list-shaped forwarding header lets the
 *    client write the first entry.
 * Anything else lands in the shared bucket, which the posture names.
 *
 * A header is only as trustworthy as the edge that overwrites it: behind
 * Cloudflare `cf-connecting-ip` is set by Cloudflare, but only for requests
 * that came THROUGH Cloudflare — an origin that answers directly lets a caller
 * send it themselves. Locking the origin is a deployment fact, not something
 * this function can see.
 */
function clientAddress(
  headers: Headers,
  headerName: string,
): string | undefined {
  const raw = headers.get(headerName)?.trim();
  if (!raw || raw.includes(",")) return undefined;
  return bucketAddress(raw);
}

/**
 * The part of an address that identifies ONE client. An IPv4 address is one
 * client. An IPv6 host is handed a whole /64 — a single VPS or phone can source
 * requests from 2^64 addresses — so keying on the full address would hand
 * every caller an unlimited supply of fresh buckets. IPv6 keys on its /64;
 * an IPv4-mapped address keys on the IPv4 it carries.
 */
function bucketAddress(raw: string): string | undefined {
  if (parseIpv4(raw) !== null) return raw;
  const v6 = parseIpv6(raw);
  if (v6 === null) return undefined;
  if (v6 >> 32n === 0xffffn) {
    const v4 = Number(v6 & 0xffffffffn);
    return [24, 16, 8, 0].map((s) => (v4 >>> s) & 255).join(".");
  }
  return `v6/64:${(v6 >> 64n).toString(16)}`;
}

/**
 * Derive the opaque bucket token for a request. Returns {@link SHARED_BUCKET_TOKEN}
 * when the forwarding header is untrusted or absent; otherwise a salted-hash of the
 * forwarded address (prefixed so it can never collide with the shared sentinel).
 * The result is content-free by construction — it does not contain the address.
 */
export function deriveClientToken(
  headers: Headers,
  config: Pick<
    RateLimitConfig,
    "trustForwardedFor" | "keySalt" | "clientIpHeader"
  >,
): string {
  if (!config.trustForwardedFor) return SHARED_BUCKET_TOKEN;
  const configuredSalt = salt(config);
  // No shared salt ⇒ REFUSE to key per client. Generating one here would make
  // every instance bucket the same caller differently, which is not a weaker
  // limit but effectively none — the exact defect measured on production. The
  // shared bucket is stricter and, unlike per-instance keys, it is a state the
  // posture names (`remote-configured-shared`) and alerts on.
  if (!configuredSalt) return SHARED_BUCKET_TOKEN;
  // No named header ⇒ REFUSE to key per client, exactly as for a missing salt:
  // guessing a header is how the bypass above was built.
  if (!config.clientIpHeader) return SHARED_BUCKET_TOKEN;
  const address = clientAddress(headers, config.clientIpHeader);
  if (!address) return SHARED_BUCKET_TOKEN;
  const digest = createHash("sha256")
    .update(configuredSalt)
    .update("\0")
    .update(address.toLowerCase())
    .digest("hex")
    .slice(0, 32);
  return `c_${digest}`;
}
