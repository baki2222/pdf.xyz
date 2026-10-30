// @vitest-environment jsdom
/**
 * Extract Tables, failure path, driven through the REAL browser client over a
 * stubbed network, with the job record built by the REAL worker processor.
 *
 * A password-protected statement used to fail here as a retryable
 * `internal_error` — requeued twice, then "could not be processed", with no
 * word about the password. The processor now sets a document-failure CODE and
 * the panel links the tool that fixes it by that code. Each half passing its
 * own test would prove nothing about the path, so this runs both.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { getToolBySlug } from "@/lib/tools";
import type { Job } from "@/lib/jobs/types";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { resetTelemetry } from "@/lib/telemetry/track";
import { createTableExtractProcessor } from "@/lib/workers/processor/table-extract";
import type { PdfLayoutExtractor } from "@/lib/workers/table-extract/engine";
import { PdfTextExecError } from "@/lib/workers/pdf-text/errors";
import { rc4EncryptedPdf } from "@/tests/pdf-office-fixtures";
import { TableExtractWorkerPanel } from "./table-extract-worker-panel";
import { readyFileInput } from "@/tests/worker-ready";

const tool = getToolBySlug("extract-tables")!;
const providers = getProviderReadiness("remote-configured");

const READY: WorkerStatus = {
  mode: "remote-configured",
  enabled: true,
  localDevOnly: false,
  detail: "A server backend is configured.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: false, detail: "not scanned" },
  ocr: { available: false, engine: null, languages: [], detail: "off" },
  security: {
    available: true,
    operations: ["protect", "unlock"],
    detail: "qpdf runs on our secure server.",
  },
  providers: {
    ...providers,
    storage: { ...providers.storage, ready: true },
    queue: { ...providers.queue, ready: true },
  },
  daemon: { ...resolveDaemonReadiness({}), drainable: true },
  ai: resolveAiReadiness({}),
  pipeline: {
    verdict: "off",
    observed: false,
    drainable: false,
    detail: "no server observed",
  },
};

const refused: PdfLayoutExtractor = async () => {
  throw new PdfTextExecError({
    exitCode: 1,
    killed: false,
    outputTooLarge: false,
  });
};

/** Run the real processor, then shape its failure the way the job API does. */
async function failedJobFrom(
  extractLayout: PdfLayoutExtractor,
  input: Uint8Array,
): Promise<Job> {
  const result = await createTableExtractProcessor({ extractLayout }).process({
    tool: "extract-tables",
    options: {},
    inputs: [
      {
        fileId: "f1",
        filename: "statement.pdf",
        contentType: "application/pdf",
        bytes: input,
      },
    ],
  });
  if (result.ok) throw new Error("expected the processor to fail");
  return {
    jobId: "job_1",
    tool: "extract-tables",
    capability: "worker",
    progress: 100,
    status: "failed",
    error: result.error,
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
  } as unknown as Job;
}

function stubNetwork(job: Job) {
  const json = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/worker/status") return json(READY);
      if (url === "/api/uploads")
        return json({
          sessionId: "s1",
          tool: "extract-tables",
          slots: [
            {
              fileId: "f1",
              filename: "statement.pdf",
              url: "/upload/f1",
              method: "PUT",
              headers: {},
            },
          ],
        });
      if (url === "/upload/f1") return json({});
      if (url === "/api/jobs") return json(job);
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

async function extractOnePdf() {
  render(<TableExtractWorkerPanel tool={tool} />);
  const input = await vi.waitFor(() => {
    const found = readyFileInput();
    if (!found) throw new Error("no file input yet");
    return found;
  });
  fireEvent.change(input, {
    target: {
      files: [
        new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "statement.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  fireEvent.click(screen.getByRole("button", { name: /extract tables/i }));
}

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("Extract Tables panel — failures link the tool that fixes them", () => {
  it("sends a password-protected PDF to Unlock PDF", async () => {
    stubNetwork(
      await failedJobFrom(
        refused,
        rc4EncryptedPdf({ userPassword: "pw", ownerPassword: "owner" }),
      ),
    );
    await extractOnePdf();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /password-protected/,
    );
    expect(
      screen.getByRole("link", { name: "Open Unlock PDF" }),
    ).toHaveAttribute("href", "/tools/unlock-pdf");
  });

  it("sends a PDF that will not open to Repair PDF", async () => {
    stubNetwork(
      await failedJobFrom(refused, await (await PDFDocument.create()).save()),
    );
    await extractOnePdf();
    await screen.findByRole("alert");
    expect(
      screen.getByRole("link", { name: "Open Repair PDF" }),
    ).toHaveAttribute("href", "/tools/repair-pdf");
  });

  it("sends a PDF with no selectable text to OCR PDF", async () => {
    stubNetwork(
      await failedJobFrom(
        async () => ({
          pageCount: 1,
          pages: [{ pageNumber: 1, width: 400, height: 300, items: [] }],
        }),
        new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      ),
    );
    await extractOnePdf();
    await screen.findByRole("alert");
    expect(screen.getByRole("link", { name: "Open OCR PDF" })).toHaveAttribute(
      "href",
      "/tools/ocr-pdf",
    );
  });

  it("POSITIVE CONTROL: a retryable failure links nothing", async () => {
    stubNetwork(
      await failedJobFrom(
        async () => {
          throw new Error("the run did not finish");
        },
        new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      ),
    );
    await extractOnePdf();
    await screen.findByRole("alert");
    expect(screen.queryByRole("link", { name: /^Open / })).toBeNull();
  });
});
