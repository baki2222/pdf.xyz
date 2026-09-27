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
 * The largest LCS table `diffLines` will build for one stretch of the
 * documents, in cells. At two bytes a cell that is 50 MB and well under a
 * second in the worst case — a size a phone's tab survives.
 *
 * It bounds a STRETCH, not the documents: stretches too big for one table are
 * first cut at lines that occur exactly once on each side (patience anchors),
 * so two versions of a 1,000-page contract with edits scattered through it
 * never build a table larger than the gap between two unchanged lines.
 */
export const MAX_DIFF_CELLS = 25_000_000;

/**
 * Thrown instead of building a table the tab cannot hold. Before this bound
 * existed the table was built anyway: 801 MB for 10k × 10k lines, and past that
 * the tab died with no message. `useAsyncRun` shows this one in the runner.
 */
export class CompareTooLargeError extends Error {
  constructor(
    readonly leftLines: number,
    readonly rightLines: number,
  ) {
    super(
      `These PDFs differ in too many places to compare line by line in your browser (${leftLines.toLocaleString("en-US")} vs ${rightLines.toLocaleString("en-US")} differing lines). Split them into smaller parts and compare those one at a time.`,
    );
    this.name = "CompareTooLargeError";
  }
}

/**
 * Line diff. Small stretches get an LCS, which favors stable readable reports
 * over minimal edit scripts. Around it:
 *
 * - the shared prefix and suffix of every stretch are emitted as-is;
 * - a stretch too large for one `MAX_DIFF_CELLS` table is split at lines that
 *   are unique on both sides and in order (a patience diff), and each gap is
 *   diffed on its own;
 * - a large stretch with no such line is refused with `CompareTooLargeError`.
 *
 * Memory is one table at a time, never more than `MAX_DIFF_CELLS` cells.
 */
export function diffLines(leftText: string, rightText: string): DiffLine[] {
  const left = normalizeComparableText(leftText);
  const right = normalizeComparableText(rightText);

  // Compare integers, not strings, in every loop below.
  const ids = new Map<string, number>();
  const idOf = (line: string) => {
    let id = ids.get(line);
    if (id === undefined) ids.set(line, (id = ids.size));
    return id;
  };
  const a = Int32Array.from(left, idOf);
  const b = Int32Array.from(right, idOf);

  const out: DiffLine[] = [];
  const same = (i: number) => out.push({ kind: "same", text: left[i]! });
  const removed = (i: number) => out.push({ kind: "removed", text: left[i]! });
  const added = (j: number) => out.push({ kind: "added", text: right[j]! });

  const walk = (aLo: number, aHi: number, bLo: number, bHi: number): void => {
    while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
      same(aLo);
      aLo += 1;
      bLo += 1;
    }
    let suffix = 0;
    while (
      aHi - suffix > aLo &&
      bHi - suffix > bLo &&
      a[aHi - 1 - suffix] === b[bHi - 1 - suffix]
    ) {
      suffix += 1;
    }
    aHi -= suffix;
    bHi -= suffix;

    const n = aHi - aLo;
    const m = bHi - bLo;
    if (n === 0 || m === 0) {
      for (let i = aLo; i < aHi; i += 1) removed(i);
      for (let j = bLo; j < bHi; j += 1) added(j);
    } else if ((n + 1) * (m + 1) <= MAX_DIFF_CELLS) {
      lcs(aLo, aHi, bLo, bHi);
    } else {
      const anchors = uniqueAnchors(a, aLo, aHi, b, bLo, bHi);
      if (anchors.length === 0) throw new CompareTooLargeError(n, m);
      let pa = aLo;
      let pb = bLo;
      for (const [ai, bj] of anchors) {
        walk(pa, ai, pb, bj);
        same(ai);
        pa = ai + 1;
        pb = bj + 1;
      }
      walk(pa, aHi, pb, bHi);
    }
    for (let i = aHi; i < aHi + suffix; i += 1) same(i);
  };

  const lcs = (aLo: number, aHi: number, bLo: number, bHi: number): void => {
    const n = aHi - aLo;
    const m = bHi - bLo;
    const width = m + 1;
    // An LCS length never exceeds min(n, m); pick the narrowest cell that fits.
    const dp = new (Math.min(n, m) < 0xffff ? Uint16Array : Uint32Array)(
      (n + 1) * width,
    );
    for (let i = n - 1; i >= 0; i -= 1) {
      const row = i * width;
      const below = row + width;
      const ai = a[aLo + i];
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[row + j] =
          ai === b[bLo + j]
            ? dp[below + j + 1]! + 1
            : Math.max(dp[below + j]!, dp[row + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[aLo + i] === b[bLo + j]) {
        same(aLo + i);
        i += 1;
        j += 1;
      } else if (dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!) {
        removed(aLo + i);
        i += 1;
      } else {
        added(bLo + j);
        j += 1;
      }
    }
    for (; i < n; i += 1) removed(aLo + i);
    for (; j < m; j += 1) added(bLo + j);
  };

  walk(0, a.length, 0, b.length);
  return out;
}

/**
 * Lines that occur exactly once in `a[aLo..aHi)` and once in `b[bLo..bHi)`,
 * reduced to the longest run that is in the same order on both sides (a
 * patience sort). Returned as [leftIndex, rightIndex] pairs, ascending.
 */
function uniqueAnchors(
  a: Int32Array,
  aLo: number,
  aHi: number,
  b: Int32Array,
  bLo: number,
  bHi: number,
): [number, number][] {
  // id -> index on that side, or -1 once seen twice.
  const inA = new Map<number, number>();
  for (let i = aLo; i < aHi; i += 1) {
    const id = a[i]!;
    inA.set(id, inA.has(id) ? -1 : i);
  }
  const inB = new Map<number, number>();
  for (let j = bLo; j < bHi; j += 1) {
    const id = b[j]!;
    if (inA.has(id)) inB.set(id, inB.has(id) ? -1 : j);
  }

  const pairs: [number, number][] = [];
  for (let i = aLo; i < aHi; i += 1) {
    const id = a[i]!;
    if (inA.get(id) !== i) continue;
    const j = inB.get(id);
    if (j !== undefined && j >= 0) pairs.push([i, j]);
  }

  // Longest strictly increasing subsequence of the right-hand indices.
  const tails: number[] = [];
  const prev = new Int32Array(pairs.length).fill(-1);
  for (let k = 0; k < pairs.length; k += 1) {
    const j = pairs[k]![1];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]!]![1] < j) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1]!;
    tails[lo] = k;
  }
  const chain: [number, number][] = [];
  for (let k = tails.at(-1) ?? -1; k >= 0; k = prev[k]!) chain.push(pairs[k]!);
  return chain.reverse();
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

/** The name of the file with no selectable text, for one-sided verdicts. */
export function fileWithoutText(
  result: Pick<PdfCompareResult, "verdict" | "leftName" | "rightName">,
): string | null {
  if (result.verdict === "left-no-text") return result.leftName;
  if (result.verdict === "right-no-text") return result.rightName;
  return null;
}

function buildReport(result: Omit<PdfCompareResult, "report">): string {
  const scanned = fileWithoutText(result);
  const compared = result.hasComparableText;
  const lines = [
    `PDF comparison: ${result.leftName} vs ${result.rightName}`,
    "",
    "Scope: selectable text, page count, and file size only. This is not OCR and not a pixel-perfect visual diff.",
    "",
    `Pages: ${result.leftPageCount} vs ${result.rightPageCount} (${result.pageDelta >= 0 ? "+" : ""}${result.pageDelta})`,
    `Bytes: ${result.leftSize} vs ${result.rightSize} (${result.sizeDelta >= 0 ? "+" : ""}${result.sizeDelta})`,
    `Comparable text: ${
      compared
        ? "yes"
        : scanned
          ? `no (${scanned} has no selectable text)`
          : "no (neither PDF has selectable text)"
    }`,
    // Without text on both sides there is no evidence either way, so neither
    // "yes" nor "no" is a claim this report can make.
    `Selectable text identical: ${compared ? (result.identicalText ? "yes" : "no") : "not compared"}`,
    compared
      ? `Changed lines: ${result.summary.changedLines} (${result.summary.addedLines} added, ${result.summary.removedLines} removed)`
      : "Changed lines: not compared",
    "",
    "Diff:",
  ];
  if (scanned) {
    lines.push(
      `${scanned} has no selectable text, so there is nothing to compare the other file's text against. It is probably a scanned or image-only PDF: run OCR PDF on it first, then compare again.`,
    );
  } else if (!compared) {
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

function verdictOf(
  leftHasText: boolean,
  rightHasText: boolean,
  sameText: boolean,
): CompareVerdict {
  if (!leftHasText && !rightHasText) return "no-text";
  if (!leftHasText) return "left-no-text";
  if (!rightHasText) return "right-no-text";
  return sameText ? "identical" : "different";
}

export function compareExtractedPdfText(
  left: ComparablePdfText,
  right: ComparablePdfText,
): PdfCompareResult {
  const leftHasText = left.extracted.hasText;
  const rightHasText = right.extracted.hasText;
  // BOTH, not either: diffing a scan against the file it was printed from
  // reports every line of the other file as changed.
  const hasComparableText = leftHasText && rightHasText;
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
  const verdict = verdictOf(
    leftHasText,
    rightHasText,
    comparableLeft === comparableRight,
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
    leftHasText,
    rightHasText,
    hasComparableText,
    identicalText: verdict === "identical",
    verdict,
    summary,
    diff,
  };
  return { ...base, report: buildReport(base) };
}
