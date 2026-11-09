/**
 * Does THIS worker image translate a scan by running OCR first?
 *
 * The web tier auto-deploys and the worker image is published separately
 * (CLAUDE.md rule 5), so "the code is merged" says nothing about the image
 * that will run a job. The Translate panel offers OCR for a scan only when
 * the live heartbeat carries `translateOcr: true`, and this is the proof the
 * daemon publishes it from. An image built before audit translate-pdf#3 does
 * not contain this module, publishes no such key, and parses as `false` —
 * the old image does not have to cooperate.
 *
 * ── IT PROBES THE COMPOSED CHAIN, NOT A UNIT ─────────────────────────────────
 *
 * The probe builds the registry the daemon builds (`createProcessorRegistry`)
 * and runs a `translate-pdf` job through the processor the registry resolves.
 * Calling `runOcrFirst` directly would prove the OCR step is present while a
 * registry that never handed the OCR processor to translate passed; calling
 * the engine would prove nothing about the chain at all.
 *
 * The evidence is what reached the provider: a marker that exists ONLY in the
 * bytes the stub OCR returns. A translate processor that ignored the request
 * refuses the scan as having no text and the provider hears nothing; one that
 * ran OCR and translated the scan's own (empty) text could not send the
 * marker either.
 *
 * And a control: the same request on a PDF that HAS text must not run OCR.
 * A processor that recognised every document would pass the first half and
 * charge every typed PDF an OCR run it did not need.
 *
 * ── WHAT A PASS DOES AND DOES NOT MEAN ──────────────────────────────────────
 *
 * The OCR runner, the extractor and the provider are stubs: a start-up probe
 * runs no engine and makes no network call. A pass means **this image's
 * translate processor chains the OCR processor for a scan, and only for a
 * scan**. Whether OCR itself can run here is the separate `ocr` capability,
 * and the web asks for both (`/api/worker/status`); whether a real job
 * completes is what the proof harness's "translate-pdf (ocr, scan)" spec is
 * for.
 */

import { createProcessorRegistry } from "../processor";
import type { OcrRunner } from "../processor/ocr";
import type { AiCompletionRequest, AiProvider } from "../ai/provider";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { buildOcrResultMeta } from "@/lib/jobs/ocr";

const enc = (s: string) => new TextEncoder().encode(s);
const SCAN = enc("%PDF-1.7\n% translate-ocr probe: scan\n%%EOF\n");
const TYPED = enc("%PDF-1.7\n% translate-ocr probe: typed\n%%EOF\n");
const RECOGNISED = enc("%PDF-1.7\n% translate-ocr probe: recognised\n%%EOF\n");
/** Present only in what the stub OCR "recognised". */
const MARKER = "translate-ocr-probe-recognised-marker";
const TYPED_TEXT = "translate-ocr-probe typed text";

const same = (a: Uint8Array, b: Uint8Array) =>
  a.byteLength === b.byteLength && a.every((v, i) => v === b[i]);

function extraction(text: string): ExtractedPdfText {
  return {
    pageCount: 1,
    pages: [{ pageNumber: 1, text, characterCount: text.length }],
    text,
    characterCount: text.length,
    hasText: text.length > 0,
  };
}

interface ProbeRun {
  ok: boolean;
  ocrCalls: number;
  sent: string[];
}

/** How the probe builds its registry: the daemon's own, unless a test swaps it. */
export type ProbeRegistryBuilder = typeof createProcessorRegistry;

async function runProbe(
  bytes: Uint8Array,
  build: ProbeRegistryBuilder,
): Promise<ProbeRun> {
  let ocrCalls = 0;
  const sent: string[] = [];
  const runner: OcrRunner = async ({ options }) => {
    ocrCalls += 1;
    return {
      artifacts: [
        {
          filename: "probe-ocr.pdf",
          contentType: "application/pdf",
          bytes: RECOGNISED,
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
  const provider: AiProvider = {
    id: "anthropic",
    model: "capability-probe",
    async complete(request: AiCompletionRequest) {
      sent.push(request.messages.map((m) => m.content).join("\n"));
      return {
        ok: true,
        text: "probe",
        model: "capability-probe",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
  const registry = build({
    ocr: { runner, engines: { ocrmypdf: true, tesseract: true } },
    translate: {
      extract: async (input) =>
        same(input, RECOGNISED)
          ? extraction(MARKER)
          : same(input, TYPED)
            ? extraction(TYPED_TEXT)
            : extraction(""),
      provider,
      now: () => "1970-01-01T00:00:00.000Z",
    },
  });
  const processor = registry.resolve("translate-pdf");
  if (!processor) return { ok: false, ocrCalls, sent };
  const result = await processor.process({
    tool: "translate-pdf",
    options: {
      targetLanguage: "fr",
      sourceLanguage: "auto",
      ocr: true,
      languages: ["eng"],
    },
    inputs: [
      {
        fileId: "probe",
        filename: "probe.pdf",
        contentType: "application/pdf",
        bytes,
      },
    ],
  });
  return { ok: result.ok, ocrCalls, sent };
}

/**
 * True when this image's translate processor recognises a scan with the OCR
 * processor and translates what OCR read — and runs no OCR on a PDF that
 * already has text.
 */
export async function provesTranslateOcr(
  build: ProbeRegistryBuilder = createProcessorRegistry,
): Promise<boolean> {
  try {
    const scan = await runProbe(SCAN, build);
    const scanned =
      scan.ok &&
      scan.ocrCalls === 1 &&
      scan.sent.length === 1 &&
      scan.sent[0]!.includes(MARKER);
    if (!scanned) return false;
    const typed = await runProbe(TYPED, build);
    return (
      typed.ok &&
      typed.ocrCalls === 0 &&
      typed.sent.length === 1 &&
      typed.sent[0]!.includes(TYPED_TEXT)
    );
  } catch {
    // A throw is an answer: this image cannot do it.
    return false;
  }
}
