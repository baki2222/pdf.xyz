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
import { sanitizeJobResults } from "@/lib/jobs/results";
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
import { tableFindingLines } from "./table-extract-findings";
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

  it("offers PDF to Excel and OCR PDF when no table is detected (audit extract-tables#5)", async () => {
    stubNetwork(
      await failedJobFrom(
        async () => ({
          pageCount: 1,
          pages: [
            {
              pageNumber: 1,
              width: 400,
              height: 300,
              items: [
                {
                  text: "Just running prose here.",
                  x: 50,
                  y: 100,
                  width: 120,
                  height: 10,
                },
              ],
            },
          ],
        }),
        new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      ),
    );
    await extractOnePdf();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /No table-like structure/,
    );
    expect(
      screen.getByRole("link", { name: "Open PDF to Excel" }),
    ).toHaveAttribute("href", "/tools/pdf-to-excel");
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

describe("Extract Tables panel — “Combine tables into one sheet” (audit extract-tables#2)", () => {
  /** The options bag of the job-create request, read off the wire. */
  async function jobOptionsSent(tick: boolean) {
    stubNetwork(
      await failedJobFrom(
        async () => {
          throw new Error("the run did not finish");
        },
        new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      ),
    );
    render(<TableExtractWorkerPanel tool={tool} />);
    const box = screen.getByRole("checkbox", {
      name: /Combine tables into one sheet/,
    });
    expect(box).not.toBeChecked();
    if (tick) fireEvent.click(box);
    const input = await vi.waitFor(() => {
      const found = readyFileInput();
      if (!found) throw new Error("no file input yet");
      return found;
    });
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "s.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /extract tables/i }));
    await screen.findByRole("alert");
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const create = calls.find(([url]) => url === "/api/jobs");
    if (!create) throw new Error("no job was created");
    const body = JSON.parse(
      new TextDecoder().decode((create[1] as { body: ArrayBuffer }).body),
    ) as { options: Record<string, unknown> };
    return body.options;
  }

  it("ticked, the job asks for one sheet", async () => {
    expect(await jobOptionsSent(true)).toEqual({ combine: true });
  });

  it("left alone, the job is the request every page sent before the option", async () => {
    expect(await jobOptionsSent(false)).toEqual({});
  });
});

describe("Extract Tables panel — the result says what was found (audit extract-tables#4)", () => {
  const page = (pageNumber: number, table: boolean) => ({
    pageNumber,
    width: 400,
    height: 300,
    items: table
      ? [
          { text: "Name", x: 50, y: 100, width: 20, height: 10 },
          { text: "Age", x: 200, y: 100, width: 15, height: 10 },
          { text: "Alice", x: 50, y: 80, width: 25, height: 10 },
          { text: "30", x: 200, y: 80, width: 10, height: 10 },
        ]
      : [{ text: "Just prose.", x: 50, y: 100, width: 60, height: 10 }],
  });

  /** The real processor's success, persisted through the real sanitizer. */
  async function completedJob(
    tablesOn: boolean[],
    options: Record<string, unknown> = {},
    keepResults = true,
  ) {
    const result = await createTableExtractProcessor({
      extractLayout: async () => ({
        pageCount: tablesOn.length,
        pages: tablesOn.map((t, i) => page(i + 1, t)),
      }),
    }).process({
      tool: "extract-tables",
      options,
      inputs: [
        {
          fileId: "f1",
          filename: "statement.pdf",
          contentType: "application/pdf",
          bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    const results = keepResults
      ? sanitizeJobResults(result.results)
      : undefined;
    const job = {
      jobId: "job_1",
      tool: "extract-tables",
      capability: "worker",
      progress: 100,
      status: "completed",
      artifacts: [
        {
          artifactId: "a1",
          filename: result.artifacts[0]!.filename,
          contentType: result.artifacts[0]!.contentType,
          bytes: result.artifacts[0]!.bytes.byteLength,
          url: "/download/a1",
          expiresAt: "2026-09-27T01:00:00.000Z",
        },
      ],
      ...(results ? { results } : {}),
      createdAt: "2026-09-27T00:00:00.000Z",
      updatedAt: "2026-09-27T00:00:00.000Z",
    } as unknown as Job;
    stubNetwork(job);
    const fetchStub = fetch as unknown as ReturnType<typeof vi.fn>;
    const answer = fetchStub.getMockImplementation()! as (
      url: string,
      init: unknown,
    ) => unknown;
    fetchStub.mockImplementation(async (url: string, init: unknown) =>
      url === "/download/a1"
        ? {
            ok: true,
            status: 200,
            json: async () => ({}),
            arrayBuffer: async () => result.artifacts[0]!.bytes.slice().buffer,
          }
        : answer(url, init),
    );
  }

  it("names the count, the pages tables came from, and the pages that gave none", async () => {
    await completedJob([true, false, true, false, false]);
    await extractOnePdf();
    expect(
      await screen.findByText("Found 2 tables on pages 1 and 3."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "No table was detected on pages 2 and 4–5. If they are scans, OCR PDF can add the text first.",
      ),
    ).toBeInTheDocument();
  });

  it("one table on one page, and nothing missing, says only that", async () => {
    await completedJob([true]);
    await extractOnePdf();
    expect(
      await screen.findByText("Found 1 table on page 1."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No table was detected/)).toBeNull();
  });

  it("a combined run says the ZIP holds one CSV and one sheet", async () => {
    await completedJob([true, true], { combine: true });
    await extractOnePdf();
    expect(
      await screen.findByText(
        /one CSV file plus an Excel workbook with one sheet/,
      ),
    ).toBeInTheDocument();
  });

  it("POSITIVE CONTROL: a worker that does not report gets no count, not a made-up one", async () => {
    await completedJob([true, false], {}, false);
    await extractOnePdf();
    expect(
      await screen.findByText(
        /ZIP of CSV files plus a combined Excel workbook/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Found /)).toBeNull();
  });
});

describe("Extract Tables page — says what the result card says", () => {
  it("quotes the card's own sentence shapes", async () => {
    const { default: content } =
      await import("@/lib/tools/content/extract-tables");
    const page = JSON.stringify(content);
    const lines = tableFindingLines({
      tableCount: 3,
      pageCount: 5,
      tablePages: [1, 2, 4],
      tablePagesTruncated: false,
      combined: false,
    });
    // The example on the page is a sentence the card really writes.
    expect(page).toContain(lines[0]!.replace(/\.$/, ""));
    expect(lines[1]).toMatch(/^No table was detected on /);
    expect(page).toContain("No table was detected on");
    // The no-tables failure's links, named as the panel labels them.
    expect(page).toContain("links to PDF to Excel and OCR PDF");
  });
});
