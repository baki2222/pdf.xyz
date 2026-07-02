// @vitest-environment node
import { describe, expect, it } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { REDIS_QUEUE_ENV } from "./redis-config";
import { createFakeRedis } from "./redis-fake";
import { createQueueProvider } from "./factory";

const redisEnv = (
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> => ({
  [REDIS_QUEUE_ENV.provider]: "redis",
  [REDIS_QUEUE_ENV.restUrl]: "https://example.upstash.io",
  [REDIS_QUEUE_ENV.restToken]: "AX_tokenEXAMPLEvalue000000000000000000000",
  ...overrides,
});

describe("createQueueProvider", () => {
  it("returns the real redis provider when configured and valid", () => {
    const q = createQueueProvider(redisEnv(), { client: createFakeRedis() });
    expect(q.id).toBe("redis");
    expect(q.probe().ok).toBe(true);
    expect(q.capability()).toMatchObject({ provider: "redis", ready: true });
  });

  it("falls back to the disabled provider when unset and no backend vars", () => {
    const q = createQueueProvider({});
    expect(q.id).toBe("disabled");
    const probe = q.probe();
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.error.reason).toBe("not_configured");
  });

  it("falls back to remote-unimplemented when legacy backend vars are present", () => {
    const env = Object.fromEntries(REQUIRED_WORKER_ENV.map((n) => [n, "set"]));
    const q = createQueueProvider(env);
    expect(q.id).toBe("remote-unimplemented");
    const probe = q.probe();
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.error.reason).toBe("not_implemented");
  });

  it("falls back to not-configured — never a dummy provider — when redis is selected but misconfigured", () => {
    const q = createQueueProvider(redisEnv({ [REDIS_QUEUE_ENV.restToken]: undefined }));
    expect(q.id).not.toBe("redis");
    expect(q.probe().ok).toBe(false);
  });
});
