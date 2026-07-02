// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { WORKER_MODE_ENV } from "@/lib/workers";
import { GET } from "./route";

function clearEnv() {
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
  delete process.env[WORKER_MODE_ENV];
}

beforeEach(clearEnv);
afterEach(clearEnv);

describe("GET /api/worker/status", () => {
  it("reports disabled with no capability by default", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.mode).toBe("disabled");
    expect(body.enabled).toBe(false);
    expect(body.compress).toEqual({ lossless: false, deep: false, engines: [] });
  });

  it("reports remote-configured when backend vars are present", async () => {
    for (const name of REQUIRED_WORKER_ENV) process.env[name] = "set";
    const res = await GET();
    const body = await res.json();
    expect(body.mode).toBe("remote-configured");
    expect(body.enabled).toBe(false);
  });

  it("reports local-dev as enabled with real lossless when opted in", async () => {
    process.env[WORKER_MODE_ENV] = "local-dev";
    const res = await GET();
    const body = await res.json();
    expect(body.mode).toBe("local-dev");
    expect(body.enabled).toBe(true);
    expect(body.localDevOnly).toBe(true);
    expect(body.compress.lossless).toBe(true);
    // Deep reflects a real PATH probe on this host — a boolean either way.
    expect(typeof body.compress.deep).toBe("boolean");
    expect(Array.isArray(body.compress.engines)).toBe(true);
  });
});
