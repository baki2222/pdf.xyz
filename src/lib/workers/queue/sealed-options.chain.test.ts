// @vitest-environment node
/**
 * A Protect or Unlock password never reaches the queue broker readable — and
 * still reaches the processor, on the first attempt and on a retry.
 *
 * Driven through the composed path, not the unit: the real request parser, the
 * real adapter's `createJob`, the real Redis provider built by the real factory
 * from env, into a fake broker that records EVERY command sent over the wire.
 * The scan reads that wire (keys and values alike), which is what an operator
 * with the broker token — or anyone who obtained it — could read.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCreateJobRequest } from "@/lib/jobs";
import { getWorkerAdapter } from "../adapter";
import { S3_ENV } from "../storage/s3-config";
import { REDIS_QUEUE_ENV } from "./redis-config";
import { createFakeRedis, type FakeRedis } from "./redis-fake";
import { createQueueProvider } from "./factory";
import type { ClaimableQueue } from "./claim";
import {
  SEAL_ENV,
  SEALED_OPTION_FIELDS,
  generateSealKeyPair,
} from "./sealed-options";

const s3Env = (): Record<string, string> => ({
  [S3_ENV.provider]: "s3",
  [S3_ENV.endpoint]: "https://acct.r2.cloudflarestorage.com",
  [S3_ENV.region]: "auto",
  [S3_ENV.bucket]: "pdfxyz-prod",
  [S3_ENV.accessKeyId]: "AKIAEXAMPLE0000000",
  [S3_ENV.secretAccessKey]: "s3cr3tEXAMPLEkeyValue00000000000000000000",
});
const redisEnv = (): Record<string, string> => ({
  [REDIS_QUEUE_ENV.provider]: "redis",
  [REDIS_QUEUE_ENV.restUrl]: "https://example.upstash.io",
  [REDIS_QUEUE_ENV.restToken]: "AX_tokenEXAMPLEvalue000000000000000000000",
});

const USER_PW = `user-canary-${process.pid}-Zq7`;
const OWNER_PW = `owner-canary-${process.pid}-Kx3`;
const keys = generateSealKeyPair();

const JOBS = [
  {
    tool: "protect-pdf",
    inputs: ["f_1234567890"],
    options: { password: USER_PW, ownerPassword: OWNER_PW, keyLength: 256 },
  },
  {
    tool: "unlock-pdf",
    inputs: ["f_2234567890"],
    options: { password: USER_PW },
  },
];

/** Everything the broker was ever sent — keys, values, script args. */
const wire = (fake: FakeRedis) => fake.calls.flat().join("\n");

async function submitAll(fake: FakeRedis, sealKey?: string) {
  const adapter = await getWorkerAdapter(
    {
      ...s3Env(),
      ...redisEnv(),
      ...(sealKey ? { [SEAL_ENV.publicKey]: sealKey } : {}),
    },
    { queue: { client: fake } },
  );
  const ids: string[] = [];
  for (const body of JOBS) {
    const parsed = parseCreateJobRequest(body);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    const created = await adapter.createJob(parsed.value);
    if (!created.ok) throw new Error(JSON.stringify(created.error));
    ids.push(created.value.jobId);
  }
  return ids;
}

const worker = (fake: FakeRedis, privateKey?: string) =>
  createQueueProvider(
    {
      ...redisEnv(),
      ...(privateKey ? { [SEAL_ENV.privateKey]: privateKey } : {}),
    },
    { client: fake },
  ) as ClaimableQueue;

describe("secret job options are sealed before the queue broker sees them", () => {
  it("POSITIVE CONTROL: with no seal key the wire carries the password (the scan can see it)", async () => {
    const fake = createFakeRedis();
    await submitAll(fake);
    expect(wire(fake)).toContain(USER_PW);
    expect(wire(fake)).toContain(OWNER_PW);
  });

  it("with the web tier's public key, no password appears anywhere on the wire", async () => {
    const fake = createFakeRedis();
    await submitAll(fake, keys.publicKey);
    // Health check: the jobs were really written, so an empty wire cannot pass.
    expect(fake.calls.length).toBeGreaterThan(4);
    expect(wire(fake)).not.toContain(USER_PW);
    expect(wire(fake)).not.toContain(OWNER_PW);
    expect(wire(fake)).not.toContain(Buffer.from(USER_PW).toString("base64"));
  });

  it("the worker's private key opens them on claim, and again after a requeue", async () => {
    const fake = createFakeRedis();
    await submitAll(fake, keys.publicKey);
    const queue = worker(fake, keys.privateKey);
    const seen: Record<string, unknown>[] = [];
    for (let i = 0; i < JOBS.length; i++) {
      const claimed = await queue.claim({ leaseMs: 60_000 });
      if (!claimed.ok || !claimed.value) throw new Error("nothing claimed");
      seen.push(claimed.value.options);
    }
    expect(seen.map((o) => [o.password, o.ownerPassword])).toEqual(
      expect.arrayContaining([
        [USER_PW, OWNER_PW],
        [USER_PW, undefined],
      ]),
    );

    // A retryable failure requeues and KEEPS the spec; the retry must still
    // find the password — which is why the box is never deleted on claim.
    const fake2 = createFakeRedis();
    const [jobId] = await submitAll(fake2, keys.publicKey);
    const q2 = worker(fake2, keys.privateKey);
    const first = await q2.claim({ leaseMs: 60_000 });
    if (!first.ok || !first.value) throw new Error("nothing claimed");
    const firstJobId = first.value.job.jobId;
    await q2.fail(
      firstJobId,
      { code: "internal_error", message: "transient", retryable: true },
      { requeue: true },
      first.value.attempt,
    );
    let retried = null;
    for (let i = 0; i < 3 && !retried; i++) {
      const next = await q2.claim({ leaseMs: 60_000 });
      if (next.ok && next.value?.job.jobId === firstJobId) retried = next.value;
    }
    expect(jobId).toBeDefined();
    expect(retried?.attempt).toBe(2);
    expect(retried?.options.password).toBe(USER_PW);
  });

  it("a worker without the key fails the job closed instead of running it passwordless", async () => {
    for (const privateKey of [undefined, generateSealKeyPair().privateKey]) {
      const fake = createFakeRedis();
      const [jobId] = await submitAll(fake, keys.publicKey);
      const queue = worker(fake, privateKey);
      const claimed = await queue.claim({ leaseMs: 60_000 });
      expect(claimed.ok && claimed.value).toBeNull();
      const status = await queue.status(jobId!);
      expect(status.ok && status.value.status).toBe("failed");
    }
  });

  it("a pre-rollout plaintext job still runs on a worker that has the key", async () => {
    const fake = createFakeRedis();
    await submitAll(fake);
    const claimed = await worker(fake, keys.privateKey).claim({
      leaseMs: 60_000,
    });
    expect(claimed.ok && claimed.value?.options.password).toBe(USER_PW);
  });

  /*
   * The sealed field list is a MECHANISM; the property is "every field the job
   * validator treats as a password". Discover that set from the parser's own
   * source rather than trusting the list to keep up.
   */
  it("seals exactly the fields the validator parses as passwords", () => {
    const hits = execFileSync(
      "git",
      ["grep", "-h", "-A1", "parsePassword(", "--", "src/lib/jobs"],
      { encoding: "utf8" },
    );
    const discovered = new Set(
      [...hits.matchAll(/options\.(\w+)/g)].map((m) => m[1]!),
    );
    // Health check: password + ownerPassword are both parsed today.
    expect(discovered.size).toBeGreaterThanOrEqual(2);
    expect([...discovered].sort()).toEqual([...SEALED_OPTION_FIELDS].sort());
  });
});

/*
 * What the product SAYS about the password, pinned to what the queue DOES.
 *
 * Until 2026-09 the Protect/Unlock panel said the password was "never stored
 * or logged" while the queue held it in plaintext for up to the queue TTL.
 * Sealing does not make "never stored" true — ciphertext is stored — so the
 * claim is banned outright, and the claim that replaced it ("deleted when the
 * job finishes or is cancelled") is pinned to the broker below.
 */
const SHIPPED_PASSWORD_CLAIMS = [
  "Your password is used only to perform the operation and is never stored or logged.",
  "Your password is sent to that worker only to encrypt the file, and the input is wiped right after.",
  "your password is sent to it only to perform the operation.",
];
const PASSWORD_CLAIM_SYNONYMS = [
  "We never save your password.",
  "Passwords are not retained anywhere.",
  "we do not store your password",
];
const PASSWORD_CLAIM_PATTERNS: readonly RegExp[] = [
  /password[^.]{0,80}\b(?:never|not) (?:stored|saved|kept|retained)\b/i,
  /\b(?:never|not) (?:store|save|keep|retain)s?\b[^.]{0,40}password/i,
  /password is sent to (?:that worker|it|the worker) only/i,
];

describe("password copy matches the queue", () => {
  it("every pattern catches a shipped claim or synonym, and each of those is caught", () => {
    const corpus = [...SHIPPED_PASSWORD_CLAIMS, ...PASSWORD_CLAIM_SYNONYMS];
    expect(
      corpus.filter((s) => !PASSWORD_CLAIM_PATTERNS.some((p) => p.test(s))),
    ).toEqual([]);
    expect(
      PASSWORD_CLAIM_PATTERNS.filter((p) => !corpus.some((s) => p.test(s))),
    ).toEqual([]);
  });

  it("no source file claims the password is never stored or goes only to the worker", () => {
    const files = execFileSync("git", ["ls-files", "-z", "src"], {
      encoding: "utf8",
    })
      .split("\0")
      .filter((f) => /\.(tsx?)$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(500);
    const offenders = files.filter((f) => {
      const text = readFileSync(f, "utf8")
        .replace(/\{"\s*"\}/g, " ")
        .replace(/&apos;/g, "'")
        .replace(/\s+/g, " ");
      return PASSWORD_CLAIM_PATTERNS.some((p) => p.test(text));
    });
    expect(offenders).toEqual([]);
  });

  it("the queue really deletes the sealed password when a job finishes or is cancelled", async () => {
    const fake = createFakeRedis();
    const [protectId, unlockId] = await submitAll(fake, keys.publicKey);
    const specKeys = () => fake.keys().filter((k) => k.includes(":spec:"));
    // Health check: both specs exist before anything happens.
    expect(specKeys()).toHaveLength(2);

    const queue = worker(fake, keys.privateKey);
    const claimed = await queue.claim({ leaseMs: 60_000 });
    if (!claimed.ok || !claimed.value) throw new Error("nothing claimed");
    expect(claimed.value.job.jobId).toBe(protectId);
    await queue.fail(
      protectId!,
      { code: "internal_error", message: "done", retryable: false },
      { requeue: false },
      claimed.value.attempt,
    );
    await queue.cancel(unlockId!);
    expect(specKeys()).toEqual([]);
  });
});
