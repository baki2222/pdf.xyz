/**
 * Whether /privacy tells a reader the rate limiter keys them by a hash of
 * their network address — and therefore whether the limiter may.
 *
 * The limiter READS this (`isTrustForwardedFor` in `ratelimit/config.ts`):
 * per-client keying needs `PDFXYZ_RATE_LIMIT_TRUST_PROXY`, `…_KEY_SALT` and
 * `…_CLIENT_IP_HEADER` AND this flag. The environment alone cannot switch it
 * on, because the environment is set in a console no test can see, and a
 * salted hash of an address kept with a counter for up to a day is personal
 * data the policy must describe before it exists — not after someone notices.
 *
 * ON SINCE 2026-10-17, and only because the origin answers nobody but
 * Cloudflare. `cf-connecting-ip` is trustworthy only while that holds: until
 * that day the origin served HTTPS to anyone who asked (a knock returned 200),
 * so a caller could skip the edge and write the header themselves. It is now
 * locked (`pdfxyz-origin-lock` on the web box: new connections to 80/443 from
 * outside Cloudflare's ranges are reset), and the repo's own instrument
 * certifies it — `ORIGIN_IP=<origin> pnpm verify:rate-limit` (or
 * `knockOnOrigin` alone; the full verifier spends a client's upload budget,
 * which while the limiter was SHARED meant everyone's). Before that day,
 * `/api/worker/operations` reported `rateLimit.code =
 * "remote-configured-shared"`. With the flag on: /privacy
 * renders the per-client sentence (`rate-limits.ts`), every AI tool page and
 * the allowance refusal say "for your connection" instead of "shared by
 * everyone using pdf.xyz" (`jobs/ai-allowance.ts`), and they ship in one
 * commit. `keying-disclosure.test.tsx` holds the rendered pages and the
 * limiter's composed chain to each other both ways — the AI pages since
 * review (2026-10-10), when they were found still saying "connection" beside
 * a limiter this flag had made shared. After a flip, read the posture at the
 * wire: the pages cannot see whether the three variables are set.
 *
 * A leaf with no imports, so the limiter can read it without loading copy.
 */
export const PER_CLIENT_KEYING_DISCLOSED: boolean = true;
