"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Download,
  Languages,
  ShieldCheck,
  Sparkles,
  Timer,
} from "lucide-react";
import { workerPipelineStages } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import {
  DEFAULT_TRANSLATE_SOURCE,
  LANGUAGE_NAMES,
  MAX_TRANSLATE_INSTRUCTIONS_CHARS,
  TRANSLATE_LANGUAGES,
  TRANSLATE_SOURCE_AUTO,
  type TranslateLanguage,
  type TranslateSourceLanguage,
} from "@/lib/jobs/translate-pdf";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  AI_DAILY_ALLOWANCE_NOTE,
  aiToolUnavailableDetail,
} from "@/lib/workers/ai-tool-availability";
import {
  canRunTranslate,
  runWorkerTranslate,
  type TranslateWorkerResult,
} from "@/lib/workers/translate-client";
import { downloadBytes } from "@/lib/pdf/browser";
import { extractPdfText, pageTextChunks } from "@/lib/pdf/text";
import { NO_SELECTABLE_TEXT_MESSAGE } from "@/lib/jobs/ai-no-text";
import { planTranslateChunks } from "@/lib/workers/translate/chunking";
import {
  TRANSLATE_MAX_INPUT_CHARS,
  translateTooLongMessage,
} from "@/lib/jobs/translate-limits";
import { TruncationNotice } from "./truncation-notice";
import { DeliveryNotice, deliverySummary } from "./delivery-notice";
import { track } from "@/lib/telemetry/track";
import type { Tool } from "@/lib/tools/types";
import { formatBytes } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
import {
  DownloadCta,
  Dropzone,
  ErrorNote,
  ResultCard,
  WorkerRunButton,
} from "./runner/runner-kit";
import { NotifyMe } from "./notify-me";

type Phase = "loading" | "error" | "ready";

/** The default target language shown in the builder. */
const DEFAULT_TARGET: TranslateLanguage = "en";

function badgeFor(
  phase: Phase,
  status: WorkerStatus | null,
): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading")
    return { tone: "info", label: "Checking…", pulse: true };
  if (phase === "error" || !status)
    return { tone: "muted", label: "Status unknown", pulse: false };
  return canRunTranslate(status)
    ? { tone: "ok", label: "Secure worker", pulse: false }
    : { tone: "muted", label: "Not enabled", pulse: false };
}

export function TranslateWorkerPanel({ tool }: { tool: Tool }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<WorkerStatus | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/worker/status", { headers: { accept: "application/json" } })
      .then((res) =>
        res.ok
          ? (res.json() as Promise<WorkerStatus>)
          : Promise.reject(new Error("unreachable")),
      )
      .then((next) => {
        if (!active) return;
        setStatus(next);
        setPhase("ready");
        track({
          name: "worker_status_checked",
          mode: next.mode,
          enabled: next.enabled,
        });
      })
      .catch(() => {
        if (active) setPhase("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const badge = badgeFor(phase, status);
  const available = phase === "ready" && canRunTranslate(status);
  const unavailableDetail =
    phase === "loading"
      ? "Checking whether a secure worker is available…"
      : phase === "error"
        ? "The worker status endpoint could not be reached right now."
        : aiToolUnavailableDetail(status);

  return (
    <div className="">
      <div className="border-line bg-panel flex flex-col gap-6 rounded-[4px] border p-5 sm:p-7">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="border-accent/40 bg-accent/10 text-accent inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium">
              <Sparkles className="size-3" aria-hidden />
              AI translation
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
            configured AI model to translate only that text into your target
            language, then returns a translation package — Markdown, plain text,
            and a manifest recording the model and scope. It produces translated
            text (not a layout-preserving PDF) and never fabricates a
            translation: with no AI model configured, or a scanned PDF with no
            selectable text, it fails honestly instead of guessing.
          </p>
        </div>

        {available && (
          <p className="text-muted text-xs leading-relaxed">
            {AI_DAILY_ALLOWANCE_NOTE}
          </p>
        )}
        {available ? (
          <TranslateBuilder />
        ) : (
          <div className="border-line bg-wash flex flex-col gap-3 rounded-[4px] border p-4">
            <p className="text-muted text-sm leading-relaxed">
              {unavailableDetail}
            </p>
            <p className="text-muted text-xs leading-relaxed">
              No builder is shown until the worker is ready, so {tool.name}{" "}
              never pretends to produce a translation it cannot actually
              generate.
            </p>
            <NotifyMe toolName={tool.name} toolSlug={tool.slug} />
          </div>
        )}

        <div className="flex flex-col gap-3">
          <h3 className="text-faint font-mono text-xs font-medium tracking-[0.18em] uppercase">
            What happens
          </h3>
          <ol className="flex flex-col gap-1">
            {workerPipelineStages(status?.scan.active ?? false).map(
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
            value="ZIP · translation.md + translation.txt + manifest"
          />
          <SpecRow
            icon={Timer}
            label="Retention"
            value={`Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`}
          />
          <SpecRow
            icon={ShieldCheck}
            label="Limit"
            // The number is PER PASS, not per document: a long document is split
            // at page boundaries and translated a few pages at a time. Saying
            // "characters translated" flat would understate the tool by however
            // many pages it can actually chain through.
            value={`${formatBytes(JOB_LIMITS.maxFileBytes)}/file · ${TRANSLATE_MAX_INPUT_CHARS.toLocaleString("en-US")} characters per pass · longer documents split by page`}
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

function TranslateBuilder() {
  const [file, setFile] = useState<File | null>(null);
  const [targetLanguage, setTargetLanguage] =
    useState<TranslateLanguage>(DEFAULT_TARGET);
  const [sourceLanguage, setSourceLanguage] = useState<TranslateSourceLanguage>(
    DEFAULT_TRANSLATE_SOURCE,
  );
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<TranslateWorkerResult | null>(null);

  const canRun = file != null && !busy;

  const start = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    try {
      setOutcome(null);
      const trimmed = instructions.trim();
      const bytes = new Uint8Array(await file.arrayBuffer());

      // MEASURE HERE, BEFORE ANYTHING IS SPENT.
      //
      // Translate is bounded by how much the model may WRITE, and its output is
      // as long as its input — so a document can be far under the file-size
      // limit and still be impossible. Measured on production: 135,280
      // characters was accepted, uploaded, scanned, extracted, sent to the
      // provider, billed, and refused after 49 seconds.
      //
      // The daily AI allowance is consumed when the job is CREATED
      // (`api/jobs/route.ts`), so the worker's own check — which exists as a
      // backstop — cannot give it back. Extracting the text here costs a local
      // pdfjs parse and gives the user an immediate, specific answer instead of
      // a 49-second wait and one of three daily runs.
      // WHAT IS REFUSED HERE MUST MATCH WHAT THE WORKER REFUSES, or this check
      // becomes a gate in front of a capability nobody can reach. The ceiling
      // bounds ONE provider call, and the worker now splits a long document at
      // page boundaries — so a document is impossible only when NO page fits.
      // The same planner runs on both sides for exactly that reason: two
      // hand-written versions of "does this fit" is how a browser refusal ends
      // up hiding a worker that would have succeeded.
      const extracted = await extractPdfText(bytes);
      // NOTHING TO TRANSLATE IS NOT "TOO LONG". A scan has no text pages, so
      // the "does any page fit?" check below finds none and used to answer
      // "0 characters … split it into smaller files" — the one remedy that
      // cannot help. Say what the worker would say, before anything is sent.
      if (!extracted.hasText) {
        setOutcome({
          ok: false,
          message: NO_SELECTABLE_TEXT_MESSAGE["translate-pdf"],
        });
        return;
      }
      // THE SAME BLOCKS THE WORKER WILL CHUNK, computed once and used for both
      // the refusal below and the page count declared with the job. Counting
      // them twice — here and again at the call site — is how the declaration
      // and the refusal end up describing different documents.
      const textPages = pageTextChunks(extracted.pages);
      const plan = planTranslateChunks(textPages, TRANSLATE_MAX_INPUT_CHARS);
      const noPageStructure = extracted.pages.length === 0;
      const nothingFits = noPageStructure
        ? extracted.characterCount > TRANSLATE_MAX_INPUT_CHARS
        : plan.chunks.length === 0;
      if (nothingFits) {
        setOutcome({
          ok: false,
          message: translateTooLongMessage(
            extracted.characterCount,
            TRANSLATE_MAX_INPUT_CHARS,
          ),
        });
        return;
      }

      const result = await runWorkerTranslate({
        filename: file.name,
        bytes,
        targetLanguage,
        sourceLanguage,
        ...(trimmed ? { instructions: trimmed } : {}),
        // The count this panel already extracted, declared so the job reserves
        // what it will use instead of a whole per-call ceiling. Required by the
        // client's type rather than optional: the route's fallback is correct
        // and silent, so the one caller that can count must not be able to stop
        // quietly.
        declaredCharacters: extracted.characterCount,
        // PAGES WITH TEXT, not `extracted.pageCount`. Blank, whitespace-only
        // and image-only pages are dropped before chunking, so the page count
        // would over-declare a document with any of them — and the bound this
        // feeds is the one that is supposed to be exact.
        declaredTextPages: textPages.length,
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
  }, [file, targetLanguage, sourceLanguage, instructions]);

  return (
    <div className="border-accent/40 bg-accent/10 flex flex-col gap-4 rounded-[4px] border p-4">
      <p className="text-accent flex items-start gap-1.5 text-xs leading-relaxed">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Running this uses a private secure-worker job. The worker translates
        only the PDF&apos;s selectable text with a configured AI model — it does
        not read scanned images (run OCR first) and does not invent content.
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
          onFiles={(files) => setFile(files[0] ?? null)}
          accept="application/pdf,.pdf"
          multiple={false}
          compact
          title="Add your PDF, or"
          hint="PDF with selectable text to translate"
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-muted flex flex-col gap-1 text-xs">
          Translate into
          <select
            value={targetLanguage}
            onChange={(e) =>
              setTargetLanguage(e.target.value as TranslateLanguage)
            }
            className="border-line bg-wash text-fg focus:border-accent/40 rounded-lg border px-3 py-1.5 text-sm outline-none"
          >
            {TRANSLATE_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_NAMES[code]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-muted flex flex-col gap-1 text-xs">
          Source language
          <select
            value={sourceLanguage}
            onChange={(e) =>
              setSourceLanguage(e.target.value as TranslateSourceLanguage)
            }
            className="border-line bg-wash text-fg focus:border-accent/40 rounded-lg border px-3 py-1.5 text-sm outline-none"
          >
            <option value={TRANSLATE_SOURCE_AUTO}>Auto-detect</option>
            {TRANSLATE_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_NAMES[code]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-muted flex flex-col gap-1 text-xs sm:col-span-2">
          Instructions (optional)
          <input
            type="text"
            value={instructions}
            onChange={(e) =>
              setInstructions(
                e.target.value.slice(0, MAX_TRANSLATE_INSTRUCTIONS_CHARS),
              )
            }
            maxLength={MAX_TRANSLATE_INSTRUCTIONS_CHARS}
            placeholder="e.g. keep product names in English, use a formal register"
            className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 rounded-lg border px-3 py-1.5 text-sm outline-none"
          />
        </label>
      </div>

      <WorkerRunButton
        onClick={start}
        busy={busy}
        // `canRun` already folds in `!busy`; both go through one blocked branch.
        disabled={!canRun}
        busyLabel="Translating…"
        icon={Languages}
        tone="violet"
      >
        Translate PDF
      </WorkerRunButton>

      {outcome?.ok === false && <ErrorNote message={outcome.message} />}
      {outcome?.ok === true && (
        <ResultCard
          announce={
            /*
             * THE COMPLETION STATE, not a fixed sentence.
             *
             * "Your AI translation package is ready" is true in the narrow
             * sense that the job finished, and a reader takes the broad one.
             * When pages were withheld, the announcement — which is what a
             * screen reader speaks — has to say so, or the surface asserts
             * something the record contradicts.
             */
            outcome.job?.results?.ai?.delivery
              ? deliverySummary(outcome.job.results.ai.delivery) +
                " The rest is marked in place in the package."
              : "Your AI translation package is ready."
          }
        >
          <TruncationNotice
            job={outcome.job}
            consequence="The rest of the document was not translated — this package covers those pages only."
          />
          <DeliveryNotice job={outcome.job} />
          <p className="text-ok text-sm">
            {outcome.job?.results?.ai?.delivery
              ? "The pages that were translated are in the package — Markdown and plain text, plus a manifest recording the model and honest scope."
              : "Your AI translation package is ready — the translation in Markdown and plain text, plus a manifest recording the model and honest scope."}
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
