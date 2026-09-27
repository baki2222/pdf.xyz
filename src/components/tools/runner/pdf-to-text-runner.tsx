"use client";

import { Download, FileText, Search, ShieldCheck } from "lucide-react";
import {
  extractPdfText,
  textOutputName,
  type ExtractedPdfText,
} from "@/lib/pdf/text";
import { downloadBlob } from "@/lib/pdf/browser";
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
import type { LoadedPdf } from "./use-single-pdf";

export function PdfToTextRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · extracts selectable text locally in your browser"
      handoffSlug="pdf-to-text"
      toolName="PDF to Text"
      writesPdf={false}
    >
      {(pdf, reset) => <PdfToTextEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

function PdfToTextEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const { busy, error, result, run } = useAsyncRun<ExtractedPdfText>();
  const onRun = () => run(() => extractPdfText(pdf.bytes));

  if (result) {
    const filename = textOutputName(pdf.file.name);
    return (
      <ResultPanel
        title={result.hasText ? "Text extracted" : "No selectable text found"}
        summary={
          result.hasText
            ? `${result.characterCount.toLocaleString()} characters from ${result.pageCount} page${result.pageCount === 1 ? "" : "s"}`
            : `Scanned/image-only PDFs need OCR. This browser tool only extracts embedded selectable text.`
        }
        onReset={onReset}
      >
        {result.hasText ? (
          <div className="flex flex-col gap-4">
            <div className="border-line text-fg max-h-72 overflow-auto rounded-[4px] border bg-black/20 p-4 text-sm leading-6 whitespace-pre-wrap">
              {result.text}
            </div>
            <button
              type="button"
              onClick={() =>
                downloadBlob(
                  new Blob([result.text], { type: "text/plain;charset=utf-8" }),
                  filename,
                )
              }
              className={buttonVariants({ variant: "primary", size: "lg" })}
            >
              <Download className="size-4" aria-hidden />
              Download TXT (
              {formatBytes(new TextEncoder().encode(result.text).byteLength)})
            </button>
          </div>
        ) : (
          <p className="border-warn/40 bg-warn/10 text-warn rounded-[4px] border p-4 text-sm leading-relaxed">
            This PDF does not contain selectable text. Use OCR PDF when OCR is
            enabled to recognize text from scanned pages or photos.
          </p>
        )}
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="Extract text"
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
            body="Runs locally in your browser — the file is not uploaded."
          />
          <InfoTile
            icon={FileText}
            title="Selectable text"
            body="Extracts embedded text exactly; scanned pages need OCR."
          />
          <InfoTile
            icon={Search}
            title="Plain TXT"
            body="Preview text here, then download a clean .txt file."
          />
        </div>
      </RunnerSection>

      {error && <ErrorNote message={error} />}

      <div className="flex justify-end">
        <RunButton onClick={onRun} busy={busy} busyLabel="Extracting text…">
          <FileText className="size-4" aria-hidden />
          Extract text
        </RunButton>
      </div>
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
    <div className="border-line bg-wash rounded-[4px] border p-4">
      <div className="text-fg mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-accent size-4" aria-hidden />
        {title}
      </div>
      <p className="text-muted text-xs leading-relaxed">{body}</p>
    </div>
  );
}
