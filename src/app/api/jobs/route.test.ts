// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
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
