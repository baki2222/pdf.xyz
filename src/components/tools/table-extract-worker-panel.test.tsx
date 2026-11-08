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
import {
  TableExtractNoTablesStep,
  tableFindingLines,
} from "./table-extract-findings";
import { EXTRACT_TABLES_NO_TABLES_CODE } from "@/lib/jobs/extract-tables-options";
import { readyFileInput } from "@/tests/worker-ready";
import { buildOcrResultMeta } from "@/lib/jobs/ocr";
import {
  createProcessorRegistry,
  type OcrRunner,
} from "@/lib/workers/processor";

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

/**
 * Integration of the OCR switch (l03) with the findings and the no-tables
 * step (l10), 2026-11-08: each lane's copy was true alone. After a run that
 * had OCR on, "OCR PDF can add the text first" and an "Open OCR PDF" link
 * send the reader to run the engine that just ran.
 */
describe("Extract Tables — after OCR ran, OCR PDF is not offered again", () => {
  const found = {
    tableCount: 1,
    pageCount: 2,
    tablePages: [1],
    tablePagesTruncated: false,
    combined: false,
  };

  it("control: without OCR, the pages with no table come with the OCR PDF advice", () => {
    expect(tableFindingLines(found)[1]).toBe(
      "No table was detected on page 2. If it is a scan, OCR PDF can add the text first.",
    );
  });

  it("with OCR, the same pages are named without it", () => {
    expect(tableFindingLines(found, true)).toEqual([
      "Found 1 table on page 1.",
      "No table was detected on page 2.",
    ]);
  });

  it("the no-tables step links OCR PDF only when OCR was off", () => {
    const { unmount } = render(
      <TableExtractNoTablesStep code={EXTRACT_TABLES_NO_TABLES_CODE} />,
    );
    // Health check: the step rendered at all, so the absence below is real.
    expect(screen.getByText("Open PDF to Excel")).toBeInTheDocument();
    expect(screen.getByText("Open OCR PDF")).toBeInTheDocument();
    unmount();
    render(
      <TableExtractNoTablesStep code={EXTRACT_TABLES_NO_TABLES_CODE} ocrRan />,
    );
    expect(screen.getByText("Open PDF to Excel")).toBeInTheDocument();
    expect(screen.queryByText("Open OCR PDF")).toBeNull();
    expect(screen.queryByText(/OCR PDF adds/)).toBeNull();
  });
});

/**
 * The same integration, through the PANEL (review of 8266f77f, 2026-11-08).
 * The block above tests the two units; nothing tested where the panel wires
 * them, and `ocrRan={false}` in the panel or `false` for the findings' OCR
 * key each stayed green. Here the OCR switch is pressed as a person presses
 * it, the job-create body off the wire is run through the REAL registry (OCR
 * processor + table processor), and the card the panel draws is read.
 */
describe("Extract Tables panel — after an OCR-first run, OCR PDF is not offered again", () => {
  const SEARCHABLE = new TextEncoder().encode("%PDF-1.7 searchable");
  const OCR_READY: WorkerStatus = {
    ...READY,
    ocr: {
      available: true,
      engine: "ocrmypdf",
      languages: ["eng", "deu"],
      detail: "OCR ready on ocrmypdf.",
    },
  };
  const prose = (pageNumber: number) => ({
    pageNumber,
    width: 400,
    height: 300,
    items: [{ text: "Just prose.", x: 50, y: 100, width: 60, height: 10 }],
  });
  const grid = (pageNumber: number) => ({
    pageNumber,
    width: 400,
    height: 300,
    items: [
      { text: "Name", x: 50, y: 100, width: 20, height: 10 },
      { text: "Age", x: 200, y: 100, width: 15, height: 10 },
      { text: "Alice", x: 50, y: 80, width: 25, height: 10 },
      { text: "30", x: 200, y: 80, width: 10, height: 10 },
    ],
  });

  /**
   * A worker that runs whatever options the panel sent. The layout is the
   * same with or without OCR, so the two runs differ only in the switch.
   */
  function stubWorker(tablesOn: boolean[]) {
    const ocrRuns: unknown[] = [];
    const runner: OcrRunner = async ({ options }) => {
      ocrRuns.push(options.languages);
      return {
        artifacts: [
          {
            filename: "x.pdf",
            contentType: "application/pdf",
            bytes: SEARCHABLE,
          },
        ],
        meta: buildOcrResultMeta({
          engine: "ocrmypdf",
          languages: options.languages,
          outputMode: options.outputMode,
          producedSearchablePdf: true,
          producedTextSidecar: false,
          pageCount: tablesOn.length,
        }),
      };
    };
    const registry = createProcessorRegistry({
      ocr: {
        runner,
        engines: { ocrmypdf: true, tesseract: false },
        installedLanguages: ["eng", "deu"],
      },
      tableExtract: {
        extractLayout: async () => ({
          pageCount: tablesOn.length,
          pages: tablesOn.map((t, i) => (t ? grid(i + 1) : prose(i + 1))),
        }),
      },
    });
    let output: Uint8Array = new Uint8Array();
    const json = (body: unknown) => ({
      ok: true,
      status: 200,
      json: async () => body,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: ArrayBuffer }) => {
        if (url === "/api/worker/status") return json(OCR_READY);
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
        if (url === "/download/a1")
          return {
            ...json({}),
            arrayBuffer: async () => output.slice().buffer,
          };
        if (url === "/api/jobs") {
          const { options } = JSON.parse(
            new TextDecoder().decode(init!.body!),
          ) as { options: Record<string, unknown> };
          const result = await registry.resolve("extract-tables")!.process({
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
          const base = {
            jobId: "job_1",
            tool: "extract-tables",
            capability: "worker",
            progress: 100,
            createdAt: "2026-09-27T00:00:00.000Z",
            updatedAt: "2026-09-27T00:00:00.000Z",
          };
          if (!result.ok)
            return json({ ...base, status: "failed", error: result.error });
          output = result.artifacts[0]!.bytes;
          const results = sanitizeJobResults(result.results);
          return json({
            ...base,
            status: "completed",
            artifacts: [
              {
                artifactId: "a1",
                filename: result.artifacts[0]!.filename,
                contentType: result.artifacts[0]!.contentType,
                bytes: output.byteLength,
                url: "/download/a1",
                expiresAt: "2026-09-27T01:00:00.000Z",
              },
            ],
            ...(results ? { results } : {}),
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    return { ocrRuns };
  }

  async function extract(ocrOn: boolean) {
    render(<TableExtractWorkerPanel tool={tool} />);
    const input = await vi.waitFor(() => {
      const found = readyFileInput();
      if (!found) throw new Error("no file input yet");
      return found;
    });
    if (ocrOn) {
      fireEvent.click(
        screen.getByRole("checkbox", { name: /Recognise text in scans/ }),
      );
      await screen.findByRole("group", { name: "OCR languages" });
    }
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "scan.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /extract tables/i }));
  }

  it("control: no table, OCR off: the step links OCR PDF and says what it adds", async () => {
    const { ocrRuns } = stubWorker([false]);
    await extract(false);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /No table-like structure/,
    );
    expect(ocrRuns).toHaveLength(0);
    expect(
      screen.getByRole("link", { name: "Open PDF to Excel" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open OCR PDF" })).toBeTruthy();
    expect(screen.getByText(/OCR PDF adds their text first/)).toBeTruthy();
  });

  it("no table, OCR on: the step links PDF to Excel only, and does not offer OCR PDF", async () => {
    const { ocrRuns } = stubWorker([false]);
    await extract(true);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /No table-like structure/,
    );
    // OCR really ran in this job, and the step really rendered.
    expect(ocrRuns).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "Open PDF to Excel" }),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open OCR PDF" })).toBeNull();
    expect(screen.queryByText(/OCR PDF adds/)).toBeNull();
  });

  it("control: tables on some pages, OCR off: the pages without one come with the OCR PDF advice", async () => {
    const { ocrRuns } = stubWorker([true, false]);
    await extract(false);
    expect(
      await screen.findByText("Found 1 table on page 1."),
    ).toBeInTheDocument();
    expect(ocrRuns).toHaveLength(0);
    expect(
      screen.getByText(
        "No table was detected on page 2. If it is a scan, OCR PDF can add the text first.",
      ),
    ).toBeInTheDocument();
  });

  it("tables on some pages, OCR on: the pages without one are named without the OCR PDF advice", async () => {
    const { ocrRuns } = stubWorker([true, false]);
    await extract(true);
    expect(
      await screen.findByText("Found 1 table on page 1."),
    ).toBeInTheDocument();
    expect(ocrRuns).toHaveLength(1);
    expect(
      screen.getByText("No table was detected on page 2."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/OCR PDF can add the text first/)).toBeNull();
  });
});
