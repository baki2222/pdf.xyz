// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { REQUIRED_WORKER_ENV, type Job, type UploadSession } from "@/lib/jobs";
import { WORKER_MODE_ENV } from "@/lib/workers";
import { devWorkerStore } from "@/lib/workers/store";
import { POST as createUpload } from "../uploads/route";
import { PUT as putBytes } from "../uploads/local/[fileId]/route";
import { POST as createJob } from "../jobs/route";
import { GET as getJob } from "../jobs/[id]/route";
import { GET as getArtifact } from "../artifacts/local/[artifactId]/route";

/**
 * End-to-end proof that the local-dev worker runs the *whole documented flow*
 * through the real Next route handlers — create session → direct upload → create
 * job → poll status → download — for the always-available lossless profile, with
 * no native binary required. Deterministic on any host.
 */

const JSON_HEADERS = { "content-type": "application/json" };

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/** A standalone ArrayBuffer body (a concrete, portable BodyInit). */
function toBody(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

async function makePdf(pages = 5): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300, 300]);
  return doc.save();
}

beforeEach(() => {
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
  process.env[WORKER_MODE_ENV] = "local-dev";
  devWorkerStore.reset();
});

afterEach(() => {
  delete process.env[WORKER_MODE_ENV];
});

describe("local-dev compression — full route flow", () => {
  it("uploads, compresses losslessly, polls, and downloads a real PDF", async () => {
    const pdf = await makePdf(5);

    // 1. Create the upload session.
    const sessionRes = await createUpload(
      jsonRequest("http://localhost/api/uploads", {
        tool: "compress-pdf",
        files: [
          {
            filename: "report.pdf",
            contentType: "application/pdf",
            bytes: pdf.byteLength,
          },
        ],
      }),
    );
    expect(sessionRes.status).toBe(201);
    const session = (await sessionRes.json()) as UploadSession;
    const slot = session.slots[0];
    expect(slot?.url).toMatch(/^\/api\/uploads\/local\/f_/);

    // 2. Upload the bytes to the reserved slot.
    const uploadRes = await putBytes(
      new Request(`http://localhost${slot!.url}`, {
        method: "PUT",
        headers: slot!.headers,
        body: toBody(pdf),
      }),
      { params: Promise.resolve({ fileId: slot!.fileId }) },
    );
    expect(uploadRes.status).toBe(200);

    // 3. Create the job (lossless — always available, no native binary).
    const jobRes = await createJob(
      jsonRequest("http://localhost/api/jobs", {
        tool: "compress-pdf",
        inputs: [slot!.fileId],
        options: { profile: "lossless" },
      }),
    );
    expect(jobRes.status).toBe(201);
    const job = (await jobRes.json()) as Job;
    expect(job.status).toBe("completed");
    const artifact = job.artifacts?.[0];
    expect(artifact?.url).toMatch(/^\/api\/artifacts\/local\/art_/);
    // The output is named from the uploaded filename (no inputNames supplied).
    expect(artifact?.filename).toBe("report-compressed.pdf");

    // 4. Poll status → same terminal job.
    const statusRes = await getJob(
      new Request(`http://localhost/api/jobs/${job.jobId}`),
      { params: Promise.resolve({ id: job.jobId }) },
    );
    expect(statusRes.status).toBe(200);
    expect(((await statusRes.json()) as Job).status).toBe("completed");

    // 5. Download the artifact — a real, valid PDF preserving the page count.
    const artifactId = artifact!.url.split("/").pop()!;
    const dlRes = await getArtifact(
      new Request(`http://localhost${artifact!.url}`),
      { params: Promise.resolve({ artifactId }) },
    );
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers.get("content-type")).toBe("application/pdf");
    const out = new Uint8Array(await dlRes.arrayBuffer());
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(5);
  });

  it("names the download from request inputNames end-to-end through the routes", async () => {
    const pdf = await makePdf(3);
    const sessionRes = await createUpload(
      jsonRequest("http://localhost/api/uploads", {
        tool: "compress-pdf",
        files: [
          {
            filename: "upload.pdf",
            contentType: "application/pdf",
            bytes: pdf.byteLength,
          },
        ],
      }),
    );
    const session = (await sessionRes.json()) as UploadSession;
    const slot = session.slots[0]!;
    await putBytes(
      new Request(`http://localhost${slot.url}`, {
        method: "PUT",
        headers: slot.headers,
        body: toBody(pdf),
      }),
      { params: Promise.resolve({ fileId: slot.fileId }) },
    );

    const jobRes = await createJob(
      jsonRequest("http://localhost/api/jobs", {
        tool: "compress-pdf",
        inputs: [slot.fileId],
        inputNames: ["Quarterly Statement.pdf"],
        options: { profile: "lossless" },
      }),
    );
    expect(jobRes.status).toBe(201);
    const job = (await jobRes.json()) as Job;
    // The sanitized display name drives the safe download filename surfaced to
    // the client — never the object id or a fabricated fallback.
    expect(job.artifacts?.[0]?.filename).toBe(
      "Quarterly Statement-compressed.pdf",
    );
  });

  it("wipes the input after processing: a second job on the same file 404s", async () => {
    const pdf = await makePdf(2);
    const sessionRes = await createUpload(
      jsonRequest("http://localhost/api/uploads", {
        tool: "compress-pdf",
        files: [
          {
            filename: "a.pdf",
            contentType: "application/pdf",
            bytes: pdf.byteLength,
          },
        ],
      }),
    );
    const session = (await sessionRes.json()) as UploadSession;
    const fileId = session.slots[0]!.fileId;

    await putBytes(
      new Request(`http://localhost/api/uploads/local/${fileId}`, {
        method: "PUT",
        headers: { "content-type": "application/pdf" },
        body: toBody(pdf),
      }),
      { params: Promise.resolve({ fileId }) },
    );

    const first = await createJob(
      jsonRequest("http://localhost/api/jobs", {
        tool: "compress-pdf",
        inputs: [fileId],
        options: { profile: "lossless" },
      }),
    );
    expect(first.status).toBe(201);
    expect(devWorkerStore.getSlot(fileId)).toBeUndefined();

    // The input is gone, so reusing it is an honest not-found.
    const second = await createJob(
      jsonRequest("http://localhost/api/jobs", {
        tool: "compress-pdf",
        inputs: [fileId],
        options: { profile: "lossless" },
      }),
    );
    expect(second.status).toBe(404);
    expect((await second.json()).error.code).toBe("not_found");
  });
});
