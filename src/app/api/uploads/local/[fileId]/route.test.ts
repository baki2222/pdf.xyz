// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JOB_LIMITS, REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { WORKER_MODE_ENV } from "@/lib/workers";
import { devWorkerStore } from "@/lib/workers/store";
import { PUT } from "./route";

function put(
  fileId: string,
  body?: Uint8Array,
  headers: Record<string, string> = {},
): Promise<Response> {
  const init: RequestInit = { method: "PUT", headers };
  if (body) {
    const buf = new ArrayBuffer(body.byteLength);
    new Uint8Array(buf).set(body);
    init.body = buf;
  }
  return PUT(new Request(`http://localhost/api/uploads/local/${fileId}`, init), {
    params: Promise.resolve({ fileId }),
  });
}

function enableLocalDev() {
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
  process.env[WORKER_MODE_ENV] = "local-dev";
}

function disableWorker() {
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
  delete process.env[WORKER_MODE_ENV];
}

beforeEach(() => {
  devWorkerStore.reset();
});
afterEach(disableWorker);

/** Reserve a slot in the singleton store and return its fileId. */
function reserve(declaredBytes: number): string {
  return devWorkerStore.reserveSlot({
    sessionId: "sess_test000000",
    filename: "report.pdf",
    contentType: "application/pdf",
    declaredBytes,
  }).fileId;
}

describe("PUT /api/uploads/local/[fileId]", () => {
  it("is inert (503) unless local-dev mode is on", async () => {
    disableWorker();
    const res = await put("f_abcdefghij", new Uint8Array([1]));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("worker_not_configured");
  });

  it("rejects a malformed file id with 400", async () => {
    enableLocalDev();
    const res = await put("not-a-file-id", new Uint8Array([1]));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });

  it("returns 404 for an unknown slot", async () => {
    enableLocalDev();
    const res = await put("f_unknown00000", new Uint8Array([1]));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("rejects a declared content-length over the per-file limit with 413", async () => {
    enableLocalDev();
    const fileId = reserve(4);
    const res = await put(fileId, undefined, {
      "content-length": String(JOB_LIMITS.maxFileBytes + 1),
    });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("payload_too_large");
  });

  it("rejects a size mismatch with 422", async () => {
    enableLocalDev();
    const fileId = reserve(4);
    const res = await put(fileId, new Uint8Array([1, 2, 3]));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("unprocessable_entity");
  });

  it("accepts bytes that match the declared size", async () => {
    enableLocalDev();
    const fileId = reserve(4);
    const res = await put(fileId, new Uint8Array([1, 2, 3, 4]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, fileId, bytes: 4 });
    // The bytes really landed in the slot.
    expect(devWorkerStore.getSlot(fileId)?.bytes).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });
});
