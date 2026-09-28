"use client";

import { useMemo, useState } from "react";
import { Download, Scissors } from "lucide-react";
import { splitPdf } from "@/lib/pdf/engine";
import {
  buildSplitParts,
  parseRanges,
  rangesEveryN,
  rangesPerPage,
} from "@/lib/pdf/ranges";
import type { NamedBytes, SplitPart } from "@/lib/pdf/types";
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
} from "./runner-kit";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import type { LoadedPdf } from "./use-single-pdf";
import { useZipDownload } from "./use-zip-download";

/** The modes offered — the same list the tool page counts (`offered-kinds`). */
const MODES: { id: SplitMode; label: string }[] = SPLIT_MODES.map((id) => ({
  id,
  label: SPLIT_MODE_LABEL[id],
}));

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

function SplitEditor({
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
  const [size, setSize] = useState(1);
  const { zipping, zipError, downloadZip } = useZipDownload();
  const { busy, error, result, run } = useAsyncRun<NamedBytes[]>();

  const { parts, previewError } = useMemo((): {
    parts: SplitPart[];
    previewError: string | null;
  } => {
    const base = baseName(pdf.file.name);
    try {
      if (mode === "ranges") {
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
      return {
        parts: buildSplitParts(base, rangesPerPage(pdf.pageCount)),
        previewError: null,
      };
    } catch (err) {
      return { parts: [], previewError: errorMessage(err) };
    }
  }, [pdf, mode, rangeInput, size]);

  const onSplit = () => run(() => splitPdf(pdf.bytes, parts));

  const downloadResult = async (files: NamedBytes[]) => {
    if (files.length === 1) {
      downloadBytes(files[0]!.bytes, files[0]!.name);
      return;
    }
    await downloadZip(files, outputName(pdf.file.name, "split", "zip"));
  };

  if (result) {
    return (
      <ResultPanel
        title="PDF split"
        summary={`${result.length} file${result.length === 1 ? "" : "s"} created · ${formatBytes(totalBytes(result))} total`}
        onReset={onReset}
      >
        <button
          type="button"
          onClick={() => {
            if (!zipping) downloadResult(result);
          }}
          aria-disabled={zipping || undefined}
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
              {result.length === 1
                ? "Download PDF"
                : `Download ZIP (${result.length} files)`}
            </>
          )}
        </button>
        {zipError && <ErrorNote message={zipError} />}
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection title="How to split">
        <div className="border-line bg-wash inline-flex flex-wrap gap-1 rounded-full border p-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-medium transition",
                mode === m.id
                  ? "bg-invert text-fg-invert"
                  : "text-muted hover:text-fg",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </RunnerSection>

      {mode === "ranges" && (
        <label className="flex flex-col gap-2">
          <span className="text-muted text-sm">
            Page ranges — one file per range
          </span>
          <input
            type="text"
            value={rangeInput}
            onChange={(e) => setRangeInput(e.target.value)}
            placeholder="e.g. 1-3, 4-6, 7-"
            spellCheck={false}
            className="bg-canvas/60 border-line text-fg focus:border-accent/40 focus:ring-accent/50 rounded-[3px] border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2"
          />
          <span className="text-muted text-xs">
            Use commas to separate files. Ranges are inclusive, e.g.{" "}
            <code className="text-muted">1-3, 8, 10-</code>.
          </span>
        </label>
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
            className="bg-canvas/60 border-line text-fg focus:border-accent/40 focus:ring-accent/50 w-32 rounded-[3px] border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2"
          />
        </label>
      )}

      {mode === "perPage" && (
        <p className="text-muted text-sm">
          Every page becomes its own PDF — {pdf.pageCount} files in total.
        </p>
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
                  className="border-line bg-wash flex items-center gap-3 rounded-[3px] border px-3 py-2 text-sm"
                >
                  <span className="bg-wash text-muted grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums">
                    {i + 1}
                  </span>
                  <span className="text-muted min-w-0 flex-1 truncate">
                    {part.name}
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

      <div className="flex justify-end">
        <RunButton
          onClick={onSplit}
          busy={busy}
          disabled={parts.length === 0 || Boolean(previewError)}
          busyLabel="Splitting…"
        >
          <Scissors className="size-4" aria-hidden />
          Split into {parts.length} file{parts.length === 1 ? "" : "s"}
        </RunButton>
      </div>
    </div>
  );
}
