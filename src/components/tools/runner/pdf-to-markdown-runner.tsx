"use client";

import { Download, FileText, FileCode2, ShieldCheck, ScanText } from "lucide-react";
import { downloadBlob } from "@/lib/pdf/browser";
import { extractPdfText } from "@/lib/pdf/text";
import {
  extractedTextToMarkdown,
  markdownOutputName,
  type PdfToMarkdownResult,
} from "@/lib/pdf/pdf-to-markdown";
import { buttonVariants } from "@/components/ui/button";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  useAsyncRun,
} from "./runner-kit";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import type { LoadedPdf } from "./use-single-pdf";

export function PdfToMarkdownRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · converts selectable text to Markdown locally in your browser"
      handoffSlug="pdf-to-markdown"
      toolName="PDF to Markdown"
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
  const { busy, error, result, run } = useAsyncRun<PdfToMarkdownResult>();
  const onRun = () =>
    run(async () => {
      const extracted = await extractPdfText(pdf.bytes);
      return extractedTextToMarkdown(extracted, { sourceName: pdf.file.name });
    });

  if (result) {
    const filename = markdownOutputName(pdf.file.name);
    return (
      <ResultPanel
        title={result.hasMarkdown ? "Markdown created" : "No selectable text found"}
        summary={
          result.hasMarkdown
            ? `${result.characterCount.toLocaleString()} Markdown characters from ${result.pageCount} page${result.pageCount === 1 ? "" : "s"}`
            : "Scanned/image-only PDFs need OCR before text can be converted to Markdown."
        }
        onReset={onReset}
      >
        {result.hasMarkdown ? (
          <div className="flex flex-col gap-4">
            <div className="max-h-72 overflow-auto rounded-2xl border border-white/10 bg-black/20 p-4 font-mono text-sm leading-6 text-slate-200 whitespace-pre-wrap">
              {result.markdown}
            </div>
            <button
              type="button"
              onClick={() =>
                downloadBlob(
                  new Blob([result.markdown], { type: "text/markdown;charset=utf-8" }),
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
          <p className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-100">
            This PDF does not contain selectable text. Use OCR PDF first for scanned
            pages, or Extract Tables for table-heavy documents when AI table extraction is enabled.
          </p>
        )}
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="Convert selectable text to Markdown"
        aside={<span className="text-xs text-slate-400">{pdf.pageCount} page{pdf.pageCount === 1 ? "" : "s"}</span>}
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
            body="Creates page headings, paragraphs, and preserves obvious list lines."
          />
          <InfoTile
            icon={ScanText}
            title="Honest scope"
            body="It converts embedded selectable text, not scanned images or AI-detected tables."
          />
        </div>
      </RunnerSection>

      {error && <ErrorNote message={error} />}

      <div className="flex justify-end">
        <RunButton onClick={onRun} busy={busy} busyLabel="Creating Markdown…">
          <FileText className="size-4" aria-hidden />
          Create Markdown
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
