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
 * EXIT CODES
 *   0  a 429 was observed — throttling is live
 *   1  the limit was never reached — throttling is NOT enforcing
 *   2  the run could not complete (network, unexpected status)
 */

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

async function attempt(): Promise<Observation> {
  const res = await fetch(`${BASE}/api/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(2);
  });
