"use client";

import {
  memo,
  useCallback,
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
import { diffWithFurnitureSteps } from "@/lib/pdf/compare/furniture";
import { drain, type Steps } from "@/lib/pdf/compare/steps";
import { buildHunks, hunkHeader, type Hunk } from "@/lib/pdf/compare/hunks";
import {
  comparableLinesSteps,
  foldCase,
  type CompareOptions,
} from "@/lib/pdf/compare/lines";
import {
  markWordsSteps,
  pairChangedLinesSteps,
  type WordToken,
} from "@/lib/pdf/compare/words";
import { cn } from "@/lib/utils";
import { scrollWithin } from "../viewer/scroll-within";
import {
  buildReport,
  fallbackSentence,
  ignoringSummary,
  noDifferencesSentence,
  setAsideSentence,
} from "./report";

/** The runner's summary line names what an option set aside (`report.ts`). */
export { ignoringSummary };

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
 * Rows drawn at first, and drawn more by each press: Show more changes adds
 * hunks until about this many rows, Show more of this change this many rows
 * of one hunk, and a hunk Next moves to is drawn with its first this many.
 * A budget of ROWS, not hunks: changes four or fewer lines apart merge into
 * one hunk, so a hunk has no size of its own. Until 2026-11-14 the budget
 * was 200 hunks, and 10,000 small edits made one hunk of 30,000 rows, every
 * one drawn (about a second of main thread on a desktop; compare-result
 * .test.tsx, "draws a bounded number of rows"). LOWERED from 1,500 the same
 * day (second review): 1,500 rows of word marks took 150-176 ms to draw,
 * past main's whole view on the same files.
 */
export const ROWS_SHOWN = 400;

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
  return drain(compareSteps(left, right, options));
}

/** The longest stretch {@link compareInSteps} runs before it lets the page in. */
export const STEP_SLICE_MS = 12;

/**
 * {@link compareExtractedPdfText} for the page: the same steps, with a
 * pause whenever a slice of {@link STEP_SLICE_MS} is used up, so the
 * browser paints and takes input between them. Each diff is still one
 * piece (main's comparison was one task holding the same diff); the word
 * marks, the pairing and the report around it are no longer added to it.
 */
export async function compareInSteps(
  left: ComparablePdfText,
  right: ComparablePdfText,
  options: CompareOptions = {},
): Promise<PdfCompareResult> {
  const steps = compareSteps(left, right, options);
  let start = performance.now();
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    if (performance.now() - start >= STEP_SLICE_MS) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      start = performance.now();
    }
  }
}

export function* compareSteps(
  left: ComparablePdfText,
  right: ComparablePdfText,
  options: CompareOptions,
): Steps<PdfCompareResult> {
  const leftHasText = left.extracted.hasText;
  const rightHasText = right.extracted.hasText;
  // BOTH, not either: diffing a scan against the file it was printed from
  // reports every line of the other file as changed.
  const hasComparableText = leftHasText && rightHasText;
  const allA = yield* comparableLinesSteps(left.extracted, options);
  const allB = yield* comparableLinesSteps(right.extracted, options);
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
  yield;
  const furniture = hasComparableText
    ? yield* diffWithFurnitureSteps(
        allA.lines,
        allB.lines,
        Boolean(options.ignoreFurniture),
      )
    : null;
  yield;
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
  const pairs = yield* pairChangedLinesSteps(
    ops,
    leftTexts,
    rightTexts,
    tokenKey,
  );
  const words = yield* markWordsSteps(pairs, leftTexts, rightTexts, tokenKey);
  yield;
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
  yield;
  return { ...base, report: buildReport(base) };
}

/* ------------------------------------------------------------------ *
 *  The view
 * ------------------------------------------------------------------ */

/**
 * Rows per memoised block. Show more, Next and the live line re-render only
 * the blocks whose rows change: until 2026-11-14 every press re-rendered
 * every row drawn so far, and each one got slower as rows were added — 922
 * ms for one Show more at 27,000 rows (second review of audit
 * compare-pdf#4; compare-result.test.tsx, "a press draws only new rows").
 */
export const BLOCK_ROWS = 100;

interface HunkMarks {
  /** A paired line's tokens, or null when a bound skipped the pair. */
  byLeft: Map<number, WordToken[] | null>;
  byRight: Map<number, WordToken[] | null>;
}

/** Each hunk's word marks by line, built once per hunk, when it is drawn. */
const marksCache = new WeakMap<Hunk, HunkMarks>();
function marksOf(hunk: Hunk): HunkMarks {
  let marks = marksCache.get(hunk);
  if (!marks) {
    marks = {
      byLeft: new Map(hunk.pairs.map((p) => [p.left, p.tokens])),
      byRight: new Map(hunk.pairs.map((p) => [p.right, p.tokens])),
    };
    marksCache.set(hunk, marks);
  }
  return marks;
}

/**
 * One side of a changed line. Word-marked: only the differing runs are in
 * <del>/<ins>. Unpaired (no version of it on the other side): the whole
 * line is the change, in one mark. Paired but skipped by a word-mark bound:
 * no mark at all, because marking the whole line would mark its unchanged
 * words too; the row's − or + and its "Removed:"/"Added:" still say it
 * changed, and the view and the report count such lines.
 */
function sideText(
  tokens: readonly WordToken[] | null | undefined,
  side: "removed" | "added",
  text: string,
): ReactNode {
  const Mark = side === "removed" ? "del" : "ins";
  if (tokens === null) return text;
  if (tokens === undefined) return <Mark className="decoration-2">{text}</Mark>;
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

/** Rows `from` to `to` of a hunk. Memoised: its props are a range. */
const RowBlock = memo(function RowBlock({
  hunk,
  n,
  from,
  to,
  leftText,
  rightText,
}: {
  hunk: Hunk;
  n: number;
  from: number;
  to: number;
  leftText: Map<number, string>;
  rightText: Map<number, string>;
}) {
  const { byLeft, byRight } = marksOf(hunk);
  const rows: ReactNode[] = [];
  for (let i = from; i < to; i += 1) {
    const op = hunk.ops[i]!;
    // The first row of a block can take focus when Show more reveals it.
    const mark = i === from ? `${n}:${i}` : undefined;
    if (op.k === "same") {
      rows.push(
        <tr key={i} data-row={mark} className="text-muted">
          <td aria-hidden className="w-6 px-2 align-top select-none" />
          <td className="py-0.5 pr-2 wrap-anywhere whitespace-pre-wrap">
            {leftText.get(op.a)}
          </td>
        </tr>,
      );
      continue;
    }
    const removed = op.k === "removed";
    const text = removed ? leftText.get(op.a)! : rightText.get(op.b)!;
    const tokens = removed ? byLeft.get(op.a) : byRight.get(op.b);
    rows.push(
      <tr
        key={i}
        data-row={mark}
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
          <span className="sr-only">{removed ? "Removed: " : "Added: "}</span>
          {sideText(tokens, removed ? "removed" : "added", text)}
        </td>
      </tr>,
    );
  }
  return <>{rows}</>;
});

/** One hunk: its heading, its drawn rows, and its own Show more. */
const HunkSection = memo(function HunkSection({
  hunk,
  n,
  rows,
  isCurrent,
  idBase,
  onHeading,
  onMore,
  leftText,
  rightText,
}: {
  hunk: Hunk;
  n: number;
  /** How many of the hunk's rows to draw. */
  rows: number;
  isCurrent: boolean;
  idBase: string;
  onHeading: (n: number, el: HTMLHeadingElement | null) => void;
  onMore: (n: number) => void;
  leftText: Map<number, string>;
  rightText: Map<number, string>;
}) {
  const blocks: ReactNode[] = [];
  for (let from = 0; from < rows; from += BLOCK_ROWS)
    blocks.push(
      <RowBlock
        key={from}
        hunk={hunk}
        n={n}
        from={from}
        to={Math.min(rows, from + BLOCK_ROWS)}
        leftText={leftText}
        rightText={rightText}
      />,
    );
  const rest = hunk.ops.length - rows;
  return (
    <section aria-labelledby={`${idBase}-h${n}`}>
      <h3
        id={`${idBase}-h${n}`}
        ref={(el) => onHeading(n, el)}
        tabIndex={-1}
        className={cn(
          "mb-1 text-sm font-semibold",
          isCurrent ? "text-accent" : "text-fg",
        )}
      >
        {hunkHeader(hunk, "→")}
      </h3>
      <table className="w-full border-collapse font-mono text-xs leading-5">
        <tbody>{blocks}</tbody>
      </table>
      {rest > 0 && (
        <button
          type="button"
          onClick={() => onMore(n)}
          className="border-line text-fg hover:bg-wash rounded-ctl mt-1 min-h-11 border px-4 text-sm sm:min-h-9"
        >
          {`Show more of this change (${rest.toLocaleString("en-US")} more lines)`}
        </button>
      )}
    </section>
  );
});

/**
 * What the view draws: the first `hunks` hunks, each with `rows[n]` of its
 * rows (default {@link ROWS_SHOWN}). The first draw, each Show more changes
 * and each Show more of this change add about {@link ROWS_SHOWN} rows, and
 * Next adds at most one hunk's first {@link ROWS_SHOWN}, so no press draws
 * more than that at once. Until 2026-11-14 the budget was one run of rows
 * across hunks, and Next to the change after a 30,000-line hunk drew all of
 * it in one go.
 */
interface Drawn {
  hunks: number;
  rows: Record<number, number>;
}

function rowsOf(drawn: Drawn, hunks: readonly Hunk[], n: number): number {
  return Math.min(hunks[n]!.ops.length, drawn.rows[n] ?? 0);
}

/** `drawn` with more hunks, each at its default rows, until `budget` rows. */
function withMoreHunks(
  drawn: Drawn,
  hunks: readonly Hunk[],
  budget: number,
  atLeast = 0,
): Drawn {
  const rows = { ...drawn.rows };
  let n = drawn.hunks;
  let added = 0;
  while (n < hunks.length && (added < budget || n < atLeast)) {
    rows[n] = budget;
    added += Math.min(hunks[n]!.ops.length, budget);
    n += 1;
  }
  return { hunks: n, rows };
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
  const fresh = () => withMoreHunks({ hunks: 0, rows: {} }, hunks, rowsShown);
  const [currentState, setCurrent] = useState(0);
  const [drawnState, setDrawn] = useState<Drawn>(fresh);
  const headings = useRef<(HTMLHeadingElement | null)[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  /** What to focus after the next render: a heading, a row, or nothing. */
  const focusNext = useRef<
    { heading: number } | { row: string } | { list: true } | null
  >(null);
  const id = useId();

  // A new result (an option toggled) starts from its first change. The
  // reset is a state update during render, and the rest of THIS render runs
  // before it lands: until 2026-11-14 it read the old index, past the end of
  // a result with fewer changes, and the view crashed into the error
  // boundary (compare-result.test.tsx, "survives a re-compare with fewer
  // changes"). So this render reads the reset values directly.
  const [forResult, setForResult] = useState(result);
  const resetting = forResult !== result;
  let drawn = drawnState;
  if (resetting) {
    drawn = fresh();
    setForResult(result);
    setCurrent(0);
    setDrawn(drawn);
  }
  const current = resetting ? 0 : currentState;

  const onHeading = useCallback((n: number, el: HTMLHeadingElement | null) => {
    headings.current[n] = el;
  }, []);
  const onMore = useCallback(
    (n: number) => {
      setDrawn((d) => {
        const before = rowsOf(d, hunks, n);
        // The button goes once the hunk is whole: focus the first row it
        // revealed, not <body> (second review of audit compare-pdf#4).
        if (before + rowsShown >= hunks[n]!.ops.length)
          focusNext.current = { row: `${n}:${before}` };
        return { ...d, rows: { ...d.rows, [n]: before + rowsShown } };
      });
    },
    [hunks, rowsShown],
  );

  useEffect(() => {
    const want = focusNext.current;
    if (!want) return;
    focusNext.current = null;
    const box = scroller.current;
    if ("row" in want) {
      const row = box?.querySelector<HTMLElement>(`[data-row="${want.row}"]`);
      if (row) {
        row.tabIndex = -1;
        row.focus({ preventScroll: true });
      }
      return;
    }
    if ("list" in want) {
      box?.focus({ preventScroll: true });
      return;
    }
    const heading = headings.current[want.heading];
    if (!heading) return;
    // The heading goes to the TOP of the list, so the change's rows are
    // below it in view: "nearest" left it on the list's bottom edge with
    // every row hidden (second review of audit compare-pdf#4).
    if (box) scrollWithin(box, heading, "start");
    heading.focus({ preventScroll: true });
    revealInWindow(heading, bar.current);
  }, [current, drawn]);

  const go = (to: number) => {
    if (hunks.length === 0) return;
    const next = Math.min(hunks.length - 1, Math.max(0, to));
    // At either end there is nowhere to go. Leaving focus pending here
    // moved focus to a heading on the NEXT change of `current` — the reset a
    // ticked box causes — taking it off the box (WCAG 3.2.2).
    if (next === current) return;
    if (next >= drawn.hunks)
      setDrawn(withMoreHunks(drawn, hunks, rowsShown, next + 1));
    focusNext.current = { heading: next };
    setCurrent(next);
  };

  const showMoreChanges = () => {
    const next = withMoreHunks(drawn, hunks, rowsShown);
    // The button goes with the last hunk: focus the first one it drew.
    if (next.hunks >= hunks.length)
      focusNext.current = { heading: drawn.hunks };
    setDrawn(next);
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

  const ignoring = ignoringSummary(result);
  const status =
    hunks.length === 0
      ? ignoring
        ? `No changes: identical (${ignoring})`
        : "No changes"
      : `Change ${current + 1} of ${hunks.length} · ${hunkHeader(
          hunks[current]!,
          "→",
        ).replace(/^P/, "p")}`;
  const rest = hunks
    .slice(drawn.hunks)
    .reduce((sum, h) => sum + h.ops.length, 0);
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
      <div
        ref={bar}
        className="border-line bg-panel rounded-t-panel flex flex-col gap-2 border-b p-3 sm:sticky sm:top-[calc(var(--sf-header-h)+1px)] sm:z-10"
      >
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
        {(result.options.ignoreFurniture || result.wordFallbacks > 0) && (
          <ul className="text-muted flex flex-col gap-0.5 text-xs">
            {result.options.ignoreFurniture && (
              <li>{setAsideSentence(result.dropped)}</li>
            )}
            {result.wordFallbacks > 0 && (
              <li>{fallbackSentence(result.wordFallbacks)}</li>
            )}
          </ul>
        )}
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
          <p className="text-muted text-sm">{noDifferencesSentence(result)}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {hunks.slice(0, drawn.hunks).map((hunk, n) => (
              <HunkSection
                key={n}
                hunk={hunk}
                n={n}
                rows={rowsOf(drawn, hunks, n)}
                isCurrent={n === current}
                idBase={id}
                onHeading={onHeading}
                onMore={onMore}
                leftText={leftText}
                rightText={rightText}
              />
            ))}
            {drawn.hunks < hunks.length && (
              <button
                type="button"
                onClick={showMoreChanges}
                className="border-line text-fg hover:bg-wash rounded-ctl min-h-11 self-start border px-4 text-sm"
              >
                {`Show more changes (${(hunks.length - drawn.hunks).toLocaleString("en-US")} more, ${rest.toLocaleString("en-US")} lines)`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Bring a heading Next moved to into the WINDOW too, under the pinned bar
 * (or the site header on a phone, where the bar is not pinned): the list
 * scrolls inside itself, and at 375 px the list itself sat below the screen,
 * so focus and the change were both out of sight (second review of audit
 * compare-pdf#4).
 */
function revealInWindow(el: HTMLElement, bar: HTMLElement | null): void {
  const header =
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--sf-header-h",
      ),
    ) || 0;
  const pinned = bar && getComputedStyle(bar).position === "sticky";
  const top = Math.max(
    header,
    pinned ? bar.getBoundingClientRect().bottom : header,
  );
  const r = el.getBoundingClientRect();
  // Room for the heading and a few of its rows below it.
  const room = Math.min(160, window.innerHeight - top);
  if (r.top < top || r.top + room > window.innerHeight)
    window.scrollBy({ top: r.top - top - 8 });
}
