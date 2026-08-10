// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { RATE_LIMIT_ENV, policyFor } from "@/lib/ratelimit";
import {
  enforceRateLimit,
  resetRateLimitGuardForTests,
} from "@/lib/ratelimit/guard";
import { DELETE, GET } from "./route";

function get(id: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/jobs/${id}`), {
    params: Promise.resolve({ id }),
  });
}

function del(id: string): Promise<Response> {
  return DELETE(
    new Request(`http://localhost/api/jobs/${id}`, { method: "DELETE" }),
    {
      params: Promise.resolve({ id }),
    },
  );
}

beforeEach(() => {
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
});

describe("GET /api/jobs/[id]", () => {
  it("honestly returns 503 not-configured for a well-formed id", async () => {
    const res = await get("job_abcdefghij");
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).error.code).toBe("worker_not_configured");
  });

  it("rejects a malformed id with 400", async () => {
    const res = await get("not-a-job-id");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });

  it("never fabricates a completed job", async () => {
    const res = await get("job_abcdefghij");
    expect(JSON.stringify(await res.json())).not.toContain("completed");
  });
});

describe("DELETE /api/jobs/[id]", () => {
  it("honestly returns 503 not-configured for delete-now without a backend", async () => {
    const res = await del("job_abcdefghij");
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).error.code).toBe("worker_not_configured");
  });

  it("rejects a malformed id with 400", async () => {
    const res = await del("not-a-job-id");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });
});

describe("/api/jobs/[id] — abuse guard", () => {
  beforeEach(() => {
    resetRateLimitGuardForTests();
    process.env[RATE_LIMIT_ENV.provider] = "local-memory";
  });
  afterEach(() => {
    resetRateLimitGuardForTests();
    delete process.env[RATE_LIMIT_ENV.provider];
  });

  it("throttles status polling with a 429 + Retry-After once the budget is spent", async () => {
    const policy = policyFor("jobs.status");
    const bare = new Request("http://localhost/api/jobs/job_abcdefghij");
    for (let i = 0; i < policy.limit; i++)
      await enforceRateLimit("jobs.status", bare);

    const denied = await get("job_abcdefghij");
    expect(denied.status).toBe(429);
    expect((await denied.json()).error.code).toBe("rate_limited");
    expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("throttles delete-now on its own independent budget", async () => {
    const policy = policyFor("jobs.delete");
    const bare = new Request("http://localhost/api/jobs/job_abcdefghij", {
      method: "DELETE",
    });
    for (let i = 0; i < policy.limit; i++)
      await enforceRateLimit("jobs.delete", bare);

    const denied = await del("job_abcdefghij");
    expect(denied.status).toBe(429);
    // Status shares nothing with delete: it is still on its normal path.
    const status = await get("job_abcdefghij");
    expect(status.status).toBe(503);
  });
});
