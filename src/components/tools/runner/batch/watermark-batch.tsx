"use client";

import { useCallback, useMemo, useState } from "react";
import { ImageIcon, X } from "lucide-react";
import {
  SETTINGS_BATCH_TOOLS,
  WATERMARK_BATCH_PAGES_NOTE,
} from "@/lib/batch/tools";
import { parseRanges } from "@/lib/pdf/ranges";
import {
  DEFAULT_IMAGE_SCALE,
  watermarkImageProblem,
  watermarkPdf,
  watermarkedOutputName,
  type WatermarkOptions,
} from "@/lib/pdf/watermark";
import { formatBytes } from "@/lib/utils";
import { Dropzone, ErrorNote, errorMessage } from "../runner-kit";
import type { SinglePdfBatch } from "../single-pdf-runner";
import {
  CheckboxField,
  PositionPicker,
  RangeField,
  SegmentedControl,
  TextField,
} from "../stamp-controls";
import {
  SettingsBatchRunner,
  type BatchFileOutput,
} from "./settings-batch-runner";
import type { OpenedPdf } from "./open-for-batch";

/** The mark every file gets: text, or one picked image. */
export interface WatermarkBatchMark {
  text: string;
  image?: { bytes: Uint8Array; scale: number };
}

/**
 * Stamp one file. The page list goes to the engine as typed, and its check
 * (`watermarkPageIndices`, the parser Extract and Remove pages use) runs
 * before the first page is touched: a file with fewer pages than the list
 * names fails with that file's count, and no file is stamped on a shorter
 * list than the one asked for.
 */
export async function watermarkOneFile(
  { file, bytes }: OpenedPdf,
  mark: WatermarkBatchMark,
  options: Omit<WatermarkOptions, "image">,
): Promise<BatchFileOutput> {
  const report = await watermarkPdf(bytes, mark.image ? "" : mark.text, {
    ...options,
    ...(mark.image ? { image: mark.image } : {}),
  });
  const plural = (n: number) => (n === 1 ? "" : "s");
  return {
    name: watermarkedOutputName(file.name),
    bytes: report.bytes,
    detail:
      report.pages === report.totalPages
        ? `Stamped on all ${report.pages} page${plural(report.pages)}`
        : `Stamped on ${report.pages} of ${report.totalPages} page${plural(report.totalPages)}`,
    ...(report.shrunkPages > 0
      ? {
          note: `Shrunk to fit on ${report.shrunkPages} of ${report.pages} page${plural(report.pages)}`,
        }
      : {}),
  };
}

/**
 * A typed page list's mistake that no file could fix, or null. Checked as
 * ranges (`parseRanges`), never expanded: an open-ended token ("3-", or "1-"
 * on the way to "1-3") resolves against the bound, and expanding it to
 * Number.MAX_SAFE_INTEGER pages froze the tab and threw "Set maximum size
 * exceeded" on every keystroke (review 2026-11-08). Each file resolves the
 * list against its own page count in `watermarkPageIndices`.
 */
function pageListProblem(list: string): string | null {
  try {
    parseRanges(list, Number.MAX_SAFE_INTEGER);
    return null;
  } catch (err) {
    return errorMessage(err);
  }
}

/** Add Watermark's batch: one text or image, on every file. */
export function WatermarkBatch(props: SinglePdfBatch) {
  const [mode, setMode] = useState<"text" | "image">("text");
  const [text, setText] = useState("CONFIDENTIAL");
  const [image, setImage] = useState<{
    name: string;
    bytes: Uint8Array;
  } | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(18);
  const [rotation, setRotation] = useState(45);
  const [position, setPosition] =
    useState<NonNullable<WatermarkOptions["position"]>>("middle-center");
  const [tile, setTile] = useState(false);
  const [pageMode, setPageMode] = useState<"all" | "some">("all");
  const [pageList, setPageList] = useState("");

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

  const listProblem = useMemo(
    () =>
      pageMode === "some" && pageList.trim() !== ""
        ? pageListProblem(pageList)
        : null,
    [pageMode, pageList],
  );
  const runBlocked =
    mode === "text" && text.trim().length === 0
      ? "Type the watermark text first."
      : mode === "image" && image === null
        ? "Choose the watermark image first."
        : pageMode === "some" && pageList.trim() === ""
          ? "Type which pages get the watermark first."
          : listProblem;

  const process = useCallback(
    (opened: OpenedPdf) =>
      watermarkOneFile(
        opened,
        mode === "image" && image
          ? {
              text: "",
              image: { bytes: image.bytes, scale: DEFAULT_IMAGE_SCALE },
            }
          : { text },
        {
          opacity: opacity / 100,
          rotation,
          position: tile ? "tile" : position,
          ...(pageMode === "some" ? { pages: pageList } : {}),
        },
      ),
    [mode, image, text, opacity, rotation, tile, position, pageMode, pageList],
  );

  return (
    <SettingsBatchRunner
      {...props}
      toolName="Add Watermark"
      verb="Watermark"
      runningLabel="Stamping…"
      zipName={SETTINGS_BATCH_TOOLS["watermark-pdf"].zipName}
      appliesNote={pageMode === "some" ? WATERMARK_BATCH_PAGES_NOTE : undefined}
      runBlocked={runBlocked}
      process={process}
      settings={
        <>
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
                className="text-muted hover:text-fg rounded-ctl grid size-11 shrink-0 place-items-center transition sm:size-8"
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
          </div>
          <div className="flex flex-wrap items-start gap-6">
            <PositionPicker
              label="Watermark position"
              value={position === "tile" ? "middle-center" : position}
              onChange={setPosition}
              disabled={tile}
            />
            <div className="flex min-w-52 flex-1 flex-col gap-3">
              <CheckboxField
                label="Tile across the page"
                checked={tile}
                onChange={setTile}
              />
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
                  label="Pages in every file, e.g. 1-3, 5"
                  value={pageList}
                  onChange={setPageList}
                  placeholder="1-3, 5"
                />
              )}
            </div>
          </div>
        </>
      }
    />
  );
}
