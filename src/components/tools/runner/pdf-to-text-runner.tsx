"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Download,
  FileText,
  Search,
  ShieldCheck,
} from "lucide-react";
import {
  extractPdfText,
  pagesWithoutText,
  textOutputName,
  type ExtractedPdfText,
} from "@/lib/pdf/text";
import {
  extractedPagesLabel,
  extractedTextSummary,
} from "@/lib/pdf/text-summary";
import { formatPageNumbers } from "@/lib/pdf/ranges";
import { downloadBlob } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import { CopyTextButton } from "../copy-text-button";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  useAsyncRun,
  NO_ADJUST,
  NO_OUTPUT,
  textOutputFile,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import type { LoadedPdf } from "./use-single-pdf";
import {
  NoSelectableTextNote,
  OCR_TOOL_HREF,
  OCR_TOOL_NAME,
} from "./no-text-note";

/**
 * `extract` is a seam for tests (pdf-to-text-result-line.test.tsx): pdf-lib's
 * standard fonts cannot draw an astral character, so that test hands in an
 * extraction holding some instead of mocking `@/lib/pdf/text`, which under
 * `isolate: false` would leave this module bound to the stub for later files
 * (mock-isolation.test.ts). The page passes nothing.
 */
export function PdfToTextRunner({
  extract = extractPdfText,
}: {
  extract?: (bytes: Uint8Array) => Promise<ExtractedPdfText>;
} = {}) {
  return (
    <SinglePdfRunner
      hint="One PDF · extracts selectable text locally in your browser"
      handoffSlug="pdf-to-text"
      toolName="PDF to Text"
      writesPdf={false}
      reader="pdfjs"
    >
      {(pdf, reset) => (
        <PdfToTextEditor pdf={pdf} onReset={reset} extract={extract} />
      )}
    </SinglePdfRunner>
  );
}

function PdfToTextEditor({
  pdf,
  onReset,
  extract,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
  extract: (bytes: Uint8Array) => Promise<ExtractedPdfText>;
}) {
  const { busy, error, result, run } = useAsyncRun<ExtractedPdfText>();
  const onRun = () => run(() => extract(pdf.bytes));

  if (result) {
    const filename = textOutputName(pdf.file.name);
    // Pages the TXT has nothing from, listed under the result. The pages
    // label and the result line share one definition (./text-summary).
    const empty = pagesWithoutText(result.pages);
    return (
      <ResultPanel
        title={result.hasText ? "Text extracted" : "No selectable text found"}
        summary={
          result.hasText
            ? extractedTextSummary(result)!
            : `Scanned/image-only PDFs need OCR. This browser tool only extracts embedded selectable text.`
        }
        announcement={
          result.hasText && empty.length > 0
            ? `Text extracted from ${extractedPagesLabel(result)}`
            : undefined
        }
        onReset={onReset}
        tone={result.hasText ? "ok" : "warn"}
        output={
          result.hasText
            ? textOutputFile(result, result.text, filename)
            : NO_OUTPUT("no selectable text, so no TXT was written")
        }
        onAdjust={NO_ADJUST("PDF to Text has no settings to change")}
      >
        {result.hasText ? (
          <div className="flex flex-col gap-4">
            {empty.length > 0 && <EmptyPagesNote pages={empty} />}
            <div className="border-line text-fg bg-canvas rounded-panel max-h-72 overflow-auto border p-4 text-sm leading-6 whitespace-pre-wrap">
              {result.text}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <button
                type="button"
                onClick={() =>
                  downloadBlob(
                    new Blob([result.text], {
                      type: "text/plain;charset=utf-8",
                    }),
                    filename,
                  )
                }
                className={buttonVariants({ variant: "primary", size: "lg" })}
              >
                <Download className="size-4" aria-hidden />
                Download TXT (
                {formatBytes(new TextEncoder().encode(result.text).byteLength)})
              </button>
              {/* The same text the TXT holds, in one press: the page's first
                  use is pasting it into an email or a spreadsheet, and
                  selecting a whole document in the box above is close to
                  impossible on a phone (audit pdf-to-text#5). */}
              <CopyTextButton text={result.text} label="Copy text" />
            </div>
          </div>
        ) : (
          <NoSelectableTextNote />
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

      <RunBar>
        <div className="flex justify-end">
          <RunButton onClick={onRun} busy={busy} busyLabel="Extracting text…">
            <FileText className="size-4" aria-hidden />
            Extract text
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}

/** Names the pages nothing was extracted from, and where to take them. */
function EmptyPagesNote({ pages }: { pages: number[] }) {
  const one = pages.length === 1;
  return (
    <p
      role="status"
      className="border-warn/40 bg-warn/10 text-warn rounded-panel flex items-start gap-2 border px-4 py-3 text-sm leading-relaxed"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">
          {one ? "Page" : "Pages"} {formatPageNumbers(pages)}{" "}
          {one ? "has" : "have"} no selectable text
        </strong>
        , so nothing from {one ? "it" : "them"} is in this TXT.{" "}
        {one ? "It may be" : "They may be"} blank, or a scanned image — to get
        text from scanned pages, use <OcrLink />.
      </span>
    </p>
  );
}

function OcrLink() {
  return (
    <Link
      href={OCR_TOOL_HREF}
      className="font-semibold underline underline-offset-2"
    >
      {OCR_TOOL_NAME}
    </Link>
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
