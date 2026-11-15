"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from "lucide-react";
import {
  compositeInto,
  describePlace,
  type Region,
  type Shift,
} from "@/lib/pdf/compare/visual-diff";
import type { ComparePages } from "./compare-result";
import { noVisualDifferenceSentence, type ClaimState } from "./visual-claim";
import {
  capturePairs,
  claimStateOf,
  lowestDpi,
  mayBeEncrypted,
  type PairOutcome,
  type PairsResult,
  type SideFacts,
} from "./visual-pairs";

/**
 * Compare PDF's Overlay (audit compare-pdf#3, S3, 2026-11-15): one page
 * pair at a time, PDF 2's page laid over PDF 1's in grayscale, with ink only
 * in PDF 1 hatched in red and ink only in PDF 2 dotted in green, each region
 * outlined and numbered, and the same regions listed as text. Previous and
 * Next difference, a blend slider, an optional shift to line the pages up
 * (itself listed as a difference), and Check all pages, which can be
 * stopped. Pages are paired by number, and the view says so.
 *
 * Its own lazy chunk, fetched from the comparison's chunk when Overlay
 * pages (or Compare pages visually) is pressed or pointed at: `lazy-chunks
 * .test.ts` holds it off every page's first load by {@link
 * COMPARE_OVERLAY_CHUNK}, which only this view renders. It draws through
 * `visual-pairs.ts` (the output path, which refuses rather than skips) and
 * says "No differences visible at this resolution" only through the gate
 * in `visual-claim.ts`.
 *
 * Styles: the site's existing utility classes and inline styles only (the
 * shipped stylesheet is paid on every page and sits at its ceiling).
 */
export const COMPARE_OVERLAY_CHUNK = "pdfxyz:lazy:compare-overlay";

/** A rapid run of Next page draws only the page it lands on. */
const NAV_DEBOUNCE_MS = 150;
/** Check all announces its progress every this many pages. */
const PROGRESS_EVERY = 10;

const NAV_BUTTON =
  "border-line text-fg hover:bg-wash rounded-ctl inline-flex size-11 shrink-0 items-center justify-center gap-1.5 border text-sm aria-disabled:opacity-40 sm:size-auto sm:h-9 sm:px-3";
const VIEW_BUTTON =
  "border-line text-fg hover:bg-wash rounded-ctl inline-flex min-h-11 items-center border px-4 text-sm aria-pressed:bg-accent/15 aria-pressed:text-accent";
const TOGGLE =
  "text-fg inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9";

type Checked = Extract<PairOutcome, { status: "checked" }>;

/** One entry of the differences list: the shift, or a region. */
type Difference =
  | { kind: "shift"; shift: Shift }
  | { kind: "region"; region: Region; n: number };

const pdfName = (side: "left" | "right") =>
  side === "left" ? "PDF 1" : "PDF 2";
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "PDF 2 moved 3 px right and 2 px up to line up with PDF 1." */
export function shiftSentence(s: Shift): string {
  // The page is read at (x + dx, y + dy): its content sits dx right of PDF
  // 1's, so lining it up moves it dx to the left.
  const parts: string[] = [];
  if (s.dx !== 0)
    parts.push(`${Math.abs(s.dx)} px ${s.dx > 0 ? "left" : "right"}`);
  if (s.dy !== 0)
    parts.push(`${Math.abs(s.dy)} px ${s.dy > 0 ? "up" : "down"}`);
  return `PDF 2 moved ${parts.join(" and ")} to line up with PDF 1.`;
}

function kindWords(d: Difference): string {
  if (d.kind === "shift") return "PDF 2 is shifted";
  return d.region.kind === "removed"
    ? "only in PDF 1"
    : d.region.kind === "added"
      ? "only in PDF 2"
      : "changed in both";
}

const pt = (n: number) => Math.round(n).toLocaleString("en-US");

/** The two pages' sizes, in points, when they differ; "turned" when swapped. */
export function sizeSentence(l: SideFacts, r: SideFacts): string {
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  if (near(l.pageWidth, r.pageHeight) && near(l.pageHeight, r.pageWidth))
    return `PDF 2's page is turned: ${pt(r.pageWidth)} × ${pt(r.pageHeight)} pt against PDF 1's ${pt(l.pageWidth)} × ${pt(l.pageHeight)} pt.`;
  return `The pages differ in size: PDF 1's is ${pt(l.pageWidth)} × ${pt(l.pageHeight)} pt, PDF 2's is ${pt(r.pageWidth)} × ${pt(r.pageHeight)} pt.`;
}

/** "PDF 2 has 2 more pages (5–6); they have nothing to compare with." */
export function unpairedSentence(nLeft: number, nRight: number): string | null {
  if (nLeft === nRight) return null;
  const longer = nLeft > nRight ? "PDF 1" : "PDF 2";
  const from = Math.min(nLeft, nRight) + 1;
  const to = Math.max(nLeft, nRight);
  const extra = to - from + 1;
  return extra === 1
    ? `${longer} has 1 more page (${from}); it has nothing to compare with.`
    : `${longer} has ${extra} more pages (${from}–${to}); they have nothing to compare with.`;
}

/** Why a refusal stopped the drawing, in the guard's own words. */
function refusalSentence(
  refused: NonNullable<PairsResult["refused"]>,
  scope: "page" | "all",
): string {
  const head = `${pdfName(refused.side)} could not be compared visually: ${refused.message}`;
  if (scope === "page") return `${head} So this page is not compared.`;
  // A page past the page budget refuses the whole scan up front.
  return /\bpage [\d,]+\b/i.test(refused.message)
    ? `${head} No pages were checked. Compare the other pages one at a time.`
    : `${head} No pages were checked.`;
}

/** Each reason a pair is not claimed, one sentence each. */
function pairNotes(
  o: PairOutcome | undefined,
  result: PairsResult,
  state: ClaimState,
  k: number,
): string[] {
  const notes: string[] = [];
  if (result.refused) notes.push(refusalSentence(result.refused, "page"));
  if (result.memory)
    notes.push(
      `Your browser ran out of memory drawing page ${result.memory.index + 1}, so it is not compared.`,
    );
  if (o?.status === "failed")
    notes.push(
      o.reason === "render"
        ? `Page ${k + 1} could not be drawn, so it is not compared.`
        : `Page ${k + 1} of ${pdfName(o.side)} could not be drawn, so it is not compared.`,
    );
  if (state.undecoded > 0)
    notes.push(
      "An image on this page could not be decoded, so this page is not compared.",
    );
  if (state.blankWithText > 0)
    notes.push(
      "This page drew blank although it has text, so it is not compared.",
    );
  if (!o && !result.refused && !result.memory && result.aborted)
    notes.push(`Page ${k + 1} was not drawn.`);
  return notes;
}

/** The two pages blended, with the differences marked, on one canvas. */
function OverlayCanvas({
  outcome,
  blend,
  active,
  label,
}: {
  outcome: Checked;
  blend: number;
  active: Region | null;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const frame = useRef(0);
  const { diff, planes } = outcome;
  useEffect(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const canvas = ref.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx || !planes) return;
      const forced =
        typeof matchMedia === "function" &&
        matchMedia("(forced-colors: active)").matches;
      const image = ctx.createImageData(diff.w, diff.h);
      compositeInto(
        image.data,
        planes.left,
        planes.right,
        diff,
        blend,
        !forced,
      );
      ctx.putImageData(image, 0, 0);
      ctx.font = "bold 14px sans-serif";
      ctx.textBaseline = "top";
      diff.regions.forEach((r, i) => {
        if (forced) {
          // System colours, so the outlines survive a forced palette.
          ctx.strokeStyle = "#000";
          ctx.strokeStyle = "CanvasText";
          ctx.lineWidth = 2;
          ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
        }
        const tag = String(i + 1);
        const tw = ctx.measureText(tag).width + 6;
        const tx = Math.max(0, r.x - 2);
        const ty = Math.max(0, r.y - 20);
        ctx.fillStyle = forced ? "Canvas" : "#1d4ed8";
        ctx.fillRect(tx, ty, tw, 18);
        ctx.fillStyle = forced ? "CanvasText" : "#ffffff";
        ctx.fillText(tag, tx + 3, ty + 2);
      });
      if (active) {
        ctx.strokeStyle = forced ? "Highlight" : "#1d4ed8";
        ctx.lineWidth = 4;
        ctx.strokeRect(
          active.x - 5,
          active.y - 5,
          active.w + 10,
          active.h + 10,
        );
      }
    });
    return () => cancelAnimationFrame(frame.current);
  }, [diff, planes, blend, active]);
  return (
    <canvas
      ref={ref}
      width={diff.w}
      height={diff.h}
      role="img"
      aria-label={label}
      data-overlay-canvas=""
      style={{
        width: "100%",
        height: "auto",
        display: "block",
        background: "#ffffff",
      }}
    />
  );
}

/** The scan over every pair, as it runs and once it ends. */
interface Scan {
  running: boolean;
  checked: number;
  /** Announced every {@link PROGRESS_EVERY} pages, not on each one. */
  announced: number;
  result: PairsResult | null;
  state: ClaimState | null;
}

export function CompareOverlay({
  pages,
  startAt = 0,
}: {
  pages: ComparePages;
  /** The 0-based pair to open at (a page with no selectable text, say). */
  startAt?: number;
}) {
  const id = useId();
  const left = pages.left;
  const right = pages.right;
  const nLeft = left.extracted.pages.length;
  const nRight = right.extracted.pages.length;
  const paired = Math.min(nLeft, nRight);
  const unpaired = Math.abs(nLeft - nRight);
  const [k, setK] = useState(() => Math.max(0, Math.min(paired - 1, startAt)));
  const [align, setAlign] = useState(true);
  const [blend, setBlend] = useState(50);
  const [current, setCurrent] = useState(0);
  const [page, setPage] = useState<{
    k: number;
    align: boolean;
    result: PairsResult;
  } | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [confirmEncrypted, setConfirmEncrypted] = useState(false);
  const scanAbort = useRef<AbortController | null>(null);

  const hasText = useCallback(
    (i: number) =>
      Boolean(left.extracted.pages[i]?.text.trim()) ||
      Boolean(right.extracted.pages[i]?.text.trim()),
    [left, right],
  );

  // One pair, drawn on both sides; a new page or alignment draws again.
  useEffect(() => {
    if (paired === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void capturePairs(left.bytes, right.bytes, [k], {
        keep: true,
        align,
        signal: controller.signal,
      }).then((result) => {
        if (!controller.signal.aborted) {
          setPage({ k, align, result });
          setCurrent(0);
        }
      });
    }, NAV_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [left.bytes, right.bytes, k, align, paired]);

  // Unmount (Show the list, Start over) stops a running scan.
  useEffect(() => () => scanAbort.current?.abort(), []);

  const loading =
    paired > 0 && (page === null || page.k !== k || page.align !== align);
  const outcome = !loading ? page?.result.outcomes[0] : undefined;
  const checked = outcome?.status === "checked" ? outcome : undefined;
  const pageState = useMemo(
    () =>
      page && !loading
        ? claimStateOf(page.result, { pairsTotal: 1, unpaired, hasText })
        : null,
    [page, loading, unpaired, hasText],
  );

  const differences: Difference[] = useMemo(() => {
    if (!checked) return [];
    const list: Difference[] = [];
    const s = checked.diff.shift;
    if (s.dx !== 0 || s.dy !== 0) list.push({ kind: "shift", shift: s });
    checked.diff.regions.forEach((region, i) =>
      list.push({ kind: "region", region, n: i + 1 }),
    );
    return list;
  }, [checked]);
  const at = Math.min(current, Math.max(0, differences.length - 1));
  const activeDiff = differences[at];
  const activeRegion = activeDiff?.kind === "region" ? activeDiff.region : null;

  const goPage = (to: number) => {
    if (scan?.running) return;
    const next = Math.max(0, Math.min(paired - 1, to));
    if (next !== k) setK(next);
    // A page of its own: the scan's result gives way to it.
    setScan(null);
  };
  const goDiff = (to: number) => {
    if (differences.length === 0) return;
    setCurrent(Math.max(0, Math.min(differences.length - 1, to)));
  };

  const startScan = () => {
    setConfirmEncrypted(false);
    scanAbort.current?.abort();
    const controller = new AbortController();
    scanAbort.current = controller;
    const all = Array.from({ length: paired }, (_, i) => i);
    let done = 0;
    setScan({
      running: true,
      checked: 0,
      announced: 0,
      result: null,
      state: null,
    });
    void capturePairs(left.bytes, right.bytes, all, {
      align,
      signal: controller.signal,
      onPair: () => {
        done += 1;
        const n = done;
        setScan((s) =>
          s && s.running
            ? {
                ...s,
                checked: n,
                announced: n % PROGRESS_EVERY === 0 ? n : s.announced,
              }
            : s,
        );
      },
    }).then((result) => {
      if (scanAbort.current !== controller) return;
      scanAbort.current = null;
      setScan({
        running: false,
        checked: result.outcomes.length,
        announced: result.outcomes.length,
        result,
        state: claimStateOf(result, { pairsTotal: paired, unpaired, hasText }),
      });
    });
  };
  const askScan = () => {
    if (mayBeEncrypted(left.bytes) || mayBeEncrypted(right.bytes))
      setConfirmEncrypted(true);
    else startScan();
  };
  const stopScan = () => scanAbort.current?.abort();

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
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
      e.stopPropagation();
      goDiff(at + 1);
    } else if ((key === "n" && e.shiftKey) || key === "k") {
      e.preventDefault();
      e.stopPropagation();
      goDiff(at - 1);
    }
  };

  // What the live line says: the difference in hand, or why there is none.
  // While a scan is running or its result is shown, the one page says
  // nothing reassuring: the scan's own line speaks for the document.
  const claim =
    pageState && checked && !scan
      ? noVisualDifferenceSentence(pageState, lowestDpi([checked]))
      : null;
  const notes =
    page && !loading ? pairNotes(outcome, page.result, pageState!, k) : [];
  const status = loading
    ? `Drawing page ${k + 1} of both files…`
    : activeDiff
      ? `Difference ${at + 1} of ${differences.length}, ${kindWords(activeDiff)}${
          activeDiff.kind === "region" && checked
            ? `, ${describePlace(activeDiff.region, checked.diff.w, checked.diff.h)}`
            : ""
        }`
      : (claim ??
        notes[0] ??
        (checked?.diff.sizeDiffers
          ? sizeSentence(checked.left, checked.right)
          : null) ??
        unpairedSentence(nLeft, nRight) ??
        "");

  const scanState = scan?.state ?? null;
  const scanClaim =
    scan?.result && scanState
      ? noVisualDifferenceSentence(scanState, lowestDpi(scan.result.outcomes))
      : null;
  const scanPages = (pred: (o: PairOutcome) => boolean) =>
    (scan?.result?.outcomes ?? []).filter(pred).map((o) => o.index);
  const differing = scanPages(
    (o) =>
      o.status === "checked" &&
      (o.diff.regions.length > 0 ||
        o.diff.sizeDiffers ||
        o.diff.shift.dx !== 0 ||
        o.diff.shift.dy !== 0),
  );
  const notDrawn = scanPages((o) => o.status === "failed");
  const undecodedPages = scanPages(
    (o) =>
      o.status === "checked" &&
      (o.left.undecodedImages > 0 || o.right.undecodedImages > 0),
  );
  const blankPages = scanPages(
    (o) => o.status === "checked" && o.diff.blank && hasText(o.index),
  );
  const unpairedLine = unpairedSentence(nLeft, nRight);
  const minDpi = checked ? Math.min(checked.left.dpi, checked.right.dpi) : null;
  const capped = checked && (checked.left.dpiCapped || checked.right.dpiCapped);

  return (
    <section
      aria-labelledby={`${id}-title`}
      aria-busy={loading || scan?.running ? true : undefined}
      data-chunk={COMPARE_OVERLAY_CHUNK}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-3 p-3"
    >
      <h3 id={`${id}-title`} className="sr-only">
        Overlay of the pages
      </h3>
      <p className="text-muted text-sm">
        {`Pages are compared by number: page ${k + 1} with page ${k + 1}.`}
        {unpairedLine && ` ${unpairedLine}`}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="Previous page"
          aria-disabled={k <= 0 || scan?.running || undefined}
          onClick={() => goPage(k - 1)}
          className={NAV_BUTTON}
        >
          <ChevronLeft className="size-4" aria-hidden />
          <span className="max-sm:hidden">Previous page</span>
        </button>
        <span className="text-fg text-sm">{`Page ${k + 1} of ${paired}`}</span>
        <button
          type="button"
          aria-label="Next page"
          aria-disabled={k >= paired - 1 || scan?.running || undefined}
          onClick={() => goPage(k + 1)}
          className={NAV_BUTTON}
        >
          <ChevronRight className="size-4" aria-hidden />
          <span className="max-sm:hidden">Next page</span>
        </button>
        <button
          type="button"
          aria-label="Previous difference"
          aria-disabled={at <= 0 || differences.length === 0 || undefined}
          onClick={() => goDiff(at - 1)}
          className={NAV_BUTTON}
        >
          <ChevronUp className="size-4" aria-hidden />
          <span className="max-sm:hidden">Previous difference</span>
        </button>
        <button
          type="button"
          aria-label="Next difference"
          aria-disabled={at >= differences.length - 1 || undefined}
          onClick={() => goDiff(at + 1)}
          className={NAV_BUTTON}
        >
          <ChevronDown className="size-4" aria-hidden />
          <span className="max-sm:hidden">Next difference</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className={TOGGLE} style={{ flex: "1 1 14rem" }}>
          <span>PDF 1</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={blend}
            aria-label="Blend between PDF 1 and PDF 2"
            aria-valuetext={
              blend === 0
                ? "PDF 1 only"
                : blend === 100
                  ? "PDF 2 only"
                  : `${100 - blend}% PDF 1, ${blend}% PDF 2`
            }
            onChange={(e) => setBlend(Number(e.target.value))}
            className="accent-accent"
            style={{
              flex: "1 1 auto",
              minHeight: "2.75rem",
              minWidth: "2.75rem",
            }}
          />
          <span>PDF 2</span>
        </label>
        <label className={TOGGLE}>
          <input
            type="checkbox"
            className="accent-accent size-4"
            checked={align}
            onChange={(e) => {
              setAlign(e.target.checked);
              setScan(null);
            }}
          />
          Line up the pages before comparing
        </label>
      </div>

      <p role="status" aria-live="polite" className="text-fg text-sm">
        {status}
      </p>

      {!loading && (
        <ul className="text-muted flex flex-col gap-0.5 text-sm">
          {checked && differences.length > 0 && (
            <li>{`${plural(differences.length, "difference")} on this page`}</li>
          )}
          {checked?.diff.capped && (
            <li>{`Only the ${checked.diff.regions.length} largest differences are marked.`}</li>
          )}
          {checked?.diff.everywhere && (
            <li>
              This page differs almost everywhere. Two separate scans of the
              same paper usually do, and so do pages that are paired with the
              wrong partner.
            </li>
          )}
          {checked?.diff.sizeDiffers && (
            <li>{sizeSentence(checked.left, checked.right)}</li>
          )}
          {checked && minDpi !== null && (
            <li>
              {capped
                ? `Drawn at about ${Math.round(minDpi)} dpi: this page is larger than about 13 inches, so it is drawn lower than 150 dpi.`
                : `Drawn at about ${Math.round(minDpi)} dpi, in grayscale.`}
            </li>
          )}
          {notes.map((n) => (
            <li key={n} className="text-fg">
              {n}
            </li>
          ))}
          {claim && <li className="text-fg">{claim}</li>}
        </ul>
      )}

      {checked?.planes && (
        <div
          style={{ maxHeight: "70vh", overflow: "auto" }}
          tabIndex={0}
          aria-label="The overlaid page"
        >
          <OverlayCanvas
            outcome={checked}
            blend={blend / 100}
            active={activeRegion}
            label={`Page ${k + 1}: PDF 2 laid over PDF 1, with ${plural(differences.length, "difference")} marked`}
          />
        </div>
      )}

      {differences.length > 0 && (
        <ol className="flex flex-col gap-1 text-sm">
          {differences.map((d, i) => (
            <li key={i}>
              <button
                type="button"
                aria-current={i === at || undefined}
                onClick={() => setCurrent(i)}
                className={VIEW_BUTTON}
                style={{ textAlign: "left" }}
              >
                {d.kind === "shift"
                  ? shiftSentence(d.shift)
                  : `${d.n}. ${kindWords(d)[0]!.toUpperCase()}${kindWords(d).slice(1)}, ${
                      checked
                        ? describePlace(
                            d.region,
                            checked.diff.w,
                            checked.diff.h,
                          )
                        : ""
                    }`}
              </button>
            </li>
          ))}
        </ol>
      )}

      {paired > 1 && (
        <div className="border-line flex flex-col gap-2 border-t pt-3">
          <div className="flex flex-wrap items-center gap-2">
            {scan?.running ? (
              <button type="button" onClick={stopScan} className={VIEW_BUTTON}>
                Stop
              </button>
            ) : (
              <button type="button" onClick={askScan} className={VIEW_BUTTON}>
                Check all pages
              </button>
            )}
          </div>
          {confirmEncrypted && (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-fg">
                This file is encrypted, so very large pages are not caught
                before they are drawn, and drawing one can take minutes and a
                lot of memory.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={startScan}
                  className={VIEW_BUTTON}
                >
                  Check all pages anyway
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmEncrypted(false)}
                  className={VIEW_BUTTON}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {scan && (
            <div role="status" aria-live="polite" className="text-fg text-sm">
              {scan.running
                ? scan.checked === 0
                  ? `Looking up all ${paired} pages before drawing them…`
                  : `Checked ${scan.announced} of ${paired} pages…`
                : null}
            </div>
          )}
          {scan?.result && scanState && (
            <ul className="text-fg flex flex-col gap-0.5 text-sm">
              {scanClaim && <li>{scanClaim}</li>}
              {scan.result.refused && (
                <li>{refusalSentence(scan.result.refused, "all")}</li>
              )}
              {scan.result.memory && (
                <li>{`Your browser ran out of memory drawing page ${scan.result.memory.index + 1}.`}</li>
              )}
              {scanState.aborted && (
                <li>{`Checked ${scanState.pairsChecked} of ${paired} pages; stopped.`}</li>
              )}
              {unpairedLine && <li>{unpairedLine}</li>}
              {notDrawn.length > 0 && (
                <li>{`Not drawn: ${notDrawn.map((i) => `page ${i + 1}`).join(", ")}.`}</li>
              )}
              {undecodedPages.length > 0 && (
                <li>{`An image could not be decoded on ${undecodedPages.map((i) => `page ${i + 1}`).join(", ")}, so those pages are not compared.`}</li>
              )}
              {blankPages.length > 0 && (
                <li>{`Drawn blank although they have text, so not compared: ${blankPages.map((i) => `page ${i + 1}`).join(", ")}.`}</li>
              )}
              {differing.length > 0 && (
                <li className="flex flex-col gap-1">
                  <span>{`Differences on ${plural(differing.length, "page")}:`}</span>
                  <span className="flex flex-wrap gap-2">
                    {differing.map((i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => goPage(i)}
                        className={VIEW_BUTTON}
                      >
                        {`Page ${i + 1}`}
                      </button>
                    ))}
                  </span>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
