"use client";

import { RunReason } from "@/components/tools/runner/run-reason";
import { useEffect, useMemo, useState } from "react";
import { Download, PanelTop } from "lucide-react";
import {
  addHeaderFooter,
  headerFooterOutputName,
  headerFooterPlan,
  NO_PAGE_STAMPED,
  resolveStampDate,
  stampDateCandidates,
  type HeaderFooterZone,
} from "@/lib/pdf/header-footer";
import { applyTokens, type HAlign } from "@/lib/pdf/stamp";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { recallOptions, rememberOptions } from "@/lib/intent/option-memory";
import { formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  outputFile,
  useAsyncRun,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import {
  CheckboxField,
  MoreOptions,
  NumberField,
  PrivacyLine,
  SegmentedControl,
  TextField,
  TokenButtons,
} from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

/** Exported so the tool page steps can be pinned to what the picker offers. */
export const ALIGN_OPTIONS: { value: HAlign; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

/** The token buttons — exported so the page's Fields fact is pinned to them. */
export const TOKENS = [
  { token: "{n}", label: "{n}" },
  { token: "{total}", label: "{total}" },
  { token: "{date}", label: "{date}" },
];

export function HeaderFooterRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · header & footer applied locally in your browser"
      handoffSlug="header-footer"
      toolName="PDF Header & Footer"
    >
      {(pdf, reset) => <HeaderFooterEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

export function HeaderFooterEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const [headerText, setHeaderText] = useState("");
  // The last alignments chosen here, never the words (option memory).
  const [kept] = useState(() => recallOptions("header-footer"));
  const [headerAlign, setHeaderAlign] = useState<HAlign>(
    kept.headerAlign ?? "center",
  );
  const [footerText, setFooterText] = useState("Page {n} of {total}");
  const [footerAlign, setFooterAlign] = useState<HAlign>(
    kept.footerAlign ?? "center",
  );
  // Which pages get the bands. Like Page Numbers' Start on page and First
  // number, these belong to ONE document and are never remembered (audit #28).
  const [pagesOpen, setPagesOpen] = useState(false);
  const [startPage, setStartPage] = useState(1);
  const [startAt, setStartAt] = useState(1);
  const [skipCover, setSkipCover] = useState(false);
  const [skipLast, setSkipLast] = useState(0);
  const { busy, error, result, run, reset } = useAsyncRun<Uint8Array>();

  // The engine's own arithmetic, so the preview, the summary and the Run gate
  // cannot disagree with what is drawn.
  const plan = useMemo(
    () =>
      headerFooterPlan(pdf.pageCount, {
        startPage,
        startAt,
        skipCover,
        skipLast,
      }),
    [pdf.pageCount, startPage, startAt, skipCover, skipLast],
  );
  const stampedCount = plan.stamps.length;

  // `{date}` in the reader's own locale format when a face we ship can draw it
  // beside what they typed, else the same day in Latin digits, else ISO. The
  // preview shows the value Run will stamp — it used to show an Arabic-Indic
  // date that Run then refused (see resolveStampDate).
  const [date, setDate] = useState(() => stampDateCandidates()[0] ?? "");
  useEffect(() => {
    let live = true;
    resolveStampDate([headerText, footerText])
      .then((resolved) => {
        if (live) setDate(resolved);
      })
      .catch(() => {
        // Coverage tables failed to load: keep the current value; Run resolves
        // again and reports any real failure through the engine's own error.
      });
    return () => {
      live = false;
    };
  }, [headerText, footerText]);

  // The preview reads as the FIRST page that gets the bands.
  const sampleTokens = useMemo(
    () => ({ n: plan.stamps[0]?.n ?? startAt, total: plan.total, date }),
    [plan, startAt, date],
  );
  const headerPreview = applyTokens(headerText, sampleTokens);
  const footerPreview = applyTokens(footerText, sampleTokens);

  const hasContent =
    headerText.trim().length > 0 || footerText.trim().length > 0;

  const onRun = () => {
    rememberOptions("header-footer", { headerAlign, footerAlign });
    const header: HeaderFooterZone | undefined = headerText.trim()
      ? { [headerAlign]: headerText }
      : undefined;
    const footer: HeaderFooterZone | undefined = footerText.trim()
      ? { [footerAlign]: footerText }
      : undefined;
    return run(async () =>
      addHeaderFooter(pdf.bytes, {
        header,
        footer,
        startPage,
        startAt,
        skipCover,
        skipLast,
        date: await resolveStampDate([headerText, footerText]),
      }),
    );
  };

  if (result) {
    return (
      <ResultPanel
        title="Header & footer added"
        summary={`${
          stampedCount === pdf.pageCount
            ? `Applied to all ${pdf.pageCount} page${pdf.pageCount === 1 ? "" : "s"}`
            : `Applied to ${stampedCount} of ${pdf.pageCount} pages`
        } · ${formatBytes(result.byteLength)}`}
        onReset={onReset}
        output={outputFile(result, headerFooterOutputName(pdf.file.name))}
        onAdjust={reset}
        expectedPages={pdf.pageCount}
      >
        <button
          type="button"
          onClick={() =>
            downloadBytes(result, headerFooterOutputName(pdf.file.name))
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download PDF
        </button>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="Header"
        aside={
          headerPreview.trim() && (
            <span className="border-line bg-wash text-muted rounded-tag border px-2.5 py-1 text-xs">
              {headerPreview}
            </span>
          )
        }
      >
        <div className="flex flex-col gap-3">
          <TextField
            label="Header text"
            value={headerText}
            onChange={setHeaderText}
            placeholder="e.g. Acme Corporation — Confidential"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              label="Header alignment"
              value={headerAlign}
              onChange={setHeaderAlign}
              options={ALIGN_OPTIONS}
            />
            <TokenButtons
              tokens={TOKENS}
              onInsert={(token) => setHeaderText((prev) => prev + token)}
            />
          </div>
        </div>
      </RunnerSection>

      <RunnerSection
        title="Footer"
        aside={
          footerPreview.trim() && (
            <span className="border-line bg-wash text-muted rounded-tag border px-2.5 py-1 text-xs">
              {footerPreview}
            </span>
          )
        }
      >
        <div className="flex flex-col gap-3">
          <TextField
            label="Footer text"
            value={footerText}
            onChange={setFooterText}
            placeholder="e.g. Page {n} of {total}"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              label="Footer alignment"
              value={footerAlign}
              onChange={setFooterAlign}
              options={ALIGN_OPTIONS}
            />
            <TokenButtons
              tokens={TOKENS}
              onInsert={(token) => setFooterText((prev) => prev + token)}
            />
          </div>
        </div>
      </RunnerSection>

      <MoreOptions label="Pages" open={pagesOpen} onToggle={setPagesOpen}>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Start on page"
              value={startPage}
              min={1}
              max={Math.max(1, pdf.pageCount)}
              onChange={setStartPage}
            />
            <NumberField
              label="First number"
              value={startAt}
              min={0}
              max={99999}
              onChange={setStartAt}
            />
          </div>
          <CheckboxField
            label="Leave the cover page blank"
            checked={skipCover}
            onChange={setSkipCover}
            hint="Page 1 gets no header or footer but is still counted, so page 2 shows {n} as 2."
          />
          <div className="max-w-52">
            <NumberField
              label="Skip last pages"
              value={skipLast}
              min={0}
              max={Math.max(0, pdf.pageCount - 1)}
              onChange={setSkipLast}
            />
          </div>
        </div>
      </MoreOptions>

      <PrivacyLine>
        Headers and footers are drawn on your device — nothing is uploaded.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunReason
            reason={
              !hasContent
                ? "Type a header or a footer first."
                : stampedCount === 0
                  ? NO_PAGE_STAMPED
                  : null
            }
          >
            {(describedBy) => (
              <RunButton
                onClick={onRun}
                busy={busy}
                describedBy={describedBy}
                disabled={!hasContent || stampedCount === 0}
                busyLabel="Applying…"
              >
                <PanelTop className="size-4" aria-hidden />
                Add header &amp; footer
              </RunButton>
            )}
          </RunReason>
        </div>
      </RunBar>
    </div>
  );
}
