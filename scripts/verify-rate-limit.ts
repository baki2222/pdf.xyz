/**
 * Prove that rate limiting is actually enforcing, by being rate limited.
 *
 * WHY THIS DOES NOT READ A FLAG
 * A status field saying "provider: redis" means the environment parsed, not that
 * a single request was ever refused. This repository has been burned by exactly
 * that distinction more than once: six tools reported `ready: true` from a
 * dependency being wired while failing 100% of jobs, and a pipeline description
 * claimed every file was malware-scanned while no scanner existed. So this sends
 * real requests until the server refuses one, and reports what it observed.
 *
 * WHAT IT SENDS
 * `POST /api/uploads` with a well-formed body for the smallest possible file.
 * That mints an upload slot and nothing else — no job is created, no worker is
 * woken, no object is written, and no AI provider is called. The slots simply
 * expire unused. The policy is 60 per hour per client, so a clean run costs 61
 * slot reservations and roughly a minute of one client's budget.
 *
 * USAGE
 *   pnpm verify:rate-limit                      # against production
 *   BASE=http://127.0.0.1:3000 pnpm verify:rate-limit
 *
 * THEN IT TRIES TO BUY A FRESH BUCKET. Once this client is refused, one more
 * request goes out carrying every client-writable address header with a made-up
 * value. It must be refused too. Until 2026-09 it was not: a spoofed
 * `x-vercel-forwarded-for` (and `x-forwarded-for`) keyed a new bucket per value,
 * so the 429 above proved enforcement while any caller could step around it.
 * The first 429 is this check's positive control — a spoof probe against a
 * limiter that never refuses anyone would pass vacuously.
 *
 * AND, WITH `ORIGIN_IP` SET, IT KNOCKS ON THE ORIGIN. The client address is
 * only as trustworthy as the edge that writes it: if the origin answers a
 * direct connection, a caller can skip Cloudflare and write
 * `cf-connecting-ip` themselves. With `ORIGIN_IP=<address>` this connects to
 * that address for the production hostname and expects NO HTTP answer. It
 * does not verify the certificate — an Origin CA or self-signed cert must not
 * make an answering origin look locked — and only an OBSERVED refusal passes
 * (`src/lib/probes/origin-knock.ts`, held by its test against real servers).
 *
 * EXIT CODES
 *   0  a 429 was observed, a spoofed address did not escape it (and, with
 *      ORIGIN_IP, the origin refused a direct connection)
 *   1  the limit was never reached — throttling is NOT enforcing
 *   2  the run could not complete (network, unexpected status), or the origin
 *      knock neither got an answer nor saw a refusal — nothing is proven
 *   3  a client-written header bought a fresh bucket — identity is spoofable
 *   4  the origin answered a direct connection — the edge can be bypassed
 */
import { knockOnOrigin, knockVerdict } from "../src/lib/probes/origin-knock";

const BASE = process.env.BASE ?? "https://pdf.xyz";

/** One more than `RATE_LIMITS.uploadsPerHourPerClient` (60), so a 429 must occur. */
const ATTEMPTS = Number(process.env.ATTEMPTS ?? 65);

/** A minimal, valid upload request: one tiny PDF, reserved and never used. */
const BODY = JSON.stringify({
  tool: "compress-pdf",
  files: [
    {
      filename: "rate-limit-probe.pdf",
      contentType: "application/pdf",
      bytes: 1024,
    },
  ],
});

interface Observation {
  status: number;
  /** `RateLimit-Remaining` if the server sends one — informative, never the proof. */
  remaining: string | null;
  retryAfter: string | null;
}

/** Every address header a client can write; values from TEST-NET-2. */
const SPOOFED: Record<string, string> = {
  "x-vercel-forwarded-for": "198.51.100.91",
  "x-forwarded-for": "198.51.100.92",
  "x-real-ip": "198.51.100.93",
  "cf-connecting-ip": "198.51.100.94",
  "true-client-ip": "198.51.100.95",
  forwarded: "for=198.51.100.96",
};

async function attempt(
  extraHeaders: Record<string, string> = {},
): Promise<Observation> {
  const res = await fetch(`${BASE}/api/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: BODY,
  });
  // Drain the body so the connection is released promptly.
  await res.text().catch(() => "");
  return {
    status: res.status,
    remaining:
      res.headers.get("ratelimit-remaining") ??
      res.headers.get("x-ratelimit-remaining"),
    retryAfter: res.headers.get("retry-after"),
  };
}

async function main(): Promise<number> {
  console.log(`Probing ${BASE}/api/uploads — up to ${ATTEMPTS} requests.\n`);

  const counts = new Map<number, number>();
  let firstDeniedAt: number | null = null;
  let denied: Observation | null = null;

  for (let i = 1; i <= ATTEMPTS; i += 1) {
    let observation: Observation;
    try {
      observation = await attempt();
    } catch (error) {
      console.error(`request ${i} failed to complete: ${String(error)}`);
      return 2;
    }
    counts.set(observation.status, (counts.get(observation.status) ?? 0) + 1);

    if (observation.status === 429 && firstDeniedAt === null) {
      firstDeniedAt = i;
      denied = observation;
      break;
    }
    // A status other than 201/429 means the probe itself is wrong, and counting
    // its responses would produce a confident answer to the wrong question.
    if (observation.status !== 201 && observation.status !== 200) {
      console.error(
        `request ${i} returned ${observation.status}, which is neither a created slot nor a refusal — the probe is not measuring what it thinks. Aborting.`,
      );
      return 2;
    }
  }

  for (const [status, n] of [...counts].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${status}: ${n}`);
  }
  console.log("");

  if (firstDeniedAt === null) {
    console.log(
      `NOT ENFORCING — ${ATTEMPTS} requests, none refused. Either the provider is\n` +
        `unset, the store credentials are missing or wrong, or the deploy carrying\n` +
        `them has not gone out yet. See docs/RATE_LIMITING.md.`,
    );
    return 1;
  }

  console.log(
    `ENFORCING — request ${firstDeniedAt} was refused with 429` +
      (denied?.retryAfter ? ` (Retry-After: ${denied.retryAfter}s)` : "") +
      `.\nThat is a real refusal from the server, not a configuration flag.`,
  );

  let spoofed: Observation;
  try {
    spoofed = await attempt(SPOOFED);
  } catch (error) {
    console.error(`the spoof probe failed to complete: ${String(error)}`);
    return 2;
  }
  if (spoofed.status !== 429) {
    console.log(
      `\nSPOOFABLE — with this client's budget spent, a request carrying made-up\n` +
        `address headers got ${spoofed.status}, not 429: a client-written header\n` +
        `chose the bucket. Check PDFXYZ_RATE_LIMIT_CLIENT_IP_HEADER (docs/RATE_LIMITING.md).`,
    );
    return 3;
  }
  console.log(
    "A request carrying spoofed address headers was refused too: same bucket.",
  );

  const originIp = process.env.ORIGIN_IP;
  if (originIp) {
    const hostname = new URL(BASE).hostname;
    const outcome = await knockOnOrigin({ originIp, hostname });
    const verdict = knockVerdict(originIp, hostname, outcome);
    console.log(verdict.message);
    if (verdict.exitCode !== 0) return verdict.exitCode;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(2);
  });
