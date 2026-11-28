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
  OCR_COMBINE_CEILING,
  ocrBatchLanguageSentence,
} from "@/lib/batch/ocr-copy";
import {
  OCR_COMBINE_HINT,
  describeOcrLanguage,
  ocrCombineTooLarge,
  ocrConfidenceLooksLow,
  ocrSendsPhotoAsPdf,
  type OcrOptions,
} from "@/lib/jobs/ocr";
import { ScanText } from "lucide-react";
import { DownloadCta, ResultCard, WorkerRunButton } from "../runner-kit";
import { jobBusyLabel, useWorkerJob, WorkerJobStatus } from "../../worker-job";
import { useWorkerPanel, workerOutput } from "../../worker-panel-shell";
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
 * request: a JPG or PNG with "Straighten crooked pages" or "Turn pages
 * upright" ticked is put on a PDF page in the browser and sent as a PDF
 * (`ocrUploadFor`, audit ocr-pdf#2), so both boxes reach it as they reach a
 * scan. Until 2026-11-22 both were sent off for an image.
 *
 * OUTPUTS. A job can make two files ("PDF + text"); both are the row's, and
 * then each row's files sit in a folder of the ZIP named after its input.
 *
 * COMBINE INTO ONE PDF (audit ocr-pdf#3, 2026-11-22). Ticked, the list is
 * not a batch: every file is put, in the order listed, into ONE PDF in the
 * browser (`@/lib/pdf/ocr-photo-pdf`), and that PDF is ONE upload and ONE
 * job (`OcrCombined`). The worker still reads one file per job; the
 * combined file must fit the per-file ceiling, and a list over it is refused
 * before anything is read or sent. Until then photos were never combined.
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

/**
 * What one file's job uploads: the file as it is, or, for a photo with
 * Straighten or Turn ticked, a one-page PDF of it made here (ocr-pdf#2).
 */
export async function ocrUploadFor(
  input: { filename: string; bytes: Uint8Array },
  contentType: string,
  frozen: OcrOptions,
): Promise<{ filename: string; bytes: Uint8Array; contentType: string }> {
  if (!ocrSendsPhotoAsPdf(contentType, frozen))
    return { ...input, contentType };
  const { buildOcrPdf, ocrPdfName } = await import("@/lib/pdf/ocr-photo-pdf");
  return {
    filename: ocrPdfName([{ name: input.filename }]),
    bytes: await buildOcrPdf([
      { name: input.filename, type: contentType, bytes: input.bytes },
    ]),
    contentType: "application/pdf",
  };
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

/** The combined run's button: it names what it makes. */
const COMBINED_RUN_LABEL = "Recognize text in one PDF";

/**
 * The list as ONE job: every file, in order, made into one PDF here, then
 * one upload and one OCR job with the request the panel built.
 */
function OcrCombined({
  files,
  request,
  settings,
  runBlocked,
  contentTypeOf,
  onReset,
  onStart,
}: {
  files: File[];
  request: OcrOptions;
  settings: ReactNode;
  runBlocked: string | null;
  contentTypeOf: (file: File) => string;
  onReset: () => void;
  /** Run was pressed: the batch holds the Combine box from here on. */
  onStart: () => void;
}) {
  const { available } = useWorkerPanel();
  const job = useWorkerJob<OcrWorkerResult>({
    tool: "ocr-pdf",
    resume: (id, controls) => resumeWorkerOcr(id, controls),
  });
  const { busy, outcome, run } = job;
  const total = files.reduce((n, file) => n + file.size, 0);
  const tooLarge =
    total > OCR_COMBINE_CEILING
      ? ocrCombineTooLarge(total, OCR_COMBINE_CEILING)
      : null;

  const start = useCallback(async () => {
    if (!available || tooLarge || runBlocked) return;
    // Held from the press on: unticking would unmount this view and the job
    // with it, while the server kept running it (review of 7b498d92).
    onStart();
    await run(async (controls): Promise<OcrWorkerResult> => {
      const { buildOcrPdf, ocrPdfName } =
        await import("@/lib/pdf/ocr-photo-pdf");
      const sources = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          type: contentTypeOf(file),
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      let bytes: Uint8Array;
      try {
        bytes = await buildOcrPdf(sources);
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
      // A PNG is stored losslessly, so the made PDF can outgrow its files.
      if (bytes.byteLength > OCR_COMBINE_CEILING)
        return {
          ok: false,
          message: ocrCombineTooLarge(bytes.byteLength, OCR_COMBINE_CEILING),
        };
      return runWorkerOcr(
        {
          filename: ocrPdfName(sources),
          bytes,
          contentType: "application/pdf",
          options: request,
        },
        controls,
      );
    });
  }, [
    available,
    tooLarge,
    runBlocked,
    onStart,
    run,
    files,
    contentTypeOf,
    request,
  ]);

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-1.5" aria-label="Files, in page order">
        {files.map((file, index) => (
          <li
            key={`${index}-${file.name}`}
            className="border-line bg-wash text-fg rounded-ctl flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-sm"
          >
            <span className="truncate">
              {index + 1}. {file.name}
            </span>
          </li>
        ))}
      </ol>
      {settings}
      {tooLarge && (
        <p className="text-warn text-xs leading-relaxed">{tooLarge}</p>
      )}
      {runBlocked && (
        <p className="text-warn text-xs leading-relaxed">{runBlocked}</p>
      )}
      <WorkerRunButton
        onClick={start}
        busy={busy}
        disabled={!available || tooLarge !== null || runBlocked !== null}
        busyLabel={jobBusyLabel(
          job.phase,
          "Recognizing text on our secure server…",
        )}
        icon={ScanText}
      >
        {COMBINED_RUN_LABEL}
      </WorkerRunButton>
      <WorkerJobStatus job={job} />
      {outcome?.ok === true && (
        <ResultCard
          announce={`OCR complete — ${outcome.artifacts.length} file${outcome.artifacts.length === 1 ? "" : "s"} ready.`}
          output={outcome.artifacts.map((entry) =>
            workerOutput(entry.bytes, entry.artifact),
          )}
          inputBytes={total}
        >
          <p className="text-ok text-sm">
            OCR complete — {outcome.artifacts.length} file
            {outcome.artifacts.length === 1 ? "" : "s"} ready.
          </p>
          <div className="flex flex-wrap gap-2">
            {outcome.artifacts.map((entry) => (
              <DownloadCta
                key={entry.artifact.artifactId}
                href={entry.artifact.url}
                download={entry.artifact.filename}
                size="inline"
              >
                Download {entry.artifact.filename}
              </DownloadCta>
            ))}
          </div>
        </ResultCard>
      )}
      <button
        type="button"
        onClick={onReset}
        className="text-muted hover:text-fg tap-row inline-flex items-center gap-1.5 self-start text-xs font-medium transition"
      >
        Start over
      </button>
    </div>
  );
}

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
  // "Combine into one PDF": off by default; once a run starts (the batch's
  // or the combined one) it stays as it was, so neither running view is
  // swapped for the other.
  const [combine, setCombine] = useState(false);
  const [started, setStarted] = useState(false);
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
    setStarted(true);
  }, []);

  const run = useCallback<WorkerRun>(
    async (input, controls, file) => {
      const frozen = frozenRef.current;
      if (!frozen) throw new BatchItemError(NO_OCR_REQUEST_FROZEN);
      // A photo that cannot be put on a page is this row's failure, in words.
      const upload = await ocrUploadFor(
        input,
        contentTypeOf(file),
        frozen,
      ).catch((err: unknown) => {
        throw new BatchItemError(
          err instanceof Error ? err.message : String(err),
        );
      });
      return ocrAsWorkerResult(
        await runWorkerOcr({ ...upload, options: frozen }, controls),
      );
    },
    [contentTypeOf],
  );

  const shown = ran ?? request;
  const languages = new Intl.ListFormat("en", { type: "conjunction" }).format(
    request.languages.map(describeOcrLanguage),
  );

  const onCombinedStart = useCallback(() => setStarted(true), []);
  const languageSentence = (
    <p className="text-fg text-sm leading-relaxed" data-ocr-batch-language="">
      {ocrBatchLanguageSentence(languages)}
    </p>
  );

  const combineBox = (
    <label className="text-muted flex items-start gap-2.5 text-sm">
      <input
        type="checkbox"
        checked={combine}
        // Guarded, never `disabled`: focus stays put (#46).
        onChange={(event) => {
          if (!started) setCombine(event.target.checked);
        }}
        aria-disabled={started || undefined}
        className="border-line-strong bg-wash accent-accent rounded-ctl mt-0.5 size-4 aria-disabled:opacity-50"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-fg font-medium">Combine into one PDF</span>
        <span className="text-muted text-xs leading-relaxed">
          {OCR_COMBINE_HINT}
        </span>
      </span>
    </label>
  );

  if (combine)
    return (
      <OcrCombined
        files={files}
        request={request}
        settings={
          <>
            {combineBox}
            {settings}
            {languageSentence}
          </>
        }
        runBlocked={runBlocked}
        contentTypeOf={contentTypeOf}
        onReset={onReset}
        onStart={onCombinedStart}
      />
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
          {combineBox}
          {settings}
          {languageSentence}
        </>
      }
      runBlocked={runBlocked}
      onRun={onRun}
    />
  );
}
