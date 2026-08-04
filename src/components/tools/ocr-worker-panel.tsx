"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { runWorkerOcr, type OcrWorkerResult } from "@/lib/workers/ocr-client";
import { track } from "@/lib/telemetry/track";
import type { Tool } from "@/lib/tools/types";
import { cn, formatBytes } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
import {
  Dropzone,
  ErrorNote,
  ResultCard,
  Spinner,
  WorkerRunButton,
} from "./runner/runner-kit";
import { NotifyMe } from "./notify-me";

type Phase = "loading" | "error" | "ready";

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
      <span className="inline-flex items-center gap-2 text-sm text-slate-400">
        <Icon className="size-4 text-slate-500" aria-hidden />
        {label}
      </span>
      <span className="text-right text-sm font-medium text-slate-200">
        {value}
      </span>
    </div>
  );
}

/** Honest availability badge derived from the live worker status. */
function badgeFor(
  phase: Phase,
  status: WorkerStatus | null,
): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading") return { tone: "info", label: "Checking…", pulse: true };
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
 * It is the honest OCR counterpart to the generic {@link WorkerPreview}: it reads
 * the live, presence-only `/api/worker/status` endpoint, lets the user configure
 * a real OCR request (languages, output, skip-text) that is validated with the
 * shared `parseOcrOptions` contract, and shows exactly what a secure worker would
 * do with the file — encrypted upload → scan → isolated recognition → download →
 * auto-delete. It never fabricates recognized text or a searchable PDF: when OCR
 * is not enabled (every environment this build ships in), it says so plainly and
 * offers no upload. Only when the status endpoint honestly reports OCR available
 * does it mount an uploader and run the real job flow via {@link runWorkerOcr}.
 */
export function OcrWorkerPanel({ tool }: { tool: Tool }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<WorkerStatus | null>(null);

  const [languages, setLanguages] = useState<OcrLanguage[]>([
    DEFAULT_OCR_LANGUAGE,
  ]);
  const [outputMode, setOutputMode] = useState<OcrOutputMode>(
    DEFAULT_OCR_OUTPUT_MODE,
  );
  const [skipTextPages, setSkipTextPages] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/worker/status", { headers: { accept: "application/json" } })
      .then((r) =>
        r.ok ? (r.json() as Promise<WorkerStatus>) : Promise.reject(new Error("unreachable")),
      )
      .then((s) => {
        if (!active) return;
        setStatus(s);
        setPhase("ready");
        // Reuse the Phase 10 privacy-safe event: mode + enabled flag only.
        track({ name: "worker_status_checked", mode: s.mode, enabled: s.enabled });
      })
      .catch(() => {
        if (active) setPhase("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const toggleLanguage = useCallback((code: OcrLanguage) => {
    setLanguages((prev) => {
      if (prev.includes(code)) {
        if (prev.length === 1) return prev; // keep at least one language
        return prev.filter((entry) => entry !== code);
      }
      if (prev.length >= MAX_OCR_LANGUAGES) return prev; // respect the cap
      return [...prev, code];
    });
  }, []);

  // Run the free-form options through the real contract validator, so the "what
  // will happen" summary and any submitted job carry exactly the validated value.
  const parsed = useMemo(
    () => parseOcrOptions({ languages, outputMode, skipTextPages }),
    [languages, outputMode, skipTextPages],
  );
  const request: OcrOptions = parsed.ok
    ? parsed.value
    : { languages, outputMode, skipTextPages };

  const badge = badgeFor(phase, status);
  const available = phase === "ready" && status?.ocr.available === true;
  const outputs = ocrOutputsForMode(outputMode).join(", ");

  return (
    <div className="gradient-border">
      <div className="glass flex flex-col gap-6 rounded-3xl p-5 sm:p-7">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/30 bg-blue-400/10 px-2.5 py-1 text-[11px] font-medium text-blue-200">
              <ScanText className="size-3" aria-hidden />
              Secure-worker OCR
            </span>
            <StatusBadge tone={badge.tone} label={badge.label} pulse={badge.pulse} />
          </div>
          <h2 className="text-lg font-semibold text-white">
            {tool.name} runs on an encrypted secure worker
          </h2>
          <p className="text-sm leading-relaxed text-slate-400">
            Optical character recognition needs a native OCR engine, so it runs on
            an isolated, auto-deleting worker rather than in your browser. Configure
            the recognition below — we&apos;ll show exactly what happens to your
            file, and never fake a result.
          </p>
        </div>

        {/* Recognition settings */}
        <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-surface-2 p-4 sm:p-5">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Recognition settings
          </h3>

          {/* Languages */}
          <div className="flex flex-col gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
              <Languages className="size-3.5" aria-hidden />
              Languages{" "}
              <span className="text-slate-500">
                (up to {MAX_OCR_LANGUAGES})
              </span>
            </span>
            {/*
              The single most useful sentence on this page. OCR against the wrong
              language does not fail — it returns confident-looking nonsense — so a
              user who leaves the default alone gets a successful job and unusable
              output, with nothing anywhere to tell them why.
            */}
            <p className="text-xs leading-relaxed text-slate-500">
              Select every language printed on the page — a page that mixes Bengali with
              English technical terms needs both. The wrong language does not produce an
              error, it produces plausible-looking gibberish.
            </p>
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label="OCR languages"
            >
              {OCR_LANGUAGES.map((language) => {
                const active = languages.includes(language.code);
                const atCap = !active && languages.length >= MAX_OCR_LANGUAGES;
                return (
                  <button
                    key={language.code}
                    type="button"
                    onClick={() => toggleLanguage(language.code)}
                    disabled={atCap}
                    aria-pressed={active}
                    title={
                      atCap
                        ? `Deselect a language first — at most ${MAX_OCR_LANGUAGES} at once.`
                        : undefined
                    }
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
                      active
                        ? "border-violet-400/50 bg-violet-500/15 text-violet-100"
                        : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25 hover:bg-white/[0.06] hover:text-white",
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
            <span className="text-xs font-medium text-slate-400">Output</span>
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
                        ? "border-violet-400/50 bg-violet-500/15 text-violet-100"
                        : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25 hover:bg-white/[0.06] hover:text-white",
                    )}
                  >
                    {mode.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs leading-relaxed text-slate-500">
              {OCR_OUTPUT_MODES.find((mode) => mode.id === outputMode)?.description}
            </p>
          </div>

          {/* Skip-text toggle */}
          <label className="flex items-start gap-2.5 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={skipTextPages}
              onChange={(event) => setSkipTextPages(event.target.checked)}
              className="mt-0.5 size-4 rounded border-white/20 bg-white/5 accent-violet-500"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium text-slate-200">
                Skip pages that already have text
              </span>
              <span className="text-xs leading-relaxed text-slate-500">
                Leave pages with an existing text layer untouched instead of
                re-recognizing them.
              </span>
            </span>
          </label>

          <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-400">
            <span className="font-medium text-slate-300">This request:</span>{" "}
            {describeOcrRequest(request)}
            {skipTextPages ? " · skip text pages" : ""}
          </p>
        </div>

        {/* Status-dependent action area */}
        {available && status ? (
          <OcrRunArea request={request} localDevOnly={status.localDevOnly} />
        ) : (
          <OcrUnavailable phase={phase} status={status} toolName={tool.name} toolSlug={tool.slug} />
        )}

        {/* Pipeline: honest "here's what will happen" */}
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            What happens to your file
          </h3>
          <ol className="flex flex-col gap-1">
            {workerPipelineStages(status?.scan.active ?? false).map((stage, i, all) => (
              <li key={stage.id} className="flex items-start gap-3">
                <div className="flex flex-col items-center self-stretch">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-300">
                    <StageIcon id={stage.id} className="size-4" />
                  </span>
                  {i < all.length - 1 && (
                    <span className="my-1 w-px flex-1 bg-white/10" aria-hidden />
                  )}
                </div>
                <div className="flex flex-col gap-0.5 pb-3">
                  <span className="text-sm font-medium text-slate-200">
                    {i + 1}. {stage.title}
                  </span>
                  <span className="text-xs leading-relaxed text-slate-500">
                    {stage.description}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Spec rows */}
        <div className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-surface-2 px-4 py-1">
          <SpecRow icon={FileUp} label="Inputs" value={tool.accept.join(", ")} />
          <SpecRow icon={FileDown} label="Outputs" value={outputs} />
          <SpecRow
            icon={Timer}
            label="Retention"
            value={`Inputs wiped after processing · outputs ${DEFAULT_RETENTION.outputTtlMinutes} min`}
          />
          <SpecRow
            icon={ShieldCheck}
            label="Limits"
            value={`${formatBytes(JOB_LIMITS.maxFileBytes)}/file · up to ${JOB_LIMITS.maxInputFiles} files`}
          />
        </div>

        <p className="text-xs leading-relaxed text-slate-500">
          No account required. OCR runs on an isolated secure worker: files are
          encrypted in transit and at rest, recognized in a sandbox with no network
          egress, and deleted automatically. It&apos;s enabled per deployment — see
          our worker architecture and security docs.
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
  status,
  toolName,
  toolSlug,
}: {
  phase: Phase;
  status: WorkerStatus | null;
  toolName: string;
  toolSlug: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-4">
      {phase === "loading" ? (
        <p
          className="inline-flex items-center gap-2 text-sm text-slate-400"
          role="status"
        >
          <Spinner className="size-4" />
          Checking whether a secure worker is available…
        </p>
      ) : (
        <p className="text-sm leading-relaxed text-amber-100/90">
          {phase === "error"
            ? "We couldn't confirm secure-worker availability just now, so OCR isn't offered here. No file is ever uploaded until OCR is confirmed available."
            : (status?.ocr.detail ??
              "OCR isn't enabled in this environment. No file is uploaded.")}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <NotifyMe toolName={toolName} toolSlug={toolSlug} />
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
}: {
  request: OcrOptions;
  localDevOnly: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<OcrWorkerResult | null>(null);

  const start = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    try {
      setOutcome(null);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await runWorkerOcr({
        filename: file.name,
        bytes,
        contentType: contentTypeFor(file),
        options: request,
      });
      setOutcome(result);
    } catch {
      // A rejected fetch — offline, DNS failure, a reset connection, CORS — or a
      // file that could not be read. None of these produce a response to inspect,
      // so there is nothing honest to say beyond what happened.
      setOutcome({
        ok: false,
        message:
          "Lost the connection before the job finished. Check your network and try again.",
      });
    } finally {
      setBusy(false);
    }
  }, [file, request]);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-blue-400/25 bg-blue-500/[0.06] p-4">
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-blue-100/90">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {localDevOnly
          ? "This runs on your local-dev worker — the file is processed in-process on this machine, not sent to any third party."
          : "Running this uploads your file to the encrypted secure worker, which recognizes text and then deletes the input."}
      </p>

      {file ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200">
          <span className="truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => {
              setFile(null);
              setOutcome(null);
            }}
            className="shrink-0 text-xs font-medium text-slate-400 transition hover:text-white"
          >
            Remove
          </button>
        </div>
      ) : (
        <Dropzone
          onFiles={(files) => setFile(files[0] ?? null)}
          accept="application/pdf,image/jpeg,image/png"
          multiple={false}
          compact
          title="Add a scan to OCR, or"
          hint="PDF, JPG, or PNG"
        />
      )}

      <WorkerRunButton
        onClick={start}
        busy={busy}
        disabled={!file}
        busyLabel="Recognizing on the worker…"
        icon={ScanText}
      >
        Run OCR on the worker
      </WorkerRunButton>

      {outcome?.ok === false && <ErrorNote message={outcome.message} />}

      {outcome?.ok === true && (
        <ResultCard announce={`OCR complete — ${outcome.artifacts.length} file${outcome.artifacts.length === 1 ? "" : "s"} ready.`}>
          <p className="text-sm text-emerald-200">
            OCR complete — {outcome.artifacts.length} file
            {outcome.artifacts.length === 1 ? "" : "s"} ready.
          </p>
          <div className="flex flex-wrap gap-2">
            {outcome.artifacts.map((entry) => (
              <a
                key={entry.artifact.artifactId}
                href={entry.artifact.url}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:brightness-110"
                download={entry.artifact.filename}
              >
                <Download className="size-4" aria-hidden />
                {entry.artifact.filename}
              </a>
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
    <div className="mt-1 flex flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
        Recognition summary
      </h4>
      <dl className="divide-y divide-white/5">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-3 py-1.5"
          >
            <dt className="inline-flex items-center gap-2 text-xs text-slate-400">
              <row.icon className="size-3.5 text-slate-500" aria-hidden />
              {row.label}
            </dt>
            <dd className="text-right text-xs font-medium text-slate-200">
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
        <p className="pt-1 text-xs leading-relaxed text-slate-500">
          Recognized as <span className="text-slate-300">{languageNames}</span>. If the
          text looks wrong, run it again with the language actually printed on the page —
          OCR returns plausible-looking gibberish for the wrong language rather than an
          error.
        </p>
      )}
      {looksLow && (
        <p className="mt-1 rounded-lg border border-amber-400/25 bg-amber-500/10 px-2.5 py-2 text-xs leading-relaxed text-amber-100/90">
          {/*
            Deliberately a list of causes, not a diagnosis. Nothing here identifies
            script, so "this document appears to be Bengali" would be invention. The
            wrong language is one candidate among several ordinary ones.
          */}
          Recognition confidence was low. That usually means the scan is blurry, skewed
          or low-resolution — or that the page is not in the language you selected.
        </p>
      )}
    </div>
  );
}
