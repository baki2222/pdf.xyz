/**
 * pdf.xyz gated-tool interest report — the read half of the demand signal.
 *
 * `pnpm interest:report` prints the per-tool "notify me" counts the
 * `/api/interest` route accumulates, sorted by demand, so choosing which
 * gated tool to build next runs on data instead of guesses. Run it anywhere
 * the web tier's rate-limit store credentials are available (they are the
 * SAME two variables the limiter uses — no new secret exists for this):
 *
 *   PDFXYZ_RATE_LIMIT_REDIS_REST_URL=… PDFXYZ_RATE_LIMIT_REDIS_REST_TOKEN=… \
 *     pnpm interest:report
 *
 * Honesty & privacy posture:
 *  - It reads ONLY the keys derived from the compiled catalogue's slugs — one
 *    MGET over a known, bounded key list. No SCAN, no pattern read, so a key
 *    this tool did not expect can never enter the report.
 *  - The store holds one integer per slug and that is all this prints: a slug
 *    and a number. There is nothing else to read.
 *  - It never prints the store URL, the token, or an error body — a transport
 *    failure is reported as a content-free sentence and exit 1.
 */

import { getAllToolSlugs } from "@/lib/tools";
import { parseRateLimitRedisConfig, RATE_LIMIT_REDIS_ENV } from "@/lib/ratelimit/redis-config";
import { createRedisClient } from "@/lib/workers/queue/redis-client";
import { interestCounterKey } from "@/lib/interest/store";

async function main(): Promise<number> {
  const parsed = parseRateLimitRedisConfig(process.env);
  if (!parsed.ok) {
    process.stderr.write(
      "interest:report: no rate-limit store is configured here. Set " +
        `${RATE_LIMIT_REDIS_ENV.restUrl} and ${RATE_LIMIT_REDIS_ENV.restToken} ` +
        "(the same web-tier values the limiter uses) and run again.\n",
    );
    return 1;
  }

  const slugs = getAllToolSlugs();
  const client = createRedisClient({
    baseUrl: parsed.config.baseUrl,
    token: parsed.config.token,
  });
  const keys = slugs.map((slug) => interestCounterKey(parsed.config.keyPrefix, slug));
  const res = await client.command(["MGET", ...keys]);
  if (!res.ok) {
    process.stderr.write(
      "interest:report: the store did not answer the read. Check the two rate-limit store variables and the store's status, then run again.\n",
    );
    return 1;
  }

  const values = Array.isArray(res.value) ? res.value : [];
  const counts = slugs
    .map((slug, i) => {
      const raw = values[i];
      const n =
        typeof raw === "number"
          ? raw
          : typeof raw === "string" && /^\d+$/.test(raw)
            ? Number(raw)
            : 0;
      return { slug, count: n };
    })
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));

  const total = counts.reduce((sum, c) => sum + c.count, 0);
  if (counts.length === 0) {
    process.stdout.write(
      `No interest recorded yet (checked ${slugs.length} catalogue slugs).\n`,
    );
    return 0;
  }

  const width = Math.max(...counts.map((c) => c.slug.length));
  process.stdout.write(
    `Gated-tool interest — ${total} click${total === 1 ? "" : "s"} across ${counts.length} tool${counts.length === 1 ? "" : "s"} (of ${slugs.length} slugs checked):\n`,
  );
  for (const c of counts) {
    process.stdout.write(`  ${c.slug.padEnd(width)}  ${c.count}\n`);
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch(() => {
    // Never print the raw error — it could carry an endpoint or a header.
    process.stderr.write("interest:report: unexpected failure (nothing printed from the error).\n");
    process.exit(1);
  });

export {};
