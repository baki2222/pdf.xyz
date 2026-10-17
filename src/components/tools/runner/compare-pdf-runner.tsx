"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Download,
  FileDiff,
  FileText,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import { downloadBlob, readFileBytes } from "@/lib/pdf/browser";
import { partitionPdfFiles } from "@/lib/pdf/files";
import { getPageCount } from "@/lib/pdf/engine";
import { extractPdfText, type ExtractedPdfText } from "@/lib/pdf/text";
import {
  compareExtractedPdfText,
  compareOutputName,
  fileWithoutText,
  type CompareVerdict,
  type PdfCompareResult,
} from "@/lib/pdf/compare-pdf";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes, formatSignedBytes } from "@/lib/utils";
import { NAME_WRAP } from "@/components/ui/name-wrap";
import {
  Dropzone,
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  errorMessage,
  useAsyncRun,
  textOutputFile,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import {
  HandoffLoadedBadge,
  HandoffLoading,
  HandoffProblem,
} from "./handoff-notice";
import { useToolHandoff } from "./use-tool-handoff";
import { OCR_TOOL_HREF } from "./no-text-note";

export interface CompareItem {
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

export function ComparePdfRunner({
  extract,
}: {
  /** Reads each PDF's text. Only a test passes this; see `ComparePdfEditor`. */
  extract?: (bytes: Uint8Array) => Promise<ExtractedPdfText>;
} = {}) {
  const [items, setItems] = useState<CompareItem[]>([]);
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const [loading, setLoading] = useState(0);
  const idRef = useRef(0);
  const handoff = useToolHandoff("compare-pdf");
  const preloadedRef = useRef(false);

  const addFiles = useCallback(
    async (files: File[]) => {
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
            reason:
              "Compare PDF uses exactly two PDF files. Remove one before adding another.",
          })),
        ]);
      }
      setLoading((n) => n + slots.length);
      for (const file of slots) {
        try {
          const bytes = await readFileBytes(file);
          const pageCount = await getPageCount(bytes);
          const id = `compare-${idRef.current++}`;
          setItems((prev) =>
            [
              ...prev,
              { id, name: file.name, size: file.size, bytes, pageCount },
            ].slice(0, 2),
          );
        } catch (err) {
          setRejections((prev) => [
            ...prev,
            { name: file.name, reason: errorMessage(err) },
          ]);
        } finally {
          setLoading((n) => n - 1);
        }
      }
    },
    [items.length],
  );

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
      {handoff.status === "ready" && (
        <HandoffLoadedBadge
          origin={handoff.origin}
          count={Math.min(2, handoff.files.length)}
          skipped={handoff.skipped}
        />
      )}
      <ComparePdfEditor
        items={items}
        loading={loading}
        rejections={rejections}
        onFiles={addFiles}
        onRemove={(id) =>
          setItems((prev) => prev.filter((item) => item.id !== id))
        }
        onClearRejections={() => setRejections([])}
        onClear={() => {
          setItems([]);
          setRejections([]);
        }}
        extract={extract}
      />
    </div>
  );
}

/**
 * Where a PDF with no selectable text should go next — the one constant the
 * other no-text panels link to, re-exported rather than typed a second time.
 */
export { OCR_TOOL_HREF };

/**
 * What the result panel says for each verdict. A run that found no text to
 * compare is not a success: it gets the warn panel every no-text outcome gets
 * (PDF to Text, PDF to Markdown — `no-text-note.test.tsx`), never the green
 * check, and a title that says what is missing instead of "Differences found".
 */
function verdictPresentation(
  result: Pick<PdfCompareResult, "verdict" | "leftName" | "rightName">,
): { title: string; tone: "ok" | "warn" } {
  const presentations: Record<
    CompareVerdict,
    { title: string; tone: "ok" | "warn" }
  > = {
    identical: { title: "Selectable text matches", tone: "ok" },
    different: { title: "Differences found", tone: "ok" },
    "no-text": { title: "No text to compare", tone: "warn" },
    "left-no-text": {
      title: `${result.leftName} has no selectable text`,
      tone: "warn",
    },
    "right-no-text": {
      title: `${result.rightName} has no selectable text`,
      tone: "warn",
    },
  };
  return presentations[result.verdict];
}

export function ComparePdfEditor({
  items,
  loading,
  rejections,
  onFiles,
  onRemove,
  onClearRejections,
  onClear,
  extract = extractPdfText,
}: {
  items: CompareItem[];
  loading: number;
  rejections: Rejection[];
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onClearRejections: () => void;
  /**
   * Empties both file slots, so "Start over" lands on the empty runner. It
   * used to reload the page instead (start-over.test.ts).
   */
  onClear: () => void;
  /** Reads each PDF's text. Only a test passes this; see `extractPdfText`. */
  extract?: (bytes: Uint8Array) => Promise<ExtractedPdfText>;
}) {
  const { busy, error, result, run, reset } = useAsyncRun<PdfCompareResult>();
  const canCompare = items.length === 2;
  const onRun = () =>
    run(async () => {
      const [left, right] = items;
      if (!left || !right) throw new Error("Add two PDFs to compare.");
      const [leftText, rightText] = await Promise.all([
        extract(left.bytes),
        extract(right.bytes),
      ]);
      return compareExtractedPdfText(
        { name: left.name, size: left.size, extracted: leftText },
        { name: right.name, size: right.size, extracted: rightText },
      );
    });

  if (result) {
    const { title, tone } = verdictPresentation(result);
    const compared = result.hasComparableText;
    const scanned = fileWithoutText(result);
    const ocrLink = (
      <Link href={OCR_TOOL_HREF} className="text-fg underline">
        OCR PDF
      </Link>
    );
    return (
      <ResultPanel
        title={title}
        // Two scanned PDFs "match" only in having no text; that is not a
        // success a reader should see in green.
        tone={tone}
        announcement={
          compared
            ? undefined
            : `${title}. Run OCR PDF on scanned or image-only files first.`
        }
        summary={
          compared ? (
            `${result.summary.changedLines} changed lines · pages ${result.leftPageCount} vs ${result.rightPageCount}`
          ) : scanned ? (
            <>
              {scanned} looks scanned or image-only, so its text cannot be
              compared with the other file. Run {ocrLink} on it first, then
              compare again.
            </>
          ) : (
            <>
              No selectable text found in either PDF — scanned or image-only
              pages need {ocrLink} before they can be compared.
            </>
          )
        }
        onReset={() => {
          reset();
          onClear();
        }}
        output={textOutputFile(
          result,
          result.report,
          compareOutputName(result.leftName, result.rightName),
        )}
        // Both files stay in their slots: swap one and compare again.
        onAdjust={reset}
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric
              label="Pages"
              value={`${result.leftPageCount} → ${result.rightPageCount}`}
            />
            <Metric
              label="Size delta"
              value={formatSignedBytes(result.sizeDelta)}
            />
            <Metric
              label="Changed lines"
              value={
                compared
                  ? result.summary.changedLines.toLocaleString("en-US")
                  : "Not compared"
              }
            />
          </div>
          <div className="border-line text-fg bg-canvas max-h-80 overflow-auto rounded-[4px] border p-4 font-mono text-xs leading-5 whitespace-pre-wrap">
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
        pageTarget
        busy={busy}
        onFiles={onFiles}
        multiple
        title="Drop two PDFs here, or"
        hint="Compares page count, file size, and selectable text locally"
      />

      <RunnerSection
        title="Files to compare"
        aside={
          <span className="text-muted text-xs">
            {items.length}/2 selected{loading ? ` · loading ${loading}` : ""}
          </span>
        }
      >
        {/* `grid-cols-1`: an implicit column is sized to its widest word,
            and a file's name is one word (see NAME_WRAP). */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {[0, 1].map((slot) => {
            const item = items[slot];
            return item ? (
              <div
                key={item.id}
                className="border-line bg-wash flex min-w-0 items-start justify-between gap-3 rounded-[4px] border p-4"
              >
                <div className={NAME_WRAP}>
                  <p className="text-fg font-medium">{item.name}</p>
                  <p className="text-muted mt-1 text-xs">
                    {item.pageCount} page{item.pageCount === 1 ? "" : "s"} ·{" "}
                    {formatBytes(item.size)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  className="text-muted hover:bg-wash hover:text-fg shrink-0 rounded-full p-2"
                >
                  <X className="size-4" aria-hidden />
                  <span className="sr-only">Remove {item.name}</span>
                </button>
              </div>
            ) : (
              <div
                key={slot}
                className="border-line-strong bg-wash text-muted flex min-h-24 items-center justify-center rounded-[4px] border border-dashed text-sm"
              >
                <Plus className="mr-2 size-4" aria-hidden />
                PDF {slot + 1}
              </div>
            );
          })}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <InfoTile
            icon={ShieldCheck}
            title="Private"
            body="Both PDFs stay in your browser."
          />
          <InfoTile
            icon={FileText}
            title="Text diff"
            body="Uses embedded selectable text; scanned pages need OCR first."
          />
          <InfoTile
            icon={FileDiff}
            title="Honest"
            body="This is not a pixel-perfect visual comparison."
          />
        </div>
      </RunnerSection>

      {rejections.length > 0 && (
        <div className="border-warn/40 bg-warn/10 text-warn rounded-[4px] border p-4 text-sm">
          <div className="mb-2 flex items-center justify-between gap-3">
            <strong>Some files were skipped</strong>
            <button
              type="button"
              onClick={onClearRejections}
              className="text-xs underline"
            >
              Dismiss
            </button>
          </div>
          <ul className="list-disc space-y-1 pl-5">
            {rejections.map((r, i) => (
              <li key={`${r.name}-${i}`} className={NAME_WRAP}>
                {r.name}: {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunButton
            onClick={onRun}
            disabled={!canCompare}
            busy={busy}
            busyLabel="Comparing…"
          >
            <FileDiff className="size-4" aria-hidden />
            Compare PDFs
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line bg-wash rounded-[4px] border p-4">
      <p className="text-muted text-xs tracking-wide uppercase">{label}</p>
      <p className="text-fg mt-1 text-lg font-semibold">{value}</p>
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
    <div className={cn("border-line bg-wash rounded-[4px] border p-4")}>
      <div className="text-fg mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-accent size-4" aria-hidden />
        {title}
      </div>
      <p className="text-muted text-xs leading-relaxed">{body}</p>
    </div>
  );
}
