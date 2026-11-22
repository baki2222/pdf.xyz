"use client";

import { usePickRefusal } from "@/components/tools/use-pick";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Download,
  FileText,
  ShieldCheck,
  Sparkles,
  Timer,
} from "lucide-react";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import { aiReadLimitFor } from "@/lib/jobs/ai-read-limit";
import {
  DEFAULT_SUMMARY_FORMAT,
  DEFAULT_SUMMARY_LENGTH,
  MAX_SUMMARY_FOCUS_CHARS,
  type SummaryFormat,
  type SummaryLength,
} from "@/lib/jobs/summarize-pdf";
import {
  aiDailyAllowanceNote,
  aiToolUnavailableDetail,
} from "@/lib/workers/ai-tool-availability";
import {
  canRunSummarize,
  measureSummarizeRun,
  runWorkerSummarize,
  type SummarizeChoice,
  type SummarizeWorkerResult,
} from "@/lib/workers/summarize-client";
import { SUMMARIZE_PAGES_UNCONFIRMED_MESSAGE } from "@/lib/jobs/summarize-pages";
import { selectionConfirmed } from "@/lib/jobs/selection-echo";
import { pagesPhrase, type PageSpan } from "@/lib/pdf/page-spans";
import type { SummarySection } from "@/lib/pdf/summary-sections";
import { userSelectionNotice } from "@/lib/workers/ai/selection-notice";
import type { Job } from "@/lib/jobs/types";
import { downloadBlob, downloadBytes } from "@/lib/pdf/browser";
import {
  readSummaryFromPackage,
  summaryFileName,
  type SummaryReadBack,
} from "@/lib/workers/summarize-package";
import { buttonVariants } from "@/components/ui/button";
import { CopyTextButton } from "./copy-text-button";

type AiResultViews = typeof import("./ai-result-views");
import { TruncationNotice } from "./truncation-notice";
import type { Tool } from "@/lib/tools/types";
import type { PickRefusal } from "@/lib/uploads/pick-check";
import { formatBytes } from "@/lib/utils";
import {
  DownloadCta,
  Dropzone,
  ResultCard,
  WorkerRunButton,
} from "./runner/runner-kit";
import { ChosenFileTarget } from "./chosen-file-target";
import { OfficeExportNextStep } from "./office-export-notices";
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
 *
 * Refitted 2026-10-24, when the not-enabled box became one sentence,
 * Why?, Try again and Notify me (the reason one press away): the
 * tallest state, Windows / Linux (CI's SLOT_NATURAL lines on
 * 28af68e1), is 381/381px at 360-390, 264/264px at 640,
 * 303/303px at 1024; the larger x1.035, to the half rem.
 */
const STATUS_SLOT = "min-h-[25rem] sm:min-h-[17.5rem] lg:min-h-[20rem]";

const LENGTH_OPTIONS: { value: SummaryLength; label: string }[] = [
  { value: "brief", label: "Brief — TL;DR + key points" },
  { value: "standard", label: "Standard — the main points" },
  { value: "detailed", label: "Detailed — every major section" },
];

const FORMAT_OPTIONS: { value: SummaryFormat; label: string }[] = [
  { value: "paragraphs", label: "Paragraphs" },
  { value: "bullets", label: "Bullet points" },
  { value: "outline", label: "Section outline" },
];

export function SummarizeWorkerPanel({ tool }: { tool: Tool }) {
  const pickRefuse = usePickRefusal(tool);
  return (
    <WorkerPanelShell
      tool={tool}
      tone="accent"
      engine={{ label: "AI summary", icon: Sparkles }}
      description={
        <>
          Our server extracts your PDF&apos;s selectable text and asks a
          configured AI model to summarize only that text, then returns a
          summary package — Markdown, plain text, and a manifest recording the
          model and scope. With no AI model configured, or a scanned PDF with no
          selectable text, the job fails instead of guessing. The model is
          instructed to use only the document&apos;s text, but AI output can
          still be wrong, so check important details against your PDF.
        </>
      }
      canRun={canRunSummarize}
      specRows={[
        {
          icon: Download,
          label: "You get",
          value: "Summary on the page · copy, TXT, Markdown or ZIP",
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
      <SummaryBuilder tool={tool} refuse={pickRefuse} />
    </WorkerPanelShell>
  );
}

const RUN_LABEL = "Summarize PDF";

/** A stable empty list, so the Run callback is not rebuilt every render. */
const NO_SECTIONS: readonly SummarySection[] = [];

/** The "Part to summarize" select's fixed values; a section is `s<index>`. */
const WHOLE = "whole";
const PAGES = "pages";

/** The page-text field's longest entry. */
const MAX_PAGES_TEXT = 200;

function SummaryBuilder({ tool, refuse }: { tool: Tool; refuse: PickRefusal }) {
  const { available, status } = useWorkerPanel();
  // Offered ONLY while the running worker proves it reads just the chosen
  // pages (`summarizePages`, the predicate `POST /api/jobs` admits on). Off,
  // nothing new renders and no outline is read.
  const pagesOffered = status?.summarizePages === true;
  const [file, setFileState] = useState<File | null>(null);
  const [part, setPart] = useState<string>(WHOLE);
  const [pagesText, setPagesText] = useState("");
  // Keyed by the file they were read from: a swapped file's late outline
  // result is never shown against the new file.
  const [sections, setSections] = useState<{
    from: File;
    list: SummarySection[];
  } | null>(null);
  // What THIS run sent as pages (null: the whole document), for the
  // rollback check on its result. A job resumed after a reload has none, so
  // it gets no warning: the panel cannot know what was asked.
  const [sentPages, setSentPages] = useState<{
    job: string | null;
    pages: PageSpan[] | null;
  } | null>(null);
  /** Every file change starts again from the whole document. */
  const setFile = useCallback((next: File | null) => {
    setFileState(next);
    setPart(WHOLE);
  }, []);
  const [length, setLength] = useState<SummaryLength>(DEFAULT_SUMMARY_LENGTH);
  const [format, setFormat] = useState<SummaryFormat>(DEFAULT_SUMMARY_FORMAT);
  const [focus, setFocus] = useState("");
  const job = useWorkerJob<SummarizeWorkerResult>({
    tool: "summarize-pdf",
    resume: (id, controls) =>
      resumeSecurityJob(id, { ...controls, tool: "summarize-pdf" }),
  });
  const { busy, outcome, setOutcome, run } = job;
  const staged = useStagedHandoff(tool.slug, RUN_LABEL, (files) => {
    setOutcome(null);
    setFile(files[0] ?? null);
  });

  const canRun = file != null && !busy;

  useEffect(() => {
    if (!file || !pagesOffered) return;
    let live = true;
    void (async () => {
      let list: SummarySection[] = [];
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { readSummarySections } =
          await import("@/lib/pdf/summary-sections");
        list = await readSummarySections(bytes);
      } catch {
        list = [];
      }
      if (live) setSections({ from: file, list });
    })();
    return () => {
      live = false;
    };
  }, [file, pagesOffered]);
  const sectionList =
    pagesOffered && sections?.from === file ? sections.list : NO_SECTIONS;

  const start = useCallback(async () => {
    if (!file || !available) return;
    await run(async (controls) => {
      const trimmedFocus = focus.trim();
      const bytes = new Uint8Array(await file.arrayBuffer());
      setSentPages(null);
      const section = /^s(\d+)$/.exec(part);
      const chosen = section ? sectionList[Number(section[1])] : undefined;
      const choice: SummarizeChoice = !pagesOffered
        ? { kind: "whole" }
        : part === PAGES
          ? { kind: "pages", text: pagesText }
          : chosen
            ? { kind: "span", span: chosen.span }
            : { kind: "whole" };
      // CHECK HERE, BEFORE ANYTHING IS SPENT, with ONE parse. The allowance
      // is reserved when the job is created, and a scan or a locked PDF has
      // no count to declare, so the worker's refusal would arrive after the
      // undeclared price (a third of the day) was taken. The same parse
      // checks the chosen pages against the page count and counts their
      // text (see measureSummarizeRun).
      const measured = await measureSummarizeRun(bytes, choice);
      if (!measured.ok) return measured;
      const result = await runWorkerSummarize(
        {
          filename: file.name,
          bytes,
          length,
          format,
          ...(trimmedFocus ? { focus: trimmedFocus } : {}),
          // Counted before upload so the run is charged what the chosen text
          // holds, not a third of the day. `null` (a file pdfjs cannot count)
          // sends it undeclared at the old price rather than refusing it.
          declaredCharacters: measured.declaredCharacters,
          ...(measured.pages ? { pages: measured.pages } : {}),
        },
        controls,
      );
      setSentPages({
        job: result.ok ? result.job.jobId : null,
        pages: measured.pages ?? null,
      });
      return result;
    });
  }, [
    file,
    length,
    format,
    focus,
    run,
    available,
    pagesOffered,
    part,
    pagesText,
    sectionList,
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
          <div className="border-line bg-wash text-fg rounded-ctl flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-sm">
            <span className="truncate">{file.name}</span>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setOutcome(null);
              }}
              className="text-muted hover:text-fg tap-y shrink-0 text-sm font-medium transition"
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
          hint="PDF with selectable text to summarize"
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-muted flex flex-col gap-1 text-xs">
          Summary length
          <select
            value={length}
            onChange={(e) => setLength(e.target.value as SummaryLength)}
            className="border-line bg-wash text-fg focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
          >
            {LENGTH_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-muted flex flex-col gap-1 text-xs">
          Format
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as SummaryFormat)}
            className="border-line bg-wash text-fg focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
          >
            {FORMAT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-muted flex flex-col gap-1 text-xs sm:col-span-2">
          Focus (optional)
          <input
            type="text"
            value={focus}
            onChange={(e) =>
              setFocus(e.target.value.slice(0, MAX_SUMMARY_FOCUS_CHARS))
            }
            maxLength={MAX_SUMMARY_FOCUS_CHARS}
            placeholder="e.g. focus on financial risks and obligations"
            className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
          />
        </label>
        {pagesOffered && (
          <label className="text-muted flex flex-col gap-1 text-xs sm:col-span-2">
            Part to summarize
            <select
              value={part}
              onChange={(e) => setPart(e.target.value)}
              className="border-line bg-wash text-fg focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
            >
              <option value={WHOLE}>Whole document</option>
              {sectionList.map((section, i) => (
                <option key={`${i}-${section.span[0]}`} value={`s${i}`}>
                  {`${section.title} (${pagesPhrase([section.span])})`}
                </option>
              ))}
              <option value={PAGES}>Pages…</option>
            </select>
          </label>
        )}
        {pagesOffered && part === PAGES && (
          <label className="text-muted flex flex-col gap-1 text-xs sm:col-span-2">
            Pages
            <input
              type="text"
              inputMode="text"
              value={pagesText}
              onChange={(e) =>
                setPagesText(e.target.value.slice(0, MAX_PAGES_TEXT))
              }
              maxLength={MAX_PAGES_TEXT}
              placeholder="e.g. 1-3, 8"
              className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
            />
          </label>
        )}
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
            busyLabel={jobBusyLabel(job.phase, "Summarizing…")}
            icon={FileText}
          >
            {RUN_LABEL}
          </WorkerRunButton>
        )}
        jobStatus={
          <>
            <WorkerJobStatus job={job} />
            {outcome?.ok === false && !outcome.stillRunning && (
              <OfficeExportNextStep
                code={outcome.code}
                message={outcome.message}
              />
            )}
          </>
        }
        note={
          <div className="flex flex-col gap-2">
            <p className="text-accent flex items-start gap-1.5 text-xs leading-relaxed">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Your PDF uploads to a private secure-server job only when you
              press {RUN_LABEL}. Our server sends only the PDF&apos;s selectable
              text to a configured AI model — it does not read scanned images
              (run OCR first) — and the model is told to summarize only that
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
              {RUN_LABEL} stays off until our server is ready, so {tool.name}{" "}
              never pretends to produce a summary it cannot actually generate.
            </p>
          </>
        }
      />

      {outcome?.ok === true && (
        <ResultCard
          announce="Your AI summary package is ready."
          output={workerOutput(outcome.output, outcome.artifact)}
          inputBytes={file?.size}
        >
          <TruncationNotice
            job={outcome.job}
            consequence="This summarises those pages, not the whole document."
          />
          <SelectionNotice
            job={outcome.job}
            sent={
              sentPages && sentPages.job === outcome.job?.jobId
                ? sentPages.pages
                : null
            }
          />
          <SummaryResultBody
            output={outcome.output}
            filename={outcome.artifact.filename}
          />
        </ResultCard>
      )}
    </div>
  );
}

/**
 * Which pages the summary covers, from the worker's own record
 * (`userSelectionNotice`, the function the manifest uses) — or, when this
 * run SENT pages and the result does not confirm exactly those
 * (`selectionConfirmed`), the rollback warning INSTEAD: an image that
 * predates page selection summarizes the opening pages and says nothing
 * false, so silence is the defect this catches. A present-but-different
 * list warns too, never renders as a confident sentence.
 */
export function SelectionNotice({
  job,
  sent,
}: {
  job: Job | undefined;
  /** What this run sent as pages, or null (whole document, or resumed). */
  sent: readonly PageSpan[] | null;
}) {
  const window = job?.results?.ai?.truncation;
  if (sent && !selectionConfirmed(sent, window)) {
    return (
      <p
        role="status"
        className="border-warn/40 bg-warn/10 text-warn rounded-panel flex items-start gap-2 border px-4 py-3 text-sm"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{SUMMARIZE_PAGES_UNCONFIRMED_MESSAGE}</span>
      </p>
    );
  }
  const sentence = window ? userSelectionNotice(window) : "";
  if (!sentence) return null;
  return (
    <p role="status" className="text-muted text-sm">
      {sentence}
    </p>
  );
}

/**
 * The finished summary, ON THE PAGE (audit summarize-pdf#1): read back from
 * the package already in the browser's memory, shown in a scroll box, with
 * Copy, a plain-text download, a Markdown download and the full ZIP.
 *
 * Until the package has been read — or when it cannot be (`null`) — the card
 * says only what is certainly true, the package sentence and its button: a
 * reader is never told "read it below" above an empty box.
 */
export function SummaryResultBody({
  output,
  filename,
}: {
  output: Uint8Array;
  filename: string;
}) {
  // Keyed by the bytes it was read from, so a new result never shows the
  // previous summary while its own package is being read.
  // The box comes from the AI result views chunk, fetched with the result
  // and never with the page; it draws at most PAGE_TEXT_LIMIT characters.
  // A chunk that will not load is treated as a package that cannot be read:
  // the card says only what is certainly true, and the ZIP holds the summary.
  const [read, setRead] = useState<{
    from: Uint8Array;
    summary: SummaryReadBack | null;
    views: AiResultViews | null;
  } | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([
      readSummaryFromPackage(output),
      import("./ai-result-views").catch(() => null),
    ]).then(([summary, views]) => {
      if (live) setRead({ from: output, summary, views });
    });
    return () => {
      live = false;
    };
  }, [output]);
  const summary = read?.from === output ? read.summary : undefined;
  const views = read?.from === output ? read.views : null;

  const zipButton = (
    <DownloadCta onClick={() => downloadBytes(output, filename)}>
      Download {filename}
    </DownloadCta>
  );

  // `data-summary-read` says whether the read has settled: before it and
  // after a read that found no summary, this card is the same, so a test of
  // "claims no summary" waits on this instead of a sleep.
  if (!summary || !views) {
    return (
      <>
        <p
          className="text-ok text-sm"
          data-summary-read={read?.from === output ? "unavailable" : "pending"}
        >
          Your AI summary package is ready — the summary in Markdown and plain
          text, plus a manifest recording the model and honest scope.
        </p>
        {zipButton}
      </>
    );
  }

  const txtName = summaryFileName(filename, "txt");
  const mdName = summaryFileName(filename, "md");
  // The labels name the format, not the file: buttonVariants never wraps, and
  // a name of up to MAX_DISPLAY_FILENAME_LENGTH would spill out of a phone's
  // card. The ZIP button below wraps and names the file; the download keeps
  // its own name (`<stem>-summary.txt` / `.md`).
  const fileButton = buttonVariants({
    variant: "secondary",
    className: "w-full sm:w-auto",
  });
  return (
    <>
      <p className="text-ok text-sm" data-summary-read="shown">
        Your AI summary is ready — read it below, copy it, or save it as plain
        text or Markdown. The ZIP adds a manifest recording the model and honest
        scope.
      </p>
      <views.SummaryBox text={summary.text} />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
        <CopyTextButton
          text={summary.text}
          label="Copy summary"
          size="md"
          className="w-full sm:w-auto"
          {...(views.cutForPage(summary.text).cut
            ? { failed: views.COPY_FAILED_CUT }
            : {})}
        />
        <button
          type="button"
          data-download=""
          onClick={() =>
            downloadBlob(
              new Blob([summary.text], { type: "text/plain;charset=utf-8" }),
              txtName,
            )
          }
          className={fileButton}
        >
          <Download className="size-4" aria-hidden />
          Download TXT
        </button>
        <button
          type="button"
          data-download=""
          onClick={() =>
            downloadBlob(
              new Blob([summary.markdown], {
                type: "text/markdown;charset=utf-8",
              }),
              mdName,
            )
          }
          className={fileButton}
        >
          <Download className="size-4" aria-hidden />
          Download Markdown
        </button>
      </div>
      {zipButton}
    </>
  );
}
