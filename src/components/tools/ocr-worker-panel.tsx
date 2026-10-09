"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  Check,
  Cpu,
  Download,
  FileDown,
  FileText,
  FileUp,
  Gauge,
  Hash,
  Languages,
  ScanText,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { workerPipelineStages } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import {
  DEFAULT_OCR_LANGUAGE,
  DEFAULT_OCR_OUTPUT_MODE,
  MAX_OCR_LANGUAGES,
  OCR_LANGUAGES,
  OCR_LANGUAGE_CODES,
  OCR_MAX_INPUT_FILES,
  OCR_OUTPUT_MODES,
  describeOcrLanguage,
  describeOcrRequest,
  ocrConfidenceLooksLow,
  ocrOutputsForMode,
  parseOcrOptions,
  type OcrLanguage,
  type OcrOptions,
  type OcrOutputMode,
  type OcrResultMeta,
} from "@/lib/jobs/ocr";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  resumeWorkerOcr,
  runWorkerOcr,
  type OcrWorkerResult,
} from "@/lib/workers/ocr-client";
import type { Tool } from "@/lib/tools/types";
import { pickRefusal, type PickRefusal } from "@/lib/uploads/pick-check";
import { cn, formatBytes } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
import {
  DownloadCta,
  Dropzone,
  ResultCard,
  WorkerRunButton,
} from "./runner/runner-kit";
import { NotifyMe } from "./notify-me";
import { jobBusyLabel, useWorkerJob, WorkerJobStatus } from "./worker-job";
import {
  useWorkerStatus,
  WorkerStatusPending,
  type WorkerPhase,
} from "./worker-status";

type Phase = WorkerPhase;

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

function contentTypeFor(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPE_BY_EXT[ext] ?? "application/pdf";
}

function StageIcon({ id, className }: { id: string; className?: string }) {
  // Reuse the same stage vocabulary as the generic worker preview, but with an
  // OCR-forward accent on the processing step.
  switch (id) {
    case "process":
      return <ScanText className={className} aria-hidden />;
    case "scan":
      return <ShieldCheck className={className} aria-hidden />;
    case "download":
      return <Download className={className} aria-hidden />;
    case "delete":
      return <Timer className={className} aria-hidden />;
    default:
      return <Cpu className={className} aria-hidden />;
  }
}

function SpecRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileUp;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-muted inline-flex items-center gap-2 text-sm">
        <Icon className="text-muted size-4" aria-hidden />
        {label}
      </span>
      <span className="text-fg text-right text-sm font-medium">{value}</span>
    </div>
  );
}

/** Honest availability badge derived from the live worker status. */
function badgeFor(
  phase: Phase,
  status: WorkerStatus | null,
): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading")
    return { tone: "info", label: "Checking…", pulse: true };
  if (phase === "error" || !status) {
    return { tone: "muted", label: "Status unknown", pulse: false };
  }
  if (status.ocr.available) {
    return status.mode === "local-dev"
      ? { tone: "warn", label: "Local-dev worker", pulse: true }
      : { tone: "ok", label: "Available", pulse: false };
  }
  return { tone: "muted", label: "Not enabled", pulse: false };
}

/**
 * Premium, OCR-specific secure-worker panel for `/tools/ocr-pdf`.
 *
 * The tool page mounts it from the panel registry (`./worker-panels`), which
 * since WP-06 has no generic preview to fall back to: every worker tool has a
 * real panel, and `tool-page-registry.test.ts` holds that. It reads
 * the live, presence-only `/api/worker/status` endpoint, lets the user configure
 * a real OCR request (languages, output, redo-OCR) that is validated with the
 * shared `parseOcrOptions` contract, and shows exactly what a secure worker would
 * do with the file — encrypted upload → scan → isolated recognition → download →
 * auto-delete. It never fabricates recognized text or a searchable PDF: when OCR
 * is not enabled (every environment this build ships in), it says so plainly and
 * offers no upload. Only when the status endpoint honestly reports OCR available
 * does it mount an uploader and run the real job flow via {@link runWorkerOcr}.
 */
export function OcrWorkerPanel({ tool }: { tool: Tool }) {
  const { phase, status, retry } = useWorkerStatus();

  const [languages, setLanguages] = useState<OcrLanguage[]>([
    DEFAULT_OCR_LANGUAGE,
  ]);
  const [outputMode, setOutputMode] = useState<OcrOutputMode>(
    DEFAULT_OCR_OUTPUT_MODE,
  );
  const [redoOcr, setRedoOcr] = useState(false);

  // The packs the worker reports it actually has. Until 2026-09-27 the menu
  // rendered the static catalogue whatever the status said — the heartbeat's
  // report reached the status payload and stopped there, while the FAQ told
  // search results the page reflects it. With no report to read (status still
  // loading, unreachable, or OCR not available — no uploader is mounted then)
  // there is nothing to narrow by, so the catalogue stands.
  const installed = useMemo<ReadonlySet<string>>(
    () =>
      new Set(
        status?.ocr.available ? status.ocr.languages : OCR_LANGUAGE_CODES,
      ),
    [status],
  );

  // What is really selected: the user's picks minus any pack the worker lacks.
  // Derived rather than stored, so the report arriving AFTER a pick still
  // removes it. If that empties the selection (the default English on a worker
  // without it), fall back to the first installed language — the request must
  // never carry a code the worker will refuse.
  const selected = useMemo<OcrLanguage[]>(() => {
    const kept = languages.filter((code) => installed.has(code));
    if (kept.length > 0) return kept;
    const first = OCR_LANGUAGE_CODES.find((code) => installed.has(code));
    return first ? [first] : languages;
  }, [languages, installed]);

  const toggleLanguage = useCallback(
    (code: OcrLanguage) => {
      // No check for an uninstalled code here: `selected` drops it on the next
      // render, so a click on a chip the worker cannot run changes nothing.
      const prev = selected;
      if (prev.includes(code)) {
        if (prev.length === 1) return; // keep at least one language
        setLanguages(prev.filter((entry) => entry !== code));
        return;
      }
      if (prev.length >= MAX_OCR_LANGUAGES) return; // respect the cap
      setLanguages([...prev, code]);
    },
    [selected],
  );

  // Run the free-form options through the real contract validator, so the "what
  // will happen" summary and any submitted job carry exactly the validated value.
  const parsed = useMemo(
    () => parseOcrOptions({ languages: selected, outputMode, redoOcr }),
    [selected, outputMode, redoOcr],
  );
  const request: OcrOptions = parsed.ok
    ? parsed.value
    : { languages: selected, outputMode, redoOcr };
  // A worker reporting no pack at all can run nothing; say so rather than
  // submit a job it will refuse.
  const runnable =
    parsed.ok && request.languages.every((code) => installed.has(code));

  const badge = badgeFor(phase, status);
  const available = phase === "ready" && status?.ocr.available === true;
  const outputs = ocrOutputsForMode(outputMode).join(", ");

  return (
    <div className="">
      <div className="border-line bg-panel flex flex-col gap-6 rounded-[4px] border p-5 sm:p-7">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="border-info/40 bg-info/10 text-info inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium">
              <ScanText className="size-3" aria-hidden />
              Secure-worker OCR
            </span>
            <StatusBadge
              tone={badge.tone}
              label={badge.label}
              pulse={badge.pulse}
            />
          </div>
          <h2 className="text-fg text-lg font-semibold">
            {tool.name} runs on an encrypted secure worker
          </h2>
          <p className="text-muted text-sm leading-relaxed">
            Optical character recognition needs a native OCR engine, so it runs
            on an isolated, auto-deleting worker rather than in your browser.
            Configure the recognition below — we&apos;ll show exactly what
            happens to your file, and never fake a result.
          </p>
        </div>

        {/* Recognition settings */}
        <div className="bg-panel border-line flex flex-col gap-4 rounded-[4px] border p-4 sm:p-5">
          <h3 className="text-faint kicker">Recognition settings</h3>

          {/* Languages */}
          <div className="flex flex-col gap-2">
            <span className="text-muted inline-flex items-center gap-1.5 text-xs font-medium">
              <Languages className="size-3.5" aria-hidden />
              Languages{" "}
              <span className="text-muted">(up to {MAX_OCR_LANGUAGES})</span>
            </span>
            {/*
              The single most useful sentence on this page. OCR against the wrong
              language does not fail — it returns confident-looking nonsense — so a
              user who leaves the default alone gets a successful job and unusable
              output, with nothing anywhere to tell them why.
            */}
            <p className="text-muted text-xs leading-relaxed">
              Select every language printed on the page — a page that mixes
              Bengali with English technical terms needs both. The wrong
              language does not produce an error, it produces plausible-looking
              gibberish.
            </p>
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label="OCR languages"
            >
              {OCR_LANGUAGES.map((language) => {
                const active = selected.includes(language.code);
                const notInstalled = !installed.has(language.code);
                const atCap = !active && selected.length >= MAX_OCR_LANGUAGES;
                return (
                  <button
                    key={language.code}
                    type="button"
                    // aria-disabled, never native: the cap flips exactly while the
                    // user is picking languages, and a natively disabled chip would
                    // eject their focus and leave the tab order (the #46 rule).
                    // toggleLanguage respects the cap; `selected` the report.
                    onClick={() => toggleLanguage(language.code)}
                    aria-disabled={notInstalled || atCap || undefined}
                    aria-pressed={active}
                    title={
                      notInstalled
                        ? "Not installed on the current worker — it has no recognition pack for this language."
                        : atCap
                          ? `Deselect a language first — at most ${MAX_OCR_LANGUAGES} at once.`
                          : undefined
                    }
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
                      active
                        ? "border-accent/40 bg-accent/10 text-accent"
                        : "border-line bg-wash text-muted hover:border-line-strong hover:bg-wash hover:text-fg",
                    )}
                  >
                    {active && <Check className="size-3" aria-hidden />}
                    {language.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Output mode */}
          <div className="flex flex-col gap-2">
            <span className="text-muted text-xs font-medium">Output</span>
            <div
              className="flex flex-wrap gap-1.5"
              role="radiogroup"
              aria-label="OCR output"
            >
              {OCR_OUTPUT_MODES.map((mode) => {
                const active = outputMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setOutputMode(mode.id)}
                    title={mode.description}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                      active
                        ? "border-accent/40 bg-accent/10 text-accent"
                        : "border-line bg-wash text-muted hover:border-line-strong hover:bg-wash hover:text-fg",
                    )}
                  >
                    {mode.label}
                  </button>
                );
              })}
            </div>
            <p className="text-muted text-xs leading-relaxed">
              {
                OCR_OUTPUT_MODES.find((mode) => mode.id === outputMode)
                  ?.description
              }
            </p>
          </div>

          {/*
            Redo toggle. Until 2026-09-27 this was "Skip pages that already have
            text", off by default, and its copy described the off state as
            re-recognizing those pages. Off actually passed no flag at all, and
            OCRmyPDF aborted the whole job on the first page with text. Keeping
            existing text is now the default, and the only opt-in is the
            non-destructive redo (never --force-ocr, which rasterizes pages).
          */}
          <label className="text-muted flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={redoOcr}
              onChange={(event) => setRedoOcr(event.target.checked)}
              className="border-line-strong bg-wash accent-accent mt-0.5 size-4 rounded"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-fg font-medium">Redo existing OCR</span>
              <span className="text-muted text-xs leading-relaxed">
                Pages that already have text keep it, and only the pages without
                text are recognized. Turn this on when a PDF&apos;s existing OCR
                text is poor: that text is removed and those pages are
                recognized again. Text typed into the document is kept either
                way. PDFs only.
              </span>
            </span>
          </label>

          <p className="border-line bg-wash text-muted rounded-[3px] border px-3 py-2 text-xs">
            <span className="text-muted font-medium">This request:</span>{" "}
            {describeOcrRequest(request)}
            {redoOcr ? " · redo existing OCR" : ""}
          </p>
        </div>

        {/* Status-dependent action area */}
        {available && status ? (
          <OcrRunArea
            request={request}
            localDevOnly={status.localDevOnly}
            refuse={(file) => pickRefusal(tool, file)}
            runnable={runnable}
          />
        ) : (
          <OcrUnavailable
            onRetry={retry}
            phase={phase}
            status={status}
            toolName={tool.name}
            toolSlug={tool.slug}
          />
        )}

        {/* Pipeline: honest "here's what will happen" */}
        <div className="flex flex-col gap-3">
          <h3 className="text-faint kicker">What happens to your file</h3>
          <ol className="flex flex-col gap-1">
            {workerPipelineStages(status ? status.scan.active : null, tool).map(
              (stage, i, all) => (
                <li key={stage.id} className="flex items-start gap-3">
                  <div className="flex flex-col items-center self-stretch">
                    <span className="border-line bg-wash text-muted grid size-8 shrink-0 place-items-center rounded-full border">
                      <StageIcon id={stage.id} className="size-4" />
                    </span>
                    {i < all.length - 1 && (
                      <span className="bg-wash my-1 w-px flex-1" aria-hidden />
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 pb-3">
                    <span className="text-fg text-sm font-medium">
                      {i + 1}. {stage.title}
                    </span>
                    <span className="text-muted text-xs leading-relaxed">
                      {stage.description}
                    </span>
                  </div>
                </li>
              ),
            )}
          </ol>
        </div>

        {/* Spec rows */}
        <div className="bg-panel border-line divide-line divide-y rounded-[4px] border px-4 py-1">
          <SpecRow
            icon={FileUp}
            label="Inputs"
            value={tool.accept.join(", ")}
          />
          <SpecRow icon={FileDown} label="Outputs" value={outputs} />
          <SpecRow
            icon={Timer}
            label="Retention"
            value={`Inputs wiped after processing · outputs ${DEFAULT_RETENTION.outputTtlMinutes} min`}
          />
          <SpecRow
            icon={ShieldCheck}
            label="Limits"
            // OCR's own per-job count, not the platform's JOB_LIMITS.maxInputFiles:
            // this row said "up to 20 files" above an uploader that kept one.
            value={`${formatBytes(JOB_LIMITS.maxFileBytes)}/file · ${OCR_MAX_INPUT_FILES} ${OCR_MAX_INPUT_FILES === 1 ? "file" : "files"} per job`}
          />
        </div>

        <p className="text-muted text-xs leading-relaxed">
          No account required. OCR runs on a separate processing server, not in
          your browser: files are encrypted in transit and at rest, recognized
          in a temporary per-job folder that is erased when the job ends, and
          deleted automatically. It&apos;s enabled per deployment; the{" "}
          <Link
            href="/privacy#files"
            className="text-accent underline underline-offset-4"
          >
            privacy policy
          </Link>{" "}
          says what happens to an uploaded file and when it is deleted.
        </p>
      </div>
    </div>
  );
}

/**
 * The honest "OCR isn't running here" state: a clear reason from the live status
 * plus a notify placeholder. Deliberately renders NO uploader — nothing can be
 * submitted, so nothing pretends it can.
 */
function OcrUnavailable({
  phase,
  onRetry,
  status,
  toolName,
  toolSlug,
}: {
  phase: Phase;
  onRetry: () => void;
  status: WorkerStatus | null;
  toolName: string;
  toolSlug: string;
}) {
  // Until the status is KNOWN this box says nothing about the tool: the
  // server renders the loading phase, and "Notify me when this ships" there
  // told search engines that live tools had not shipped. A failed status
  // check gets a retry, not a notify button.
  if (phase !== "ready")
    return <WorkerStatusPending phase={phase} onRetry={onRetry} />;
  return (
    <div className="border-warn/40 bg-warn/10 flex flex-col gap-3 rounded-[4px] border p-4">
      <p className="text-warn text-sm leading-relaxed">
        {status?.ocr.detail ??
          "OCR isn't enabled in this environment. No file is uploaded."}
      </p>
      <div className="flex flex-col gap-2">
        <NotifyMe toolName={toolName} toolSlug={toolSlug} checking={false} />
      </div>
    </div>
  );
}

/**
 * The available state: an uploader plus a run button that drives the real,
 * documented job flow via {@link runWorkerOcr}. Reached only when the status
 * endpoint honestly reports OCR available; every result here is real output
 * downloaded from the worker, never fabricated.
 */
function OcrRunArea({
  request,
  localDevOnly,
  refuse,
  runnable,
}: {
  request: OcrOptions;
  localDevOnly: boolean;
  refuse: PickRefusal;
  /** False when the request names a language the worker reports it lacks. */
  runnable: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  // How many files a drop brought beyond the one OCR reads. A drop bypasses
  // `multiple={false}`, so without this the rest vanished without a word.
  const [discarded, setDiscarded] = useState(0);
  const job = useWorkerJob<OcrWorkerResult>({
    tool: "ocr-pdf",
    resume: (id, controls) => resumeWorkerOcr(id, controls),
  });
  const { busy, outcome, setOutcome, run } = job;

  const start = useCallback(async () => {
    if (!file) return;
    await run(async (controls) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await runWorkerOcr(
        {
          filename: file.name,
          bytes,
          contentType: contentTypeFor(file),
          options: request,
        },
        controls,
      );
      return result;
    });
  }, [file, request, run]);

  return (
    <div className="border-info/40 bg-info/10 flex flex-col gap-3 rounded-[4px] border p-4">
      <p className="text-info flex items-start gap-1.5 text-xs leading-relaxed">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {localDevOnly
          ? "This runs on your local-dev worker — the file is processed in-process on this machine, not sent to any third party."
          : "Running this uploads your file to the encrypted secure worker, which recognizes text and then deletes the input."}
      </p>

      {file ? (
        <div className="border-line bg-wash text-fg flex flex-wrap items-center justify-between gap-2 rounded-[3px] border px-3 py-2 text-sm">
          <span className="truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => {
              setFile(null);
              setDiscarded(0);
              setOutcome(null);
            }}
            className="text-muted hover:text-fg shrink-0 text-xs font-medium transition"
          >
            Remove
          </button>
        </div>
      ) : (
        <Dropzone
          refuse={refuse}
          onFiles={(files) => {
            setFile(files[0] ?? null);
            setDiscarded(Math.max(0, files.length - OCR_MAX_INPUT_FILES));
          }}
          accept="application/pdf,image/jpeg,image/png"
          multiple={false}
          compact
          title="Add a scan to OCR, or"
          hint="PDF, JPG, or PNG"
        />
      )}

      {discarded > 0 && (
        <p className="text-warn text-xs leading-relaxed" role="status">
          Only the first file was added — OCR runs one document per job. The
          other {discarded === 1 ? "file was" : `${discarded} files were`} not
          uploaded; run each as its own job.
        </p>
      )}

      {!runnable && (
        <p className="text-warn text-xs leading-relaxed">
          This worker reports no recognition pack for the selected language, so
          OCR can&apos;t run here right now.
        </p>
      )}

      <WorkerRunButton
        onClick={start}
        busy={busy}
        disabled={!file || !runnable}
        busyLabel={jobBusyLabel(job.phase, "Recognizing on the worker…")}
        icon={ScanText}
      >
        Run OCR on the worker
      </WorkerRunButton>

      <WorkerJobStatus job={job} />

      {outcome?.ok === true && (
        <ResultCard
          announce={`OCR complete — ${outcome.artifacts.length} file${outcome.artifacts.length === 1 ? "" : "s"} ready.`}
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
                {entry.artifact.filename}
              </DownloadCta>
            ))}
          </div>
          {outcome.job.results?.ocr && (
            <OcrResultSummary meta={outcome.job.results.ocr} />
          )}
        </ResultCard>
      )}
    </div>
  );
}

/**
 * The honest, structural summary of a completed OCR run — the safe, content-free
 * {@link OcrResultMeta} the worker attached to the job record (`Job.results.ocr`),
 * surfaced from the job status API. It shows ONLY structural facts — how many
 * pages, what was produced, which languages, and how many characters the text
 * sidecar holds — and NEVER any recognized text. Every field is optional: a value
 * the backend could not determine is simply omitted, so nothing is fabricated to
 * fill a row. Renders nothing when there is no safe fact to show. Exported for a
 * focused render test of the "structural only, graceful when missing" contract.
 */
export function OcrResultSummary({ meta }: { meta: OcrResultMeta }) {
  const rows: { icon: typeof FileUp; label: string; value: string }[] = [];

  if (meta.pageCount !== null) {
    rows.push({
      icon: FileText,
      label: meta.pageCount === 1 ? "Page" : "Pages",
      value: meta.pageCount.toLocaleString(),
    });
  }
  rows.push({
    icon: FileDown,
    label: "Output",
    value:
      OCR_OUTPUT_MODES.find((mode) => mode.id === meta.outputMode)?.label ??
      meta.outputMode,
  });
  if (meta.languages.length > 0) {
    rows.push({
      icon: Languages,
      label: meta.languages.length === 1 ? "Language" : "Languages",
      value: meta.languages.map(describeOcrLanguage).join(", "),
    });
  }
  if (meta.textCharacters !== null) {
    rows.push({
      icon: Hash,
      label: "Text extracted",
      value: `${meta.textCharacters.toLocaleString()} character${
        meta.textCharacters === 1 ? "" : "s"
      }`,
    });
  }
  // Present for image inputs, absent for PDFs — OCRmyPDF reports none. An absent row
  // is the honest rendering; a dash or a zero would read as a broken feature or, worse,
  // as a measured lack of confidence.
  if (meta.meanConfidence !== null) {
    rows.push({
      icon: Gauge,
      label: "Confidence",
      value: `${Math.round(meta.meanConfidence * 100)}%`,
    });
  }

  if (rows.length === 0) return null;

  const looksLow = ocrConfidenceLooksLow(meta);
  const languageNames = meta.languages.map(describeOcrLanguage).join(", ");

  return (
    <div className="border-line bg-wash mt-1 flex flex-col gap-1 rounded-[3px] border p-3">
      <h4 className="text-faint kicker">Recognition summary</h4>
      <dl className="divide-line divide-y">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-3 py-1.5"
          >
            <dt className="text-muted inline-flex items-center gap-2 text-xs">
              <row.icon className="text-muted size-3.5" aria-hidden />
              {row.label}
            </dt>
            <dd className="text-fg text-right text-xs font-medium">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {/*
        Shown on every run, both engines, needing no new data — and it is the piece
        that would actually have helped. OCR against the wrong language completes
        successfully and returns confident-looking nonsense, so a user with unusable
        output has no reason to suspect the setting rather than the tool.
      */}
      {languageNames.length > 0 && (
        <p className="text-muted pt-1 text-xs leading-relaxed">
          Recognized as <span className="text-muted">{languageNames}</span>. If
          the text looks wrong, run it again with the language actually printed
          on the page — OCR returns plausible-looking gibberish for the wrong
          language rather than an error.
        </p>
      )}
      {looksLow && (
        <p className="border-warn/40 bg-warn/10 text-warn mt-1 rounded-lg border px-2.5 py-2 text-xs leading-relaxed">
          {/*
            Deliberately a list of causes, not a diagnosis. Nothing here identifies
            script, so "this document appears to be Bengali" would be invention. The
            wrong language is one candidate among several ordinary ones.
          */}
          Recognition confidence was low. That usually means the scan is blurry,
          skewed or low-resolution — or that the page is not in the language you
          selected.
        </p>
      )}
    </div>
  );
}
