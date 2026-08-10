import { baseName } from "./files";
import type { ExtractedPdfText } from "./text";

export interface ComparablePdfText {
  name: string;
  size: number;
  extracted: ExtractedPdfText;
}

export type DiffLineKind = "same" | "added" | "removed";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface CompareSummary {
  addedLines: number;
  removedLines: number;
  unchangedLines: number;
  changedLines: number;
}

export interface PdfCompareResult {
  leftName: string;
  rightName: string;
  leftPageCount: number;
  rightPageCount: number;
  pageDelta: number;
  leftSize: number;
  rightSize: number;
  sizeDelta: number;
  hasComparableText: boolean;
  identicalText: boolean;
  summary: CompareSummary;
  diff: DiffLine[];
  report: string;
}

function normalizeComparableText(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Line diff via LCS. This favors stable readable reports over minimal edit
 * scripts and is bounded by the selectable-text line count, not page pixels.
 */
export function diffLines(leftText: string, rightText: string): DiffLine[] {
  const left = normalizeComparableText(leftText);
  const right = normalizeComparableText(rightText);
  const dp = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      dp[i]![j] =
        left[i] === right[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      out.push({ kind: "same", text: left[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ kind: "removed", text: left[i]! });
      i += 1;
    } else {
      out.push({ kind: "added", text: right[j]! });
      j += 1;
    }
  }
  while (i < left.length) out.push({ kind: "removed", text: left[i++]! });
  while (j < right.length) out.push({ kind: "added", text: right[j++]! });
  return out;
}

function summarize(diff: DiffLine[]): CompareSummary {
  const addedLines = diff.filter((line) => line.kind === "added").length;
  const removedLines = diff.filter((line) => line.kind === "removed").length;
  const unchangedLines = diff.filter((line) => line.kind === "same").length;
  return {
    addedLines,
    removedLines,
    unchangedLines,
    changedLines: addedLines + removedLines,
  };
}

export function compareOutputName(leftName: string, rightName: string): string {
  return `${baseName(leftName)}-vs-${baseName(rightName)}-comparison.txt`;
}

function buildReport(result: Omit<PdfCompareResult, "report">): string {
  const lines = [
    `PDF comparison: ${result.leftName} vs ${result.rightName}`,
    "",
    "Scope: selectable text, page count, and file size only. This is not OCR and not a pixel-perfect visual diff.",
    "",
    `Pages: ${result.leftPageCount} vs ${result.rightPageCount} (${result.pageDelta >= 0 ? "+" : ""}${result.pageDelta})`,
    `Bytes: ${result.leftSize} vs ${result.rightSize} (${result.sizeDelta >= 0 ? "+" : ""}${result.sizeDelta})`,
    `Comparable text: ${result.hasComparableText ? "yes" : "no"}`,
    `Selectable text identical: ${result.identicalText ? "yes" : "no"}`,
    `Changed lines: ${result.summary.changedLines} (${result.summary.addedLines} added, ${result.summary.removedLines} removed)`,
    "",
    "Diff:",
  ];
  if (!result.hasComparableText) {
    lines.push(
      "No selectable text was found in either PDF. Use OCR first for scanned/image-only PDFs.",
    );
  } else if (result.diff.length === 0 || result.identicalText) {
    lines.push("No selectable-text differences found.");
  } else {
    for (const line of result.diff) {
      if (line.kind === "same") lines.push(`  ${line.text}`);
      if (line.kind === "added") lines.push(`+ ${line.text}`);
      if (line.kind === "removed") lines.push(`- ${line.text}`);
    }
  }
  return lines.join("\n");
}

export function compareExtractedPdfText(
  left: ComparablePdfText,
  right: ComparablePdfText,
): PdfCompareResult {
  const hasComparableText = left.extracted.hasText || right.extracted.hasText;
  const diff = hasComparableText
    ? diffLines(left.extracted.text, right.extracted.text)
    : [];
  const summary = summarize(diff);
  const comparableLeft = normalizeComparableText(left.extracted.text).join(
    "\n",
  );
  const comparableRight = normalizeComparableText(right.extracted.text).join(
    "\n",
  );
  const base = {
    leftName: left.name,
    rightName: right.name,
    leftPageCount: left.extracted.pageCount,
    rightPageCount: right.extracted.pageCount,
    pageDelta: right.extracted.pageCount - left.extracted.pageCount,
    leftSize: left.size,
    rightSize: right.size,
    sizeDelta: right.size - left.size,
    hasComparableText,
    identicalText: hasComparableText && comparableLeft === comparableRight,
    summary,
    diff,
  };
  return { ...base, report: buildReport(base) };
}
