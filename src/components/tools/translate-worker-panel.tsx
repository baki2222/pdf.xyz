"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  Download,
  Languages,
  ShieldCheck,
  Sparkles,
  Timer,
} from "lucide-react";
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
import {
  aiDailyAllowanceNote,
  aiToolUnavailableDetail,
} from "@/lib/workers/ai-tool-availability";
import {
  canRunTranslate,
  runWorkerTranslate,
  translateTextDeps,
  type TranslateWorkerResult,
} from "@/lib/workers/translate-client";
import { downloadBytes } from "@/lib/pdf/browser";
import { PdfEngineError } from "@/lib/pdf/engine";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { translatePreflight } from "@/lib/workers/translate/preflight";
import {
  TRANSLATE_MAX_INPUT_CHARS,
  TRANSLATE_NO_TEXT_MESSAGE,
} from "@/lib/jobs/translate-limits";
import { TruncationNotice } from "./truncation-notice";
import { DeliveryNotice, deliverySummary } from "./delivery-notice";
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
import { translateJobPoll, type JobPollBudget } from "@/lib/jobs/client-wait";
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
 * and what the check said, the drop zone having moved out of it: tallest
 * on Windows 641.3px at 360, 452.8px at 640, 495px at 1024; x1.06 —
 * Linux Chromium's ~2.2% taller text and the 3.5% headroom rule — to the
 * half rem, then up to a value another panel's slot already uses, so the
 * thirteen share a handful of classes (the stylesheet has no room for 39).
 * Linux's own SLOT_NATURAL lines (CI) are the check:
 * `e2e/tool-layout.mobile.spec.ts`.
 */
const STATUS_SLOT = "min-h-[42.5rem] sm:min-h-[32rem] lg:min-h-[33rem]";

/** The default target language shown in the builder. */
const DEFAULT_TARGET: TranslateLanguage = "en";

/**
 * What the user reads when the run throws. The local text parse runs in the
 * same `try` as the network job, and the catch used to call EVERY throw a lost
 * connection — so a password-protected or damaged PDF, which never touches
 * the network, told the user to check their network. The parse now throws a
 * typed `PdfEngineError` with the same copy the other PDF tools use;
 * `runWorkerTranslate` reports its own failures as a returned result, so what
 * is left is genuinely a transport failure.
 */
export function translateFailureMessage(err: unknown): string {
  if (err instanceof PdfEngineError) return err.message;
  return "Lost the connection before the job finished. Check your network and try again.";
}

/** The local text parse the builder runs before anything is uploaded. */
type ExtractText = (bytes: Uint8Array) => Promise<ExtractedPdfText>;

export function TranslateWorkerPanel({
  tool,
  // Injectable for one reason: the modern pdf.js build needs `DOMMatrix`, which
  // jsdom lacks, so the panel test passes the REAL `extractPdfText` bound to the
  // legacy build. The page never passes it.
  // The default reads `translateTextDeps`, the client module's own swappable
  // seam, so a test may swap either.
  extractText = (bytes) => translateTextDeps.extract(bytes),
}: {
  tool: Tool;
  extractText?: ExtractText;
}) {
  return (
    <WorkerPanelShell
      tool={tool}
      tone="accent"
      engine={{ label: "AI translation", icon: Sparkles }}
      description={
        <>
          The worker extracts your PDF&apos;s selectable text and asks a
          configured AI model to translate only that text into your target
          language, then returns a translation package — Markdown, plain text,
          and a manifest recording the model and scope. It produces translated
          text (not a layout-preserving PDF). With no AI model configured, or a
          scanned PDF with no selectable text, the job fails instead of
          guessing. The model is instructed to translate only the
          document&apos;s text, but AI output can still be wrong, so check
          important passages against your PDF.
        </>
      }
      canRun={canRunTranslate}
      specRows={[
        {
          icon: Download,
          label: "Output",
          value: "ZIP · translation.md + translation.txt + manifest",
        },
        {
          icon: Timer,
          label: "Retention",
          value: `Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`,
        },
        {
          icon: ShieldCheck,
          label: "Limit",
          // The number is PER PASS, not per document: a long document is split
          // at page boundaries and translated a few pages at a time. Saying
          // "characters translated" flat would understate the tool by however
          // many pages it can actually chain through.
          value: `${formatBytes(JOB_LIMITS.maxFileBytes)}/file · ${TRANSLATE_MAX_INPUT_CHARS.toLocaleString("en-US")} characters per pass · longer documents split by page`,
        },
      ]}
    >
      <TranslateBuilder
        tool={tool}
        extractText={extractText}
        refuse={(file) => pickRefusal(tool, file)}
      />
    </WorkerPanelShell>
  );
}

/** A poll budget in the shape the job client's options take. */
function waitOptions(budget: JobPollBudget) {
  return {
    pollIntervalMs: budget.intervalMs,
    maxPollAttempts: budget.maxAttempts,
  };
}

const RUN_LABEL = "Translate PDF";

function TranslateBuilder({
  tool,
  extractText,
  refuse,
}: {
  tool: Tool;
  extractText: ExtractText;
  refuse: PickRefusal;
}) {
  const { available, status } = useWorkerPanel();
  const [file, setFile] = useState<File | null>(null);
  const [targetLanguage, setTargetLanguage] =
    useState<TranslateLanguage>(DEFAULT_TARGET);
  const [sourceLanguage, setSourceLanguage] = useState<TranslateSourceLanguage>(
    DEFAULT_TRANSLATE_SOURCE,
  );
  const [instructions, setInstructions] = useState("");
  const job = useWorkerJob<TranslateWorkerResult>({
    tool: "translate-pdf",
    resume: (id, controls) =>
      resumeSecurityJob(id, { ...controls, tool: "translate-pdf" }),
  });
  const { busy, outcome, setOutcome, run } = job;
  const staged = useStagedHandoff(tool.slug, RUN_LABEL, (files) => {
    setOutcome(null);
    setFile(files[0] ?? null);
  });

  const canRun = file != null && !busy;

  const start = useCallback(async () => {
    if (!file || !available) return;
    await run(async (controls) => {
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
      // A local parse that throws never touched the network: a locked or
      // damaged PDF is reported as what it is (`translateFailureMessage`),
      // not as the lost connection the shared job hook calls a throw.
      let extracted: ExtractedPdfText;
      try {
        extracted = await extractText(bytes);
      } catch (err) {
        return { ok: false, message: translateFailureMessage(err) };
      }
      // THE SAME BLOCKS THE WORKER WILL CHUNK, computed once and used for both
      // the refusal below and the page count declared with the job. Counting
      // them twice — here and again at the call site — is how the declaration
      // and the refusal end up describing different documents.
      //
      // AND THE REFUSAL SAYS WHY. "No chunks" used to be read as "too long",
      // so a scanned PDF — no text pages, therefore no chunks — was told it had
      // "0 characters of text" and should be split into smaller files. The
      // preflight tells no-text, every-page-oversize and too-long apart, in
      // the worker's order and with the worker's sentences.
      const { textPages, plan, refusal } = translatePreflight(
        extracted,
        TRANSLATE_MAX_INPUT_CHARS,
      );
      if (refusal !== null) return { ok: false, message: refusal };

      const result = await runWorkerTranslate(
        {
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
        },
        {
          ...controls,
          // One provider call per chunk, one after another: the wait scales
          // with the plan computed above, not a flat two minutes.
          ...waitOptions(translateJobPoll(plan.chunks.length)),
        },
      );
      return result;
    });
  }, [
    file,
    targetLanguage,
    sourceLanguage,
    instructions,
    extractText,
    run,
    available,
  ]);

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
        </ChosenFileTarget>
      ) : (
        <Dropzone
          pageTarget
          refuse={refuse}
          onFiles={(files) => {
            // `refuse` has already turned away a non-PDF (a drop is not
            // filtered by `accept`), so it never reaches the local parse.
            setOutcome(null);
            setFile(files[0] ?? null);
          }}
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
            busyLabel={jobBusyLabel(job.phase, "Translating…")}
            icon={Languages}
          >
            {RUN_LABEL}
          </WorkerRunButton>
        )}
        jobStatus={
          <WorkerJobStatus
            job={job}
            action={(failure) =>
              // Keyed on the SHARED sentence, so the next step appears whether
              // the browser refused the scan or the worker did (its extractor
              // can disagree with the browser's). Equality, not a pattern: the
              // two sides import one constant.
              failure.message === TRANSLATE_NO_TEXT_MESSAGE ? (
                <Link
                  href="/tools/ocr-pdf"
                  className="text-fg font-medium underline underline-offset-2"
                >
                  Open OCR PDF
                </Link>
              ) : undefined
            }
          />
        }
        note={
          <div className="flex flex-col gap-2">
            <p className="text-accent flex items-start gap-1.5 text-xs leading-relaxed">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Your PDF uploads to a private secure-worker job only when you
              press {RUN_LABEL}. The worker sends only the PDF&apos;s selectable
              text to a configured AI model — it does not read scanned images
              (run OCR first) — and the model is told to translate only that
              text. AI output can still be wrong.
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
              never pretends to produce a translation it cannot actually
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
          output={workerOutput(outcome.output, outcome.artifact)}
          inputBytes={file?.size}
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
