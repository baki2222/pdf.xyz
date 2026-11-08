import type { JobResults } from "@/lib/jobs/results";
import { parsePdfToWordOptions } from "@/lib/jobs/ocr";
import { WORD_OCR_LABEL } from "@/lib/jobs/pdf-office-export";
import { OCR_REFUSAL_MESSAGES } from "../ocr-engine-errors";
import { describeByteCeiling } from "../engine-file-ceilings";
import { processorFail, type Processor, type ProcessorResult } from "./types";

/** The tool slug the OCR processor serves; a chained job asks it by name. */
const OCR_TOOL_SLUG = "ocr-pdf";

/**
 * What "Recognise text in scans (OCR)" says when OCR cannot help, in words
 * for the panel that offers it. The OCR processor's own copy is written for
 * OCR PDF's panel. `name` is the tool's ("PDF to Excel"), `noun` the thing a
 * conversion with no words would have had nothing to fill ("a spreadsheet"),
 * so an Excel job never names PDF to Word.
 */
export function ocrFirstMessages(name: string, noun: string) {
  return {
    unavailable: `Recognising text in scans needs OCR, which isn't available on this worker. Turn off “${WORD_OCR_LABEL}” to convert the selectable text alone. Nothing was converted.`,
    // CHANGED 2026-11-08 (audit pdf-to-word#3): "… Turn off “…” and convert
    // again." — the only way out until this panel had Redo existing OCR.
    // CHANGED again 2026-11-08: "Turn on “Redo existing OCR” to replace a
    // poor text layer" — it does not replace every one (REDO_OCR_LAYER_OUTCOMES).
    priorText: `This PDF already has a text layer, and the OCR engine would not add a second one. Turn on “Redo existing OCR” to have its pages read again, or turn off “${WORD_OCR_LABEL}” to convert the text it has. Nothing was converted.`,
    noText: `OCR ran, but found no text in this PDF to put in ${noun}. Check the languages you chose match the page. Nothing was converted.`,
    /** The upload itself is over the tool's ceiling — said before OCR runs. */
    tooLarge: (limit: number) =>
      `This PDF is larger than ${describeByteCeiling(limit)}, the most ${name} converts per file. Nothing was converted.`,
    /**
     * OCR's searchable PDF outgrew the ceiling the upload was under: a text
     * layer adds bytes, and OCR may re-encode the page images.
     */
    grew: (size: number, limit: number) =>
      `Recognising the text made this PDF ${describeByteCeiling(size)}, past the ${describeByteCeiling(limit)} ${name} converts per file. Split the PDF and convert the parts. Nothing was converted.`,
  };
}
export type OcrFirstMessages = ReturnType<typeof ocrFirstMessages>;

/** What {@link runOcrFirst} hands back: the bytes to convert, or a refusal. */
export type OcrFirstOutcome =
  | { ok: true; bytes: Uint8Array; results?: JobResults }
  | { ok: false; result: ProcessorResult };

const fail = (error: Parameters<typeof processorFail>[0]): OcrFirstOutcome => ({
  ok: false,
  result: processorFail(error),
});

/**
 * The one "OCR first" step a conversion job may run before its own engine:
 * PDF to Word since 2026-10-24; PDF to Excel, PDF to PowerPoint and Extract
 * Tables since 2026-11-08 (audit pdf-to-excel#2, pdf-to-powerpoint#4,
 * extract-tables#3). Moved here from `./pdf-office-export` so they share ONE
 * step rather than a copy each.
 *
 * The options are `parsePdfToWordOptions`' (`{}` = no OCR: the bytes come
 * back as they went in, with no `results`). The OCR processor is the SAME
 * instance the registry serves `ocr-pdf` with, so option validation, the
 * installed-pack check and the refusal mapping are OCR PDF's own.
 */
export async function runOcrFirst(
  input: Parameters<Processor["process"]>[0],
  bytes: Uint8Array,
  ocr: Processor | undefined,
  messages: OcrFirstMessages,
  maxInput: number | undefined,
): Promise<OcrFirstOutcome> {
  const parsed = parsePdfToWordOptions(input.options);
  if (!parsed.ok)
    return fail({
      code: parsed.error.body.error.code,
      message: parsed.error.body.error.message,
      retryable: false,
    });
  if (!parsed.value.ocr) return { ok: true, bytes };
  if (!ocr || !ocr.capability().ready)
    return fail({
      code: "not_implemented",
      message: messages.unavailable,
      retryable: false,
    });
  // The tool's input ceiling, checked HERE as well as in its engine. Until
  // 2026-11-06 (audit #50) only the engine checked it, against OCR's OUTPUT:
  // an over-ceiling upload was recognised for minutes before the refusal,
  // and a searchable PDF that grew past the ceiling was reported as "The PDF
  // input exceeds the worker's size limit." — no number, blaming a file the
  // page had accepted.
  if (maxInput !== undefined && bytes.byteLength > maxInput)
    return fail({
      code: "payload_too_large",
      message: messages.tooLarge(maxInput),
      retryable: false,
    });
  const recognised = await ocr.process({
    ...input,
    tool: OCR_TOOL_SLUG,
    // The page choices since 2026-11-08 (audit pdf-to-word#3): until then
    // only languages went, so a sideways or crooked scan was recognised as
    // it lay.
    options: {
      languages: parsed.value.languages,
      outputMode: "searchable-pdf",
      rotatePages: parsed.value.rotatePages,
      deskew: parsed.value.deskew,
      redoOcr: parsed.value.redoOcr,
    },
  });
  if (!recognised.ok) {
    // Its refusal copy names OCR PDF's switch; say this panel's.
    const prior =
      recognised.error.message === OCR_REFUSAL_MESSAGES["prior-text"];
    return fail(
      prior
        ? { ...recognised.error, message: messages.priorText }
        : recognised.error,
    );
  }
  const pdf = recognised.artifacts.find(
    (a) => a.contentType === "application/pdf",
  );
  if (!pdf)
    return fail({
      code: "internal_error",
      message: "The OCR engine produced no searchable PDF.",
      retryable: true,
    });
  // Deterministic, so final: the same scan recognises to the same size.
  if (maxInput !== undefined && pdf.bytes.byteLength > maxInput)
    return fail({
      code: "payload_too_large",
      message: messages.grew(pdf.bytes.byteLength, maxInput),
      retryable: false,
    });
  return { ok: true, bytes: pdf.bytes, results: recognised.results ?? {} };
}
