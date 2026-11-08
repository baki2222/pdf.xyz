/**
 * Extract Tables with "Recognise text in scans (OCR)" (audit 2026-11-06,
 * extract-tables#3): ONE job through the real registry, the OCR PDF processor
 * first and the table detector on its searchable PDF — the chain the PDF to
 * Office exports use, not a second one. Played: OCRmyPDF (marked bytes) and
 * poppler's positioned text (words only in the bytes OCR produced). Each
 * test reads the ZIP the job wrote.
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildOcrResultMeta, type OcrOptions } from "@/lib/jobs/ocr";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";
import { OCR_REFUSAL_MESSAGES, OcrEngineRefusal } from "../ocr-engine-errors";
import type { PdfLayout } from "../table-extract/engine";
import { createProcessorRegistry, type OcrRunner } from "./index";

const enc = (s: string) => new TextEncoder().encode(s);
const SCAN = enc("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n% scan\n%%EOF\n");
const SEARCHABLE = enc(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n% ocr layer\n%%EOF\n",
);
const RECOGNISED = "Recognised-Alice";

/** poppler's positioned text, played: a table only in OCR's output. */
async function extractLayout(bytes: Uint8Array): Promise<PdfLayout> {
  const searchable = Buffer.from(bytes).equals(Buffer.from(SEARCHABLE));
  return {
    pageCount: 1,
    pages: [
      {
        pageNumber: 1,
        width: 400,
        height: 300,
        items: searchable
          ? [
              { text: "Name", x: 50, y: 100, width: 20, height: 10 },
              { text: "Age", x: 200, y: 100, width: 15, height: 10 },
              { text: RECOGNISED, x: 50, y: 80, width: 60, height: 10 },
              { text: "30", x: 200, y: 80, width: 10, height: 10 },
            ]
          : [],
      },
    ],
  };
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

function registry(
  runner: OcrRunner = ocrmypdf,
  limits?: { maxInputBytes?: number },
) {
  const asked: OcrOptions[] = [];
  const reg = createProcessorRegistry({
    ocr: {
      runner: async (input) => {
        asked.push(input.options);
        return runner(input);
      },
      engines: { ocrmypdf: true, tesseract: true },
    },
    tableExtract: { extractLayout, ...(limits ? { limits } : {}) },
  });
  return { processor: reg.resolve("extract-tables")!, asked };
}

const job = (options: Record<string, unknown>) => ({
  tool: "extract-tables",
  options,
  inputs: [
    {
      fileId: "f",
      filename: "statement.pdf",
      contentType: "application/pdf",
      bytes: SCAN,
    },
  ],
});

async function csvText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const csvs = Object.keys(zip.files).filter((n) => n.endsWith(".csv"));
  // Health check: no CSV would make a "not.toContain" vacuous.
  expect(csvs.length).toBeGreaterThan(0);
  return (
    await Promise.all(csvs.map((n) => zip.file(n)!.async("string")))
  ).join("\n");
}

describe("Extract Tables, OCR first — one job (audit extract-tables#3)", () => {
  it("control: without OCR a scan is refused for having no text, and OCR never runs", async () => {
    const { processor, asked } = registry();
    const result = await processor.process(job({}));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe(OFFICE_EXPORT_ERROR_CODES.noText);
    expect(asked).toEqual([]);
  });

  it("with OCR on, the recognised table is in the ZIP's CSV, and OCR got the chosen languages and page choices", async () => {
    const { processor, asked } = registry();
    const result = await processor.process(
      job({ ocr: true, languages: ["deu", "eng"], rotatePages: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asked).toEqual([
      {
        languages: ["deu", "eng"],
        outputMode: "searchable-pdf",
        redoOcr: false,
        deskew: false,
        rotatePages: true,
      },
    ]);
    expect(result.artifacts[0]!.filename).toBe("statement-tables.zip");
    expect(await csvText(result.artifacts[0]!.bytes)).toContain(RECOGNISED);
    expect(result.results?.ocr?.languages).toEqual(["deu", "eng"]);
    expect(result.meta?.ocrFirst).toBe(true);
  });

  it("OCR that recognised nothing says OCR ran and names tables, not 'Run OCR PDF first'", async () => {
    const { processor } = registry(async (input) => {
      const out = await ocrmypdf(input);
      return { ...out, artifacts: [{ ...out.artifacts[0]!, bytes: SCAN }] };
    });
    const result = await processor.process(job({ ocr: true }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(OFFICE_EXPORT_ERROR_CODES.noText);
    expect(result.error.message).toMatch(/OCR ran/);
    expect(result.error.message).toMatch(/table/);
    expect(result.error.message).not.toMatch(/Word|Run OCR/);
  });

  it("OCR's 'already has a text layer' refusal names this panel's switch", async () => {
    const { processor } = registry(async () => {
      throw new OcrEngineRefusal("prior-text");
    });
    const result = await processor.process(job({ ocr: true }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).not.toBe(OCR_REFUSAL_MESSAGES["prior-text"]);
    expect(result.error.message).toMatch(/Recognise text in scans/);
  });

  it("an upload over the ceiling is refused before OCR, naming Extract Tables", async () => {
    const { processor, asked } = registry(ocrmypdf, {
      maxInputBytes: SCAN.byteLength - 1,
    });
    const result = await processor.process(job({ ocr: true }));
    expect(asked).toEqual([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("payload_too_large");
    expect(result.error.message).toMatch(/Extract Tables/);
  });

  it("an invalid option and a right-to-left language are refused before anything runs", async () => {
    for (const options of [{ ocr: "yes" }, { ocr: true, languages: ["ara"] }]) {
      const { processor, asked } = registry();
      const result = await processor.process(job(options));
      expect(result.ok).toBe(false);
      expect(asked).toEqual([]);
      if (!result.ok)
        expect(result.error.code).not.toBe(OFFICE_EXPORT_ERROR_CODES.noText);
    }
  });
});
