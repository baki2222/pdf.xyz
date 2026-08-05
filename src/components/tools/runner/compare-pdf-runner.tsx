"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileDiff, FileText, Plus, ShieldCheck, X } from "lucide-react";
import { downloadBlob, readFileBytes } from "@/lib/pdf/browser";
import { partitionPdfFiles } from "@/lib/pdf/files";
import { getPageCount } from "@/lib/pdf/engine";
import { extractPdfText } from "@/lib/pdf/text";
import {
  compareExtractedPdfText,
  compareOutputName,
  type PdfCompareResult,
} from "@/lib/pdf/compare-pdf";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import {
  Dropzone,
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  errorMessage,
  useAsyncRun,
} from "./runner-kit";
import { HandoffLoadedBadge, HandoffLoading, HandoffProblem } from "./handoff-notice";
import { useToolHandoff } from "./use-tool-handoff";

interface CompareItem {
  id: string;
  name: string;
  size: number;
  bytes: Uint8Array;
  pageCount: number;
}

interface Rejection {
  name: string;
  reason: string;
}

export function ComparePdfRunner() {
  const [items, setItems] = useState<CompareItem[]>([]);
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const [loading, setLoading] = useState(0);
  const idRef = useRef(0);
  const handoff = useToolHandoff("compare-pdf");
  const preloadedRef = useRef(false);

  const addFiles = useCallback(async (files: File[]) => {
    const { accepted, rejected } = partitionPdfFiles(files);
    if (rejected.length > 0) {
      setRejections((prev) => [
        ...prev,
        ...rejected.map((r) => ({ name: r.file.name, reason: r.reason })),
      ]);
    }
    const slots = accepted.slice(0, Math.max(0, 2 - items.length));
    if (accepted.length > slots.length) {
      setRejections((prev) => [
        ...prev,
        ...accepted.slice(slots.length).map((file) => ({
          name: file.name,
          reason: "Compare PDF uses exactly two PDF files. Remove one before adding another.",
        })),
      ]);
    }
    setLoading((n) => n + slots.length);
    for (const file of slots) {
      try {
        const bytes = await readFileBytes(file);
        const pageCount = await getPageCount(bytes);
        const id = `compare-${idRef.current++}`;
        setItems((prev) => [...prev, { id, name: file.name, size: file.size, bytes, pageCount }].slice(0, 2));
      } catch (err) {
        setRejections((prev) => [...prev, { name: file.name, reason: errorMessage(err) }]);
      } finally {
        setLoading((n) => n - 1);
      }
    }
  }, [items.length]);

  useEffect(() => {
    if (preloadedRef.current) return;
    if (handoff.status === "ready" && handoff.files.length > 0) {
      preloadedRef.current = true;
      void addFiles(handoff.files.slice(0, 2));
    }
  }, [addFiles, handoff.files, handoff.status]);

  if (handoff.status === "loading") return <HandoffLoading />;

  return (
    <div className="flex flex-col gap-4">
      <HandoffProblem handoff={handoff} toolName="Compare PDF" />
      {handoff.status === "ready" && <HandoffLoadedBadge count={Math.min(2, handoff.files.length)} skipped={handoff.skipped} />}
      <ComparePdfEditor
        items={items}
        loading={loading}
        rejections={rejections}
        onFiles={addFiles}
        onRemove={(id) => setItems((prev) => prev.filter((item) => item.id !== id))}
        onClearRejections={() => setRejections([])}
      />
    </div>
  );
}

function ComparePdfEditor({
  items,
  loading,
  rejections,
  onFiles,
  onRemove,
  onClearRejections,
}: {
  items: CompareItem[];
  loading: number;
  rejections: Rejection[];
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onClearRejections: () => void;
}) {
  const { busy, error, result, run } = useAsyncRun<PdfCompareResult>();
  const canCompare = items.length === 2;
  const onRun = () =>
    run(async () => {
      const [left, right] = items;
      if (!left || !right) throw new Error("Add two PDFs to compare.");
      const [leftText, rightText] = await Promise.all([
        extractPdfText(left.bytes),
        extractPdfText(right.bytes),
      ]);
      return compareExtractedPdfText(
        { name: left.name, size: left.size, extracted: leftText },
        { name: right.name, size: right.size, extracted: rightText },
      );
    });

  if (result) {
    return (
      <ResultPanel
        title={result.identicalText ? "Selectable text matches" : "Differences found"}
        summary={
          result.hasComparableText
            ? `${result.summary.changedLines} changed lines · pages ${result.leftPageCount} vs ${result.rightPageCount}`
            : "No selectable text found in either PDF — OCR is needed for scanned documents."
        }
        onReset={() => window.location.reload()}
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Pages" value={`${result.leftPageCount} → ${result.rightPageCount}`} />
            <Metric label="Size delta" value={`${result.sizeDelta >= 0 ? "+" : ""}${formatBytes(Math.abs(result.sizeDelta))}`} />
            <Metric label="Changed lines" value={result.summary.changedLines.toLocaleString()} />
          </div>
          <div className="max-h-80 overflow-auto rounded-2xl border border-white/10 bg-black/20 p-4 font-mono text-xs leading-5 text-slate-200 whitespace-pre-wrap">
            {result.report}
          </div>
          <button
            type="button"
            onClick={() =>
              downloadBlob(
                new Blob([result.report], { type: "text/plain;charset=utf-8" }),
                compareOutputName(result.leftName, result.rightName),
              )
            }
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            <Download className="size-4" aria-hidden />
            Download comparison report
          </button>
        </div>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Dropzone
        onFiles={onFiles}
        multiple
        title="Drop two PDFs here, or"
        hint="Compares page count, file size, and selectable text locally"
      />

      <RunnerSection
        title="Files to compare"
        aside={<span className="text-xs text-slate-400">{items.length}/2 selected{loading ? ` · loading ${loading}` : ""}</span>}
      >
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1].map((slot) => {
            const item = items[slot];
            return item ? (
              <div key={item.id} className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div>
                  <p className="font-medium text-slate-100">{item.name}</p>
                  <p className="mt-1 text-xs text-slate-400">{item.pageCount} page{item.pageCount === 1 ? "" : "s"} · {formatBytes(item.size)}</p>
                </div>
                <button type="button" onClick={() => onRemove(item.id)} className="rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white">
                  <X className="size-4" aria-hidden />
                  <span className="sr-only">Remove {item.name}</span>
                </button>
              </div>
            ) : (
              <div key={slot} className="flex min-h-24 items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] text-sm text-slate-400">
                <Plus className="mr-2 size-4" aria-hidden />
                PDF {slot + 1}
              </div>
            );
          })}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <InfoTile icon={ShieldCheck} title="Private" body="Both PDFs stay in your browser." />
          <InfoTile icon={FileText} title="Text diff" body="Uses embedded selectable text; scanned pages need OCR first." />
          <InfoTile icon={FileDiff} title="Honest" body="This is not a pixel-perfect visual comparison." />
        </div>
      </RunnerSection>

      {rejections.length > 0 && (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100">
          <div className="mb-2 flex items-center justify-between gap-3">
            <strong>Some files were skipped</strong>
            <button type="button" onClick={onClearRejections} className="text-xs underline">Dismiss</button>
          </div>
          <ul className="list-disc space-y-1 pl-5">
            {rejections.map((r, i) => <li key={`${r.name}-${i}`}>{r.name}: {r.reason}</li>)}
          </ul>
        </div>
      )}
      {error && <ErrorNote message={error} />}

      <div className="flex justify-end">
        <RunButton onClick={onRun} disabled={!canCompare} busy={busy} busyLabel="Comparing…">
          <FileDiff className="size-4" aria-hidden />
          Compare PDFs
        </RunButton>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
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
    <div className={cn("rounded-2xl border border-white/10 bg-white/[0.02] p-4")}>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
        <Icon className="size-4 text-violet-300" aria-hidden />
        {title}
      </div>
      <p className="text-xs leading-relaxed text-slate-400">{body}</p>
    </div>
  );
}
