"use client";

import { RunReason } from "@/components/tools/runner/run-reason";
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
  OVERLAY_LAYERS,
  overlayOutputName,
  overlayPdf,
  type OverlayFit,
  type OverlayLayer,
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
  outputFile,
  useAsyncRun,
} from "./runner-kit";
import { RunBar } from "./run-bar";
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
      toolName="Overlay PDF"
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
  const { busy, error, result, run, reset } = useAsyncRun<OverlayResult>();
  const [overlay, setOverlay] = useState<OverlayFile | null>(null);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [loadingOverlay, setLoadingOverlay] = useState(false);

  const [opacity, setOpacity] = useState(100);
  const [fit, setFit] = useState<OverlayFit>("fit");
  const [paging, setPaging] = useState<OverlayPaging>("repeat");
  const [layer, setLayer] = useState<OverlayLayer>("front");
  const layerOption = describeLayer(layer);

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
        layer,
      }),
    );
  };

  if (result) {
    const skipped = result.skippedBlankOverlayPages;
    return (
      <ResultPanel
        title="Overlay applied"
        summary={`${describeLayer(result.layer).done} ${describePages(result.overlaidPageCount, result.pageCount)} · ${describeFit(result.fit)} · ${result.opacity === 1 ? "opaque" : `${Math.round(result.opacity * 100)}% opacity`} · ${formatBytes(result.bytes.byteLength)}`}
        onReset={onReset}
        output={outputFile(result.bytes, overlayOutputName(pdf.file.name))}
        onAdjust={reset}
        expectedPages={pdf.pageCount}
      >
        {skipped.length > 0 && (
          <p className="text-muted text-sm">
            {skipped.length === 1
              ? `Overlay page ${skipped[0]} is blank, so it was skipped: the base pages it maps to are unchanged.`
              : `Overlay pages ${skipped.join(", ")} are blank, so they were skipped: the base pages they map to are unchanged.`}
          </p>
        )}
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
          <span className="text-muted text-xs">
            stamp · letterhead · template
          </span>
        }
      >
        {overlay ? (
          <div className="border-accent/40 bg-accent/10 rounded-panel flex items-center gap-3 border px-3.5 py-3">
            <Layers className="text-accent size-4 shrink-0" aria-hidden />
            <span className="text-fg min-w-0 flex-1 truncate text-sm">
              {overlay.file.name}
            </span>
            <span className="text-muted shrink-0 text-xs">
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
              className="border-line bg-wash text-muted hover:bg-wash rounded-ctl inline-grid size-7 shrink-0 place-items-center border transition"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : loadingOverlay ? (
          <p className="text-muted inline-flex items-center gap-2 text-sm">
            <Spinner /> Reading overlay PDF…
          </p>
        ) : (
          <Dropzone
            onFiles={(files) => files[0] && void openOverlay(files[0])}
            multiple={false}
            compact
            title="Drop the overlay PDF here, or"
            hint="Its first page is applied to every page of your base PDF"
          />
        )}
        {overlayError && <ErrorNote message={overlayError} />}
      </RunnerSection>

      <RunnerSection title="Placement">
        <div className="flex flex-col gap-2">
          <span className="text-muted text-xs font-medium">Layer</span>
          <SegmentedControl
            label="Overlay layer"
            value={layer}
            onChange={setLayer}
            options={OVERLAY_LAYERS.map((option) => ({
              value: option.id,
              label: option.label,
              title: option.hint,
            }))}
          />
          <p className="text-muted text-xs leading-relaxed">
            {layerOption.hint}
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <span className="text-muted text-xs font-medium">Scale</span>
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
            <span className="text-muted text-xs font-medium">
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
          body="Your base PDF keeps its exact page count and page sizes; only the overlay is added."
        />
      </div>

      <PrivacyLine>
        The overlay is applied on your device — neither PDF ever leaves your
        browser.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunReason
            reason={
              !overlay ? "Add the PDF to lay over the pages first." : null
            }
          >
            {(describedBy) => (
              <RunButton
                onClick={onRun}
                busy={busy}
                describedBy={describedBy}
                disabled={!overlay}
                busyLabel="Overlaying…"
              >
                <Layers className="size-4" aria-hidden />
                {overlay
                  ? `Overlay onto ${pdf.pageCount} page${pdf.pageCount === 1 ? "" : "s"}`
                  : "Add an overlay PDF"}
              </RunButton>
            )}
          </RunReason>
        </div>
      </RunBar>
    </div>
  );
}

function describeFit(fit: OverlayFit): string {
  return OVERLAY_FITS.find((option) => option.id === fit)?.label ?? "Fit page";
}

function describeLayer(layer: OverlayLayer) {
  return (
    OVERLAY_LAYERS.find((option) => option.id === layer) ?? OVERLAY_LAYERS[0]!
  );
}

/** "all 3 pages", "the page", or "2 of 3 pages" when some were skipped. */
function describePages(overlaid: number, total: number): string {
  if (overlaid === total) {
    return total === 1 ? "the page" : `all ${total} pages`;
  }
  return `${overlaid} of ${total} pages`;
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
    <div className="border-line bg-wash rounded-panel border p-4">
      <div className="text-fg mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-accent size-4" aria-hidden />
        {title}
      </div>
      <p className="text-muted text-xs leading-relaxed">{body}</p>
    </div>
  );
}
