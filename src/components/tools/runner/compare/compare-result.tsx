"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type {
  CompareSummary,
  CompareVerdict,
  ComparablePdfText,
  DiffLine,
  PdfCompareResult,
} from "@/lib/pdf/compare-pdf";
import type { Op } from "@/lib/pdf/compare/diff";
import { diffWithFurniture } from "@/lib/pdf/compare/furniture";
import { buildHunks, hunkHeader, type Hunk } from "@/lib/pdf/compare/hunks";
import {
  comparableLines,
  foldCase,
  type CompareOptions,
} from "@/lib/pdf/compare/lines";
import {
  markWords,
  pairChangedLines,
  type WordToken,
} from "@/lib/pdf/compare/words";
import { cn } from "@/lib/utils";
import { scrollWithin } from "../viewer/scroll-within";
import { buildReport, optionsPhrase } from "./report";

/**
 * Compare PDF's result: the comparison itself and the view of its changes.
 * The runner's ONE lazy chunk (`import("./compare/compare-result")`), fetched
 * beside the two text extractions, or as the second file lands — so the
 * compare page's first load carries no diff engine, and every other page's
 * webpack runtime one chunk-map entry. `lazy-chunks.test.ts` holds it off
 * every page's first load by {@link COMPARE_RESULT_CHUNK}, which only the view
 * renders, so the marker survives minification only where it is drawn.
 */
export const COMPARE_RESULT_CHUNK = "pdfxyz:lazy:compare-result";

/**
 * Rows drawn at first; the rest wait behind "Show more changes", which draws
 * this many more. A budget of ROWS, not hunks: changes four or fewer lines
 * apart merge into one hunk, so a hunk has no size of its own. Until
 * 2026-11-14 the budget was 200 hunks, and 10,000 small edits made one hunk
 * of 30,000 rows, every one drawn (about a second of main thread on a
 * desktop; compare-result.test.tsx, "draws a bounded number of rows").
 */
export const ROWS_SHOWN = 1_500;

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

function summarize(ops: readonly Op[]): CompareSummary {
  let addedLines = 0;
  let removedLines = 0;
  let unchangedLines = 0;
  for (const op of ops) {
    if (op.k === "added") addedLines += 1;
    else if (op.k === "removed") removedLines += 1;
    else unchangedLines += 1;
  }
  return {
    addedLines,
    removedLines,
    unchangedLines,
    changedLines: addedLines + removedLines,
  };
}

/**
 * Compare the selectable text of two PDFs. The verdict and the hunks are
 * read from the SAME edit script — identical exactly when it lists no
 * change — so "identical" and "no changes listed" cannot disagree under any
 * option (`engine.test.ts` enumerates them). With no option set, that is the
 * old verdict (the two normalised texts joined and compared), because a line
 * never holds "\n".
 */
export function compareExtractedPdfText(
  left: ComparablePdfText,
  right: ComparablePdfText,
  options: CompareOptions = {},
): PdfCompareResult {
  const leftHasText = left.extracted.hasText;
  const rightHasText = right.extracted.hasText;
  // BOTH, not either: diffing a scan against the file it was printed from
  // reports every line of the other file as changed.
  const hasComparableText = leftHasText && rightHasText;
  const allA = comparableLines(left.extracted, options);
  const allB = comparableLines(right.extracted, options);
  for (const [side, doc] of [
    [left, allA],
    [right, allB],
  ] as const) {
    // `hasText` and the pages come from one extraction; text with no lines
    // means a caller built them separately, and every verdict would lie.
    if (side.extracted.hasText && doc.lines.length === 0)
      throw new Error(
        `${side.name}: its text and its pages disagree; compare cannot read it.`,
      );
  }

  // The furniture a comparison sets aside is decided against both files
  // (furniture.ts), so the lines below are what was KEPT, renumbered.
  const furniture = hasComparableText
    ? diffWithFurniture(
        allA.lines,
        allB.lines,
        Boolean(options.ignoreFurniture),
      )
    : null;
  const ops = furniture?.ops ?? [];
  const a = {
    lines: furniture
      ? furniture.keptLeft.map((i) => allA.lines[i]!)
      : allA.lines,
    pagesWithoutText: allA.pagesWithoutText,
  };
  const b = {
    lines: furniture
      ? furniture.keptRight.map((j) => allB.lines[j]!)
      : allB.lines,
    pagesWithoutText: allB.pagesWithoutText,
  };
  const dropped = furniture?.dropped ?? { left: 0, right: 0 };
  // Identical exactly when the script lists no change. With no option set
  // that is the old verdict (the two normalised texts joined and compared):
  // an LCS with no change is the same sequence on both sides.
  const verdict = verdictOf(
    leftHasText,
    rightHasText,
    ops.every((op) => op.k === "same"),
  );

  const diff: DiffLine[] = ops.map((op) =>
    op.k === "same"
      ? { kind: "same", text: a.lines[op.a]!.text, left: op.a, right: op.b }
      : op.k === "removed"
        ? { kind: "removed", text: a.lines[op.a]!.text, left: op.a }
        : { kind: "added", text: b.lines[op.b]!.text, right: op.b },
  );
  const leftTexts = a.lines.map((l) => l.text);
  const rightTexts = b.lines.map((l) => l.text);
  const tokenKey = options.ignoreCase ? foldCase : undefined;
  const words = markWords(
    pairChangedLines(ops, leftTexts, rightTexts, tokenKey),
    leftTexts,
    rightTexts,
    tokenKey,
  );
  const hunks = buildHunks(
    ops,
    (i) => a.lines[i]!.page,
    (j) => b.lines[j]!.page,
    words.pairs,
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
    summary: summarize(ops),
    diff,
    hunks,
    options: { ...options },
    dropped,
    pagesWithoutText: {
      left: a.pagesWithoutText,
      right: b.pagesWithoutText,
    },
    wordFallbacks: words.fallbacks,
  };
  return { ...base, report: buildReport(base) };
}

/* ------------------------------------------------------------------ *
 *  The view
 * ------------------------------------------------------------------ */

/** The marked text of one side of a pair, or the whole line in one mark. */
function sideText(
  tokens: readonly WordToken[] | null | undefined,
  side: "removed" | "added",
  text: string,
): ReactNode {
  const Mark = side === "removed" ? "del" : "ins";
  if (!tokens) return <Mark className="decoration-2">{text}</Mark>;
  // Most screen readers say nothing for <del> and <ins>: the words around
  // each mark say where it starts and ends.
  return tokens.map((t, i) =>
    t.k === "same" ? (
      <span key={i}>{side === "added" ? (t.right ?? t.text) : t.text}</span>
    ) : t.k === side ? (
      <span key={i}>
        <span className="sr-only">{`[${side}: `}</span>
        <Mark className="decoration-2">{t.text}</Mark>
        <span className="sr-only">]</span>
      </span>
    ) : null,
  );
}

function HunkTable({
  hunk,
  rows,
  leftText,
  rightText,
}: {
  hunk: Hunk;
  /** How many of the hunk's rows to draw. */
  rows: number;
  leftText: Map<number, string>;
  rightText: Map<number, string>;
}) {
  const byLeft = new Map(hunk.pairs.map((p) => [p.left, p.tokens]));
  const byRight = new Map(hunk.pairs.map((p) => [p.right, p.tokens]));
  return (
    <table className="w-full border-collapse font-mono text-xs leading-5">
      <tbody>
        {hunk.ops.slice(0, rows).map((op, i) => {
          if (op.k === "same")
            return (
              <tr key={i} className="text-muted">
                <td aria-hidden className="w-6 px-2 align-top select-none" />
                <td className="py-0.5 pr-2 wrap-anywhere whitespace-pre-wrap">
                  {leftText.get(op.a)}
                </td>
              </tr>
            );
          const removed = op.k === "removed";
          const text = removed ? leftText.get(op.a)! : rightText.get(op.b)!;
          const tokens = removed ? byLeft.get(op.a) : byRight.get(op.b);
          return (
            <tr
              key={i}
              data-kind={op.k}
              className={cn("text-fg", removed ? "bg-err/10" : "bg-ok/10")}
            >
              <td
                aria-hidden
                className={cn(
                  "w-6 px-2 align-top font-semibold select-none",
                  removed ? "text-err" : "text-ok",
                )}
              >
                {removed ? "−" : "+"}
              </td>
              <td className="py-0.5 pr-2 wrap-anywhere whitespace-pre-wrap">
                <span className="sr-only">
                  {removed ? "Removed: " : "Added: "}
                </span>
                {sideText(tokens, removed ? "removed" : "added", text)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * The changes, one section per hunk, with Previous/Next change, a live
 * "Change 3 of 12" line and the two ignore options. Keys inside the region,
 * never in a field: n or j for the next change, Shift+n or k for the one
 * before.
 */
export function CompareChanges({
  result,
  options,
  onOptions,
  rowsShown = ROWS_SHOWN,
}: {
  result: PdfCompareResult;
  options: CompareOptions;
  onOptions: (options: CompareOptions) => void;
  /** The row budget; a test sets it to make a few hunks overflow it. */
  rowsShown?: number;
}) {
  const hunks = result.hunks;
  const [currentState, setCurrent] = useState(0);
  const [shownState, setShown] = useState(rowsShown);
  const headings = useRef<(HTMLHeadingElement | null)[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const focusPending = useRef(false);
  const id = useId();

  // A new result (an option toggled) starts from its first change. The
  // reset is a state update during render, and the rest of THIS render runs
  // before it lands: until 2026-11-14 it read the old index, past the end of
  // a result with fewer changes, and the view crashed into the error
  // boundary (compare-result.test.tsx, "survives a re-compare with fewer
  // changes"). So this render reads the reset values directly.
  const [forResult, setForResult] = useState(result);
  const resetting = forResult !== result;
  if (resetting) {
    setForResult(result);
    setCurrent(0);
    setShown(rowsShown);
  }
  const current = resetting ? 0 : currentState;
  const shown = resetting ? rowsShown : shownState;

  // rowsBefore[n]: the rows of every hunk before hunk n; the last entry is
  // all of them. Hunk n's heading is drawn while rowsBefore[n] < shown.
  const rowsBefore = useMemo(() => {
    const out = [0];
    for (const h of hunks) out.push(out.at(-1)! + h.ops.length);
    return out;
  }, [hunks]);
  const totalRows = rowsBefore.at(-1)!;
  let drawnHunks = 0;
  while (drawnHunks < hunks.length && rowsBefore[drawnHunks]! < shown)
    drawnHunks += 1;

  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    const heading = headings.current[current];
    if (!heading) return;
    if (scroller.current) scrollWithin(scroller.current, heading, "nearest");
    heading.focus({ preventScroll: true });
  }, [current, shown]);

  const go = (to: number) => {
    if (hunks.length === 0) return;
    const next = Math.min(hunks.length - 1, Math.max(0, to));
    // At either end there is nowhere to go. Leaving focusPending set here
    // moved focus to a heading on the NEXT change of `current` — the reset a
    // ticked box causes — taking it off the box (WCAG 3.2.2).
    if (next === current) return;
    const before = rowsBefore[next]!;
    if (before >= shown)
      setShown(Math.ceil((before + 1) / rowsShown) * rowsShown);
    focusPending.current = true;
    setCurrent(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "SELECT" ||
      target.tagName === "TEXTAREA" ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey
    )
      return;
    const key = e.key.toLowerCase();
    if ((key === "n" && !e.shiftKey) || key === "j") {
      e.preventDefault();
      go(current + 1);
    } else if ((key === "n" && e.shiftKey) || key === "k") {
      e.preventDefault();
      go(current - 1);
    }
  };

  const [leftText, rightText] = useMemo(() => {
    const l = new Map<number, string>();
    const r = new Map<number, string>();
    for (const line of result.diff) {
      if (line.left !== undefined) l.set(line.left, line.text);
      if (line.right !== undefined) r.set(line.right, line.text);
    }
    return [l, r];
  }, [result.diff]);

  const ignoring = optionsPhrase(result.options);
  const status =
    hunks.length === 0
      ? ignoring
        ? `No changes: identical (${ignoring.replace(/ignore/g, "ignoring")})`
        : "No changes"
      : `Change ${current + 1} of ${hunks.length} · ${hunkHeader(
          hunks[current]!,
          "→",
        ).replace(/^P/, "p")}`;
  const navButton =
    "border-line text-fg hover:bg-wash rounded-ctl inline-flex size-11 shrink-0 items-center justify-center gap-1.5 border text-sm aria-disabled:opacity-40 sm:size-auto sm:h-9 sm:px-3";
  const toggle =
    "text-fg inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9";

  return (
    <div
      role="region"
      aria-labelledby={`${id}-title`}
      data-chunk={COMPARE_RESULT_CHUNK}
      onKeyDown={onKeyDown}
      className="border-line bg-canvas rounded-panel flex flex-col border"
    >
      {/* Pinned BELOW the site header, which is itself sticky at top-0 and
          z-50: at top-0 this bar slid under it and hid the steps and the
          live line. On a phone it is not pinned at all (two rows of boxes
          would hold a fifth of the screen), and the region fits the screen. */}
      <div className="border-line bg-panel rounded-t-panel flex flex-col gap-2 border-b p-3 sm:sticky sm:top-[calc(var(--sf-header-h)+1px)] sm:z-10">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={`${id}-title`} className="sr-only">
            Changes
          </h2>
          <button
            type="button"
            aria-label="Previous change"
            aria-disabled={current <= 0 || hunks.length === 0 || undefined}
            onClick={() => go(current - 1)}
            className={navButton}
          >
            <ChevronUp className="size-4" aria-hidden />
            <span className="max-sm:hidden">Previous change</span>
          </button>
          <button
            type="button"
            aria-label="Next change"
            aria-disabled={current >= hunks.length - 1 || undefined}
            onClick={() => go(current + 1)}
            className={navButton}
          >
            <ChevronDown className="size-4" aria-hidden />
            <span className="max-sm:hidden">Next change</span>
          </button>
          <p
            role="status"
            aria-live="polite"
            className="text-muted min-w-0 flex-1 text-sm"
          >
            {status}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-5">
          <label className={toggle}>
            <input
              type="checkbox"
              className="accent-accent size-4"
              checked={Boolean(options.ignoreCase)}
              onChange={(e) =>
                onOptions({ ...options, ignoreCase: e.target.checked })
              }
            />
            Ignore case
          </label>
          <label className={toggle}>
            <input
              type="checkbox"
              className="accent-accent size-4"
              checked={Boolean(options.ignoreFurniture)}
              onChange={(e) =>
                onOptions({ ...options, ignoreFurniture: e.target.checked })
              }
            />
            Ignore page headers and numbers
          </label>
        </div>
      </div>
      {/* Focusable, so a keyboard can scroll it (axe: scrollable-region-
          focusable, seen on the result in e2e/compare-pdf.mobile.spec.ts). */}
      <div
        ref={scroller}
        role="group"
        aria-label="List of changes"
        tabIndex={0}
        className="max-h-[32rem] overflow-y-auto p-3"
      >
        {hunks.length === 0 ? (
          <p className="text-muted text-sm">
            No selectable-text differences found.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {hunks.slice(0, drawnHunks).map((hunk, n) => (
              <section key={n} aria-labelledby={`${id}-h${n}`}>
                <h3
                  id={`${id}-h${n}`}
                  ref={(el) => {
                    headings.current[n] = el;
                  }}
                  tabIndex={-1}
                  className={cn(
                    "mb-1 text-sm font-semibold",
                    n === current ? "text-accent" : "text-fg",
                  )}
                >
                  {hunkHeader(hunk, "→")}
                </h3>
                <HunkTable
                  hunk={hunk}
                  rows={shown - rowsBefore[n]!}
                  leftText={leftText}
                  rightText={rightText}
                />
              </section>
            ))}
            {shown < totalRows && (
              <button
                type="button"
                onClick={() => setShown((s) => s + rowsShown)}
                className="border-line text-fg hover:bg-wash rounded-ctl min-h-11 self-start border px-4 text-sm"
              >
                {`Show more changes (${(totalRows - shown).toLocaleString("en-US")} more lines)`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
