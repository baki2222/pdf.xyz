"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, MessageSquare, ShieldCheck, Sparkles, Timer } from "lucide-react";
import { workerPipelineStages } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import { MAX_QUESTION_CHARS } from "@/lib/jobs/chat-with-pdf";
import type { WorkerStatus } from "@/lib/workers/status";
import { aiToolUnavailableDetail } from "@/lib/workers/ai-tool-availability";
import {
  canRunChatWithPdf,
  runWorkerChatWithPdf,
} from "@/lib/workers/chat-with-pdf-client";
import {
  buildChatContext,
  readAnswerFromPackage,
  type ChatExchange,
} from "@/lib/workers/chat-with-pdf-conversation";
import { downloadBytes } from "@/lib/pdf/browser";
import { track } from "@/lib/telemetry/track";
import type { Tool } from "@/lib/tools/types";
import { formatBytes } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
import { Dropzone, ErrorNote, Spinner } from "./runner/runner-kit";
import { NotifyMe } from "./notify-me";

type Phase = "loading" | "error" | "ready";

function badgeFor(phase: Phase, status: WorkerStatus | null): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading") return { tone: "info", label: "Checking…", pulse: true };
  if (phase === "error" || !status) return { tone: "muted", label: "Status unknown", pulse: false };
  return canRunChatWithPdf(status)
    ? { tone: "ok", label: "Secure worker", pulse: false }
    : { tone: "muted", label: "Not enabled", pulse: false };
}

export function ChatWithPdfWorkerPanel({ tool }: { tool: Tool }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<WorkerStatus | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/worker/status", { headers: { accept: "application/json" } })
      .then((res) => (res.ok ? (res.json() as Promise<WorkerStatus>) : Promise.reject(new Error("unreachable"))))
      .then((next) => {
        if (!active) return;
        setStatus(next);
        setPhase("ready");
        track({ name: "worker_status_checked", mode: next.mode, enabled: next.enabled });
      })
      .catch(() => {
        if (active) setPhase("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const badge = badgeFor(phase, status);
  const available = phase === "ready" && canRunChatWithPdf(status);
  const unavailableDetail =
    phase === "loading"
      ? "Checking whether a secure worker is available…"
      : phase === "error"
        ? "The worker status endpoint could not be reached right now."
        : aiToolUnavailableDetail(status);

  return (
    <div className="gradient-border">
      <div className="glass flex flex-col gap-6 rounded-3xl p-5 sm:p-7">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-400/10 px-2.5 py-1 text-[11px] font-medium text-violet-200">
              <Sparkles className="size-3" aria-hidden />
              AI chat
            </span>
            <StatusBadge tone={badge.tone} label={badge.label} pulse={badge.pulse} />
          </div>
          <h2 className="text-lg font-semibold text-white">{tool.name} runs on an encrypted secure worker</h2>
          <p className="text-sm leading-relaxed text-slate-400">
            The worker extracts your PDF&apos;s selectable text and asks a configured AI model to answer your question
            using only that text — with inline page citations when the document has page-level text — then returns an
            answer package (the model&apos;s answer, a plain-text copy, and a manifest recording the model and scope). It
            never fabricates answers: with no AI model configured, a scanned PDF with no selectable text, or an empty
            model reply, it fails honestly instead of guessing.
          </p>
        </div>

        {available ? (
          <ChatBuilder />
        ) : (
          <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm leading-relaxed text-slate-300">{unavailableDetail}</p>
            <p className="text-xs leading-relaxed text-slate-500">
              No question box is shown until the worker is ready, so {tool.name} never pretends to answer from a document
              it cannot actually read.
            </p>
            <NotifyMe toolName={tool.name} toolSlug={tool.slug} />
          </div>
        )}

        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">What happens</h3>
          <ol className="flex flex-col gap-1">
            {workerPipelineStages(status?.scan.active ?? false).map((stage, index, all) => (
              <li key={stage.id} className="flex items-start gap-3">
                <div className="flex flex-col items-center self-stretch">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-300">
                    <Sparkles className="size-4" aria-hidden />
                  </span>
                  {index < all.length - 1 && <span className="my-1 w-px flex-1 bg-white/10" aria-hidden />}
                </div>
                <div className="flex flex-col gap-0.5 pb-3">
                  <span className="text-sm font-medium text-slate-200">
                    {index + 1}. {stage.title}
                  </span>
                  <span className="text-xs leading-relaxed text-slate-500">{stage.description}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-surface-2 px-4 py-1">
          <SpecRow icon={Download} label="Output" value="ZIP · answer.md + answer.txt + manifest" />
          <SpecRow icon={Timer} label="Retention" value={`Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`} />
          <SpecRow icon={ShieldCheck} label="Limit" value={`${formatBytes(JOB_LIMITS.maxFileBytes)}/file`} />
        </div>
      </div>
    </div>
  );
}

function SpecRow({ icon: Icon, label, value }: { icon: typeof Download; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="inline-flex items-center gap-2 text-sm text-slate-400">
        <Icon className="size-4 text-slate-500" aria-hidden />
        {label}
      </span>
      <span className="text-right text-sm font-medium text-slate-200">{value}</span>
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
}

function ChatBuilder() {
  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);

  const requestReady = question.trim().length > 0;
  const canRun = file != null && !busy && requestReady;

  // Only exchanges whose answer was actually recovered can become prior turns.
  const carryable = useMemo<ChatExchange[]>(
    () =>
      transcript
        .filter((entry) => entry.answer !== null)
        .map((entry) => ({ question: entry.question, answer: entry.answer as string })),
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

  const chooseFile = useCallback((next: File | null) => {
    fileToken.current += 1;
    setFile(next);
    setTranscript([]);
    setError(null);
  }, []);

  const start = useCallback(async () => {
    if (!file || !requestReady) return;
    const asked = question.trim();
    const startedFor = fileToken.current;
    setBusy(true);
    setError(null);
    // Every exit from here — the two file-swap bail-outs, the happy path, and a
    // rejected fetch — has to stop the spinner. A rejection used to escape this
    // callback entirely, so `setBusy(false)` never ran and the button spun
    // forever with no error, recoverable only by reloading the page.
    try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await runWorkerChatWithPdf({
      filename: file.name,
      bytes,
      question: asked,
      ...(context.turns.length > 0 ? { context: context.turns } : {}),
    });
    // The document changed while this was running: the answer is about a file the user
    // has already replaced, so it belongs to no transcript on screen. Drop it rather
    // than showing it under the wrong PDF.
    if (fileToken.current !== startedFor) {
      return;
    }
    if (result.ok) {
      const answer = await readAnswerFromPackage(result.output, asked);
      // Re-checked after the await: reading the package is itself asynchronous.
      if (fileToken.current !== startedFor) {
        return;
      }
      setTranscript((prev) => [
        ...prev,
        { id: prev.length, question: asked, answer, filename: result.artifact.filename, output: result.output },
      ]);
      setQuestion("");
    } else {
      setError(result.message);
    }
    } catch {
      // No response to inspect: offline, DNS failure, a reset connection, or a
      // file that could not be read. Say what is true and nothing more.
      if (fileToken.current === startedFor) {
        setError(
          "Lost the connection before the answer came back. Check your network and try again.",
        );
      }
    } finally {
      setBusy(false);
    }
  }, [file, question, requestReady, context]);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-violet-400/25 bg-violet-500/[0.06] p-4">
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-violet-100/90">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Running this uses a private secure-worker job. The worker answers only from the PDF&apos;s selectable text with a
        configured AI model — it does not read scanned images (run OCR first) and never invents an answer.
      </p>

      {file ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200">
          <span className="truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => chooseFile(null)}
            className="shrink-0 text-xs font-medium text-slate-400 transition hover:text-white"
          >
            Remove
          </button>
        </div>
      ) : (
        <Dropzone onFiles={(files) => chooseFile(files[0] ?? null)} accept="application/pdf,.pdf" multiple={false} compact title="Add your PDF, or" hint="PDF with selectable text to ask about" />
      )}

      {/* Always mounted. Gating this on `transcript.length > 0` inserted the live
          region and its first answer in the same commit to the DOM, and a region
          that arrives already containing its text is not a change — nothing is
          spoken. The empty list costs nothing and is what makes the log work. */}
      <Transcript entries={transcript} />

      <label className="flex flex-col gap-1 text-xs text-slate-400">
        {transcript.length > 0 ? "Ask a follow-up" : "Your question"}
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value.slice(0, MAX_QUESTION_CHARS))}
          maxLength={MAX_QUESTION_CHARS}
          rows={3}
          placeholder={
            transcript.length > 0
              ? "e.g. And what is the payment method?"
              : "e.g. What is the total amount due, and when is it due?"
          }
          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-400/50"
        />
      </label>

      {transcript.length > 0 && <ContextNote context={context} unreadable={transcript.length - carryable.length} />}

      <button
        type="button"
        onClick={start}
        disabled={!canRun}
        aria-busy={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-violet-400/40 bg-violet-500/15 px-6 py-2.5 text-sm font-semibold text-violet-100 transition hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:self-start"
      >
        {busy ? (
          <>
            <Spinner />
            Answering…
          </>
        ) : (
          <>
            <MessageSquare className="size-4" aria-hidden />
            {transcript.length > 0 ? "Send follow-up" : "Ask the PDF"}
          </>
        )}
      </button>

      {error !== null && <ErrorNote message={error} />}
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
        <li key={entry.id} className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-sm font-medium text-slate-200">{entry.question}</p>
          {entry.answer !== null ? (
            // The model's answer verbatim, exactly as shipped in the package — never a
            // paraphrase, and never anything the panel composed itself.
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{entry.answer}</p>
          ) : (
            <p className="text-sm leading-relaxed text-amber-200/90">
              The answer package came back, but its answer could not be read here — so nothing is shown rather than
              guessed, and this exchange is left out of follow-up context. Download it to read the answer.
            </p>
          )}
          <button
            type="button"
            onClick={() => downloadBytes(entry.output, entry.filename)}
            className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-white/25 hover:text-white"
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
    notes.push(`${context.shortenedTurns} long ${context.shortenedTurns === 1 ? "message is" : "messages are"} shortened`);
  }
  if (unreadable > 0) {
    notes.push(`${unreadable} unreadable ${unreadable === 1 ? "answer is" : "answers are"} excluded`);
  }

  return (
    <p className="text-xs leading-relaxed text-slate-500">
      {exchanges === 0
        ? "Your next question is sent on its own — no earlier exchange is carried."
        : `Your next question is sent with the previous ${exchanges === 1 ? "exchange" : `${exchanges} exchanges`} as context.`}
      {notes.length > 0 ? ` To stay within the request limits, ${notes.join(", and ")}.` : ""} The PDF is re-sent and
      re-read each time — the worker keeps nothing between questions.
    </p>
  );
}
