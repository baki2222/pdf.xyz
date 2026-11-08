// @vitest-environment node
/**
 * The browser half of `processor/ocr-first-own-options.chain.test.ts`
 * (integration of feat/w3-l03-ocr-in-conversions with feat/w3-l10-tables,
 * 2026-11-08): when a visitor ticks a tool's own option AND the OCR switch,
 * the ONE job request carries both. Each lane's client wrote its option as
 * the whole bag; a resolution that kept either expression alone would send
 * one and silently drop the other. Read at the wire: the `/api/jobs` body.
 */
import { describe, expect, it } from "vitest";
import type { FetchLike } from "./pdf-security-client";
import { runWorkerPdfOfficeExport } from "./pdf-office-export-client";
import { runWorkerTableExtract } from "./table-extract-client";

/** A worker that accepts the job and fails it at once; records the body. */
function recording(): { fetchImpl: FetchLike; sent: () => unknown[] } {
  const bodies: unknown[] = [];
  const json = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  const fetchImpl: FetchLike = async (url, init) => {
    if (url === "/api/uploads")
      return json({
        slots: [
          {
            fileId: "file_1",
            url: "https://upload.example/slot",
            method: "PUT",
            headers: {},
          },
        ],
      });
    if (url === "https://upload.example/slot") return json({});
    if (url === "/api/jobs") {
      const body = init?.body;
      bodies.push(
        JSON.parse(
          typeof body === "string"
            ? body
            : new TextDecoder().decode(body as ArrayBuffer),
        ),
      );
      return json({ jobId: "job_1", status: "queued" });
    }
    if (url === "/api/jobs/job_1")
      return json({
        jobId: "job_1",
        status: "failed",
        error: { code: "internal_error", message: "x", retryable: false },
      });
    throw new Error(`unexpected url ${url}`);
  };
  return { fetchImpl, sent: () => bodies };
}

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
const sleep = async () => {};
const optionsOf = (sent: unknown[]) => {
  // Health check: exactly one job was created, so the bag read is THE bag.
  expect(sent).toHaveLength(1);
  return (sent[0] as { options: Record<string, unknown> }).options;
};

describe("one job request carries the tool's own option and OCR first", () => {
  it("Extract Tables: combine and OCR together", async () => {
    const h = recording();
    await runWorkerTableExtract(
      {
        filename: "scan.pdf",
        bytes: BYTES,
        combine: true,
        ocr: { languages: ["eng"], deskew: true },
      },
      { fetchImpl: h.fetchImpl, sleep },
    );
    expect(optionsOf(h.sent())).toEqual({
      ocr: true,
      languages: ["eng"],
      deskew: true,
      combine: true,
    });
  });

  it("Extract Tables: control, neither is the empty bag", async () => {
    const h = recording();
    await runWorkerTableExtract(
      { filename: "scan.pdf", bytes: BYTES },
      { fetchImpl: h.fetchImpl, sleep },
    );
    expect(optionsOf(h.sent())).toEqual({});
  });

  it("PDF to Excel: sheetPerPage and OCR together", async () => {
    const h = recording();
    await runWorkerPdfOfficeExport(
      {
        tool: "pdf-to-excel",
        filename: "scan.pdf",
        bytes: BYTES,
        sheetPerPage: true,
        ocr: { languages: ["eng"] },
      },
      { fetchImpl: h.fetchImpl, sleep },
    );
    expect(optionsOf(h.sent())).toEqual({
      ocr: true,
      languages: ["eng"],
      sheetPerPage: true,
    });
  });

  it("PDF to Word: sheetPerPage is Excel's alone and never travels", async () => {
    const h = recording();
    await runWorkerPdfOfficeExport(
      {
        tool: "pdf-to-word",
        filename: "scan.pdf",
        bytes: BYTES,
        sheetPerPage: true,
        ocr: { languages: ["eng"] },
      },
      { fetchImpl: h.fetchImpl, sleep },
    );
    expect(optionsOf(h.sent())).toEqual({ ocr: true, languages: ["eng"] });
  });
});
