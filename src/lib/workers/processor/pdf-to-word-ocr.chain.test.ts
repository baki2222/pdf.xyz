/**
 * PDF to Word with "Recognise text in scans (OCR)": ONE job that runs the OCR
 * processor first and converts its searchable PDF. Driven through the real
 * registry (`createProcessorRegistry`), so the chain is the one the worker
 * builds — the OCR processor (its option, language and refusal handling) and
 * the export processor, joined where the daemon joins them. Only the native
 * pieces are played: OCRmyPDF (a runner that returns marked bytes) and
 * poppler's flow (text only for the bytes OCR produced).
 */
import { describe, expect, it } from "vitest";
import { buildOcrResultMeta, type OcrOptions } from "@/lib/jobs/ocr";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";
import { OCR_REFUSAL_MESSAGES, OcrEngineRefusal } from "../ocr-engine-errors";
import type { PdfFlowExtractor } from "../pdf-office-export/engine";
import { noPictures } from "@/tests/page-scan-stubs";
import { createProcessorRegistry, type OcrRunner } from "./index";

const enc = (s: string) => new TextEncoder().encode(s);
const SCAN = enc("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n% scan\n%%EOF\n");
const SEARCHABLE = enc(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n% ocr layer\n%%EOF\n",
);
const RECOGNISED = "Invoice 2026-118 recognised from the scan";

/** Poppler's flow, played: the scan has no text, OCR's output has the words. */
const extractFlow: PdfFlowExtractor = async (bytes) => ({
  pageCount: 1,
  pages: [
    {
      pageNumber: 1,
      paragraphs: Buffer.from(bytes).equals(Buffer.from(SEARCHABLE))
        ? [[RECOGNISED]]
        : [],
    },
  ],
});
const extract = async () => ({
  pageCount: 1,
  pages: [{ pageNumber: 1, text: "", characterCount: 0 }],
  text: "",
  characterCount: 0,
  hasText: false,
});

function registry(runner?: OcrRunner, installed?: string[]) {
  const asked: OcrOptions[] = [];
  const wrapped: OcrRunner | undefined = runner
    ? async (input) => {
        asked.push(input.options);
        return runner(input);
      }
    : undefined;
  const reg = createProcessorRegistry({
    ocr: wrapped
      ? {
          runner: wrapped,
          engines: { ocrmypdf: true, tesseract: true },
          ...(installed ? { installedLanguages: installed } : {}),
        }
      : {},
    pdfOfficeExport: { extract, extractFlow, scanPages: noPictures },
  });
  return { processor: reg.resolve("pdf-to-word")!, asked };
}

const ocrmypdf: OcrRunner = async ({ options }) => ({
  artifacts: [
    {
      filename: "scan-ocr.pdf",
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
});

const job = (options: Record<string, unknown>) => ({
  tool: "pdf-to-word",
  options,
  inputs: [
    {
      fileId: "f",
      filename: "scan.pdf",
      contentType: "application/pdf",
      bytes: SCAN,
    },
  ],
});

async function docxText(bytes: Uint8Array): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  return (await zip.file("word/document.xml")!.async("string"))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

describe("PDF to Word, OCR first — one job", () => {
  it("control: without OCR the scan is refused as having no text (today's behaviour)", async () => {
    const { processor, asked } = registry(ocrmypdf);
    const result = await processor.process(job({}));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe(OFFICE_EXPORT_ERROR_CODES.noText);
    expect(asked).toEqual([]);
  });

  it("with OCR on, the recognised words are in the DOCX, and OCR got the chosen languages as a searchable PDF", async () => {
    const { processor, asked } = registry(ocrmypdf);
    const result = await processor.process(
      job({ ocr: true, languages: ["deu", "eng"] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asked).toEqual([
      {
        languages: ["deu", "eng"],
        outputMode: "searchable-pdf",
        redoOcr: false,
      },
    ]);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]!.filename).toBe("scan.docx");
    expect(await docxText(result.artifacts[0]!.bytes)).toContain(RECOGNISED);
    // Both stories travel to the job record: what OCR did, and what the
    // export covered.
    expect(result.results?.ocr?.languages).toEqual(["deu", "eng"]);
    expect(result.results?.officeExport).toBeDefined();
  });

  it("a worker with no OCR says so, and converts nothing", async () => {
    const { processor } = registry(undefined);
    const result = await processor.process(job({ ocr: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_implemented");
      expect(result.error.message).toMatch(/OCR/);
      expect(result.error.retryable).toBe(false);
    }
  });

  it("a language the worker has no pack for is refused before any work, by OCR's own check", async () => {
    let ran = false;
    const { processor } = registry(
      async (input) => {
        ran = true;
        return ocrmypdf(input);
      },
      ["eng"],
    );
    const result = await processor.process(
      job({ ocr: true, languages: ["deu"] }),
    );
    expect(result.ok).toBe(false);
    expect(ran).toBe(false);
  });

  it("OCR's 'already has a text layer' refusal names THIS panel's switch, not OCR PDF's", async () => {
    const { processor } = registry(async () => {
      throw new OcrEngineRefusal("prior-text");
    });
    const result = await processor.process(job({ ocr: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.retryable).toBe(false);
      expect(result.error.message).not.toBe(OCR_REFUSAL_MESSAGES["prior-text"]);
      expect(result.error.message).not.toMatch(/Redo existing OCR/);
      expect(result.error.message).toMatch(/Recognise text in scans/);
    }
  });

  it("OCR that recognised nothing: the refusal says OCR ran, not 'run OCR first'", async () => {
    const { processor } = registry(async (input) => {
      const out = await ocrmypdf(input);
      // A searchable PDF whose layer is empty: the flow finds no words.
      return { ...out, artifacts: [{ ...out.artifacts[0]!, bytes: SCAN }] };
    });
    const result = await processor.process(job({ ocr: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(OFFICE_EXPORT_ERROR_CODES.noText);
      expect(result.error.message).not.toMatch(/Run OCR first/);
      expect(result.error.message).toMatch(/OCR/);
    }
  });

  it("refuses an invalid option before running anything", async () => {
    let ran = false;
    const { processor } = registry(async (input) => {
      ran = true;
      return ocrmypdf(input);
    });
    const result = await processor.process(job({ ocr: "yes" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.retryable).toBe(false);
    expect(ran).toBe(false);
  });
});
