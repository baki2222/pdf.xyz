"use client";

import { RunReason } from "@/components/tools/runner/run-reason";
import { useEffect, useMemo, useState } from "react";
import { Download, PanelTop } from "lucide-react";
import {
  addHeaderFooter,
  headerFooterOutputName,
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
  const { busy, error, result, run, reset } = useAsyncRun<Uint8Array>();

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

  const sampleTokens = useMemo(
    () => ({ n: 1, total: pdf.pageCount, date }),
    [pdf.pageCount, date],
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
        date: await resolveStampDate([headerText, footerText]),
      }),
    );
  };

  if (result) {
    return (
      <ResultPanel
        title="Header & footer added"
        summary={`Applied to all ${pdf.pageCount} page${pdf.pageCount === 1 ? "" : "s"} · ${formatBytes(result.byteLength)}`}
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

      <PrivacyLine>
        Headers and footers are drawn on your device — nothing is uploaded.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunReason
            reason={!hasContent ? "Type a header or a footer first." : null}
          >
            {(describedBy) => (
              <RunButton
                onClick={onRun}
                busy={busy}
                describedBy={describedBy}
                disabled={!hasContent}
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
