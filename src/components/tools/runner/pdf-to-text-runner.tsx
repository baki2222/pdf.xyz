"use client";

import { Download, FileText, Search, ShieldCheck } from "lucide-react";
import { extractPdfText, textOutputName, type ExtractedPdfText } from "@/lib/pdf/text";
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
            <div className="max-h-72 overflow-auto rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-slate-200 whitespace-pre-wrap">
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
              Download TXT ({formatBytes(new TextEncoder().encode(result.text).byteLength)})
            </button>
          </div>
        ) : (
          <p className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-100">
            This PDF does not contain selectable text. Use OCR PDF when OCR is enabled
            to recognize text from scanned pages or photos.
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
        aside={<span className="text-xs text-slate-400">{pdf.pageCount} page{pdf.pageCount === 1 ? "" : "s"}</span>}
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
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
        <Icon className="size-4 text-violet-300" aria-hidden />
        {title}
      </div>
      <p className="text-xs leading-relaxed text-slate-400">{body}</p>
    </div>
  );
}
