// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { GET } from "./route";

function get(id: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/jobs/${id}`), {
    params: Promise.resolve({ id }),
  });
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
