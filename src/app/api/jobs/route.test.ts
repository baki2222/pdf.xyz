// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { RATE_LIMIT_ENV, policyFor } from "@/lib/ratelimit";
import { resetRateLimitGuardForTests } from "@/lib/ratelimit/guard";
import { POST } from "./route";

function post(
  body: unknown,
  headers: Record<string, string> = { "content-type": "application/json" },
): Request {
  return new Request("http://localhost/api/jobs", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  // Deterministic: never treat the test host as a configured backend.
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
});

describe("POST /api/jobs", () => {
  it("honestly returns 503 not-configured for a well-formed job", async () => {
    const res = await POST(post({ tool: "ocr-pdf", inputs: ["f_1234567890"] }));
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = await res.json();
    expect(json.error.code).toBe("worker_not_configured");
  });

  it("never fakes a completed job (no artifacts, no success status)", async () => {
    const res = await POST(post({ tool: "ocr-pdf", inputs: ["f_1234567890"] }));
    const json = await res.json();
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(json).not.toHaveProperty("artifacts");
    expect(JSON.stringify(json)).not.toContain("completed");
  });

  it("rejects an unknown tool with 404", async () => {
    const res = await POST(post({ tool: "nope-pdf", inputs: ["f_1234567890"] }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("unsupported_tool");
  });

  it("rejects an in-browser tool with 422", async () => {
    const res = await POST(post({ tool: "merge-pdf", inputs: ["f_1234567890"] }));
    expect(res.status).toBe(422);
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await POST(post("{ not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });

  it("requires application/json with 415", async () => {
    const res = await POST(
      post({ tool: "ocr-pdf", inputs: ["f_1234567890"] }, { "content-type": "text/plain" }),
    );
    expect(res.status).toBe(415);
  });

  it("rejects an unsafe URL for a URL-input tool with 422", async () => {
    const res = await POST(
      post({ tool: "webpage-to-pdf", options: { url: "http://127.0.0.1/admin" } }),
    );
    expect(res.status).toBe(422);
  });
});

describe("POST /api/jobs — abuse guard", () => {
  beforeEach(() => {
    resetRateLimitGuardForTests();
    process.env[RATE_LIMIT_ENV.provider] = "local-memory";
  });
  afterEach(() => {
    resetRateLimitGuardForTests();
    delete process.env[RATE_LIMIT_ENV.provider];
    delete process.env[RATE_LIMIT_ENV.trustForwardedFor];
  });

  const validJob = { tool: "ocr-pdf", inputs: ["f_1234567890"] };

  it("leaves a request under the budget on its normal (503 not-configured) path", async () => {
    const res = await POST(post(validJob));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBeNull();
    expect((await res.json()).error.code).toBe("worker_not_configured");
  });

  it("returns 429 with a Retry-After header once the per-window budget is spent", async () => {
    const policy = policyFor("jobs.create");
    let last: Response | undefined;
    for (let i = 0; i < policy.limit; i++) last = await POST(post(validJob));
    // The last allowed request still takes the normal not-configured path.
    expect(last?.status).toBe(503);

    const denied = await POST(post(validJob));
    expect(denied.status).toBe(429);
    expect((await denied.json()).error.code).toBe("rate_limited");
    expect(denied.headers.get("cache-control")).toBe("no-store");
    const retryAfter = Number(denied.headers.get("retry-after"));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
  });

  it("never leaks request identity in the 429 (hostile headers + body)", async () => {
    process.env[RATE_LIMIT_ENV.trustForwardedFor] = "on";
    const hostileHeaders = {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.42",
      "user-agent": "EvilBot/9.9",
      cookie: "session=SUPERSECRET",
    };
    const hostileBody = JSON.stringify({
      tool: "ocr-pdf",
      inputs: ["f_evilinput"],
      inputNames: ["/etc/shadow"],
      idempotencyKey: "idem_SUPERSECRET",
    });
    const request = () =>
      new Request("http://localhost/api/jobs", {
        method: "POST",
        headers: hostileHeaders,
        body: hostileBody,
      });

    const policy = policyFor("jobs.create");
    let denied: Response | undefined;
    for (let i = 0; i <= policy.limit; i++) denied = await POST(request());
    expect(denied?.status).toBe(429);

    // The guard runs before the body is parsed, and the client address is only
    // ever a salted hash — so no header, body value, or address reaches the wire.
    const bodyText = JSON.stringify(await denied!.json());
    const headerText = [...denied!.headers].map(([k, v]) => `${k}:${v}`).join(" ");
    for (const leak of [
      "203.0.113.42",
      "EvilBot",
      "SUPERSECRET",
      "/etc/shadow",
      "f_evilinput",
    ]) {
      expect(bodyText).not.toContain(leak);
      expect(headerText).not.toContain(leak);
    }
  });
});
