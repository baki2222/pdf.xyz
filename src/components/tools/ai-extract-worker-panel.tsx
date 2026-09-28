"use client";

import { useCallback, useId, useState } from "react";
import {
  Download,
  Plus,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Timer,
  Trash2,
} from "lucide-react";
import { workerPipelineStages } from "@/lib/jobs/capabilities";
import {
  AI_INPUT_LIMITS,
  DEFAULT_RETENTION,
  JOB_LIMITS,
} from "@/lib/jobs/types";
import {
  EXTRACTION_FIELD_TYPES,
  MAX_EXTRACTION_FIELDS,
  MAX_EXTRACTION_PROMPT_CHARS,
  MAX_FIELD_NAME_CHARS,
  duplicateFieldMessage,
  duplicateFieldNames,
  type ExtractionField,
  type ExtractionFieldType,
  type ExtractionMode,
} from "@/lib/jobs/ai-extract";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  aiDailyAllowanceNote,
  aiToolUnavailableDetail,
} from "@/lib/workers/ai-tool-availability";
import { countDeclaredCharacters } from "@/lib/workers/ai-declared-characters";
import {
  canRunAiExtract,
  runWorkerAiExtract,
  type AiExtractWorkerResult,
} from "@/lib/workers/ai-extract-client";
import { downloadBytes } from "@/lib/pdf/browser";
import { TruncationNotice } from "./truncation-notice";
import type { Tool } from "@/lib/tools/types";
import { pickRefusal, type PickRefusal } from "@/lib/uploads/pick-check";
import { formatBytes } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
import {
  DownloadCta,
  Dropzone,
  ResultCard,
  WorkerRunButton,
} from "./runner/runner-kit";
import { NotifyMe } from "./notify-me";
import { jobBusyLabel, useWorkerJob, WorkerJobStatus } from "./worker-job";
import { resumeSecurityJob } from "@/lib/workers/pdf-security-client";
import {
  useWorkerStatus,
  WorkerStatusPending,
  type WorkerPhase,
} from "./worker-status";

type Phase = WorkerPhase;

function badgeFor(
  phase: Phase,
  status: WorkerStatus | null,
): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading")
    return { tone: "info", label: "Checking…", pulse: true };
  if (phase === "error" || !status)
    return { tone: "muted", label: "Status unknown", pulse: false };
  return canRunAiExtract(status)
    ? { tone: "ok", label: "Secure worker", pulse: false }
    : { tone: "muted", label: "Not enabled", pulse: false };
}

export function AiExtractWorkerPanel({ tool }: { tool: Tool }) {
  const { phase, status, retry } = useWorkerStatus();

  const badge = badgeFor(phase, status);
  const available = phase === "ready" && canRunAiExtract(status);
  // Read only once the status is known: the loading and error phases
  // render <WorkerStatusPending>, which claims nothing about the tool.
  const unavailableDetail = aiToolUnavailableDetail(status);

  return (
    <div className="">
      <div className="border-line bg-panel flex flex-col gap-6 rounded-[4px] border p-5 sm:p-7">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="border-accent/40 bg-accent/10 text-accent inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium">
              <Sparkles className="size-3" aria-hidden />
              AI extraction
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
            The worker extracts your PDF&apos;s selectable text and asks a
            configured AI model to pull the fields you describe into clean JSON,
            then returns an extraction package — the model&apos;s JSON, a
            readable rendering, and a manifest recording the model and scope.
            With no AI model configured, a scanned PDF with no selectable text,
            or a model reply that isn&apos;t valid JSON, the job fails instead
            of guessing. The model is instructed to use only the document&apos;s
            text, but AI output can still be wrong, so check important values
            against your PDF.
          </p>
        </div>

        {available && (
          <p className="text-muted text-xs leading-relaxed">
            {aiDailyAllowanceNote(tool.slug)}
          </p>
        )}
        {available ? (
          <AiExtractBuilder refuse={(file) => pickRefusal(tool, file)} />
        ) : phase === "ready" ? (
          <div className="border-line bg-wash flex flex-col gap-3 rounded-[4px] border p-4">
            <p className="text-muted text-sm leading-relaxed">
              {unavailableDetail}
            </p>
            <p className="text-muted text-xs leading-relaxed">
              No builder is shown until the worker is ready, so {tool.name}{" "}
              never pretends to produce an extraction it cannot actually
              generate.
            </p>
            <NotifyMe
              toolName={tool.name}
              toolSlug={tool.slug}
              checking={false}
            />
          </div>
        ) : (
          <WorkerStatusPending phase={phase} onRetry={retry} />
        )}

        <div className="flex flex-col gap-3">
          <h3 className="text-faint font-mono text-xs font-medium tracking-[0.18em] uppercase">
            What happens
          </h3>
          <ol className="flex flex-col gap-1">
            {workerPipelineStages(status ? status.scan.active : null, tool).map(
              (stage, index, all) => (
                <li key={stage.id} className="flex items-start gap-3">
                  <div className="flex flex-col items-center self-stretch">
                    <span className="border-line bg-wash text-muted grid size-8 shrink-0 place-items-center rounded-full border">
                      <Sparkles className="size-4" aria-hidden />
                    </span>
                    {index < all.length - 1 && (
                      <span className="bg-wash my-1 w-px flex-1" aria-hidden />
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 pb-3">
                    <span className="text-fg text-sm font-medium">
                      {index + 1}. {stage.title}
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

        <div className="bg-panel border-line divide-y divide-white/5 rounded-[4px] border px-4 py-1">
          <SpecRow
            icon={Download}
            label="Output"
            value="ZIP · extraction.json + model-output.json + extraction.md + manifest"
          />
          <SpecRow
            icon={Timer}
            label="Retention"
            value={`Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`}
          />
          <SpecRow
            icon={ShieldCheck}
            label="Limit"
            value={`${formatBytes(JOB_LIMITS.maxFileBytes)}/file · ${AI_INPUT_LIMITS.maxInputCharacters.toLocaleString("en-US")} characters read`}
          />
        </div>
      </div>
    </div>
  );
}

function SpecRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Download;
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

const EMPTY_FIELD: ExtractionField = { name: "", type: "string" };

function AiExtractBuilder({ refuse }: { refuse: PickRefusal }) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ExtractionMode>("schema");
  const [prompt, setPrompt] = useState("");
  const [fields, setFields] = useState<ExtractionField[]>([{ ...EMPTY_FIELD }]);
  const job = useWorkerJob<AiExtractWorkerResult>({
    tool: "ai-extract",
    resume: (id, controls) =>
      resumeSecurityJob(id, { ...controls, tool: "ai-extract" }),
  });
  const { busy, outcome, setOutcome, run } = job;

  const namedFields = fields.filter((f) => f.name.trim().length > 0);
  // The worker refuses two fields with the same name (case and spacing
  // ignored). Until 2026-09-28 the panel allowed them, so the refusal arrived
  // AFTER the upload and after a third of the day's AI allowance was reserved.
  // The same rule as the parser, from the same module, checked here first.
  const duplicates = duplicateFieldNames(fields.map((f) => f.name));
  const requestReady =
    mode === "prompt"
      ? prompt.trim().length > 0
      : namedFields.length > 0 && duplicates.size === 0;
  const fieldIds = useId();
  const canRun = file != null && !busy && requestReady;

  const start = useCallback(async () => {
    if (!file || !requestReady) return;
    await run(async (controls) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Counted before upload so the run is charged what this document holds,
      // not a third of the day. `null` sends it undeclared at the old price.
      const declaredCharacters = await countDeclaredCharacters(bytes);
      const result = await runWorkerAiExtract(
        mode === "prompt"
          ? {
              filename: file.name,
              bytes,
              mode: "prompt",
              prompt: prompt.trim(),
              declaredCharacters,
            }
          : {
              filename: file.name,
              bytes,
              declaredCharacters,
              mode: "schema",
              schema: namedFields.map((f) => ({
                name: f.name.trim(),
                type: f.type,
                ...(f.description?.trim()
                  ? { description: f.description.trim() }
                  : {}),
              })),
            },
        controls,
      );
      return result;
    });
  }, [file, mode, prompt, namedFields, requestReady, run]);

  return (
    <div className="border-accent/40 bg-accent/10 flex flex-col gap-4 rounded-[4px] border p-4">
      <p className="text-accent flex items-start gap-1.5 text-xs leading-relaxed">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Running this uses a private secure-worker job. The worker sends only the
        PDF&apos;s selectable text to a configured AI model — it does not read
        scanned images (run OCR first) — and the model is told to use only that
        text. AI output can still be wrong.
      </p>

      {file ? (
        <div className="border-line bg-wash text-fg flex flex-wrap items-center justify-between gap-2 rounded-[3px] border px-3 py-2 text-sm">
          <span className="truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => {
              setFile(null);
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
          onFiles={(files) => setFile(files[0] ?? null)}
          accept="application/pdf,.pdf"
          multiple={false}
          compact
          title="Add your PDF, or"
          hint="PDF with selectable text to extract from"
        />
      )}

      <div className="border-line bg-wash inline-flex gap-1 self-start rounded-full border p-1 text-xs">
        <ModeTab
          active={mode === "schema"}
          onClick={() => setMode("schema")}
          label="Field schema"
        />
        <ModeTab
          active={mode === "prompt"}
          onClick={() => setMode("prompt")}
          label="Prompt"
        />
      </div>

      {mode === "prompt" ? (
        <label className="text-muted flex flex-col gap-1 text-xs">
          What to extract
          <textarea
            value={prompt}
            onChange={(e) =>
              setPrompt(e.target.value.slice(0, MAX_EXTRACTION_PROMPT_CHARS))
            }
            maxLength={MAX_EXTRACTION_PROMPT_CHARS}
            rows={3}
            placeholder="e.g. Extract the invoice number, issue date, vendor name, and grand total."
            className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 rounded-lg border px-3 py-2 text-sm outline-none"
          />
        </label>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-muted text-xs">Fields to extract</span>
          {fields.map((field, i) => {
            const earlier = duplicates.get(i);
            const problemId = `${fieldIds}-field-${i}-problem`;
            return (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    aria-label={`Field ${i + 1} name`}
                    aria-invalid={earlier !== undefined || undefined}
                    aria-describedby={
                      earlier !== undefined ? problemId : undefined
                    }
                    value={field.name}
                    onChange={(e) => {
                      const name = e.target.value.slice(
                        0,
                        MAX_FIELD_NAME_CHARS,
                      );
                      setFields((prev) =>
                        prev.map((f, j) => (j === i ? { ...f, name } : f)),
                      );
                    }}
                    placeholder="field name (e.g. total)"
                    className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none"
                  />
                  <select
                    value={field.type}
                    onChange={(e) => {
                      const type = e.target.value as ExtractionFieldType;
                      setFields((prev) =>
                        prev.map((f, j) => (j === i ? { ...f, type } : f)),
                      );
                    }}
                    className="border-line bg-wash text-fg focus:border-accent/40 rounded-lg border px-2 py-1.5 text-sm outline-none"
                  >
                    {EXTRACTION_FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    // aria-disabled, never native: this disables at the LOWER bound,
                    // i.e. right after the user removing fields reaches the last one —
                    // the TileAction shape. The setter already no-ops at the bound.
                    onClick={() =>
                      setFields((prev) =>
                        prev.length > 1 ? prev.filter((_, j) => j !== i) : prev,
                      )
                    }
                    aria-disabled={fields.length <= 1 || undefined}
                    aria-label="Remove field"
                    className="border-line text-muted hover:text-fg grid size-8 shrink-0 place-items-center rounded-lg border transition aria-disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
                {earlier !== undefined && (
                  <p id={problemId} className="text-err text-xs">
                    {duplicateFieldMessage(i, earlier)}
                  </p>
                )}
              </div>
            );
          })}
          <button
            type="button"
            onClick={() =>
              setFields((prev) =>
                prev.length < MAX_EXTRACTION_FIELDS
                  ? [...prev, { ...EMPTY_FIELD }]
                  : prev,
              )
            }
            aria-disabled={fields.length >= MAX_EXTRACTION_FIELDS || undefined}
            className="border-line text-muted hover:text-fg inline-flex items-center gap-1.5 self-start rounded-lg border px-3 py-1.5 text-xs font-medium transition aria-disabled:opacity-40"
          >
            <Plus className="size-3.5" aria-hidden />
            Add field
          </button>
        </div>
      )}

      <WorkerRunButton
        onClick={start}
        busy={busy}
        // `canRun` already folds in `!busy`; both go through one blocked branch.
        disabled={!canRun}
        busyLabel={jobBusyLabel(job.phase, "Extracting…")}
        icon={ScanSearch}
        tone="violet"
      >
        Extract data
      </WorkerRunButton>

      <WorkerJobStatus job={job} />
      {outcome?.ok === true && (
        <ResultCard announce="Your AI extraction package is ready.">
          <TruncationNotice
            job={outcome.job}
            consequence="A field reported as not found was not found in those pages — it may still appear later in the document."
          />
          <p className="text-ok text-sm">
            Your AI extraction package is ready — the extracted data as JSON, a
            readable rendering, plus a manifest recording the model and honest
            scope.
          </p>
          <DownloadCta
            onClick={() =>
              downloadBytes(outcome.output, outcome.artifact.filename)
            }
          >
            Download {outcome.artifact.filename}
          </DownloadCta>
        </ResultCard>
      )}
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 font-medium transition ${
        active ? "bg-accent/10 text-accent" : "text-muted hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
}
