"use client";

import { useCallback, useState } from "react";
import { batchMaxFilesFor, SETTINGS_BATCH_TOOLS } from "@/lib/batch/tools";
import {
  GRAYSCALE_DPI_PRESETS,
  GRAYSCALE_GREW_NOTE,
  grayscaleOutputName,
  grayscalePdf,
  grayscalePresetById,
} from "@/lib/pdf/grayscale";
import type { SinglePdfBatch } from "../single-pdf-runner";
import { BatchChoice } from "./batch-choice";
import {
  SettingsBatchRunner,
  type BatchFileOutput,
} from "./settings-batch-runner";
import type { OpenedPdf } from "./open-for-batch";

/**
 * The single-file editor's quality choices, its labels and its default
 * ("print"): the same `GRAYSCALE_DPI_PRESETS`, so the two cannot drift.
 */
export const GRAYSCALE_BATCH_DEFAULT = "print";
const PRESETS = GRAYSCALE_DPI_PRESETS.map((preset) => ({
  value: preset.id as string,
  label: `${preset.label} (${preset.dpi} DPI)`,
}));

/**
 * Grayscale one file: the single-file editor's own engine, preset and
 * download name. Every page is drawn at the preset's DPI, under the same
 * per-page pixel ceiling as one file on its own.
 */
export async function grayscaleOneFile(
  { file, bytes }: OpenedPdf,
  presetId: string,
  signal: AbortSignal,
): Promise<BatchFileOutput> {
  const preset = grayscalePresetById(presetId);
  const result = await grayscalePdf(bytes, {
    dpi: preset.dpi,
    sourceName: file.name,
    signal,
  });
  const n = result.pageCount;
  const notes = [
    result.bytes.byteLength > bytes.byteLength ? GRAYSCALE_GREW_NOTE : "",
    result.undecodedImages > 0
      ? `${result.undecodedImages} image${result.undecodedImages === 1 ? "" : "s"} could not be decoded and ${result.undecodedImages === 1 ? "is" : "are"} missing`
      : "",
  ].filter(Boolean);
  return {
    name: grayscaleOutputName(file.name),
    bytes: result.bytes,
    detail: `${n} page${n === 1 ? "" : "s"} rasterized`,
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}

/**
 * Grayscale PDF's batch (batch plan P2): one quality for every file, each
 * file drawn page by page in turn, at most `BATCH_LIMITS.rasterMaxFiles`
 * files. pdf.js draws the pages, and it would draw a restricted file without
 * asking, so an encrypted file is refused before it is read
 * (`checkAccessFirst`); the single-file panel takes its password.
 */
export function GrayscaleBatch(props: SinglePdfBatch) {
  const [presetId, setPresetId] = useState(GRAYSCALE_BATCH_DEFAULT);
  const process = useCallback(
    (opened: OpenedPdf, signal: AbortSignal) =>
      grayscaleOneFile(opened, presetId, signal),
    [presetId],
  );
  return (
    <SettingsBatchRunner
      {...props}
      toolName="Grayscale PDF"
      verb="Convert"
      runningLabel="Converting pages…"
      zipName={SETTINGS_BATCH_TOOLS["grayscale-pdf"].zipName}
      maxFiles={batchMaxFilesFor("grayscale-pdf")}
      checkAccessFirst
      appliesNote="Every page of each file becomes a grayscale image, so its text can no longer be selected."
      restrictedNote="Open it on its own to enter its password."
      process={process}
      settings={
        <BatchChoice
          label="Rasterization quality"
          value={presetId}
          onChange={setPresetId}
          options={PRESETS}
        />
      }
    />
  );
}
