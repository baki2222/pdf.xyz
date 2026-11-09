// @vitest-environment node
/**
 * `translateOcr` must be able to say NO, and it must probe the CHAIN the
 * daemon builds — the registry handing the OCR processor to translate — not
 * a unit beside it.
 *
 * The positive half runs the real probe. The negative half cannot stub the
 * probe (that would test the stub), so it drives the probe's own question
 * through the two broken shapes it exists to catch, built from the same real
 * modules: a registry whose translate processor was NOT given the OCR
 * processor (an image built before audit translate-pdf#3), and a processor
 * that recognised a typed PDF too.
 */
import { describe, expect, it } from "vitest";
import { provesTranslateOcr } from "./ocr-capability";
import { createTranslateProcessor } from "../processor/translate";
import { createOcrProcessor, type OcrRunner } from "../processor/ocr";
import { createProcessorRegistry } from "../processor";
import { buildOcrResultMeta } from "@/lib/jobs/ocr";
import type { ExtractedPdfText } from "@/lib/pdf/text";

const ext = (text: string): ExtractedPdfText => ({
  pageCount: 1,
  pages: [{ pageNumber: 1, text, characterCount: text.length }],
  text,
  characterCount: text.length,
  hasText: text.length > 0,
});

const runner: OcrRunner = async ({ options }) => ({
  artifacts: [
    {
      filename: "o.pdf",
      contentType: "application/pdf",
      bytes: new Uint8Array([9]),
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

describe("provesTranslateOcr", () => {
  it("passes on this image's registry", async () => {
    expect(await provesTranslateOcr()).toBe(true);
  });

  it("says NO for a registry whose OCR cannot run (the chain has nothing to call)", async () => {
    expect(
      await provesTranslateOcr((deps = {}) =>
        createProcessorRegistry({ ...deps, ocr: {} }),
      ),
    ).toBe(false);
  });

  it("says NO for a translate processor that recognises a TYPED PDF too (the control half bites)", async () => {
    // The probe's typed page reads as having no text, so OCR runs on it:
    // what a processor that ignored the text layer would do.
    expect(
      await provesTranslateOcr((deps = {}) =>
        createProcessorRegistry({
          ...deps,
          translate: {
            ...deps.translate,
            extract: async (bytes, run) => {
              const found = await deps.translate!.extract!(bytes, run);
              return found.text.includes("typed")
                ? { ...found, text: "", hasText: false, pages: [] }
                : found;
            },
          },
        }),
      ),
    ).toBe(false);
  });

  it("says NO for a translate processor that sends the scan's own (empty) text, not OCR's", async () => {
    expect(
      await provesTranslateOcr((deps = {}) =>
        createProcessorRegistry({
          ...deps,
          translate: {
            ...deps.translate,
            // Whatever OCR returns, the extractor reads nothing new from it.
            extract: async (bytes, run) => {
              const found = await deps.translate!.extract!(bytes, run);
              return found.text.includes("recognised-marker")
                ? { ...found, text: "unrelated", pages: [] }
                : found;
            },
          },
        }),
      ),
    ).toBe(false);
  });

  it("the signal discriminates: a translate processor WITHOUT the OCR chain refuses the scan, so the provider hears nothing", async () => {
    const sent: string[] = [];
    // The pre-#3 wiring: no chain argument.
    const processor = createTranslateProcessor({
      extract: async (bytes) => (bytes[0] === 9 ? ext("recognised") : ext("")),
      provider: {
        id: "anthropic",
        model: "m",
        async complete(request) {
          sent.push(String(request.messages[0]?.content));
          return { ok: true, text: "t", model: "m" };
        },
      },
    });
    const result = await processor.process({
      tool: "translate-pdf",
      options: { targetLanguage: "fr", ocr: true, languages: ["eng"] },
      inputs: [
        {
          fileId: "f",
          filename: "s.pdf",
          contentType: "application/pdf",
          bytes: new Uint8Array([1]),
        },
      ],
    });
    // Exactly what the probe reads as `false`.
    expect(result.ok).toBe(false);
    expect(sent).toEqual([]);
  });

  it("the same processor WITH the chain passes the probe's question — the difference is the chain, nothing else", async () => {
    const sent: string[] = [];
    const processor = createTranslateProcessor(
      {
        extract: async (bytes) =>
          bytes[0] === 9 ? ext("recognised") : ext(""),
        provider: {
          id: "anthropic",
          model: "m",
          async complete(request) {
            sent.push(String(request.messages[0]?.content));
            return { ok: true, text: "t", model: "m" };
          },
        },
      },
      {
        ocr: createOcrProcessor({
          runner,
          engines: { ocrmypdf: true, tesseract: true },
        }),
      },
    );
    const result = await processor.process({
      tool: "translate-pdf",
      options: { targetLanguage: "fr", ocr: true, languages: ["eng"] },
      inputs: [
        {
          fileId: "f",
          filename: "s.pdf",
          contentType: "application/pdf",
          bytes: new Uint8Array([1]),
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("recognised");
  });
});
