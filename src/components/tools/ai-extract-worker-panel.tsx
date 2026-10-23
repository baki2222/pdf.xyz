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
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import { aiReadLimitFor } from "@/lib/jobs/ai-read-limit";
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
import {
  AI_EXTRACT_NOT_NULL_WARNING,
  AI_EXTRACT_NULL_INSTRUCTION,
  AI_EXTRACT_NULL_MEANING,
  AI_EXTRACT_NULL_PAST_CUT,
} from "@/lib/jobs/ai-extract-null-meaning";
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
import {
  DownloadCta,
  Dropzone,
  ResultCard,
  WorkerRunButton,
} from "./runner/runner-kit";
import { ChosenFileTarget } from "./chosen-file-target";
import { NotifyMe } from "./notify-me";
import { jobBusyLabel, useWorkerJob, WorkerJobStatus } from "./worker-job";
import { resumeSecurityJob } from "@/lib/workers/pdf-security-client";
import { useStagedHandoff } from "./use-staged-handoff";
import {
  useWorkerPanel,
  WorkerGate,
  WorkerPanelShell,
  workerOutput,
} from "./worker-panel-shell";

/**
 * The status slot's reserved height (see `WorkerStatusSlot` and
 * `WorkerGate`): the tallest state it shows — checking, a failed check,
 * not enabled, ready — at the narrowest width of each breakpoint.
 *
 * Refitted 2026-10-21 (WP-10), when the slot came to hold Run, the docket
 * and what the check said, the drop zone having moved out of it: the
 * tallest state, the larger of Windows and Linux (CI's SLOT_NATURAL lines
 * on 507b6383), is 660.8px at 360, 478px at 640, 535px at 1024;
 * x1.035, to the half rem, then up to a value another panel's slot already
 * uses, so the thirteen share a handful of classes. A first fit from
 * Windows alone (x1.06) left PowerPoint to PDF and PDF to PowerPoint
 * short on Linux at 360. The check: `e2e/tool-layout.mobile.spec.ts`.
 *
 * Refitted 2026-10-23, when the stage list stopped being drawn before a
 * job (one "What happens to your file" press stands in for it): the
 * tallest state is now not-enabled, off 641.3/660.8px at 360 (Windows/Linux;
 * Linux from CI's SLOT_NATURAL lines on 0504da27, a state this change
 * did not touch), x1.035 to the half rem, then up to a value another
 * panel already uses.
 */
const STATUS_SLOT = "min-h-[43rem] sm:min-h-[29.5rem] lg:min-h-[33.5rem]";

export function AiExtractWorkerPanel({ tool }: { tool: Tool }) {
  return (
    <WorkerPanelShell
      tool={tool}
      tone="accent"
      engine={{ label: "AI extraction", icon: Sparkles }}
      description={
        <>
          The worker extracts your PDF&apos;s selectable text and asks a
          configured AI model to pull the fields you describe into clean JSON,
          then returns an extraction package — the model&apos;s JSON, a readable
          rendering, and a manifest recording the model and scope. With no AI
          model configured, a scanned PDF with no selectable text, or a model
          reply that isn&apos;t valid JSON, the job fails instead of guessing.
          The model is instructed to use only the document&apos;s text, but AI
          output can still be wrong, so check important values against your PDF.
        </>
      }
      canRun={canRunAiExtract}
      specRows={[
        {
          icon: Download,
          label: "You get",
          value:
            "ZIP · extraction.json + model-output.json + extraction.md + manifest",
        },
        {
          icon: Timer,
          label: "Your files",
          value: `Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`,
        },
        {
          icon: ShieldCheck,
          label: "Largest file",
          value: `${formatBytes(JOB_LIMITS.maxFileBytes)}/file · ${aiReadLimitFor(tool.slug).toLocaleString("en-US")} characters read`,
        },
      ]}
    >
      <AiExtractBuilder
        tool={tool}
        refuse={(file) => pickRefusal(tool, file)}
      />
    </WorkerPanelShell>
  );
}

const RUN_LABEL = "Extract data";

const EMPTY_FIELD: ExtractionField = { name: "", type: "string" };

function AiExtractBuilder({
  tool,
  refuse,
}: {
  tool: Tool;
  refuse: PickRefusal;
}) {
  const { available, status } = useWorkerPanel();
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
  const staged = useStagedHandoff(tool.slug, RUN_LABEL, (files) => {
    setOutcome(null);
    setFile(files[0] ?? null);
  });

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
    if (!file || !requestReady || !available) return;
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
  }, [file, mode, prompt, namedFields, requestReady, run, available]);

  return (
    <div className="flex flex-col gap-4">
      {staged}
      {file ? (
        <ChosenFileTarget
          file={file}
          accept="application/pdf,.pdf"
          busy={busy}
          refuse={refuse}
          onReplace={(files) => {
            setOutcome(null);
            setFile(files[0] ?? null);
          }}
        >
          <div className="border-line bg-wash text-fg rounded-ctl flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-sm">
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
        </ChosenFileTarget>
      ) : (
        <Dropzone
          pageTarget
          refuse={refuse}
          onFiles={(files) => setFile(files[0] ?? null)}
          accept="application/pdf,.pdf"
          multiple={false}
          compact
          title="Add your PDF, or"
          hint="PDF with selectable text to extract from"
        />
      )}

      <div className="border-line bg-wash rounded-ctl inline-flex gap-1 self-start border p-1 text-xs">
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
            className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 rounded-ctl border px-3 py-2 text-sm outline-none"
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
                    // `w-0` with `flex-1`: an input's automatic minimum is its
                    // default width (~20 characters), so this row — name,
                    // type, delete — was 32px wider than a phone's panel and
                    // the page scrolled sideways (473px at 390, measured on
                    // the WP-06 review build with a ready worker). A zero
                    // width zeroes that minimum and flex-1 grows it back.
                    className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 rounded-ctl w-0 flex-1 border px-3 py-1.5 text-sm outline-none"
                  />
                  <select
                    value={field.type}
                    onChange={(e) => {
                      const type = e.target.value as ExtractionFieldType;
                      setFields((prev) =>
                        prev.map((f, j) => (j === i ? { ...f, type } : f)),
                      );
                    }}
                    className="border-line bg-wash text-fg focus:border-accent/40 rounded-ctl border px-2 py-1.5 text-sm outline-none"
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
                    className="border-line text-muted hover:text-fg rounded-ctl grid size-8 shrink-0 place-items-center border transition aria-disabled:opacity-40"
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
            className="border-line text-muted hover:text-fg rounded-ctl inline-flex items-center gap-1.5 self-start border px-3 py-1.5 text-xs font-medium transition aria-disabled:opacity-40"
          >
            <Plus className="size-3.5" aria-hidden />
            Add field
          </button>
        </div>
      )}

      {/* In both modes: a prompt-mode reply has nulls too. The words are the
          module's, which every surface renders (null-meaning.test.ts). */}
      <p className="text-muted text-xs leading-relaxed">
        {AI_EXTRACT_NULL_INSTRUCTION} {AI_EXTRACT_NULL_MEANING}{" "}
        {AI_EXTRACT_NOT_NULL_WARNING}
      </p>

      <WorkerGate
        reserve={STATUS_SLOT}
        job={job}
        bytes={file?.size}
        run={(ready) => (
          <WorkerRunButton
            onClick={start}
            busy={busy}
            // `canRun` already folds in `!busy`; both go through one blocked branch.
            disabled={!ready || !canRun}
            busyLabel={jobBusyLabel(job.phase, "Extracting…")}
            icon={ScanSearch}
          >
            {RUN_LABEL}
          </WorkerRunButton>
        )}
        jobStatus={<WorkerJobStatus job={job} />}
        note={
          <div className="flex flex-col gap-2">
            <p className="text-accent flex items-start gap-1.5 text-xs leading-relaxed">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Your PDF uploads to a private secure-worker job only when you
              press {RUN_LABEL}. The worker sends only the PDF&apos;s selectable
              text to a configured AI model — it does not read scanned images
              (run OCR first) — and the model is told to use only that text. AI
              output can still be wrong.
            </p>
            {/* Said only when the panel can run, inside the reserved slot:
                above it, it pushed the whole slot down as the status
                answered (Chat with PDF read CLS 0.0241 at 390, 2026-10-10). */}
            <p className="text-muted text-xs leading-relaxed">
              {aiDailyAllowanceNote(tool.slug)}
            </p>
          </div>
        }
        off={
          <>
            <p className="text-muted text-sm leading-relaxed">
              {aiToolUnavailableDetail(status)}
            </p>
            <p className="text-muted text-xs leading-relaxed">
              {RUN_LABEL} stays off until the worker is ready, so {tool.name}{" "}
              never pretends to produce an extraction it cannot actually
              generate.
            </p>
            <NotifyMe
              toolName={tool.name}
              toolSlug={tool.slug}
              checking={false}
            />
          </>
        }
      />
      {outcome?.ok === true && (
        <ResultCard
          announce="Your AI extraction package is ready."
          output={workerOutput(outcome.output, outcome.artifact)}
          inputBytes={file?.size}
        >
          <TruncationNotice
            job={outcome.job}
            consequence={AI_EXTRACT_NULL_PAST_CUT}
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
      className={`rounded-tag px-3 py-1 font-medium transition ${
        active ? "bg-accent/10 text-accent" : "text-muted hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
}
