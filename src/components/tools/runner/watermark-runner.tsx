"use client";

import { useState } from "react";
import { Download, ImageIcon, Stamp, X } from "lucide-react";
import {
  DEFAULT_IMAGE_SCALE,
  watermarkImageProblem,
  watermarkPdf,
  watermarkedOutputName,
  type WatermarkLayer,
  type WatermarkReport,
} from "@/lib/pdf/watermark";
import {
  hexToRgb,
  rgbToHex,
  STAMP_FONT_FAMILIES,
  STAMP_FONT_LABELS,
  WATERMARK_INK,
  type RGB,
  type StampFontFamily,
  type StampPosition,
} from "@/lib/pdf/stamp";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { recallOptions, rememberOptions } from "@/lib/intent/option-memory";
import { formatBytes } from "@/lib/utils";
import {
  Dropzone,
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  outputFile,
  useAsyncRun,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import {
  CheckboxField,
  ColorField,
  MoreOptions,
  PositionPicker,
  PrivacyLine,
  RangeField,
  SegmentedControl,
  TextField,
} from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

const COLORS: Record<"gray" | "red" | "blue", RGB> = {
  gray: WATERMARK_INK,
  red: { r: 0.78, g: 0.12, b: 0.12 },
  blue: { r: 0.16, g: 0.32, b: 0.7 },
};

type ColorChoice = keyof typeof COLORS | "custom";

interface PickedImage {
  name: string;
  bytes: Uint8Array;
}

export function WatermarkRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · watermark applied locally in your browser"
      handoffSlug="watermark-pdf"
      toolName="Add Watermark"
    >
      {(pdf, reset) => <WatermarkEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

export function WatermarkEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  // The last opacity and angle chosen here, never the text (option memory).
  const [kept] = useState(() => recallOptions("watermark"));
  const [mode, setMode] = useState<"text" | "image">("text");
  const [text, setText] = useState("CONFIDENTIAL");
  const [image, setImage] = useState<PickedImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageScale, setImageScale] = useState(DEFAULT_IMAGE_SCALE);
  const [opacity, setOpacity] = useState(kept.opacity ?? 18);
  const [rotation, setRotation] = useState(kept.rotation ?? 45);
  const [fontSize, setFontSize] = useState(60);
  const [font, setFont] = useState<StampFontFamily>("helvetica");
  const [color, setColor] = useState<ColorChoice>("gray");
  const [customHex, setCustomHex] = useState(() => rgbToHex(WATERMARK_INK));
  const [position, setPosition] = useState<StampPosition>("middle-center");
  const [tile, setTile] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pageMode, setPageMode] = useState<"all" | "some">("all");
  const [pageList, setPageList] = useState("");
  const [layer, setLayer] = useState<WatermarkLayer>("over");
  const { busy, error, result, run, reset } = useAsyncRun<WatermarkReport>();

  const trimmed = text.trim();
  const ready =
    (mode === "text" ? trimmed.length > 0 : image !== null) &&
    (pageMode === "all" || pageList.trim().length > 0);

  const onImage = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setImageError(null);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const problem = watermarkImageProblem(bytes);
    if (problem) {
      setImage(null);
      setImageError(problem);
      return;
    }
    setImage({ name: file.name, bytes });
  };

  const inkColor =
    color === "custom" ? (hexToRgb(customHex) ?? WATERMARK_INK) : COLORS[color];

  const onRun = () => {
    rememberOptions("watermark", { opacity, rotation });
    return run(() =>
      watermarkPdf(pdf.bytes, mode === "text" ? text : "", {
        opacity: opacity / 100,
        rotation,
        fontSize,
        color: inkColor,
        font,
        position: tile ? "tile" : position,
        pages: pageMode === "some" ? pageList : undefined,
        layer,
        ...(mode === "image" && image
          ? { image: { bytes: image.bytes, scale: imageScale } }
          : {}),
      }),
    );
  };

  if (result) {
    const pages = result.pages;
    const plural = (n: number) => (n === 1 ? "" : "s");
    const where =
      pages === result.totalPages
        ? `Stamped on all ${pages} page${plural(pages)}`
        : `Stamped on ${pages} of ${result.totalPages} page${plural(result.totalPages)}`;
    const marks =
      result.placements > pages ? ` · ${result.placements} marks in all` : "";
    // The size is a ceiling: a page too small for it got the largest size that
    // fits. Say so — the reader otherwise finds a smaller watermark than the
    // slider showed and no reason why.
    const shrunk =
      result.shrunkPages > 0
        ? ` · Shrunk to fit on ${result.shrunkPages} of ${pages} page${plural(pages)}`
        : "";
    return (
      <ResultPanel
        title="Watermark added"
        summary={`${where}${marks}${shrunk} · ${formatBytes(result.bytes.byteLength)}`}
        onReset={onReset}
        output={outputFile(result.bytes, watermarkedOutputName(pdf.file.name))}
        onAdjust={reset}
        expectedPages={pdf.pageCount}
      >
        <button
          type="button"
          onClick={() =>
            downloadBytes(result.bytes, watermarkedOutputName(pdf.file.name))
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download watermarked PDF
        </button>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection title="Watermark">
        <div className="flex flex-col gap-3">
          <SegmentedControl
            label="Watermark type"
            value={mode}
            onChange={setMode}
            options={[
              { value: "text", label: "Text" },
              { value: "image", label: "Image" },
            ]}
          />
          {mode === "text" ? (
            <TextField
              label="Text"
              value={text}
              onChange={setText}
              placeholder="e.g. CONFIDENTIAL, DRAFT, SAMPLE"
            />
          ) : image ? (
            <div className="border-line bg-wash rounded-ctl flex items-center gap-2 border px-3 py-2 text-sm">
              <ImageIcon className="text-muted size-4 shrink-0" aria-hidden />
              <span className="text-fg min-w-0 flex-1 truncate">
                {image.name}
              </span>
              <span className="text-muted shrink-0 text-xs">
                {formatBytes(image.bytes.byteLength)}
              </span>
              <button
                type="button"
                onClick={() => setImage(null)}
                aria-label="Remove watermark image"
                className="text-muted hover:text-fg shrink-0 transition"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          ) : (
            <Dropzone
              onFiles={(files) => void onImage(files)}
              accept="image/png,image/jpeg"
              multiple={false}
              compact
              title="Drop a logo or image, or"
              hint="PNG or JPEG · placed locally, never uploaded"
            />
          )}
          {mode === "image" && imageError && <ErrorNote message={imageError} />}
        </div>
      </RunnerSection>

      <RunnerSection title="Appearance">
        <div className="grid gap-5 sm:grid-cols-2">
          <RangeField
            label="Opacity"
            value={opacity}
            min={5}
            max={100}
            onChange={setOpacity}
            format={(v) => `${v}%`}
          />
          <RangeField
            label="Rotation"
            value={rotation}
            min={-90}
            max={90}
            onChange={setRotation}
            format={(v) => `${v}°`}
          />
          {mode === "text" ? (
            <RangeField
              label="Max font size"
              value={fontSize}
              min={16}
              max={160}
              onChange={setFontSize}
              format={(v) => `${v} pt`}
            />
          ) : (
            <RangeField
              label="Image size"
              value={imageScale}
              min={5}
              max={100}
              onChange={setImageScale}
              format={(v) => `${v}% of page width`}
            />
          )}
          {mode === "text" && (
            <div className="flex flex-col gap-2">
              <span className="text-muted text-xs font-medium">Font</span>
              <SegmentedControl
                label="Watermark font"
                value={font}
                onChange={setFont}
                options={STAMP_FONT_FAMILIES.map((family) => ({
                  value: family,
                  label: STAMP_FONT_LABELS[family],
                }))}
              />
            </div>
          )}
          {mode === "text" && (
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="text-muted text-xs font-medium">Color</span>
              <div className="flex flex-wrap items-center gap-3">
                <SegmentedControl
                  label="Watermark color"
                  value={color}
                  onChange={setColor}
                  options={[
                    { value: "gray", label: "Gray" },
                    { value: "red", label: "Red" },
                    { value: "blue", label: "Blue" },
                    { value: "custom", label: "Custom" },
                  ]}
                />
                {color === "custom" && (
                  <ColorField
                    label="Custom color"
                    value={customHex}
                    onChange={setCustomHex}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </RunnerSection>

      <RunnerSection title="Placement">
        <div className="flex flex-wrap items-start gap-6">
          <PositionPicker
            label="Watermark position"
            value={position}
            onChange={setPosition}
            disabled={tile}
          />
          <div className="flex min-w-52 flex-1 flex-col gap-3">
            <CheckboxField
              label="Tile across the page"
              checked={tile}
              onChange={setTile}
              hint="Repeats the mark in rows; only whole copies are drawn. A smaller size fits more."
            />
          </div>
        </div>
      </RunnerSection>

      <MoreOptions
        label="Pages and layer"
        open={moreOpen}
        onToggle={setMoreOpen}
      >
        <div className="flex flex-col gap-3">
          <span className="text-muted text-xs font-medium">Pages</span>
          <SegmentedControl
            label="Pages to watermark"
            value={pageMode}
            onChange={setPageMode}
            options={[
              { value: "all", label: "All pages" },
              { value: "some", label: "Selected pages" },
            ]}
          />
          {pageMode === "some" && (
            <TextField
              label={`Pages (1–${pdf.pageCount}), e.g. 1-3, 5`}
              value={pageList}
              onChange={setPageList}
              placeholder="1-3, 5"
            />
          )}
        </div>
        <div className="flex flex-col gap-3">
          <span className="text-muted text-xs font-medium">Layer</span>
          <SegmentedControl
            label="Watermark layer"
            value={layer}
            onChange={setLayer}
            options={[
              { value: "over", label: "Over content" },
              { value: "behind", label: "Behind content" },
            ]}
          />
          {layer === "behind" && (
            <p className="text-muted text-xs">
              Drawn underneath the page, so anything opaque on it — a scanned
              page, a filled background — hides the mark.
            </p>
          )}
        </div>
      </MoreOptions>

      <PrivacyLine>
        The watermark is drawn on your device — your PDF never leaves the
        browser.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunButton
            onClick={onRun}
            busy={busy}
            disabled={!ready}
            busyLabel="Stamping…"
          >
            <Stamp className="size-4" aria-hidden />
            Add watermark
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}
