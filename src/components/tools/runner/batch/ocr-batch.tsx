"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  OCR_BATCH_LOW_CONFIDENCE_NOTE,
  OCR_BATCH_PDF_ONLY_NOTE,
  ocrBatchLanguageSentence,
} from "@/lib/batch/ocr-copy";
import {
  describeOcrLanguage,
  ocrConfidenceLooksLow,
  type OcrOptions,
} from "@/lib/jobs/ocr";
import type { Tool } from "@/lib/tools/types";
import {
  resumeWorkerOcr,
  runWorkerOcr,
  type OcrWorkerResult,
} from "@/lib/workers/ocr-client";
import { WorkerBatchRunner } from "./worker-batch-runner";
import {
  BatchItemError,
  type WorkerBatchResult,
  type WorkerBatchSuccess,
  type WorkerResume,
  type WorkerRun,
} from "./worker-batch";

/**
 * OCR PDF's batch (batch plan P5): every file is today's single OCR job —
 * one upload, one `POST /api/jobs` with one input, the same poll and the
 * same downloads — through the worker batch (`./worker-batch-runner`),
 * strictly one after another, at `BATCH_LIMITS.ocrMaxFiles`. The worker
 * does not change.
 *
 * THE SETTINGS. The single-file panel's own recognition settings are drawn
 * above the list, unchanged, and its validated request (`request`, built by
 * `parseOcrOptions` in the panel) is what Run is held to: Run waits until
 * the panel's own rule passes (`runBlocked`: every selected language has a
 * pack on our server), exactly as the single-file Run does. Pressing Run
 * copies the request into `frozenRef`, and every file's job body is built
 * from that copy — so a language the page changes after Run (a worker
 * report narrowing the packs, say) reaches no file of that run, and a
 * paused file runs again with what was frozen.
 *
 * Per file, one rule of the single-file panel's is applied to the frozen
 * request: a JPG or PNG (by the content type the upload sends) goes to
 * Tesseract, which has no straighten or turn step, so for one both are
 * sent off — the panel turns those boxes off for an image the same way.
 *
 * OUTPUTS. A job can make two files ("PDF + text"); both are the row's, and
 * then each row's files sit in a folder of the ZIP named after its input.
 * Photos are never combined: each input is its own job and its own output.
 */

export interface OcrBatchProps {
  tool: Tool;
  files: File[];
  onReset: () => void;
  onSingle?: (file: File) => void;
  /** The panel's validated request, as it stands before Run. */
  request: OcrOptions;
  /** The panel's own recognition settings, drawn above the list. */
  settings: ReactNode;
  /** The panel's reason Run cannot be pressed (no pack for a language). */
  runBlocked: string | null;
  /** The content type the panel's upload sends for a file. */
  contentTypeOf: (file: File) => string;
}

/** A job ran with nothing frozen: never sent, said plainly. */
export const NO_OCR_REQUEST_FROZEN =
  "This file's recognition settings were not ready, so it was not sent. Press Retry failed.";

/** What one file's job sends: the frozen request, with the image rule. */
export function ocrRequestForFile(
  frozen: OcrOptions,
  contentType: string,
): OcrOptions {
  return contentType.toLowerCase().startsWith("image/")
    ? { ...frozen, deskew: false, rotatePages: false }
    : frozen;
}

/** The OCR client's result, as a worker batch's row reads it. */
export function ocrAsWorkerResult(result: OcrWorkerResult): WorkerBatchResult {
  if (!result.ok) return result;
  const [first, ...rest] = result.artifacts;
  if (!first)
    return { ok: false, message: "The job completed but produced no output." };
  return {
    ok: true,
    job: result.job,
    artifact: first.artifact,
    output: first.bytes,
    ...(rest.length > 0
      ? {
          more: rest.map((entry) => ({
            artifact: entry.artifact,
            output: entry.bytes,
          })),
        }
      : {}),
  };
}

const resume: WorkerResume = async (jobId, controls) =>
  ocrAsWorkerResult(await resumeWorkerOcr(jobId, controls));

const rowNote = (result: WorkerBatchSuccess): string | undefined => {
  const meta = result.job.results?.ocr;
  return meta && ocrConfidenceLooksLow(meta)
    ? OCR_BATCH_LOW_CONFIDENCE_NOTE
    : undefined;
};

export function OcrBatch({
  tool,
  files,
  onReset,
  onSingle,
  request,
  settings,
  runBlocked,
  contentTypeOf,
}: OcrBatchProps) {
  const frozenRef = useRef<OcrOptions | null>(null);
  // What Run froze, for drawing (the ZIP's folders); the ref is what runs.
  const [ran, setRan] = useState<OcrOptions | null>(null);
  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  const onRun = useCallback(() => {
    const frozen = { ...requestRef.current };
    frozenRef.current = frozen;
    setRan(frozen);
  }, []);

  const run = useCallback<WorkerRun>(
    async (input, controls, file) => {
      const frozen = frozenRef.current;
      if (!frozen) throw new BatchItemError(NO_OCR_REQUEST_FROZEN);
      const contentType = contentTypeOf(file);
      return ocrAsWorkerResult(
        await runWorkerOcr(
          {
            ...input,
            contentType,
            options: ocrRequestForFile(frozen, contentType),
          },
          controls,
        ),
      );
    },
    [contentTypeOf],
  );

  const shown = ran ?? request;
  const languages = new Intl.ListFormat("en", { type: "conjunction" }).format(
    request.languages.map(describeOcrLanguage),
  );

  return (
    <WorkerBatchRunner
      tool={tool}
      files={files}
      onReset={onReset}
      {...(onSingle ? { onSingle } : {})}
      run={run}
      resume={resume}
      rowNote={rowNote}
      bundleRows={shown.outputMode === "both"}
      settings={
        <>
          {settings}
          <p
            className="text-fg text-sm leading-relaxed"
            data-ocr-batch-language=""
          >
            {ocrBatchLanguageSentence(languages)}
          </p>
          {(request.deskew || request.rotatePages) && (
            <p className="text-muted text-xs leading-relaxed">
              {OCR_BATCH_PDF_ONLY_NOTE}
            </p>
          )}
        </>
      }
      runBlocked={runBlocked}
      onRun={onRun}
    />
  );
}
