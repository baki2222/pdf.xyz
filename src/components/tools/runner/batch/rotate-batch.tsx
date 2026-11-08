"use client";

import { useCallback, useState } from "react";
import { SETTINGS_BATCH_TOOLS } from "@/lib/batch/tools";
import {
  getPageRotations,
  normalizeAngle,
  setPageRotations,
} from "@/lib/pdf/engine";
import { outputName } from "@/lib/pdf/files";
import type { SinglePdfBatch } from "../single-pdf-runner";
import { SegmentedControl } from "../stamp-controls";
import {
  SettingsBatchRunner,
  type BatchFileOutput,
} from "./settings-batch-runner";
import type { OpenedPdf } from "./open-for-batch";

/** The one setting: how far every page of every file turns. */
export const ROTATE_BATCH_TURNS = [
  // The single-file editor's own chip labels: Left and Right are a quarter
  // turn each way, 180° flips the page.
  { value: "-90", label: "Left" },
  { value: "90", label: "Right" },
  { value: "180", label: "180°" },
] as const;

type Turn = (typeof ROTATE_BATCH_TURNS)[number]["value"];

/**
 * Turn every page of one file by `turn` degrees, on top of the angle it
 * has: the single-file editor's own path (`getPageRotations` →
 * `setPageRotations`), in place, never a rebuild.
 */
export async function rotateWholeFile(
  { file, bytes }: OpenedPdf,
  turn: number,
): Promise<BatchFileOutput> {
  const rotations = await getPageRotations(bytes);
  const rotated = await setPageRotations(
    bytes,
    rotations.map((r) => normalizeAngle(r + turn)),
  );
  const n = rotations.length;
  return {
    name: outputName(file.name, "rotated"),
    bytes: rotated,
    detail: `${n} page${n === 1 ? "" : "s"} rotated`,
  };
}

/**
 * Rotate PDF's batch: every page of every file turns the same way. Turning
 * single pages stays in the single-file editor, where each page has a tile.
 */
export function RotateBatch(props: SinglePdfBatch) {
  const [turn, setTurn] = useState<Turn>("90");
  const process = useCallback(
    (opened: OpenedPdf) => rotateWholeFile(opened, Number(turn)),
    [turn],
  );
  return (
    <SettingsBatchRunner
      {...props}
      toolName="Rotate PDF"
      verb="Rotate"
      runningLabel="Rotating…"
      zipName={SETTINGS_BATCH_TOOLS["rotate-pdf"].zipName}
      appliesNote="Every page of every file turns the same way; to turn single pages, open one file on its own."
      restrictedNote="Rotate it on its own: Rotate PDF opens a restricted file whose author allowed page changes."
      process={process}
      settings={
        <SegmentedControl
          label="Rotate every page"
          value={turn}
          onChange={setTurn}
          options={[...ROTATE_BATCH_TURNS]}
        />
      }
    />
  );
}
