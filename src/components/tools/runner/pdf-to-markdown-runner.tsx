"use client";

import { useState } from "react";
import {
  Download,
  FileText,
  FileCode2,
  ShieldCheck,
  ScanText,
} from "lucide-react";
import { downloadBlob } from "@/lib/pdf/browser";
import {
  DEFAULT_PAGE_HEADINGS,
  DEFAULT_REMOVE_REPEATED_LINES,
  markdownOutputName,
  markdownSummary,
  type PdfToMarkdownResult,
} from "@/lib/pdf/pdf-to-markdown";
import {
  PAGE_HEADINGS_HINT,
  REPEATED_LINES_HINT,
} from "@/lib/tools/pdf-to-markdown-options";
import { pdfToMarkdown } from "@/lib/pdf/pdf-to-markdown-read";
import { buttonVariants } from "@/components/ui/button";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  useAsyncRun,
  NO_OUTPUT,
  textOutputFile,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import type { LoadedPdf } from "./use-single-pdf";
import { NoSelectableTextNote } from "./no-text-note";

export function PdfToMarkdownRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · converts selectable text to Markdown locally in your browser"
      handoffSlug="pdf-to-markdown"
      toolName="PDF to Markdown"
      writesPdf={false}
      reader="pdfjs"
    >
      {(pdf, reset) => <PdfToMarkdownEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

function PdfToMarkdownEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const { busy, error, result, run, reset } =
    useAsyncRun<PdfToMarkdownResult>();
  const [removeRepeatedLines, setRemoveRepeatedLines] = useState(
    DEFAULT_REMOVE_REPEATED_LINES,
  );
  const [pageHeadings, setPageHeadings] = useState(DEFAULT_PAGE_HEADINGS);
  const onRun = () =>
    run(() =>
      pdfToMarkdown(pdf.bytes, {
        sourceName: pdf.file.name,
        removeRepeatedLines,
        includePageHeadings: pageHeadings,
      }),
    );

  if (result) {
    const filename = markdownOutputName(pdf.file.name);
    return (
      <ResultPanel
        title={
          result.hasMarkdown ? "Markdown created" : "No selectable text found"
        }
        summary={
          result.hasMarkdown
            ? markdownSummary(result)
            : "Scanned/image-only PDFs need OCR before text can be converted to Markdown."
        }
        onReset={onReset}
        tone={result.hasMarkdown ? "ok" : "warn"}
        output={
          result.hasMarkdown
            ? textOutputFile(
                result,
                result.markdown,
                filename,
                "text/markdown;charset=utf-8",
              )
            : NO_OUTPUT("no selectable text, so no Markdown was written")
        }
        onAdjust={reset}
      >
        {result.hasMarkdown ? (
          <div className="flex flex-col gap-4">
            <div className="border-line text-fg bg-canvas rounded-panel max-h-72 overflow-auto border p-4 font-mono text-sm leading-6 whitespace-pre-wrap">
              {result.markdown}
            </div>
            <button
              type="button"
              onClick={() =>
                downloadBlob(
                  new Blob([result.markdown], {
                    type: "text/markdown;charset=utf-8",
                  }),
                  filename,
                )
              }
              className={buttonVariants({ variant: "primary", size: "lg" })}
            >
              <Download className="size-4" aria-hidden />
              Download MD
            </button>
          </div>
        ) : (
          // No `extra`: it once suggested Extract Tables "when AI table
          // extraction is enabled". That tool is not AI (pdftotext word
          // positions) and needs selectable text too, so it cannot help a
          // PDF that reached this note (removed 2026-10-31).
          <NoSelectableTextNote />
        )}
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="Convert selectable text to Markdown"
        aside={
          <span className="text-muted text-xs">
            {pdf.pageCount} page{pdf.pageCount === 1 ? "" : "s"}
          </span>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <InfoTile
            icon={ShieldCheck}
            title="Private"
            body="Runs locally in your browser — the PDF is not uploaded."
          />
          <InfoTile
            icon={FileCode2}
            title="Clean Markdown"
            body="Writes headings, paragraphs and list lines, with tables and web links where the PDF has them."
          />
          <InfoTile
            icon={ScanText}
            title="Honest scope"
            body="It converts embedded selectable text, not scanned images. Tables are found by how their words line up, not by AI."
          />
        </div>
      </RunnerSection>

      <RunnerSection title="Options">
        {pdf.pageCount > 1 && (
          <label className="text-muted flex min-h-11 items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={pageHeadings}
              onChange={(event) => {
                if (!busy) setPageHeadings(event.target.checked);
              }}
              aria-disabled={busy || undefined}
              className="border-line-strong bg-wash accent-accent rounded-ctl mt-0.5 size-4"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-fg font-medium">
                Start each page with a Page heading
              </span>
              <span className="text-muted text-xs leading-relaxed">
                {PAGE_HEADINGS_HINT}
              </span>
            </span>
          </label>
        )}
        <label className="text-muted flex min-h-11 items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={removeRepeatedLines}
            // readOnly-style guard rather than `disabled`: a disabled input
            // drops focus mid-run (the #46 rule).
            onChange={(event) => {
              if (!busy) setRemoveRepeatedLines(event.target.checked);
            }}
            aria-disabled={busy || undefined}
            className="border-line-strong bg-wash accent-accent rounded-ctl mt-0.5 size-4"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-fg font-medium">
              Leave out repeated headers and footers
            </span>
            <span className="text-muted text-xs leading-relaxed">
              {REPEATED_LINES_HINT}
            </span>
          </span>
        </label>
      </RunnerSection>

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunButton onClick={onRun} busy={busy} busyLabel="Creating Markdown…">
            <FileText className="size-4" aria-hidden />
            Create Markdown
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}

function InfoTile({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof FileText;
  title: string;
  body: string;
}) {
  return (
    <div className="border-line bg-wash rounded-panel border p-4">
      <div className="text-fg mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-accent size-4" aria-hidden />
        {title}
      </div>
      <p className="text-muted text-xs leading-relaxed">{body}</p>
    </div>
  );
}
