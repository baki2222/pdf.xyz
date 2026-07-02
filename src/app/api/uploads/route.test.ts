// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
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
