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
import { downloadBlob, downloadBytes, totalBytes, zipFiles } from "@/lib/pdf/browser";
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

type SplitMode = "ranges" | "everyN" | "perPage";

const MODES: { id: SplitMode; label: string }[] = [
  { id: "ranges", label: "Custom ranges" },
  { id: "everyN", label: "Every N pages" },
  { id: "perPage", label: "Each page" },
];

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

function SplitEditor({ pdf, onReset }: { pdf: LoadedPdf; onReset: () => void }) {
  const [mode, setMode] = useState<SplitMode>("ranges");
  const [rangeInput, setRangeInput] = useState(() => {
    const half = Math.max(1, Math.ceil(pdf.pageCount / 2));
    return pdf.pageCount > 1 ? `1-${half}, ${half + 1}-${pdf.pageCount}` : "1";
  });
  const [size, setSize] = useState(1);
  const [zipping, setZipping] = useState(false);
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
    setZipping(true);
    try {
      const zip = await zipFiles(files);
      downloadBlob(zip, outputName(pdf.file.name, "split", "zip"));
    } finally {
      setZipping(false);
    }
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
          onClick={() => downloadResult(result)}
          disabled={zipping}
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
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection title="How to split">
        <div className="inline-flex flex-wrap gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-medium transition",
                mode === m.id
                  ? "bg-gradient-to-r from-violet-500 to-blue-500 text-white shadow"
                  : "text-slate-400 hover:text-white",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </RunnerSection>

      {mode === "ranges" && (
        <label className="flex flex-col gap-2">
          <span className="text-sm text-slate-300">
            Page ranges — one file per range
          </span>
          <input
            type="text"
            value={rangeInput}
            onChange={(e) => setRangeInput(e.target.value)}
            placeholder="e.g. 1-3, 4-6, 7-"
            spellCheck={false}
            className="rounded-xl border border-white/10 bg-ink/60 px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/30"
          />
          <span className="text-xs text-slate-400">
            Use commas to separate files. Ranges are inclusive, e.g.{" "}
            <code className="text-slate-400">1-3, 8, 10-</code>.
          </span>
        </label>
      )}

      {mode === "everyN" && (
        <label className="flex flex-col gap-2">
          <span className="text-sm text-slate-300">Pages per file</span>
          <input
            type="number"
            min={1}
            max={pdf.pageCount}
            value={size}
            onChange={(e) =>
              setSize(Math.max(1, Math.floor(Number(e.target.value) || 1)))
            }
            className="w-32 rounded-xl border border-white/10 bg-ink/60 px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/30"
          />
        </label>
      )}

      {mode === "perPage" && (
        <p className="text-sm text-slate-400">
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
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm"
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/5 text-xs font-semibold tabular-nums text-slate-400">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-300">
                    {part.name}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
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
