"use client";

import {
  Download,
  FileText,
  FileCode2,
  ShieldCheck,
  ScanText,
} from "lucide-react";
import { downloadBlob } from "@/lib/pdf/browser";
import { extractPdfLines } from "@/lib/pdf/text";
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
  const { busy, error, result, run } = useAsyncRun<PdfToMarkdownResult>();
  const onRun = () =>
    run(async () => {
      const extracted = await extractPdfLines(pdf.bytes);
      return extractedTextToMarkdown(extracted, { sourceName: pdf.file.name });
    });

  if (result) {
    const filename = markdownOutputName(pdf.file.name);
    return (
      <ResultPanel
        title={
          result.hasMarkdown ? "Markdown created" : "No selectable text found"
        }
        summary={
          result.hasMarkdown
            ? `${result.characterCount.toLocaleString()} Markdown characters from ${result.pageCount} page${result.pageCount === 1 ? "" : "s"}`
            : "Scanned/image-only PDFs need OCR before text can be converted to Markdown."
        }
        onReset={onReset}
        tone={result.hasMarkdown ? "ok" : "warn"}
      >
        {result.hasMarkdown ? (
          <div className="flex flex-col gap-4">
            <div className="border-line text-fg bg-canvas max-h-72 overflow-auto rounded-[4px] border p-4 font-mono text-sm leading-6 whitespace-pre-wrap">
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
          <NoSelectableTextNote extra="For table-heavy documents, Extract Tables may also help when AI table extraction is enabled." />
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
    <div className="border-line bg-wash rounded-[4px] border p-4">
      <div className="text-fg mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-accent size-4" aria-hidden />
        {title}
      </div>
      <p className="text-muted text-xs leading-relaxed">{body}</p>
    </div>
  );
}
