"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, Download, Scissors } from "lucide-react";
import { splitPdf } from "@/lib/pdf/engine";
import {
  combineRanges,
  readTopLevelBookmarks,
  splitPdfBySize,
  type TopLevelBookmark,
} from "@/lib/pdf/split-modes";
import {
  buildSplitParts,
  formatPageNumbers,
  parseRanges,
  rangeToIndices,
  rangesEveryN,
  rangesFromStarts,
  rangesPerPage,
} from "@/lib/pdf/ranges";
import type { NamedBytes, SplitPart } from "@/lib/pdf/types";
import { planTextSplit } from "@/lib/pdf/split-text";
import {
  SPLIT_MODE_LABEL,
  SPLIT_MODES,
  type SplitMode,
} from "@/lib/pdf/offered-kinds";
import { downloadBytes, totalBytes } from "@/lib/pdf/browser";
import { baseName, outputName } from "@/lib/pdf/files";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  Spinner,
  errorMessage,
  useAsyncRun,
  outputFile,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import type { LoadedPdf } from "./use-single-pdf";
import { useZipDownload } from "./use-zip-download";
import { NoSelectableTextNote } from "./no-text-note";

/** The modes offered — the same list the tool page counts (`offered-kinds`). */
const MODES: { id: SplitMode; label: string }[] = SPLIT_MODES.map((id) => ({
  id,
  label: SPLIT_MODE_LABEL[id],
}));

const MB = 1024 * 1024;

/** What a split produced, and what the receipt has to say about it. */
interface SplitOutcome {
  files: NamedBytes[];
  /** 1-based pages that alone are over a by-size target. */
  oversized: number[];
  /** The pages the split meant to write, for the receipt's re-count. */
  expectedPages: number;
}

/** A previewed part, with the bookmark that starts it in "By bookmarks". */
type PreviewPart = SplitPart & { label?: string };

export function SplitRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · it stays on your device"
      handoffSlug="split-pdf"
      toolName="Split PDF"
    >
      {(pdf, reset) => <SplitEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

/** A first target near half the file, so the default size split is ~2 parts. */
function defaultTargetMb(bytes: number): number {
  return Math.max(0.1, Math.round((bytes / MB / 2) * 10) / 10);
}

export function SplitEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const [mode, setMode] = useState<SplitMode>("ranges");
  const [rangeInput, setRangeInput] = useState(() => {
    const half = Math.max(1, Math.ceil(pdf.pageCount / 2));
    return pdf.pageCount > 1 ? `1-${half}, ${half + 1}-${pdf.pageCount}` : "1";
  });
  const [mergeRanges, setMergeRanges] = useState(false);
  const [size, setSize] = useState(1);
  const [targetMb, setTargetMb] = useState(() =>
    String(defaultTargetMb(pdf.file.size)),
  );
  // `null` while the outline is read; a PDF that cannot be read for it has
  // no bookmarks to offer.
  const [marks, setMarks] = useState<TopLevelBookmark[] | null>(null);
  const { zipping, zipError, downloadZip } = useZipDownload();
  const { busy, error, result, run, reset } = useAsyncRun<SplitOutcome>();
  const mergeId = useId();
  const bookmarksNoteId = useId();
  const textCaseId = useId();
  const [textQuery, setTextQuery] = useState("");
  const [textCase, setTextCase] = useState(false);
  // Each page's selectable text, read the first time "By text" is chosen.
  const [pageTexts, setPageTexts] = useState<
    { pageNumber: number; text: string }[] | null
  >(null);
  const [textError, setTextError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "text" || pageTexts !== null || textError !== null) return;
    let live = true;
    const read = async () => {
      const { extractPdfText } = await import("@/lib/pdf/text");
      return extractPdfText(pdf.bytes);
    };
    read()
      .then((done) => live && setPageTexts(done.pages))
      .catch((err: unknown) => live && setTextError(errorMessage(err)));
    return () => {
      live = false;
    };
  }, [mode, pageTexts, textError, pdf.bytes]);

  const textPlan = useMemo(
    () =>
      pageTexts && mode === "text"
        ? planTextSplit(pageTexts, textQuery, textCase)
        : null,
    [pageTexts, mode, textQuery, textCase],
  );

  useEffect(() => {
    let live = true;
    readTopLevelBookmarks(pdf.bytes)
      .then((found) => live && setMarks(found))
      .catch(() => live && setMarks([]));
    return () => {
      live = false;
    };
  }, [pdf.bytes]);

  const noBookmarks = marks !== null && marks.length === 0;
  const targetBytes = Number(targetMb) * MB;

  const { parts, previewError } = useMemo((): {
    parts: PreviewPart[];
    previewError: string | null;
  } => {
    const base = baseName(pdf.file.name);
    try {
      if (mode === "ranges") {
        if (mergeRanges) {
          return {
            parts: [
              {
                name: outputName(pdf.file.name, "split"),
                indices: parseRanges(rangeInput, pdf.pageCount).flatMap(
                  rangeToIndices,
                ),
              },
            ],
            previewError: null,
          };
        }
        return {
          parts: buildSplitParts(base, parseRanges(rangeInput, pdf.pageCount)),
          previewError: null,
        };
      }
      if (mode === "everyN") {
        return {
          parts: buildSplitParts(base, rangesEveryN(pdf.pageCount, size)),
          previewError: null,
        };
      }
      if (mode === "size") {
        // The parts are only known once each is built and measured.
        return {
          parts: [],
          previewError:
            Number.isFinite(targetBytes) && targetBytes > 0
              ? null
              : "Enter a maximum size per file greater than zero.",
        };
      }
      if (mode === "bookmarks") {
        if (!marks || marks.length === 0) {
          return { parts: [], previewError: null };
        }
        const ranges = rangesFromStarts(
          marks.map((m) => m.pageIndex),
          pdf.pageCount,
        );
        const titleAt = new Map<number, string>();
        for (const m of marks) {
          if (!titleAt.has(m.pageIndex)) titleAt.set(m.pageIndex, m.title);
        }
        return {
          parts: buildSplitParts(base, ranges).map((part, i) => ({
            ...part,
            label: titleAt.get(ranges[i]!.start) ?? "Before the first bookmark",
          })),
          previewError: null,
        };
      }
      if (mode === "text") {
        if (!textPlan || textPlan.ranges.length === 0) {
          return { parts: [], previewError: null };
        }
        const matched = new Set(textPlan.matched);
        return {
          parts: buildSplitParts(base, textPlan.ranges).map((part, i) => {
            const start = textPlan.ranges[i]!.start;
            return {
              ...part,
              label: matched.has(start)
                ? `Starts at page ${start + 1}, which contains the text`
                : "Before the first page with the text",
            };
          }),
          previewError: null,
        };
      }
      return {
        parts: buildSplitParts(base, rangesPerPage(pdf.pageCount)),
        previewError: null,
      };
    } catch (err) {
      return { parts: [], previewError: errorMessage(err) };
    }
  }, [pdf, mode, rangeInput, mergeRanges, size, marks, targetBytes, textPlan]);

  const onSplit = () =>
    run(async (): Promise<SplitOutcome> => {
      if (mode === "size") {
        const { files, oversized } = await splitPdfBySize(
          pdf.bytes,
          targetBytes,
          baseName(pdf.file.name),
        );
        return {
          files: files.map(({ name, bytes }) => ({ name, bytes })),
          oversized: oversized.map((i) => i + 1),
          expectedPages: pdf.pageCount,
        };
      }
      if (mode === "ranges" && mergeRanges) {
        const part = parts[0]!;
        const bytes = await combineRanges(
          pdf.bytes,
          parseRanges(rangeInput, pdf.pageCount),
        );
        return {
          files: [{ name: part.name, bytes }],
          oversized: [],
          expectedPages: part.indices.length,
        };
      }
      return {
        files: await splitPdf(pdf.bytes, parts),
        oversized: [],
        expectedPages: parts.reduce((n, part) => n + part.indices.length, 0),
      };
    });

  const downloadResult = async (files: NamedBytes[]) => {
    if (files.length === 1) {
      downloadBytes(files[0]!.bytes, files[0]!.name);
      return;
    }
    await downloadZip(files, outputName(pdf.file.name, "split", "zip"));
  };

  if (result) {
    const { files, oversized } = result;
    return (
      <ResultPanel
        title="PDF split"
        summary={`${files.length} file${files.length === 1 ? "" : "s"} created · ${formatBytes(totalBytes(files))} total`}
        onReset={onReset}
        // Each part, as the PDF it is (several download as one ZIP).
        output={files.map((part) => outputFile(part.bytes, part.name))}
        onAdjust={reset}
        expectedPages={result.expectedPages}
      >
        {oversized.length > 0 && (
          <p
            role="status"
            className="border-warn/40 bg-warn/10 text-warn rounded-panel flex items-start gap-2 border px-4 py-3 text-sm"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {oversized.length === 1 ? "Page" : "Pages"}{" "}
              {formatPageNumbers(oversized)}{" "}
              {oversized.length === 1 ? "is" : "are"} bigger than {targetMb} MB
              on {oversized.length === 1 ? "its" : "their"} own, so{" "}
              {oversized.length === 1 ? "it is" : "each is"} a file of{" "}
              {oversized.length === 1 ? "its" : "their"} own over that size.
              Splitting cannot make one page smaller; Compress PDF can.
            </span>
          </p>
        )}
        {zipError && <ErrorNote message={zipError} />}
        <button
          type="button"
          onClick={() => {
            if (!zipping) void downloadResult(files);
          }}
          aria-disabled={zipping || undefined}
          aria-busy={zipping}
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          {zipping ? (
            <>
              <Spinner />
              Zipping…
            </>
          ) : (
            <>
              <Download className="size-4" aria-hidden />
              {files.length === 1
                ? "Download PDF"
                : `Download ZIP (${files.length} files)`}
            </>
          )}
        </button>
      </ResultPanel>
    );
  }

  const runLabel =
    mode === "size"
      ? `Split by size`
      : `Split into ${parts.length} file${parts.length === 1 ? "" : "s"}`;
  const cannotRun =
    Boolean(previewError) || (mode === "size" ? false : parts.length === 0);

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection title="How to split">
        <div className="border-line bg-wash rounded-ctl inline-flex flex-wrap gap-1 border p-1">
          {MODES.map((m) => {
            const off = m.id === "bookmarks" && noBookmarks;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  if (!off) setMode(m.id);
                }}
                aria-pressed={mode === m.id}
                aria-disabled={off || undefined}
                aria-describedby={off ? bookmarksNoteId : undefined}
                className={cn(
                  "rounded-tag px-3.5 py-1.5 text-xs font-medium transition",
                  mode === m.id
                    ? "bg-invert text-fg-invert"
                    : "text-muted hover:text-fg",
                  off && "cursor-not-allowed opacity-50 hover:text-current",
                )}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        {noBookmarks && (
          <p id={bookmarksNoteId} className="text-muted mt-2 text-xs">
            By bookmarks is unavailable: this PDF has no top-level bookmarks
            that open one of its pages.
          </p>
        )}
      </RunnerSection>

      {mode === "ranges" && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-2">
            <span className="text-muted text-sm">
              {mergeRanges
                ? "Page ranges — all in one file"
                : "Page ranges — one file per range"}
            </span>
            <input
              type="text"
              value={rangeInput}
              onChange={(e) => setRangeInput(e.target.value)}
              placeholder="e.g. 1-3, 4-6, 7-"
              spellCheck={false}
              className="bg-canvas/60 border-line text-fg focus:border-accent/40 focus:ring-accent/50 rounded-ctl border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2"
            />
            <span className="text-muted text-xs">
              Use commas to separate ranges. Ranges are inclusive, e.g.{" "}
              <code className="text-muted">1-3, 8, 10-</code>.
            </span>
          </label>
          <label
            htmlFor={mergeId}
            className="text-fg flex items-start gap-2 text-sm"
          >
            <input
              id={mergeId}
              type="checkbox"
              checked={mergeRanges}
              onChange={(e) => setMergeRanges(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Merge selected ranges into one file
              <span className="text-muted block text-xs">
                The ranges&apos; pages, in the order you typed them.
              </span>
            </span>
          </label>
        </div>
      )}

      {mode === "everyN" && (
        <label className="flex flex-col gap-2">
          <span className="text-muted text-sm">Pages per file</span>
          <input
            type="number"
            min={1}
            max={pdf.pageCount}
            value={size}
            onChange={(e) =>
              setSize(Math.max(1, Math.floor(Number(e.target.value) || 1)))
            }
            className="bg-canvas/60 border-line text-fg focus:border-accent/40 focus:ring-accent/50 rounded-ctl w-32 border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2"
          />
        </label>
      )}

      {mode === "perPage" && (
        <p className="text-muted text-sm">
          Every page becomes its own PDF — {pdf.pageCount} files in total.
        </p>
      )}

      {mode === "size" && (
        <label className="flex flex-col gap-2">
          <span className="text-muted text-sm">Maximum size per file (MB)</span>
          <input
            type="number"
            min={0.1}
            step={0.1}
            inputMode="decimal"
            value={targetMb}
            onChange={(e) => setTargetMb(e.target.value)}
            className="bg-canvas/60 border-line text-fg focus:border-accent/40 focus:ring-accent/50 rounded-ctl w-32 border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2"
          />
          <span className="text-muted text-xs">
            Pages stay in order. Each file gets as many pages as fit, measured
            by building the file, not estimated. A page bigger than the limit on
            its own becomes a file of its own, and the result says so.
          </span>
        </label>
      )}

      {mode === "bookmarks" && marks === null && (
        <p className="text-muted inline-flex items-center gap-2 text-sm">
          <Spinner />
          Reading bookmarks…
        </p>
      )}
      {mode === "bookmarks" && marks !== null && marks.length > 0 && (
        <p className="text-muted text-sm">
          A new file starts at each top-level bookmark&apos;s page. Pages before
          the first bookmark become a file of their own.
        </p>
      )}

      {mode === "text" && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-2">
            <span className="text-muted text-sm">
              Start a new file at every page containing
            </span>
            <input
              type="text"
              value={textQuery}
              onChange={(e) => setTextQuery(e.target.value)}
              placeholder="e.g. Invoice number"
              spellCheck={false}
              className="bg-canvas/60 border-line text-fg focus:border-accent/40 focus:ring-accent/50 rounded-ctl border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2"
            />
          </label>
          <label
            htmlFor={textCaseId}
            className="text-fg flex items-start gap-2 text-sm"
          >
            <input
              id={textCaseId}
              type="checkbox"
              checked={textCase}
              onChange={(e) => setTextCase(e.target.checked)}
              className="mt-0.5"
            />
            <span>Match case</span>
          </label>
          {pageTexts === null && textError === null && (
            <p className="text-muted inline-flex items-center gap-2 text-sm">
              <Spinner />
              Reading the PDF&apos;s text…
            </p>
          )}
          {textError && <ErrorNote message={textError} />}
          {textPlan && textPlan.noText.length === pdf.pageCount && (
            <NoSelectableTextNote extra="Then split the recognized copy here." />
          )}
          {textPlan &&
            textPlan.noText.length > 0 &&
            textPlan.noText.length < pdf.pageCount && (
              <p className="text-muted text-xs">
                {textPlan.noText.length === 1 ? "Page" : "Pages"}{" "}
                {formatPageNumbers(textPlan.noText)}{" "}
                {textPlan.noText.length === 1 ? "has" : "have"} no selectable
                text, so {textPlan.noText.length === 1 ? "it" : "they"}{" "}
                can&apos;t start a file and{" "}
                {textPlan.noText.length === 1 ? "stays" : "stay"} with the pages
                before {textPlan.noText.length === 1 ? "it" : "them"}.
              </p>
            )}
          {textPlan &&
            textQuery.trim().length > 0 &&
            textPlan.matched.length === 0 &&
            textPlan.noText.length < pdf.pageCount && (
              <p className="text-muted text-sm" role="status">
                No page contains “{textQuery.trim()}”.
              </p>
            )}
        </div>
      )}

      {previewError ? (
        <ErrorNote message={previewError} />
      ) : (
        parts.length > 0 && (
          <RunnerSection
            title={`Preview · ${parts.length} file${parts.length === 1 ? "" : "s"}`}
          >
            <ul className="flex max-h-52 flex-col gap-1.5 overflow-auto pr-1">
              {parts.map((part, i) => (
                <li
                  key={part.name}
                  className="border-line bg-wash rounded-ctl flex items-center gap-3 border px-3 py-2 text-sm"
                >
                  <span className="bg-wash text-muted rounded-tag grid size-6 shrink-0 place-items-center text-xs font-semibold tabular-nums">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-muted block truncate">
                      {part.name}
                    </span>
                    {part.label !== undefined && (
                      <span className="text-muted block truncate text-xs">
                        {part.label || "Untitled bookmark"}
                      </span>
                    )}
                  </span>
                  <span className="text-muted shrink-0 text-xs">
                    {part.indices.length} page
                    {part.indices.length === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </RunnerSection>
        )
      )}

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunButton
            onClick={onSplit}
            busy={busy}
            disabled={cannotRun}
            busyLabel="Splitting…"
          >
            <Scissors className="size-4" aria-hidden />
            {runLabel}
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}
