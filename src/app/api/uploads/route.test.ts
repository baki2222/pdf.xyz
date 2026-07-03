// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { RATE_LIMIT_ENV, policyFor } from "@/lib/ratelimit";
import { enforceRateLimit, resetRateLimitGuardForTests } from "@/lib/ratelimit/guard";
import { POST } from "./route";

const file = {
  filename: "scan.pdf",
  contentType: "application/pdf",
  bytes: 1024,
};

function post(body: unknown): Request {
  return new Request("http://localhost/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
});

describe("POST /api/uploads", () => {
  it("honestly returns 503 not-configured for a well-formed session", async () => {
    const res = await POST(post({ tool: "ocr-pdf", files: [file] }));
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).error.code).toBe("worker_not_configured");
  });

  it("rejects an in-browser tool with 422", async () => {
    const res = await POST(post({ tool: "merge-pdf", files: [file] }));
    expect(res.status).toBe(422);
  });

  it("rejects a filename with path traversal with 400", async () => {
    const res = await POST(
      post({ tool: "ocr-pdf", files: [{ ...file, filename: "../secret.pdf" }] }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/uploads — abuse guard", () => {
  beforeEach(() => {
    resetRateLimitGuardForTests();
    process.env[RATE_LIMIT_ENV.provider] = "local-memory";
  });
  afterEach(() => {
    resetRateLimitGuardForTests();
    delete process.env[RATE_LIMIT_ENV.provider];
  });

  it("leaves a request under the budget on its normal (503) path", async () => {
    const res = await POST(post({ tool: "ocr-pdf", files: [file] }));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBeNull();
  });

  it("returns 429 with Retry-After once the uploads budget is spent", async () => {
    const policy = policyFor("uploads.create");
    const bare = new Request("http://localhost/api/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    // Pre-spend the shared budget cheaply; the route call is then the one over.
    for (let i = 0; i < policy.limit; i++) await enforceRateLimit("uploads.create", bare);

    const denied = await POST(post({ tool: "ocr-pdf", files: [file] }));
    expect(denied.status).toBe(429);
    expect((await denied.json()).error.code).toBe("rate_limited");
    expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
