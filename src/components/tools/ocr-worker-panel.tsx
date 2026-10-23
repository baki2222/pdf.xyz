"use client";

import Link from "next/link";
import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  Check,
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
import { ocrLanguagesFromBrowser } from "@/lib/jobs/ocr-browser-languages";
import {
  resumeWorkerOcr,
  runWorkerOcr,
  type OcrWorkerResult,
} from "@/lib/workers/ocr-client";
import type { Tool } from "@/lib/tools/types";
import { pickRefusal, type PickRefusal } from "@/lib/uploads/pick-check";
import { cn, formatBytes } from "@/lib/utils";
import {
  DownloadCta,
  Dropzone,
  ResultCard,
  WorkerRunButton,
} from "./runner/runner-kit";
import { ChosenFileTarget } from "./chosen-file-target";
import { NotifyMe } from "./notify-me";
import { jobBusyLabel, useWorkerJob, WorkerJobStatus } from "./worker-job";
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
 * on 507b6383), is 496.3px at 360, 439.5px at 640, 457.5px at 1024;
 * x1.035, to the half rem, then up to a value another panel's slot already
 * uses, so the thirteen share a handful of classes. A first fit from
 * Windows alone (x1.06) left PowerPoint to PDF and PDF to PowerPoint
 * short on Linux at 360. The check: `e2e/tool-layout.mobile.spec.ts`.
 *
 * Refitted 2026-10-23, when the stage list stopped being drawn before a
 * job (one "What happens to your file" press stands in for it): the
 * tallest state is now not-enabled, off 460.3/479.8px at 360 (Windows/Linux;
 * Linux from CI's SLOT_NATURAL lines on 0504da27, a state this change
 * did not touch), x1.035 to the half rem, then up to a value another
 * panel already uses.
 */
const STATUS_SLOT = "min-h-[31.5rem] sm:min-h-[22rem] lg:min-h-[24.5rem]";

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

/**
 * Premium, OCR-specific secure-worker panel for `/tools/ocr-pdf`.
 *
 * The tool page mounts it from the panel registry (`./worker-panels`), which
 * since WP-06 has no generic preview to fall back to: every worker tool has a
 * real panel, and `tool-page-registry.test.ts` holds that. It lets the user
 * configure a real OCR request (languages, output, redo-OCR) that is
 * validated with the shared `parseOcrOptions` contract, takes the file at
 * once, and shows exactly what a secure worker does with it — encrypted
 * upload → scan → recognition → download → auto-delete — as a live docket.
 * It never fabricates recognized text or a searchable PDF: the run, the only
 * thing that uploads, waits for the live, presence-only `/api/worker/status`
 * check to report OCR available, and otherwise the panel says so plainly.
 */
export function OcrWorkerPanel({ tool }: { tool: Tool }) {
  // Here, not in the body: the spec rows under the run area name it too.
  const [outputMode, setOutputMode] = useState<OcrOutputMode>(
    DEFAULT_OCR_OUTPUT_MODE,
  );
  const outputs = ocrOutputsForMode(outputMode).join(", ");
  return (
    <WorkerPanelShell
      tool={tool}
      engine={{ label: "Secure-worker OCR", icon: ScanText }}
      description={
        <>
          Optical character recognition needs a native OCR engine, so it runs on
          an isolated, auto-deleting worker rather than in your browser.
          Configure the recognition below — we&apos;ll show exactly what happens
          to your file, and never fake a result.
        </>
      }
      canRun={(status) => status.ocr.available}
      readyLabel="Available"
      specRows={[
        { icon: FileUp, label: "Inputs", value: tool.accept.join(", ") },
        { icon: FileDown, label: "Outputs", value: outputs },
        {
          icon: Timer,
          label: "Your files",
          value: `Inputs wiped after processing · outputs ${DEFAULT_RETENTION.outputTtlMinutes} min`,
        },
        {
          icon: ShieldCheck,
          label: "Limits",
          // OCR's own per-job count, not the platform's JOB_LIMITS.maxInputFiles:
          // this row said "up to 20 files" above an uploader that kept one.
          value: `${formatBytes(JOB_LIMITS.maxFileBytes)}/file · ${OCR_MAX_INPUT_FILES} ${OCR_MAX_INPUT_FILES === 1 ? "file" : "files"} per job`,
        },
      ]}
      footer={
        <p className="text-muted text-xs leading-relaxed">
          No account required. OCR runs on a separate processing server, not in
          your browser: files travel over an encrypted connection, are
          recognized in a temporary per-job folder that is erased when the job
          ends, and are deleted automatically. It&apos;s enabled per deployment;
          the{" "}
          <Link
            href="/privacy#files"
            className="text-accent underline underline-offset-4"
          >
            privacy policy
          </Link>{" "}
          says what happens to an uploaded file and when it is deleted.
        </p>
      }
    >
      <OcrBody
        tool={tool}
        outputMode={outputMode}
        setOutputMode={setOutputMode}
      />
    </WorkerPanelShell>
  );
}

/** The browser's pick, read once per page — the server has no `navigator`. */
let browserPick: OcrLanguage[] | null | undefined;
function readBrowserPick(): OcrLanguage[] | null {
  if (browserPick !== undefined) return browserPick;
  let tags: readonly string[] = [];
  try {
    tags = navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
  } catch {
    tags = [];
  }
  const langs = ocrLanguagesFromBrowser(tags);
  // English alone is the default already; there is nothing to explain.
  browserPick =
    langs.length > 1 || langs[0] !== DEFAULT_OCR_LANGUAGE ? langs : null;
  return browserPick;
}
const noSubscription = () => () => {};

/**
 * `navigator.languages ∩ OCR_LANGUAGES` (spec D.7) — `null` on the server and
 * through hydration (its snapshot), then the browser's answer, so the HTML
 * and the first client render agree.
 */
function useBrowserLanguages(): OcrLanguage[] | null {
  return useSyncExternalStore(noSubscription, readBrowserPick, () => null);
}

function OcrBody({
  tool,
  outputMode,
  setOutputMode,
}: {
  tool: Tool;
  outputMode: OcrOutputMode;
  setOutputMode: (mode: OcrOutputMode) => void;
}) {
  const { status } = useWorkerPanel();
  // The reader's own picks, once they make one; until then the browser's.
  const [chosen, setChosen] = useState<OcrLanguage[] | null>(null);
  const fromBrowser = useBrowserLanguages();
  const languages = useMemo(
    () => chosen ?? fromBrowser ?? [DEFAULT_OCR_LANGUAGE],
    [chosen, fromBrowser],
  );
  const setLanguages = setChosen;
  const [redoOcr, setRedoOcr] = useState(false);

  // The packs the worker reports it actually has. Until 2026-09-27 the menu
  // rendered the static catalogue whatever the status said — the heartbeat's
  // report reached the status payload and stopped there, while the FAQ told
  // search results the page reflects it. With no report to read (status still
  // loading, unreachable, or OCR not available) there is nothing to narrow
  // by, so the catalogue stands.
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
    [selected, setLanguages],
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
  const browserChose = chosen === null && fromBrowser !== null;

  // The file comes first, then what to recognise in it, then Run: a
  // visitor meets the drop area at the top of the panel (owner,
  // 2026-10-23). Until then the settings stood above it, and the drop
  // area started below a 1440 x 900 screen.
  const settings = (
    <div className="bg-panel border-line rounded-panel flex flex-col gap-4 border p-4 sm:p-5">
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
          Select every language printed on the page — a page that mixes Bengali
          with English technical terms needs both. The wrong language does not
          produce an error, it produces plausible-looking gibberish.
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
                  "rounded-tag inline-flex items-center gap-1.5 border px-3 py-1.5 text-xs font-medium transition aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
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
        {browserChose && (
          <p className="text-muted text-xs leading-relaxed" data-ocr-reason="">
            Chosen from your browser&apos;s languages. Change them if the page
            is printed in others.
          </p>
        )}
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
                  "rounded-tag inline-flex items-center gap-1.5 border px-3 py-1.5 text-xs font-medium transition",
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
          {OCR_OUTPUT_MODES.find((mode) => mode.id === outputMode)?.description}
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
          className="border-line-strong bg-wash accent-accent rounded-ctl mt-0.5 size-4"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-fg font-medium">Redo existing OCR</span>
          <span className="text-muted text-xs leading-relaxed">
            Pages that already have text keep it, and only the pages without
            text are recognized. Turn this on when a PDF&apos;s existing OCR
            text is poor: that text is removed and those pages are recognized
            again. Text typed into the document is kept either way. PDFs only.
          </span>
        </span>
      </label>

      <p className="border-line bg-wash text-muted rounded-ctl border px-3 py-2 text-xs">
        <span className="text-muted font-medium">This request:</span>{" "}
        {describeOcrRequest(request)}
        {redoOcr ? " · redo existing OCR" : ""}
      </p>
    </div>
  );

  return (
    <OcrRunArea
      tool={tool}
      request={request}
      refuse={(file) => pickRefusal(tool, file)}
      runnable={runnable}
      settings={settings}
    />
  );
}

const RUN_LABEL = "Run OCR on the worker";

/**
 * The drop zone, the run and the result. The drop zone takes a file from the
 * first paint; Run drives the real, documented job flow via
 * {@link runWorkerOcr} only once the status endpoint honestly reports OCR
 * available. Every result here is real output downloaded from the worker,
 * never fabricated.
 */
function OcrRunArea({
  tool,
  request,
  refuse,
  runnable,
  settings,
}: {
  tool: Tool;
  request: OcrOptions;
  refuse: PickRefusal;
  /** False when the request names a language the worker reports it lacks. */
  runnable: boolean;
  /** The recognition settings, drawn between the file and Run. */
  settings: ReactNode;
}) {
  const { available, status } = useWorkerPanel();
  const [file, setFile] = useState<File | null>(null);
  // How many files a drop brought beyond the one OCR reads. A drop bypasses
  // `multiple={false}`, so without this the rest vanished without a word.
  const [discarded, setDiscarded] = useState(0);
  const job = useWorkerJob<OcrWorkerResult>({
    tool: "ocr-pdf",
    resume: (id, controls) => resumeWorkerOcr(id, controls),
  });
  const { busy, outcome, setOutcome, run } = job;
  const staged = useStagedHandoff(tool.slug, RUN_LABEL, (files) => {
    setOutcome(null);
    setDiscarded(0);
    setFile(files[0] ?? null);
  });

  const start = useCallback(async () => {
    if (!file || !available) return;
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
  }, [file, request, run, available]);

  return (
    <div className="flex flex-col gap-3">
      {staged}
      {file ? (
        <ChosenFileTarget
          file={file}
          accept="application/pdf,image/jpeg,image/png"
          busy={busy}
          refuse={refuse}
          onReplace={(files) => {
            setOutcome(null);
            setFile(files[0] ?? null);
            setDiscarded(Math.max(0, files.length - OCR_MAX_INPUT_FILES));
          }}
        >
          <div className="border-line bg-wash text-fg rounded-ctl flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-sm">
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
        </ChosenFileTarget>
      ) : (
        <Dropzone
          pageTarget
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

      {settings}

      {available && !runnable && (
        <p className="text-warn text-xs leading-relaxed">
          This worker reports no recognition pack for the selected language, so
          OCR can&apos;t run here right now.
        </p>
      )}

      <WorkerGate
        reserve={STATUS_SLOT}
        job={job}
        bytes={file?.size}
        run={(ready) => (
          <WorkerRunButton
            onClick={start}
            busy={busy}
            disabled={!ready || !file || !runnable}
            busyLabel={jobBusyLabel(job.phase, "Recognizing on the worker…")}
            icon={ScanText}
          >
            {RUN_LABEL}
          </WorkerRunButton>
        )}
        jobStatus={<WorkerJobStatus job={job} />}
        note={
          <p className="text-info flex items-start gap-1.5 text-xs leading-relaxed">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {status?.localDevOnly
              ? "This runs on your local-dev worker — the file is processed in-process on this machine, not sent to any third party."
              : `Your file uploads only when you press ${RUN_LABEL}. The secure worker recognizes text and then deletes the input.`}
          </p>
        }
        off={
          <>
            <p className="text-warn text-sm leading-relaxed">
              {status?.ocr.detail ??
                "OCR isn't enabled in this environment. No file is uploaded."}
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
          announce={`OCR complete — ${outcome.artifacts.length} file${outcome.artifacts.length === 1 ? "" : "s"} ready.`}
          output={outcome.artifacts.map((entry) =>
            workerOutput(entry.bytes, entry.artifact),
          )}
          inputBytes={file?.size}
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
    <div className="border-line bg-wash rounded-ctl mt-1 flex flex-col gap-1 border p-3">
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
        <p className="border-warn/40 bg-warn/10 text-warn rounded-panel mt-1 border px-2.5 py-2 text-xs leading-relaxed">
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
