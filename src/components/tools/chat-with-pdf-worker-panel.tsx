"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Download,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Timer,
} from "lucide-react";
import { workerPipelineStages } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import { MAX_QUESTION_CHARS } from "@/lib/jobs/chat-with-pdf";
import { aiReadLimitFor } from "@/lib/jobs/ai-read-limit";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  aiDailyAllowanceNote,
  aiToolUnavailableDetail,
} from "@/lib/workers/ai-tool-availability";
import {
  canRunChatWithPdf,
  measureChatDocument,
  runWorkerChatWithPdf,
  type ChatDocumentMeasurement,
  chatWithPdfDeps,
  type ChatWithPdfWorkerResult,
} from "@/lib/workers/chat-with-pdf-client";
import { extractPdfText } from "@/lib/pdf/text";
import {
  buildChatContext,
  readAnswerFromPackage,
  type ChatExchange,
} from "@/lib/workers/chat-with-pdf-conversation";
import { downloadBytes } from "@/lib/pdf/browser";
import type { Tool } from "@/lib/tools/types";
import { pickRefusal, type PickRefusal } from "@/lib/uploads/pick-check";
import { formatBytes } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
import { Dropzone, WorkerRunButton } from "./runner/runner-kit";
import { ChosenFileTarget } from "./chosen-file-target";
import { jobBusyLabel, useWorkerJob, WorkerJobStatus } from "./worker-job";
import { resumeSecurityJob } from "@/lib/workers/pdf-security-client";
import { TruncationNotice } from "./truncation-notice";
import type { Job } from "@/lib/jobs/types";
import { NotifyMe } from "./notify-me";
import {
  useWorkerStatus,
  WorkerStatusPending,
  type WorkerPhase,
  WorkerStatusSlot,
  workerSlotState,
} from "./worker-status";

/**
 * The status slot's reserved height (see `WorkerStatusSlot`): the tallest
 * state it shows at the narrowest width of each breakpoint, measured
 * 2026-10-10 — phone at 360px 715.5px, `sm` at 640px 579px, `lg` at 1024px
 * 598.5px — plus 4px, to the half rem. The run state includes the daily
 * allowance note, which only a panel that can run says.
 */
const STATUS_SLOT = "min-h-[49rem] sm:min-h-[36.5rem] lg:min-h-[38rem]";

type Phase = WorkerPhase;

/**
 * Shown under every answer. The only safeguard against a wrong answer is an
 * instruction in the prompt; nothing checks the answer against the text, so
 * the chat bubble — the one surface everyone reads — must not read as a
 * guarantee. Exported for its test.
 */
export const AI_ANSWER_CAVEAT =
  "AI-generated. Check it against your PDF before relying on it.";

function badgeFor(
  phase: Phase,
  status: WorkerStatus | null,
): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading")
    return { tone: "info", label: "Checking…", pulse: true };
  if (phase === "error" || !status)
    return { tone: "muted", label: "Status unknown", pulse: false };
  return canRunChatWithPdf(status)
    ? { tone: "ok", label: "Secure worker", pulse: false }
    : { tone: "muted", label: "Not enabled", pulse: false };
}

/** The job driver. A prop, not a module mock, so a test can stub it without
 * leaving this panel cached against a stub for the next test file (see
 * src/tests/mock-isolation.test.ts). The page never passes it; the default
 * calls through `chatWithPdfDeps`, the client module's own swappable seam. */
type RunChat = typeof runWorkerChatWithPdf;
const runThroughDeps: RunChat = (input, options) =>
  chatWithPdfDeps.run(input, options);

/** How the panel counts a document before a question is sent; a prop for the
 * same reason as `runChat`. The page never passes it. */
type MeasureChat = (bytes: Uint8Array) => Promise<ChatDocumentMeasurement>;
const measureWithPdfText: MeasureChat = (bytes) =>
  measureChatDocument(bytes, extractPdfText);

export function ChatWithPdfWorkerPanel({
  tool,
  runChat = runThroughDeps,
  measureChat = measureWithPdfText,
}: {
  tool: Tool;
  runChat?: RunChat;
  measureChat?: MeasureChat;
}) {
  const { phase, status, retry } = useWorkerStatus();

  const badge = badgeFor(phase, status);
  const available = phase === "ready" && canRunChatWithPdf(status);
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
              AI chat
            </span>
            <StatusBadge
              tone={badge.tone}
              label={badge.label}
              pulse={badge.pulse}
            />
          </div>
          <h2 className="text-fg text-lg font-semibold">
            {tool.name} runs on a secure worker
          </h2>
          <p className="text-muted text-sm leading-relaxed">
            The worker extracts your PDF&apos;s selectable text and asks a
            configured AI model to answer your question using only that text —
            with inline page citations when the document has page-level text —
            then returns an answer package (the model&apos;s answer, a
            plain-text copy, and a manifest recording the model and scope). With
            no AI model configured, a scanned PDF with no selectable text, or an
            empty model reply, the job fails instead of guessing. The model is
            instructed to use only the document&apos;s text, but AI answers can
            still be wrong, so check important answers against your PDF.
          </p>
        </div>

        <WorkerStatusSlot
          state={workerSlotState(phase, available)}
          reserve={STATUS_SLOT}
        >
          {available ? (
            <div className="flex flex-col gap-6">
              {/* Said only when the panel can run, so it is part of the
                  run area. Above the slot it pushed the whole slot down
                  as the status answered: Chat with PDF read CLS 0.0241 at
                  390 with the slot reserved (measured 2026-10-10). */}
              <p className="text-muted text-xs leading-relaxed">
                {aiDailyAllowanceNote(tool.slug)}
              </p>
              <ChatBuilder
                refuse={(file) => pickRefusal(tool, file)}
                runChat={runChat}
                measureChat={measureChat}
              />
            </div>
          ) : phase === "ready" ? (
            <div className="border-line bg-wash flex flex-col gap-3 rounded-[4px] border p-4">
              <p className="text-muted text-sm leading-relaxed">
                {unavailableDetail}
              </p>
              <p className="text-muted text-xs leading-relaxed">
                No question box is shown until the worker is ready, so{" "}
                {tool.name} never pretends to answer from a document it cannot
                actually read.
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
        </WorkerStatusSlot>

        <div className="flex flex-col gap-3">
          <h3 className="text-faint kicker">What happens</h3>
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

        <div className="bg-panel border-line divide-line divide-y rounded-[4px] border px-4 py-1">
          <SpecRow
            icon={Download}
            label="Output"
            value="ZIP · answer.md + answer.txt + manifest"
          />
          <SpecRow
            icon={Timer}
            label="Retention"
            value={`Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`}
          />
          <SpecRow
            icon={ShieldCheck}
            label="Limit"
            value={`${formatBytes(JOB_LIMITS.maxFileBytes)}/file · up to ${aiReadLimitFor(tool.slug).toLocaleString("en-US")} characters per question, conversation included`}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The outcome of a run that ended before anything was sent because the file
 * was swapped. Never shown: the caller clears any outcome for a file that is
 * no longer on screen.
 */
const NOT_SENT = {
  ok: false as const,
  message: "The document changed before the question was sent.",
};

/** Shown instead of uploading a PDF the browser found no text in. */
const NO_TEXT_MESSAGE =
  "This PDF has no selectable text to ask about. It may be a scan or an image-only PDF — run OCR PDF first, then chat with the result. Nothing was uploaded, and nothing was charged to the daily AI allowance.";

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

/** One answered question, kept so the conversation can be shown and carried forward. */
interface TranscriptEntry {
  id: number;
  question: string;
  /**
   * The model's answer, read back out of the returned package. `null` when it could not
   * be recovered — the package still downloads, but that turn is NOT carried into the
   * next question rather than sending a guess at what the model said.
   */
  answer: string | null;
  filename: string;
  output: Uint8Array;
  /**
   * The completed job for THIS question. Kept per entry, not per panel: each
   * question is its own job, and the window a given answer was produced from is
   * a fact about that answer.
   */
  job: Job;
}

function ChatBuilder({
  refuse,
  runChat,
  measureChat,
}: {
  refuse: PickRefusal;
  runChat: RunChat;
  measureChat: MeasureChat;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  /** The question the job in flight (or left running) is answering. */
  const asking = useRef<string | null>(null);

  /** Add an answered job to the transcript. */
  const record = useCallback(
    async (result: ChatWithPdfWorkerResult, asked: string) => {
      if (!result.ok) return;
      const answer = await readAnswerFromPackage(result.output, asked);
      setTranscript((prev) => [
        ...prev,
        {
          id: prev.length,
          question: asked,
          answer,
          filename: result.artifact.filename,
          output: result.output,
          job: result.job,
        },
      ]);
    },
    [],
  );

  const job = useWorkerJob<ChatWithPdfWorkerResult>({
    tool: "chat-with-pdf",
    // Picking up an answer the browser stopped waiting for. After a reload
    // the question is no longer on screen, and the transcript says so rather
    // than inventing it.
    resume: async (id, controls) => {
      const result = await resumeSecurityJob(id, {
        ...controls,
        tool: "chat-with-pdf",
      });
      await record(result, asking.current ?? "Your earlier question");
      if (result.ok) setQuestion("");
      return result;
    },
  });
  const { busy, setOutcome, run } = job;

  const requestReady = question.trim().length > 0;
  const canRun = file != null && !busy && requestReady;

  // Only exchanges whose answer was actually recovered can become prior turns.
  const carryable = useMemo<ChatExchange[]>(
    () =>
      transcript
        .filter((entry) => entry.answer !== null)
        .map((entry) => ({
          question: entry.question,
          answer: entry.answer as string,
        })),
    [transcript],
  );
  // Recomputed rather than stored so what the panel SAYS it will send and what it
  // actually sends come from one call, not two that can drift apart.
  const context = useMemo(() => buildChatContext(carryable), [carryable]);

  // The conversation belongs to one document; swapping the file must not let turns
  // about the old PDF be sent as context for the new one.
  /**
   * Identifies which document the in-flight request belongs to.
   *
   * A job takes seconds to minutes, and nothing stops the user swapping the PDF while
   * one is running — the uploader and the Remove button both stay live. Without this,
   * a result that lands after a swap appends the OLD document's exchange to the
   * just-cleared transcript, and the next follow-up sends it as context for the NEW
   * PDF: the model is asked about one document while being shown another, and the
   * panel displays it as if it belonged to the file on screen.
   */
  const fileToken = useRef(0);
  /**
   * The document's measurement, ONCE per file — keyed by the same token, so a
   * swapped PDF is measured afresh and a follow-up does not re-parse it. A
   * promise rather than a value, so two quick questions share one parse.
   */
  const measurement = useRef<{
    token: number;
    result: Promise<ChatDocumentMeasurement>;
  } | null>(null);

  const chooseFile = useCallback(
    (next: File | null) => {
      fileToken.current += 1;
      setFile(next);
      setTranscript([]);
      setOutcome(null);
    },
    [setOutcome],
  );

  const start = useCallback(async () => {
    if (!file || !requestReady) return;
    const asked = question.trim();
    const startedFor = fileToken.current;
    asking.current = asked;
    const outcome = await run(async (controls) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // MEASURED BEFORE ANYTHING IS SPENT, and declared with the job. Without
      // the count every question reserved a whole call's worth — a third of
      // the day for a question about one page.
      if (measurement.current?.token !== startedFor) {
        measurement.current = {
          token: startedFor,
          result: measureChat(bytes),
        };
      }
      const measured = await measurement.current.result;
      // Nothing has been sent yet. A file swapped during the measurement ends
      // the run here; the outcome is cleared below, as any other outcome for a
      // file no longer on screen is.
      if (fileToken.current !== startedFor) return NOT_SENT;
      if (measured.kind === "no-text")
        return { ok: false as const, message: NO_TEXT_MESSAGE };
      const result = await runChat(
        {
          filename: file.name,
          bytes,
          question: asked,
          ...(context.turns.length > 0 ? { context: context.turns } : {}),
          // Only the DOCUMENT is declared: the route measures the question and
          // the carried turns off the job's options and charges them itself.
          documentCharacters:
            measured.kind === "counted" ? measured.count.characters : null,
        },
        controls,
      );
      // The document changed while this was running: the answer is about a
      // file the user has already replaced, so it belongs to no transcript on
      // screen. Drop it rather than showing it under the wrong PDF.
      if (fileToken.current !== startedFor) return result;
      // Re-checked after the await: reading the package is itself asynchronous.
      if (result.ok) {
        const answer = await readAnswerFromPackage(result.output, asked);
        if (fileToken.current === startedFor) {
          setTranscript((prev) => [
            ...prev,
            {
              id: prev.length,
              question: asked,
              answer,
              filename: result.artifact.filename,
              output: result.output,
              job: result.job,
            },
          ]);
          setQuestion("");
        }
      }
      return result;
    });
    // Whatever came back for a file that is no longer on screen — an answer
    // or an error — is not about the document the user is looking at.
    if (outcome && fileToken.current !== startedFor) setOutcome(null);
  }, [
    file,
    question,
    requestReady,
    context,
    run,
    setOutcome,
    runChat,
    measureChat,
  ]);

  return (
    <div className="border-accent/40 bg-accent/10 flex flex-col gap-4 rounded-[4px] border p-4">
      <p className="text-accent flex items-start gap-1.5 text-xs leading-relaxed">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Running this uses a private secure-worker job. The worker sends only the
        PDF&apos;s selectable text to a configured AI model — it does not read
        scanned images (run OCR first) — and the model is told to answer only
        from that text. AI answers can still be wrong.
      </p>

      {file ? (
        <ChosenFileTarget
          file={file}
          accept="application/pdf,.pdf"
          busy={busy}
          refuse={refuse}
          onReplace={(files) => {
            chooseFile(files[0] ?? null);
          }}
        >
          <div className="border-line bg-wash text-fg flex flex-wrap items-center justify-between gap-2 rounded-[3px] border px-3 py-2 text-sm">
            <span className="truncate">{file.name}</span>
            <button
              type="button"
              onClick={() => chooseFile(null)}
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
          onFiles={(files) => chooseFile(files[0] ?? null)}
          accept="application/pdf,.pdf"
          multiple={false}
          compact
          title="Add your PDF, or"
          hint="PDF with selectable text to ask about"
        />
      )}

      {/* Always mounted. Gating this on `transcript.length > 0` inserted the live
          region and its first answer in the same commit to the DOM, and a region
          that arrives already containing its text is not a change — nothing is
          spoken. The empty list costs nothing and is what makes the log work. */}
      <Transcript entries={transcript} />

      <label className="text-muted flex flex-col gap-1 text-xs">
        {transcript.length > 0 ? "Ask a follow-up" : "Your question"}
        <textarea
          value={question}
          onChange={(e) =>
            setQuestion(e.target.value.slice(0, MAX_QUESTION_CHARS))
          }
          maxLength={MAX_QUESTION_CHARS}
          rows={3}
          placeholder={
            transcript.length > 0
              ? "e.g. And what is the payment method?"
              : "e.g. What is the total amount due, and when is it due?"
          }
          className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 rounded-lg border px-3 py-2 text-sm outline-none"
        />
      </label>

      {transcript.length > 0 && (
        <ContextNote
          context={context}
          unreadable={transcript.length - carryable.length}
        />
      )}

      <WorkerRunButton
        onClick={start}
        busy={busy}
        // `canRun` already folds in `!busy`; both go through one blocked branch.
        disabled={!canRun}
        busyLabel={jobBusyLabel(job.phase, "Answering…")}
        icon={MessageSquare}
        tone="violet"
      >
        {transcript.length > 0 ? "Send follow-up" : "Ask the PDF"}
      </WorkerRunButton>

      <WorkerJobStatus job={job} />
    </div>
  );
}

/** The conversation so far: each question, the model's real answer, and its package. */
function Transcript({ entries }: { entries: TranscriptEntry[] }) {
  return (
    /* `log` rather than `status`: answers arrive in sequence and the order is
       meaningful, and unlike a focus move it never interrupts someone midway
       through typing their follow-up. */
    <ol role="log" aria-live="polite" className="flex flex-col gap-3">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="border-line bg-wash flex flex-col gap-2 rounded-[4px] border p-4"
        >
          <p className="text-fg text-sm font-medium">{entry.question}</p>
          {/* Before the answer, not after: a reader who stops at the answer is
              exactly the reader the notice is for. */}
          <TruncationNotice
            job={entry.job}
            consequence="An answer that says the document does not mention something may only mean it is not in the pages that were read."
          />
          {entry.answer !== null ? (
            // The model's answer verbatim, exactly as shipped in the package — never a
            // paraphrase, and never anything the panel composed itself.
            <>
              <p className="text-muted text-sm leading-relaxed whitespace-pre-wrap">
                {entry.answer}
              </p>
              {/* Under EVERY answer, and not conditional on citations: an
                  ungrounded answer has none to point at. */}
              <p className="text-muted text-xs leading-relaxed">
                {AI_ANSWER_CAVEAT}
              </p>
            </>
          ) : (
            <p className="text-warn text-sm leading-relaxed">
              The answer package came back, but its answer could not be read
              here — so nothing is shown rather than guessed, and this exchange
              is left out of follow-up context. Download it to read the answer.
            </p>
          )}
          <button
            type="button"
            onClick={() => downloadBytes(entry.output, entry.filename)}
            className="border-line text-muted hover:border-line-strong hover:text-fg inline-flex items-center gap-2 self-start rounded-full border px-3 py-1.5 text-xs font-medium transition"
          >
            <Download className="size-3.5" aria-hidden />
            {entry.filename}
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * States exactly what the next question will carry. The bounds are the contract's
 * (`MAX_CONTEXT_TURNS`, `MAX_TURN_CHARS`), and a transcript longer than they allow
 * would otherwise imply the model is being told more than it is.
 */
function ContextNote({
  context,
  unreadable,
}: {
  context: ReturnType<typeof buildChatContext>;
  unreadable: number;
}) {
  const exchanges = context.turns.length / 2;
  const notes: string[] = [];
  if (context.droppedExchanges > 0) {
    notes.push(
      `the ${context.droppedExchanges} oldest ${context.droppedExchanges === 1 ? "exchange is" : "exchanges are"} left out`,
    );
  }
  if (context.shortenedTurns > 0) {
    notes.push(
      `${context.shortenedTurns} long ${context.shortenedTurns === 1 ? "message is" : "messages are"} shortened`,
    );
  }
  if (unreadable > 0) {
    notes.push(
      `${unreadable} unreadable ${unreadable === 1 ? "answer is" : "answers are"} excluded`,
    );
  }

  return (
    <p className="text-muted text-xs leading-relaxed">
      {exchanges === 0
        ? "Your next question is sent on its own — no earlier exchange is carried."
        : `Your next question is sent with the previous ${exchanges === 1 ? "exchange" : `${exchanges} exchanges`} as context.`}
      {notes.length > 0
        ? ` To stay within the request limits, ${notes.join(", and ")}.`
        : ""}{" "}
      The PDF is re-sent and re-read each time — the worker keeps nothing
      between questions.
    </p>
  );
}
