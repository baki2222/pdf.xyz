import { vi } from "vitest";
import { S3_ENV } from "@/lib/workers/storage/s3-config";
import { REDIS_QUEUE_ENV } from "@/lib/workers/queue/redis-config";
import {
  createFakeRedis,
  type FakeRedis,
} from "@/lib/workers/queue/redis-fake";
import { redisRestFetch } from "@/lib/workers/queue/redis-rest-fake";
import { heartbeatKey, WORKER_HEARTBEAT_ENV } from "@/lib/workers/heartbeat";

/**
 * A WIRED deployment for tests that drive the real `POST /api/jobs`: S3 and the
 * Redis queue configured, the queue answered by the faithful in-memory Redis
 * over the Upstash REST wire the real client speaks (`redis-rest-fake.ts`), so
 * the REAL adapter creates the job.
 *
 * WHY A CREATED JOB. Since the integration of wave1/l01-page-leak a job that is
 * NOT created costs nothing: the route releases the allowance it reserved when
 * `createJob` fails (`reserveAiCharacterAllowance`). Tests that measured the
 * charge against an unconfigured adapter — the route answered 503 AFTER
 * charging — now measure a refund. A charge that is kept needs a job that
 * exists.
 *
 * THE HEARTBEAT lives in the same Redis the route reads it from in
 * production, so a test publishes the running worker's record with
 * {@link publishHeartbeat} and the route finds it over the same wire.
 *
 * No module mock: the suite runs `isolate: false`. The global `fetch` stub is
 * removed by `vi.unstubAllGlobals()` and the environment by
 * {@link unwireJobRoute}.
 */
export const WIRED_QUEUE_URL = "https://queue-example-12345.upstash.io";

export const WIRED_JOB_ENV: Readonly<Record<string, string>> = {
  [S3_ENV.provider]: "s3",
  [S3_ENV.endpoint]: "https://s3.us-east-1.amazonaws.com",
  [S3_ENV.region]: "us-east-1",
  [S3_ENV.bucket]: "pdfxyz-test",
  [S3_ENV.accessKeyId]: "AKIAEXAMPLE0000000",
  [S3_ENV.secretAccessKey]: "s3cr3tEXAMPLEkeyValue00000000000000000000",
  [REDIS_QUEUE_ENV.provider]: "redis",
  [REDIS_QUEUE_ENV.restUrl]: WIRED_QUEUE_URL,
  [REDIS_QUEUE_ENV.restToken]: "AX_tokenEXAMPLEvalue000000000000000000000",
};

export interface WiredJobRoute {
  readonly redis: FakeRedis;
  /** How many times anything read the worker heartbeat key. */
  heartbeatReads(): number;
}

function commandOf(init: RequestInit | undefined): unknown {
  try {
    return JSON.parse(String(init?.body ?? "null"));
  } catch {
    return null;
  }
}

/** Wire the environment and the queue's Redis; see the module docblock. */
export function wireJobRoute(): WiredJobRoute {
  Object.assign(process.env, WIRED_JOB_ENV);
  const redis = createFakeRedis();
  const rest = redisRestFetch(redis, WIRED_QUEUE_URL);
  const key = heartbeatKey("pdfxyz");
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const command = commandOf(init);
      if (
        Array.isArray(command) &&
        command[0] === "GET" &&
        command[1] === key
      ) {
        reads += 1;
      }
      return rest(input, init);
    },
  );
  return { redis, heartbeatReads: () => reads };
}

/**
 * Turn the heartbeat on and publish `record` as the running worker's, or
 * publish nothing (`null`: heartbeats enabled, no worker has written one).
 */
export async function publishHeartbeat(
  route: WiredJobRoute,
  record: string | null,
): Promise<void> {
  process.env[WORKER_HEARTBEAT_ENV.enabled] = "enabled";
  if (record === null) return;
  const set = await route.redis.command([
    "SET",
    heartbeatKey("pdfxyz"),
    record,
  ]);
  if (!set.ok) throw new Error("could not publish the worker heartbeat");
}

/** Undo {@link wireJobRoute} and {@link publishHeartbeat}'s environment. */
export function unwireJobRoute(): void {
  for (const name of Object.keys(WIRED_JOB_ENV)) delete process.env[name];
  delete process.env[WORKER_HEARTBEAT_ENV.enabled];
}
