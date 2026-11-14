import { baseName } from "./files";
import type { ExtractedPdfText } from "./text";
import type { Hunk } from "./compare/hunks";
import type { CompareOptions } from "./compare/lines";

/**
 * Compare PDF's result types and the two helpers its runner needs on first
 * load. The engine — lines, diff, hunks, word marks — is in `./compare/`, and
 * the comparison itself (`compareExtractedPdfText`) with its report and view
 * in the runner's one lazy chunk, `runner/compare/compare-result.tsx`
 * (audit compare-pdf#4, 2026-11-14): the page no longer loads a diff engine
 * before a second file has even been picked.
 */

export interface ComparablePdfText {
  name: string;
  size: number;
  extracted: ExtractedPdfText;
}

export type DiffLineKind = "same" | "added" | "removed";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** Index into the first PDF's comparable lines (same, removed). */
  left?: number;
  /** Index into the second PDF's comparable lines (same, added). */
  right?: number;
}

export interface CompareSummary {
  addedLines: number;
  removedLines: number;
  unchangedLines: number;
  changedLines: number;
}

/**
 * What a comparison found. The no-text verdicts name the side, because the
 * only useful thing to tell a user holding a signed scan and the file it was
 * printed from is WHICH one needs OCR — diffing them lists every line of the
 * other file as changed.
 */
export const COMPARE_VERDICTS = [
  "identical",
  "different",
  "no-text",
  "left-no-text",
  "right-no-text",
] as const;
export type CompareVerdict = (typeof COMPARE_VERDICTS)[number];

export interface PdfCompareResult {
  leftName: string;
  rightName: string;
  leftPageCount: number;
  rightPageCount: number;
  pageDelta: number;
  leftSize: number;
  rightSize: number;
  sizeDelta: number;
  /** Whether each side has any selectable text at all. */
  leftHasText: boolean;
  rightHasText: boolean;
  /** Both sides have selectable text, so a text diff means something. */
  hasComparableText: boolean;
  /** Only ever true when `verdict === "identical"`. */
  identicalText: boolean;
  verdict: CompareVerdict;
  summary: CompareSummary;
  diff: DiffLine[];
  /** The changes, grouped with their context and the pages they sit on. */
  hunks: Hunk[];
  /** What the comparison set aside; identical means identical UNDER these. */
  options: CompareOptions;
  /** Lines left out by "ignore page headers and numbers", per side. */
  dropped: { left: number; right: number };
  /** Pages with no selectable text, per side (1-based). */
  pagesWithoutText: { left: number[]; right: number[] };
  /** Changed lines marked whole because a word-mark bound skipped them. */
  wordFallbacks: number;
  report: string;
}

export function compareOutputName(leftName: string, rightName: string): string {
  return `${baseName(leftName)}-vs-${baseName(rightName)}-comparison.txt`;
}

/** The name of the file with no selectable text, for one-sided verdicts. */
export function fileWithoutText(
  result: Pick<PdfCompareResult, "verdict" | "leftName" | "rightName">,
): string | null {
  if (result.verdict === "left-no-text") return result.leftName;
  if (result.verdict === "right-no-text") return result.rightName;
  return null;
}
