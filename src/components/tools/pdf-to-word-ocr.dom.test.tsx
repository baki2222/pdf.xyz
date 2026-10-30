// @vitest-environment jsdom
/**
 * PDF to Word's "Recognise text in scans (OCR)", pressed as a person presses
 * it: the panel, the REAL browser client, and the job the REAL processor
 * registry runs from the options the client sent — OCR processor first, then
 * the export. Played: the network hops, OCRmyPDF (marked bytes) and poppler's
 * flow (words only in the bytes OCR produced).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import JSZip from "jszip";
import { getToolBySlug } from "@/lib/tools";
import type { Job } from "@/lib/jobs/types";
import { buildOcrResultMeta } from "@/lib/jobs/ocr";
import { sanitizeJobResults } from "@/lib/jobs/results";
import { WORD_OCR_LABEL } from "@/lib/jobs/pdf-office-export";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { resetTelemetry } from "@/lib/telemetry/track";
import {
  createProcessorRegistry,
  type OcrRunner,
} from "@/lib/workers/processor";
import type { PdfFlowExtractor } from "@/lib/workers/pdf-office-export/engine";
import { noPictures } from "@/tests/page-scan-stubs";
import { readyFileInput } from "@/tests/worker-ready";
import { PdfOfficeExportWorkerPanel } from "./pdf-office-export-worker-panel";

const wordTool = getToolBySlug("pdf-to-word")!;
const providers = getProviderReadiness("remote-configured");

function status(ocrAvailable: boolean): WorkerStatus {
  return {
    mode: "remote-configured",
    enabled: true,
    localDevOnly: false,
    detail: "A server backend is configured.",
    compress: { lossless: false, deep: false, engines: [] },
    scan: { active: false, detail: "not scanned" },
    ocr: ocrAvailable
      ? {
          available: true,
          engine: "ocrmypdf",
          languages: ["eng", "deu"],
          detail: "OCR ready on ocrmypdf.",
        }
      : {
          available: false,
          engine: null,
          languages: [],
          detail: "OCR isn't enabled on this server.",
        },
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
}

const SCAN = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const SEARCHABLE = new TextEncoder().encode("%PDF-1.7 searchable");
const WORDS = "Scanned receipt total 41.20 recognised by OCR";

const extractFlow: PdfFlowExtractor = async (bytes) => ({
  pageCount: 1,
  pages: [
    {
      pageNumber: 1,
      paragraphs: Buffer.from(bytes).equals(Buffer.from(SEARCHABLE))
        ? [[WORDS]]
        : [],
    },
  ],
});

/** The job the worker runs for a POST body, through the real registry. */
function worker() {
  const ocrAsked: unknown[] = [];
  const runner: OcrRunner = async ({ options }) => {
    ocrAsked.push(options.languages);
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
        pageCount: 1,
      }),
    };
  };
  const registry = createProcessorRegistry({
    ocr: {
      runner,
      engines: { ocrmypdf: true, tesseract: false },
      installedLanguages: ["eng", "deu"],
    },
    pdfOfficeExport: {
      extract: async () => ({
        pageCount: 1,
        pages: [{ pageNumber: 1, text: "", characterCount: 0 }],
        text: "",
        characterCount: 0,
        hasText: false,
      }),
      extractFlow,
      scanPages: noPictures,
    },
  });
  return { registry, ocrAsked };
}

function stubNetwork(ocrAvailable: boolean) {
  const { registry, ocrAsked } = worker();
  const sent: Record<string, unknown>[] = [];
  let output: Uint8Array | undefined;
  const json = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: ArrayBuffer }) => {
      if (url === "/api/worker/status") return json(status(ocrAvailable));
      if (url === "/api/uploads")
        return json({
          sessionId: "s1",
          tool: "pdf-to-word",
          slots: [
            {
              fileId: "f1",
              filename: "receipt.pdf",
              url: "/upload/f1",
              method: "PUT",
              headers: {},
            },
          ],
        });
      if (url === "/upload/f1") return json({});
      if (url === "/api/jobs") {
        const body = JSON.parse(
          new TextDecoder().decode(init!.body as ArrayBuffer),
        );
        sent.push(body.options);
        const result = await registry.resolve("pdf-to-word")!.process({
          tool: "pdf-to-word",
          options: body.options,
          inputs: [
            {
              fileId: "f1",
              filename: "receipt.pdf",
              contentType: "application/pdf",
              bytes: SCAN,
            },
          ],
        });
        const base = {
          jobId: "job_1",
          tool: "pdf-to-word",
          capability: "worker",
          progress: 100,
          createdAt: "2026-10-24T00:00:00.000Z",
          updatedAt: "2026-10-24T00:00:00.000Z",
        };
        if (!result.ok)
          return json({ ...base, status: "failed", error: result.error });
        output = result.artifacts[0]!.bytes;
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
              expiresAt: "2026-10-24T01:00:00.000Z",
            },
          ],
          results: sanitizeJobResults(result.results),
        } as unknown as Job);
      }
      if (url === "/download/a1")
        return { ...json({}), arrayBuffer: async () => output!.slice().buffer };
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return { sent, ocrAsked, output: () => output };
}

async function addFile() {
  render(<PdfOfficeExportWorkerPanel tool={wordTool} />);
  const input = await vi.waitFor(() => {
    const found = readyFileInput();
    if (!found) throw new Error("no file input yet");
    return found;
  });
  fireEvent.change(input, {
    target: {
      files: [new File([SCAN], "receipt.pdf", { type: "application/pdf" })],
    },
  });
}

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("PDF to Word: Recognise text in scans (OCR)", () => {
  it("control: off by default — the request carries no options and the scan is refused for having no text", async () => {
    const net = stubNetwork(true);
    await addFile();
    expect(
      screen.getByRole("checkbox", {
        name: new RegExp(WORD_OCR_LABEL.replace(/[()]/g, "\\$&")),
      }),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /export docx/i }));
    await waitFor(() => expect(net.sent).toHaveLength(1));
    expect(net.sent[0]).toEqual({});
    expect(net.ocrAsked).toEqual([]);
    expect(
      (await screen.findAllByText(/no selectable text/i)).length,
    ).toBeGreaterThan(0);
  });

  it("on: the language picker appears, the chosen languages travel, and the DOCX holds the recognised words", async () => {
    const net = stubNetwork(true);
    await addFile();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /recognise text in scans/i }),
    );
    const group = await screen.findByRole("group", { name: "OCR languages" });
    // Narrowed by the worker's report, exactly as on OCR PDF.
    expect(
      group.querySelectorAll("[aria-disabled=true]").length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "German" }));
    fireEvent.click(screen.getByRole("button", { name: /export docx/i }));
    await screen.findByText("Your DOCX file is ready.");
    expect(net.sent[0]).toMatchObject({ ocr: true });
    expect(net.ocrAsked).toEqual([
      (net.sent[0] as { languages: string[] }).languages,
    ]);
    expect((net.sent[0] as { languages: string[] }).languages).toContain("deu");
    const zip = await JSZip.loadAsync(net.output()!);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain(WORDS);
  });

  it("a worker without OCR: the switch says so and Export waits — nothing uploads", async () => {
    const net = stubNetwork(false);
    await addFile();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /recognise text in scans/i }),
    );
    expect(
      await screen.findByText(/OCR isn't enabled on this server/),
    ).toBeInTheDocument();
    const run = screen.getByRole("button", { name: /export docx/i });
    expect(run).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(run);
    expect(net.sent).toEqual([]);
  });
});
