"use client";

import { useMemo, useState } from "react";
import { Download, PanelTop } from "lucide-react";
import {
  addHeaderFooter,
  headerFooterOutputName,
  type HeaderFooterZone,
} from "@/lib/pdf/header-footer";
import { applyTokens, type HAlign } from "@/lib/pdf/stamp";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  useAsyncRun,
} from "./runner-kit";
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

/** A single locale date string for the whole run — computed once on submit. */
function today(): string {
  try {
    return new Date().toLocaleDateString();
  } catch {
    return "";
  }
}

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

function HeaderFooterEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const [headerText, setHeaderText] = useState("");
  const [headerAlign, setHeaderAlign] = useState<HAlign>("center");
  const [footerText, setFooterText] = useState("Page {n} of {total}");
  const [footerAlign, setFooterAlign] = useState<HAlign>("center");
  const { busy, error, result, run } = useAsyncRun<Uint8Array>();

  const sampleTokens = useMemo(
    () => ({ n: 1, total: pdf.pageCount, date: today() }),
    [pdf.pageCount],
  );
  const headerPreview = applyTokens(headerText, sampleTokens);
  const footerPreview = applyTokens(footerText, sampleTokens);

  const hasContent =
    headerText.trim().length > 0 || footerText.trim().length > 0;

  const onRun = () => {
    const header: HeaderFooterZone | undefined = headerText.trim()
      ? { [headerAlign]: headerText }
      : undefined;
    const footer: HeaderFooterZone | undefined = footerText.trim()
      ? { [footerAlign]: footerText }
      : undefined;
    return run(() =>
      addHeaderFooter(pdf.bytes, { header, footer, date: today() }),
    );
  };

  if (result) {
    return (
      <ResultPanel
        title="Header & footer added"
        summary={`Applied to all ${pdf.pageCount} page${pdf.pageCount === 1 ? "" : "s"} · ${formatBytes(result.byteLength)}`}
        onReset={onReset}
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
            <span className="border-line bg-wash text-muted rounded-full border px-2.5 py-1 text-xs">
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
            <span className="border-line bg-wash text-muted rounded-full border px-2.5 py-1 text-xs">
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

      <div className="flex justify-end">
        <RunButton
          onClick={onRun}
          busy={busy}
          disabled={!hasContent}
          busyLabel="Applying…"
        >
          <PanelTop className="size-4" aria-hidden />
          Add header &amp; footer
        </RunButton>
      </div>
    </div>
  );
}
