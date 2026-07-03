// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JOB_LIMITS, REQUIRED_WORKER_ENV } from "@/lib/jobs";
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

describe("POST /api/uploads — intake guardrails", () => {
  it("rejects too many files with 422 (too_many_files) before tool validation", async () => {
    const files = Array.from({ length: JOB_LIMITS.maxInputFiles + 1 }, () => file);
    const res = await POST(post({ tool: "ocr-pdf", files }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("too_many_files");
  });

  it("rejects an over-size file with 413 (file_too_large)", async () => {
    const res = await POST(
      post({ tool: "ocr-pdf", files: [{ ...file, bytes: JOB_LIMITS.maxFileBytes + 1 }] }),
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("file_too_large");
  });

  it("rejects an unrecognized file type with 415 (unsupported_file_type)", async () => {
    const res = await POST(
      post({
        tool: "ocr-pdf",
        files: [{ filename: "x.bin", contentType: "application/x-msdownload", bytes: 10 }],
      }),
    );
    expect(res.status).toBe(415);
    expect((await res.json()).error.code).toBe("unsupported_file_type");
  });

  it("never echoes a hostile filename in the 400 response body", async () => {
    const res = await POST(
      post({
        tool: "ocr-pdf",
        files: [{ ...file, filename: "../../etc/passwd/obj_secret" }],
      }),
    );
    expect(res.status).toBe(400);
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain("passwd");
    expect(raw).not.toContain("obj_secret");
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

  it("rate limiting wins over intake: a throttled, intake-violating request is 429", async () => {
    const policy = policyFor("uploads.create");
    const bare = new Request("http://localhost/api/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    for (let i = 0; i < policy.limit; i++) await enforceRateLimit("uploads.create", bare);

    // This body ALSO violates intake (too many files); the abuse guard runs first,
    // so the deterministic outcome is 429 — never the intake code.
    const files = Array.from({ length: JOB_LIMITS.maxInputFiles + 5 }, () => file);
    const denied = await POST(post({ tool: "ocr-pdf", files }));
    expect(denied.status).toBe(429);
    expect((await denied.json()).error.code).toBe("rate_limited");
  });
});
