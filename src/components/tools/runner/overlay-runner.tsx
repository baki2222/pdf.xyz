"use client";

import { useState } from "react";
import {
  Download,
  FileText,
  Layers,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  OVERLAY_FITS,
  overlayOutputName,
  overlayPdf,
  type OverlayFit,
  type OverlayPaging,
  type OverlayResult,
} from "@/lib/pdf/overlay";
import { getPageCount } from "@/lib/pdf/engine";
import { downloadBytes, readFileBytes } from "@/lib/pdf/browser";
import { validatePdfFile } from "@/lib/pdf/files";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import {
  Dropzone,
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  Spinner,
  errorMessage,
  useAsyncRun,
} from "./runner-kit";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import { PrivacyLine, RangeField, SegmentedControl } from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

/** A loaded overlay/stamp document: its bytes plus page count. */
interface OverlayFile {
  file: File;
  bytes: Uint8Array;
  pageCount: number;
}

export function OverlayRunner() {
  return (
    <SinglePdfRunner
      hint="Your base PDF · a stamp or letterhead PDF is overlaid locally in your browser"
      handoffSlug="overlay-pdf"
      toolName="Overlay / Stamp"
    >
      {(pdf, reset) => <OverlayEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

function OverlayEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const { busy, error, result, run } = useAsyncRun<OverlayResult>();
  const [overlay, setOverlay] = useState<OverlayFile | null>(null);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [loadingOverlay, setLoadingOverlay] = useState(false);

  const [opacity, setOpacity] = useState(100);
  const [fit, setFit] = useState<OverlayFit>("fit");
  const [paging, setPaging] = useState<OverlayPaging>("repeat");

  const multiPageOverlay = (overlay?.pageCount ?? 0) > 1;
  // A single-page overlay can only repeat, so keep the submitted value honest
  // without mutating state inside an effect.
  const effectivePaging: OverlayPaging = multiPageOverlay ? paging : "repeat";

  const openOverlay = async (file: File) => {
    const check = validatePdfFile(file);
    if (!check.ok) {
      setOverlay(null);
      setOverlayError(check.reason ?? "That file can't be used as an overlay.");
      return;
    }
    setLoadingOverlay(true);
    setOverlayError(null);
    try {
      const bytes = await readFileBytes(file);
      const pageCount = await getPageCount(bytes);
      setOverlay({ file, bytes, pageCount });
    } catch (err) {
      setOverlay(null);
      setOverlayError(errorMessage(err));
    } finally {
      setLoadingOverlay(false);
    }
  };

  const onRun = () => {
    if (!overlay) return;
    void run(() =>
      overlayPdf(pdf.bytes, overlay.bytes, {
        opacity: opacity / 100,
        fit,
        paging: effectivePaging,
      }),
    );
  };

  if (result) {
    return (
      <ResultPanel
        title="Overlay applied"
        summary={`Stamped on all ${result.pageCount} page${result.pageCount === 1 ? "" : "s"} · ${describeFit(result.fit)} · ${result.opacity === 1 ? "opaque" : `${Math.round(result.opacity * 100)}% opacity`} · ${formatBytes(result.bytes.byteLength)}`}
        onReset={onReset}
      >
        <button
          type="button"
          onClick={() =>
            downloadBytes(result.bytes, overlayOutputName(pdf.file.name))
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download overlaid PDF
        </button>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="Overlay PDF"
        aside={
          <span className="text-xs text-slate-400">
            stamp · letterhead · template
          </span>
        }
      >
        {overlay ? (
          <div className="flex items-center gap-3 rounded-2xl border border-violet-400/25 bg-violet-500/[0.06] px-3.5 py-3">
            <Layers className="size-4 shrink-0 text-violet-300" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
              {overlay.file.name}
            </span>
            <span className="shrink-0 text-xs text-slate-400">
              {overlay.pageCount} page{overlay.pageCount === 1 ? "" : "s"} ·{" "}
              {formatBytes(overlay.file.size)}
            </span>
            <button
              type="button"
              onClick={() => {
                setOverlay(null);
                setOverlayError(null);
              }}
              title="Remove overlay"
              className="inline-grid size-7 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : loadingOverlay ? (
          <p className="inline-flex items-center gap-2 text-sm text-slate-400">
            <Spinner className="size-4" /> Reading overlay PDF…
          </p>
        ) : (
          <Dropzone
            onFiles={(files) => files[0] && void openOverlay(files[0])}
            multiple={false}
            compact
            title="Drop the overlay PDF here, or"
            hint="The first page is stamped over every page of your base PDF"
          />
        )}
        {overlayError && <ErrorNote message={overlayError} />}
      </RunnerSection>

      <RunnerSection title="Placement">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-slate-300">Scale</span>
            <SegmentedControl
              label="Overlay scale mode"
              value={fit}
              onChange={setFit}
              options={OVERLAY_FITS.map((option) => ({
                value: option.id,
                label: option.label,
                title: option.hint,
              }))}
            />
          </div>
          <RangeField
            label="Opacity"
            value={opacity}
            min={10}
            max={100}
            step={5}
            onChange={setOpacity}
            format={(v) => `${v}%`}
          />
        </div>
        {multiPageOverlay && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-slate-300">
              Multi-page overlay
            </span>
            <SegmentedControl
              label="How overlay pages map to base pages"
              value={effectivePaging}
              onChange={setPaging}
              options={[
                {
                  value: "repeat",
                  label: "First page on all",
                  title: "Use only the overlay's first page on every base page",
                },
                {
                  value: "cycle",
                  label: "Cycle pages",
                  title: "Walk the overlay pages in order, repeating as needed",
                },
              ]}
            />
          </div>
        )}
      </RunnerSection>

      <div className="grid gap-3 sm:grid-cols-3">
        <InfoTile
          icon={Sparkles}
          title="Real vector overlay"
          body="The overlay is embedded as vector content — text and graphics in both PDFs stay crisp and selectable, not flattened to an image."
        />
        <InfoTile
          icon={ShieldCheck}
          title="Local only"
          body="Both PDFs are combined in your browser with pdf-lib — nothing is uploaded."
        />
        <InfoTile
          icon={FileText}
          title="Sizes preserved"
          body="Your base PDF keeps its exact page count and page sizes; only the overlay is added on top."
        />
      </div>

      <PrivacyLine>
        The overlay is applied on your device — neither PDF ever leaves your
        browser.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <div className="flex justify-end">
        <RunButton
          onClick={onRun}
          busy={busy}
          disabled={!overlay}
          busyLabel="Overlaying…"
        >
          <Layers className="size-4" aria-hidden />
          {overlay
            ? `Overlay onto ${pdf.pageCount} page${pdf.pageCount === 1 ? "" : "s"}`
            : "Add an overlay PDF"}
        </RunButton>
      </div>
    </div>
  );
}

function describeFit(fit: OverlayFit): string {
  return OVERLAY_FITS.find((option) => option.id === fit)?.label ?? "Fit page";
}

function InfoTile({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof ShieldCheck;
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
