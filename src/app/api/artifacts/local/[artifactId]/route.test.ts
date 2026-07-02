// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { WORKER_MODE_ENV } from "@/lib/workers";
import { devWorkerStore, newArtifactId, newJobId } from "@/lib/workers/store";
import { GET } from "./route";

function get(artifactId: string): Promise<Response> {
  return GET(
    new Request(`http://localhost/api/artifacts/local/${artifactId}`),
    { params: Promise.resolve({ artifactId }) },
  );
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

/** Seed a downloadable artifact and return its id. */
function seedArtifact(bytes: Uint8Array, filename = "report-compressed.pdf"): string {
  const artifactId = newArtifactId();
  devWorkerStore.putArtifact({
    artifactId,
    jobId: newJobId(),
    filename,
    contentType: "application/pdf",
    bytes,
  });
  return artifactId;
}

describe("GET /api/artifacts/local/[artifactId]", () => {
  it("is inert (503) unless local-dev mode is on", async () => {
    disableWorker();
    const res = await get(newArtifactId());
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("worker_not_configured");
  });

  it("rejects a malformed artifact id with 400", async () => {
    enableLocalDev();
    const res = await get("nope");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });

  it("returns 404 for an unknown artifact", async () => {
    enableLocalDev();
    const res = await get(newArtifactId());
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("streams the stored PDF as a no-store attachment", async () => {
    enableLocalDev();
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const artifactId = seedArtifact(bytes);

    const res = await get(artifactId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain(
      "report-compressed.pdf",
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });
});
