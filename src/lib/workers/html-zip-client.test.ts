// @vitest-environment node
/**
 * The ZIP run's requests, sent through the REAL server gates they meet: the
 * upload body through the intake (`evaluateUploadDescriptors`) and the
 * per-tool validator (`parseCreateUploadSessionRequest`), the job body
 * through `parseCreateJobRequest`. Two boundaries can each pass their own
 * tests while the path through them drops everything (CLAUDE.md, "verify
 * the composed chain"): `runSecurityJob` declares a type from the file's
 * extension, which for a .zip is no type at all, so the ZIP run must
 * declare its own — and the server must take exactly what it declares.
 */
import { describe, expect, it } from "vitest";
import { runWorkerHtmlZipToPdf } from "./html-zip-client";
import type { FetchLike } from "./pdf-security-client";
import {
  parseCreateJobRequest,
  parseCreateUploadSessionRequest,
} from "@/lib/jobs/validation";
import { evaluateUploadDescriptors } from "@/lib/uploads/intake";

function json(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

const completed = {
  jobId: "job_1",
  status: "completed",
  artifacts: [
    {
      artifactId: "a_1",
      filename: "site.pdf",
      contentType: "application/pdf",
      bytes: 4,
      url: "https://art.example/out",
      expiresAt: "2099-01-01T00:00:00Z",
    },
  ],
};

describe("runWorkerHtmlZipToPdf", () => {
  it("declares the upload a ZIP and the job's page, and the real gates take both", async () => {
    const bodies: Record<string, unknown> = {};
    const fetchImpl: FetchLike = async (url, init) => {
      if (init?.body && (url === "/api/uploads" || url === "/api/jobs"))
        bodies[url] = JSON.parse(new TextDecoder().decode(init.body));
      if (url === "/api/uploads")
        return json({
          slots: [
            {
              fileId: "f_htmlzipfile01",
              url: "https://upload.example/slot",
              method: "PUT",
              headers: {},
            },
          ],
        });
      if (url === "https://upload.example/slot") return json({});
      if (url === "/api/jobs") return json(completed);
      if (url === "https://art.example/out")
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
        };
      throw new Error(`unexpected ${url}`);
    };
    const result = await runWorkerHtmlZipToPdf(
      {
        filename: "site.zip",
        bytes: new Uint8Array([0x50, 0x4b, 3, 4]),
        entry: "site/about.html",
        layout: { onePage: true, entry: "a layout key must not win" },
      },
      { fetchImpl },
    );
    expect(result.ok).toBe(true);

    const upload = bodies["/api/uploads"];
    expect(upload).toMatchObject({
      tool: "html-to-pdf",
      files: [{ filename: "site.zip", contentType: "application/zip" }],
    });
    expect(evaluateUploadDescriptors(upload).ok).toBe(true);
    expect(parseCreateUploadSessionRequest(upload).ok).toBe(true);

    const job = bodies["/api/jobs"] as { options: Record<string, unknown> };
    expect(job.options.entry).toBe("site/about.html");
    expect(job).toMatchObject({ inputNames: ["site.zip"] });
    expect(parseCreateJobRequest(job)).toMatchObject({ ok: true });
  });

  it("control: the same upload for another tool, or declared as HTML, is refused by the validator", () => {
    const zip = {
      filename: "site.zip",
      contentType: "application/zip",
      bytes: 10,
    };
    expect(
      parseCreateUploadSessionRequest({ tool: "word-to-pdf", files: [zip] }).ok,
    ).toBe(false);
    expect(
      evaluateUploadDescriptors({
        tool: "html-to-pdf",
        files: [{ ...zip, contentType: "text/html" }],
      }).ok,
    ).toBe(false);
  });
});
