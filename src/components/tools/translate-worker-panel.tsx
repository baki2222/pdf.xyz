"use client";

import { usePickRefusal } from "@/components/tools/use-pick";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Download,
  Languages,
  ShieldCheck,
  Sparkles,
  Timer,
} from "lucide-react";
import { DEFAULT_RETENTION, JOB_LIMITS, type Job } from "@/lib/jobs/types";
import {
  DEFAULT_TRANSLATE_SOURCE,
  LANGUAGE_NAMES,
  MAX_TRANSLATE_INSTRUCTIONS_CHARS,
  TRANSLATE_LANGUAGES,
  TRANSLATE_SOURCE_AUTO,
  translateSameLanguageMessage,
  type TranslateLanguage,
  type TranslateSourceLanguage,
} from "@/lib/jobs/translate-pdf";
import {
  aiDailyAllowanceNote,
  aiToolUnavailableDetail,
} from "@/lib/workers/ai-tool-availability";
import {
  canRunTranslate,
  canTranslateScans,
  resumeWorkerTranslate,
  runWorkerTranslate,
  translateOcrJobPoll,
  translatesToPdf,
  translateTextDeps,
  type TranslateWorkerResult,
} from "@/lib/workers/translate-client";
import type { TranslatePdfReason } from "@/lib/jobs/translate-pdf-render";
import { useWorkerStatus } from "./use-worker-status";
import {
  MAX_OCR_LANGUAGES,
  PDF_TO_WORD_OCR_LANGUAGE_CODES,
  type OcrLanguage,
} from "@/lib/jobs/ocr";
import {
  TRANSLATE_OCR_CHARGE,
  TRANSLATE_OCR_EXPLAINER,
  TRANSLATE_OCR_SCOPE,
  TRANSLATE_SCAN_CHECK,
  translateOcrSourceNotInstalled,
  translateOcrSourceNotOffered,
  translateOcrSourceNotSelected,
  translateSourceOcrPack,
} from "@/lib/jobs/translate-ocr";
// STATIC, NOT LAZY — decided 2026-11-09 on a review finding. The picker's
// module (it also holds `useOcrLanguageChoice`, which `start` needs for the
// languages it sends) weighed 2,742 B raw / 1,320 B gzip -9 inside this
// panel's own lazy chunk, which only /tools/translate-pdf loads; the BCP-47
// map 770 / 490. Splitting the UI out would save under 1.3 KB on that one
// page and add a round trip after the scan check (the lazy-chunk waterfall).
import {
  OcrLanguagePicker,
  useOcrLanguageChoice,
  type OcrLanguageChoice,
} from "./ocr-language-picker";
import { downloadBytes } from "@/lib/pdf/browser";
import { PdfEngineError } from "@/lib/pdf/engine";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import {
  scriptOnlyLanguage,
  translateAutoSameLanguageWarning,
} from "@/lib/jobs/translate-script";
import {
  declareTranslateRun,
  translatePreflight,
} from "@/lib/workers/translate/preflight";
import {
  TRANSLATE_MAX_INPUT_CHARS,
  TRANSLATE_NO_TEXT_MESSAGE,
} from "@/lib/jobs/translate-limits";
import {
  TRANSLATE_PAGES_UNCONFIRMED_MESSAGE,
  translateSelectionSentence,
} from "@/lib/jobs/translate-pages";
import { selectionConfirmed } from "@/lib/jobs/selection-echo";
import type { PageSpan } from "@/lib/pdf/page-spans";
import { TruncationNotice } from "./truncation-notice";
import { DeliveryNotice, deliverySummary } from "./delivery-notice";
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
import { translateJobPoll, type JobPollBudget } from "@/lib/jobs/client-wait";
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
 * on 507b6383), is 660.8px at 360, 452.8px at 640, 514.5px at 1024;
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
 * 28af68e1), is 338/357.5px at 360-390, 225.5/225.5px at 640,
 * 244.5/244.5px at 1024; the larger x1.035, to the half rem.
 */
const STATUS_SLOT = "min-h-[23.5rem] sm:min-h-[15rem] lg:min-h-[16rem]";

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
  const pickRefuse = usePickRefusal(tool);
  // Held HERE, above the shell, because the "You get" row depends on it: a
  // reflowed PDF is described only for a target the running worker proved
  // it prints (`translatePdfLanguages` on its heartbeat, 2026-11-15).
  const [targetLanguage, setTargetLanguage] =
    useState<TranslateLanguage>(DEFAULT_TARGET);
  const { status } = useWorkerStatus();
  return (
    <WorkerPanelShell
      tool={tool}
      tone="accent"
      engine={{ label: "AI translation", icon: Sparkles }}
      description={
        <>
          Our server extracts your PDF&apos;s selectable text and asks a
          configured AI model to translate only that text into your target
          language, then returns a translation package — Markdown, plain text,
          and a manifest recording the model and scope. It produces translated
          text (not a layout-preserving PDF). With no AI model configured the
          job fails instead of guessing. A scan with no selectable text is
          recognised on our server first when it can do that, and refused before
          upload when it cannot. The model is instructed to translate only the
          document&apos;s text, but AI output can still be wrong, so check
          important passages against your PDF.
        </>
      }
      canRun={canRunTranslate}
      specRows={[
        {
          icon: Download,
          label: "You get",
          value: translatesToPdf(status, targetLanguage)
            ? TRANSLATE_OUTPUT_WITH_PDF
            : TRANSLATE_OUTPUT_ZIP,
        },
        {
          icon: Timer,
          label: "Your files",
          value: `Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`,
        },
        {
          icon: ShieldCheck,
          label: "Largest file",
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
        refuse={pickRefuse}
        targetLanguage={targetLanguage}
        setTargetLanguage={setTargetLanguage}
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

/** The Pages field's longest entry. */
const MAX_PAGES_TEXT = 200;

/** The "You get" row when the running worker does not print the target. */
export const TRANSLATE_OUTPUT_ZIP =
  "ZIP · translation.md + translation.txt + manifest";
/** The "You get" row when it does (`translatePdfLanguages` names the target). */
export const TRANSLATE_OUTPUT_WITH_PDF =
  "PDF (text reflowed, not the original layout) + ZIP · translation.md + translation.txt + manifest";
/** Said when a job made no PDF it was expected to, or could not draw one. */
export const TRANSLATE_PDF_NOT_DRAWN =
  "The PDF could not be drawn this time; the translation package has the full text.";
/** Said when the job made a PDF this browser could not download. */
export const TRANSLATE_PDF_NOT_DOWNLOADED =
  "The PDF could not be downloaded this time; the translation package has the full text.";

/**
 * Reasons that mean the renderer TRIED and failed. "No renderer" and "an
 * unproven language" are not failures of this job: the panel never offered a
 * PDF for them, so it says nothing — unless it had offered one.
 */
const DRAW_FAILURES: ReadonlySet<TranslatePdfReason> = new Set([
  "render_failed",
  "timeout",
  "too_large",
  "not_conserved",
]);

/**
 * OCR's language choice, preferring the pack of the Source language the
 * reader set (review finding, 2026-11-09: Source = German still recognised
 * the scan as English). The preference ranks above the browser's guess and
 * below the reader's own picks, and applies only while the worker reports
 * that pack installed. Wrapped HERE rather than inside `useOcrLanguageChoice`
 * because that hook is first-load on OCR PDF, whose row had 0.12 KB left and
 * a change there cost it the room (bundle-budget, measured).
 */
function useSourcePreferredOcrChoice(
  base: OcrLanguageChoice,
  preferred: OcrLanguage | null,
): OcrLanguageChoice {
  // The reader's picks made while a preference stood; `base` holds any made
  // before one did, and then keeps them (`pickedFirst`).
  const [own, setOwn] = useState<OcrLanguage[] | null>(null);
  const [pickedFirst, setPickedFirst] = useState(false);
  const usable = preferred && base.installed.has(preferred) ? preferred : null;
  if (pickedFirst || (own === null && usable === null)) {
    return {
      ...base,
      toggle: (code) => {
        setPickedFirst(true);
        base.toggle(code);
      },
    };
  }
  const kept = (own ?? [usable!]).filter((code) => base.installed.has(code));
  const selected = kept.length > 0 ? kept : base.selected;
  return {
    ...base,
    selected,
    browserChose: false,
    toggle: (code) => {
      if (!base.installed.has(code)) return;
      if (selected.includes(code)) {
        if (selected.length > 1)
          setOwn(selected.filter((entry) => entry !== code));
        return;
      }
      if (selected.length < MAX_OCR_LANGUAGES) setOwn([...selected, code]);
    },
  };
}

function TranslateBuilder({
  tool,
  extractText,
  refuse,
  targetLanguage,
  setTargetLanguage,
}: {
  tool: Tool;
  extractText: ExtractText;
  refuse: PickRefusal;
  targetLanguage: TranslateLanguage;
  setTargetLanguage: (target: TranslateLanguage) => void;
}) {
  const { available, status } = useWorkerPanel();
  const [file, setFileState] = useState<File | null>(null);
  /**
   * PAGES (audit #29 slice 6). Offered ONLY while the running worker proves
   * it sends just the chosen pages (`translatePageRange`, the predicate
   * `POST /api/jobs` admits a `pages` job on). Off, nothing new renders and
   * no measure chunk is fetched.
   */
  const pageRangeOffered = status?.translatePageRange === true;
  const [pagesText, setPagesText] = useState("");
  const pagesHelpId = useId();
  // What THIS run sent as pages (null: the whole document), for the rollback
  // check on its result. A job resumed after a reload has none, so it gets no
  // warning: the panel cannot know what was asked.
  const [sentPages, setSentPages] = useState<{
    job: string | null;
    pages: PageSpan[] | null;
  } | null>(null);
  /** Every file change starts again from the whole document. */
  const setFile = useCallback((next: File | null) => {
    setFileState(next);
    setPagesText("");
  }, []);
  /** Whether the panel described a PDF for the target of the last run. */
  const [pdfOffered, setPdfOffered] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState<TranslateSourceLanguage>(
    DEFAULT_TRANSLATE_SOURCE,
  );
  const [instructions, setInstructions] = useState("");
  const job = useWorkerJob<TranslateWorkerResult>({
    tool: "translate-pdf",
    resume: (id, controls) => resumeWorkerTranslate(id, controls),
  });
  const { busy, outcome, setOutcome, run } = job;
  const staged = useStagedHandoff(tool.slug, RUN_LABEL, (files) => {
    setOutcome(null);
    setFile(files[0] ?? null);
  });

  // The parser refuses this pair; blocking it here keeps the PDF from uploading
  // only to be told so, with the same sentence.
  const sameLanguage = sourceLanguage === targetLanguage;
  const canRun = file != null && !busy && !sameLanguage;

  /**
   * The text, extracted ONCE per file and shared: by the script check below,
   * as soon as the file is chosen, and by the preflight when the run starts.
   * A promise, so a quick click shares the parse already under way.
   */
  const extraction = useRef<{
    file: File;
    result: Promise<ExtractedPdfText>;
  } | null>(null);
  const extractionFor = useCallback(
    (chosen: File): Promise<ExtractedPdfText> => {
      if (extraction.current?.file !== chosen) {
        extraction.current = {
          file: chosen,
          result: chosen
            .arrayBuffer()
            .then((buffer) => extractText(new Uint8Array(buffer))),
        };
      }
      return extraction.current.result;
    },
    [extractText],
  );

  // AUTO-DETECT INTO THE DOCUMENT'S OWN LANGUAGE (audit #38). The parser
  // refuses an explicit same-language pair, but the default source is
  // Auto-detect, and a Bengali PDF sent "into Bengali" that way ran, returned
  // a copy of itself and spent the allowance. Some scripts are written by only
  // one of our languages, so the extracted text says so before anything is
  // sent. A warning, not a refusal: Marathi is written in Devanagari too, and
  // Latin script decides nothing at all (see `scriptOnlyLanguage`).
  const [scriptLanguage, setScriptLanguage] = useState<{
    file: File;
    language: TranslateLanguage | null;
    /**
     * The browser found no selectable text on any page — the preflight's own
     * no-text verdict, so this and the refusal at Run cannot disagree.
     */
    scan: boolean;
  } | null>(null);
  useEffect(() => {
    if (!file) return;
    let current = true;
    extractionFor(file).then(
      (extracted) => {
        if (current)
          setScriptLanguage({
            file,
            language: scriptOnlyLanguage(extracted.text),
            scan:
              translatePreflight(extracted, TRANSLATE_MAX_INPUT_CHARS)
                .refusal === TRANSLATE_NO_TEXT_MESSAGE,
          });
      },
      // A PDF that cannot be read is reported when the run starts, in words.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [file, extractionFor]);
  const autoSameLanguage =
    sourceLanguage === TRANSLATE_SOURCE_AUTO &&
    scriptLanguage?.file === file &&
    scriptLanguage.language === targetLanguage;

  /**
   * OCR INSIDE TRANSLATE (audit translate-pdf#3). Offered only while the live
   * status says an observed worker proves it (`translateOcr` and OCR itself):
   * the worker image is published separately from this page, so merged code
   * is not evidence. Otherwise a scan is refused at Run with today's sentence.
   * The languages are PDF to Word's OCR set and picker — the worker validates
   * them with the same parser.
   */
  const ocrOffered = canTranslateScans(status);
  // THE SOURCE LANGUAGE ANSWERS THE OCR QUESTION TOO (review finding,
  // 2026-11-09): Source = German used to recognise the scan as English —
  // fluent nonsense, translated and charged. It preselects the matching
  // pack until the reader picks for themselves, and a mismatch is said in
  // place (`sourceOcrWarning`).
  const sourcePack =
    sourceLanguage === TRANSLATE_SOURCE_AUTO
      ? null
      : translateSourceOcrPack(sourceLanguage);
  const ocrLanguages = useSourcePreferredOcrChoice(
    useOcrLanguageChoice(status, PDF_TO_WORD_OCR_LANGUAGE_CODES),
    sourcePack,
  );
  const sourceOcrWarning = (() => {
    if (sourceLanguage === TRANSLATE_SOURCE_AUTO) return null;
    const name = LANGUAGE_NAMES[sourceLanguage];
    if (!sourcePack) return translateOcrSourceNotOffered(name);
    if (!ocrLanguages.installed.has(sourcePack))
      return translateOcrSourceNotInstalled(name);
    if (!ocrLanguages.selected.includes(sourcePack))
      return translateOcrSourceNotSelected(name);
    return null;
  })();
  const scanDetected = scriptLanguage?.file === file && scriptLanguage.scan;
  const recogniseScan = ocrOffered && scanDetected;

  // THE SECTION IS BROUGHT TO THE READER when it appears for a file (review
  // findings, 2026-11-09). It is inserted above Run — at 375 px it pushed the
  // button about 1,100 px down — so focus moves to its heading, which scrolls
  // it into view and announces it, unless the reader is typing somewhere.
  const ocrHeading = useRef<HTMLParagraphElement>(null);
  const ocrFocusedFor = useRef<File | null>(null);
  useEffect(() => {
    if (!recogniseScan || !file || ocrFocusedFor.current === file) return;
    ocrFocusedFor.current = file;
    const active = document.activeElement;
    const typing =
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement ||
      (active instanceof HTMLInputElement && active.type !== "file");
    if (!typing) ocrHeading.current?.focus();
  }, [recogniseScan, file]);

  const start = useCallback(async () => {
    if (!file || !available) return;
    // A SCAN IS SENT FOR OCR ONLY ONCE ITS SECTION HAS BEEN SHOWN (review
    // finding, 2026-11-09). Run is enabled as soon as the file is listed, and
    // a Run pressed before the scan check drew the section used to send an
    // OCR job with the default languages — a third of the day — while the
    // reader had seen neither the choice nor the price. If the check has not
    // answered yet, this Run answers it; a scan then draws the section (which
    // takes focus) and nothing is sent: the next Run is a deliberate one,
    // with the picker and the charge on screen.
    if (ocrOffered && !recogniseScan && scriptLanguage?.file !== file) {
      let extracted: ExtractedPdfText | null = null;
      try {
        extracted = await extractionFor(file);
      } catch {
        // Reported in words by the run below.
      }
      if (
        extracted &&
        translatePreflight(extracted, TRANSLATE_MAX_INPUT_CHARS).refusal ===
          TRANSLATE_NO_TEXT_MESSAGE
      ) {
        setScriptLanguage({
          file,
          language: scriptOnlyLanguage(extracted.text),
          scan: true,
        });
        return;
      }
    }
    // Read at the press: the section was on screen when Run was pressed.
    const sendOcr = ocrOffered && recogniseScan;
    // What the "You get" row said at the press: a PDF the row promised and
    // the job did not bring back is named, whatever its reason.
    setPdfOffered(translatesToPdf(status, targetLanguage));
    // PAGES ONLY ON THE TEXT PATH: the field is hidden for a detected scan,
    // and the OCR request never carries `pages` (the parser refuses the pair).
    const pagesWanted =
      pageRangeOffered && !sendOcr && !scanDetected && pagesText.trim() !== "";
    await run(async (controls) => {
      const trimmed = instructions.trim();
      setSentPages(null);
      // The measure chunk is requested BEFORE the extraction is awaited, so
      // Run pays one round trip, not two (the lazy-chunk waterfall rule).
      const measure = pagesWanted ? translateTextDeps.measure() : null;
      measure?.catch(() => undefined);
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
        extracted = await extractionFor(file);
      } catch (err) {
        return { ok: false, message: translateFailureMessage(err) };
      }
      // THE CHOSEN PAGES, from the SAME extraction (D14): the page check reads
      // its page count, and everything below (the refusal, the declaration,
      // the wait) reads the selection, so the charge and the worker's walk
      // describe one set of pages. `judged` null: the whole document.
      let judged: {
        pages: PageSpan[] | null;
        selected: ExtractedPdfText;
      } | null = null;
      if (measure) {
        const { judgeTranslatePages } = await measure;
        const answer = judgeTranslatePages(extracted, pagesText);
        if (!answer.ok) return { ok: false, message: answer.message };
        judged = answer;
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
      // The every-page-oversize sentence names its object: "chosen" only
      // for a real selection, so an empty or every-page field keeps today's
      // sentence byte for byte. THE DECLARATION IS ONE FUNCTION, shared with
      // the composed chain that proves "the charge equals the chosen pages"
      // (`declareTranslateRun`): typed here, it was a copy the chain could
      // not see.
      const { plan, refusal, pages, declared } = declareTranslateRun(
        extracted,
        judged,
        TRANSLATE_MAX_INPUT_CHARS,
      );
      // A SCAN, AND THE RUNNING WORKER CAN RECOGNISE IT: send it with an OCR
      // request instead of refusing. It declares no count — the browser found
      // no text to count — so the route charges an undeclared run, and the
      // worker caps the RECOGNISED text at that charge before any provider
      // call. Decided from this run's own extraction AND the section having
      // been shown at the press (`sendOcr`), so a quick click can send
      // neither a typed PDF down this path nor a scan nobody was shown.
      if (refusal === TRANSLATE_NO_TEXT_MESSAGE && sendOcr) {
        return runWorkerTranslate(
          {
            filename: file.name,
            bytes,
            targetLanguage,
            sourceLanguage,
            ...(trimmed ? { instructions: trimmed } : {}),
            ocr: { languages: ocrLanguages.selected },
          },
          {
            ...controls,
            // OCR, then at most the cap's worth of provider calls.
            ...waitOptions(
              translateOcrJobPoll(
                Math.ceil(TRANSLATE_OCR_CHARGE / TRANSLATE_MAX_INPUT_CHARS),
              ),
            ),
          },
        );
      }
      if (refusal !== null) return { ok: false, message: refusal };

      const result = await runWorkerTranslate(
        {
          filename: file.name,
          bytes,
          targetLanguage,
          sourceLanguage,
          ...(trimmed ? { instructions: trimmed } : {}),
          // The counts this panel already extracted (and `pages`, for a
          // selection), declared so the job reserves what it will use instead
          // of a whole per-call ceiling. Required by the client's type rather
          // than optional: the route's fallback is correct and silent, so the
          // one caller that can count must not be able to stop quietly. PAGES
          // WITH TEXT, not the page count: see `declareTranslateRun`.
          ...declared,
        },
        {
          ...controls,
          // One provider call per chunk, one after another: the wait scales
          // with the plan computed above, not a flat two minutes.
          ...waitOptions(translateJobPoll(plan.chunks.length)),
        },
      );
      setSentPages({ job: result.ok ? result.job.jobId : null, pages });
      return result;
    });
  }, [
    file,
    targetLanguage,
    status,
    sourceLanguage,
    instructions,
    extractionFor,
    run,
    available,
    ocrOffered,
    recogniseScan,
    scriptLanguage,
    ocrLanguages.selected,
    pageRangeOffered,
    scanDetected,
    pagesText,
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
            className="border-line bg-wash text-fg focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
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
            className="border-line bg-wash text-fg focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
          >
            <option value={TRANSLATE_SOURCE_AUTO}>Auto-detect</option>
            {TRANSLATE_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_NAMES[code]}
              </option>
            ))}
          </select>
        </label>
        {sameLanguage ? (
          <p className="text-warn text-xs leading-relaxed sm:col-span-2">
            {translateSameLanguageMessage(targetLanguage)}
          </p>
        ) : null}
        {autoSameLanguage ? (
          <p className="text-warn text-xs leading-relaxed sm:col-span-2">
            {translateAutoSameLanguageWarning(targetLanguage)}
          </p>
        ) : null}
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
            className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
          />
        </label>
        {pageRangeOffered && !scanDetected ? (
          <label className="text-muted flex flex-col gap-1 text-xs sm:col-span-2">
            Pages (optional)
            <input
              type="text"
              inputMode="text"
              value={pagesText}
              onChange={(e) =>
                setPagesText(e.target.value.slice(0, MAX_PAGES_TEXT))
              }
              maxLength={MAX_PAGES_TEXT}
              placeholder="e.g. 1-3, 8"
              aria-describedby={pagesHelpId}
              className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
            />
            <span id={pagesHelpId}>Leave empty for the whole document.</span>
          </label>
        ) : null}
      </div>

      {recogniseScan ? (
        <section
          aria-label="Recognise the scan's text first"
          data-translate-ocr=""
          className="border-line rounded-panel flex flex-col gap-3 border p-3"
        >
          <p
            ref={ocrHeading}
            tabIndex={-1}
            className="text-fg text-sm font-medium outline-none"
          >
            Recognise the scan&apos;s text first
          </p>
          <p className="text-muted text-xs leading-relaxed">
            {TRANSLATE_SCAN_CHECK}
          </p>
          <p className="text-muted text-xs leading-relaxed">
            {TRANSLATE_OCR_EXPLAINER}
          </p>
          <p className="text-muted text-xs leading-relaxed">
            {TRANSLATE_OCR_SCOPE}
          </p>
          {sourceOcrWarning ? (
            <p className="text-warn text-xs leading-relaxed">
              {sourceOcrWarning}
            </p>
          ) : null}
          <OcrLanguagePicker choice={ocrLanguages} />
        </section>
      ) : null}

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
              {ocrOffered ? (
                <>
                  Your PDF uploads to a private secure-server job only when you
                  press {RUN_LABEL}. Our server sends only the PDF&apos;s text
                  to a configured AI model — its selectable text, or for a scan
                  the text our server recognised in it — and the model is told
                  to translate only that text. AI output can still be wrong.
                </>
              ) : (
                <>
                  Your PDF uploads to a private secure-server job only when you
                  press {RUN_LABEL}. Our server sends only the PDF&apos;s
                  selectable text to a configured AI model — it does not read
                  scanned images (run OCR first) — and the model is told to
                  translate only that text. AI output can still be wrong.
                </>
              )}
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
              never pretends to produce a translation it cannot actually
              generate.
            </p>
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
          <TranslateSelectionNotice
            job={outcome.job}
            sent={
              sentPages && sentPages.job === outcome.job?.jobId
                ? sentPages.pages
                : null
            }
          />
          <p className="text-ok text-sm">
            {outcome.job?.results?.ai?.delivery
              ? "The pages that were translated are in the package — Markdown and plain text, plus a manifest recording the model and honest scope."
              : "Your AI translation package is ready — the translation in Markdown and plain text, plus a manifest recording the model and honest scope."}
            {outcome.pdf
              ? " The same translation is also a PDF: text reflowed, not the original layout."
              : null}
          </p>
          {pdfNotice(outcome, pdfOffered) ? (
            <p
              className="text-muted text-sm"
              data-testid="translate-pdf-notice"
            >
              {pdfNotice(outcome, pdfOffered)}
            </p>
          ) : null}
          {/* The PDF first, when the job made one: it is what a reader
              asked a "Translate PDF" tool for. The package follows. */}
          {outcome.pdf ? (
            <DownloadCta
              onClick={() =>
                downloadBytes(
                  outcome.pdf!.bytes,
                  outcome.pdf!.artifact.filename,
                )
              }
            >
              Download {outcome.pdf.artifact.filename}
            </DownloadCta>
          ) : null}
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

/**
 * Which pages this job was sent (audit #29 slice 6), from the worker's own
 * record (`translateSelectionSentence`, the function the README, the manifest
 * and translation.md use), or, when this run SENT pages and the result does
 * not confirm exactly those (`selectionConfirmed`), the rollback warning
 * INSTEAD. An image that predates page selection translates the whole
 * document and says nothing false, so silence is the defect this catches.
 * The worker derives its echo from the pages that survived its filter, so a
 * keyed image whose filter did nothing warns here too.
 *
 * The sentence claims only that no other page was SENT, never that every
 * chosen page was translated: a withheld tail or a failed call is reported
 * by the DeliveryNotice and the package, beside it, and both stay true.
 */
export function TranslateSelectionNotice({
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
        <span>{TRANSLATE_PAGES_UNCONFIRMED_MESSAGE}</span>
      </p>
    );
  }
  const sentence = window ? translateSelectionSentence(window) : "";
  if (!sentence) return null;
  return (
    <p role="status" className="text-muted text-sm">
      {sentence}
    </p>
  );
}

/**
 * The one sentence about a PDF that did not arrive, or null. A PDF the job
 * made and this browser could not fetch is said as such; a PDF the renderer
 * failed to draw — or any missing PDF the "You get" row had promised — is
 * "could not be drawn". A target the worker never offered a PDF for says
 * nothing: no PDF was described, so none is missing.
 */
function pdfNotice(
  outcome: Extract<TranslateWorkerResult, { ok: true }>,
  offered: boolean,
): string | null {
  if (outcome.pdf) return null;
  if (outcome.pdfDownloadFailed) return TRANSLATE_PDF_NOT_DOWNLOADED;
  const pdf = outcome.job?.results?.ai?.pdf;
  if (!pdf || pdf.rendered) return offered ? TRANSLATE_PDF_NOT_DRAWN : null;
  if (offered || (pdf.reason !== undefined && DRAW_FAILURES.has(pdf.reason)))
    return TRANSLATE_PDF_NOT_DRAWN;
  return null;
}
