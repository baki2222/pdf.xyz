import { capturePdfPages, luminancePlane } from "@/lib/pdf/render";
import type { RasterCanvasInfo } from "@/lib/pdf/render";
import {
  NO_SHIFT,
  VISUAL_DPI,
  VISUAL_MAX_SIDE_PX,
  bestShift,
  diffPlanes,
  type Plane,
  type VisualDiff,
} from "@/lib/pdf/compare/visual-diff";
import type { ClaimState } from "./visual-claim";

/**
 * The Overlay's drawing (S3, 2026-11-15): page pairs drawn on both sides
 * through `capturePdfPages`, the OUTPUT path, never a preview open. That
 * path refuses rather than skips: an image over its budget refuses the
 * file, and a page past the page budget (or one the page map could not
 * read) refuses the CALL that includes it before any page is drawn
 * (`pdfjs-guard.ts`, `refuseOverBudgetPages`). A preview open (`ViewerPdf`,
 * S2's page view) skips such an image or draws a note in place of the
 * page, and either, overlaid, could read as no difference. The overlay-
 * path guard in `visual-pairs.test.ts` holds this property.
 *
 * HOW. Two concurrent `capturePdfPages` calls, one per file, over the same
 * page list, sharing one abort. Each capture hook reads its pixels, zeroes
 * its own canvas (render.ts releases the canvas only after the hook
 * settles, so a hook waiting for its partner would otherwise hold it),
 * makes a luminance plane, and waits for the partner's plane of the same
 * page. The second to arrive diffs the pair and drops both planes (unless
 * the caller keeps the one pair it shows), so at most two planes are alive
 * at once, whatever the page count. A failed page, a call that resolves
 * without a page, a rejection and an abort each settle every waiter still
 * open: nothing is left pending.
 *
 * WORKERS. Every browser document opens in the page's ONE pdf.js worker
 * (`pdfjs-worker.ts`), so this adds no worker; the two files' parsing and
 * drawing queue in it. Opening the overlay unmounts S2's page view, whose
 * documents are destroyed on the next task (`compare-docs.ts`); that
 * teardown can overlap these opens, which is safe in the shared worker.
 *
 * BOUND, per side while a page is drawn: the RGBA canvas (≤ 16 MB at
 * {@link VISUAL_MAX_SIDE_PX} px a side) and its `getImageData` copy (≤ 16
 * MB), released before the hook waits; then one plane (≤ 4 MB). Each open
 * also holds a `bytes.slice()` copy in pdf.js, up to the compare ceiling.
 *
 * ENCRYPTED FILES. An owner-password-only file is never page-mapped (owner
 * ruling D1, `pdfjs-guard.ts`), so a page past the page budget is drawn in
 * full rather than refused: never skipped and never a note, so no false
 * "no difference" can come of it, but its cost is not bounded in advance
 * (the guard's table gives a 10 × 49 MP page 104 s and +2.8 GB). Check all
 * asks before it draws such a file ({@link mayBeEncrypted}).
 *
 * RESIDUALS. pdf.js resolves a page whose font failed to load with a
 * fallback, and only images are counted as undecoded: two files whose
 * different fonts both fail would draw the same fallback. Annotations
 * without an appearance stream, form values whose appearance was never
 * regenerated and hidden optional-content layers are not drawn, so they
 * are not seen. Transparency is drawn onto white.
 */

/**
 * Where the overlay's drawing is found: an object, so a test can hand it a
 * fake `capturePdfPages` without `vi.mock` (under `isolate: false` a module
 * evaluated under a mock stays bound to the stub). Nothing else writes it.
 */
export const visualRender = { capture: capturePdfPages };

export type Side = "left" | "right";

/** What one side's drawing of a page says about itself. */
export interface SideFacts {
  dpi: number;
  dpiCapped: boolean;
  /** The page's size in PDF points, after its /Rotate. */
  pageWidth: number;
  pageHeight: number;
  undecodedImages: number;
}

export type PairOutcome =
  | {
      index: number;
      status: "checked";
      diff: VisualDiff;
      left: SideFacts;
      right: SideFacts;
      /** Both planes, only when the caller asked to keep them (one pair shown). */
      planes: { left: Plane; right: Plane } | null;
    }
  | {
      index: number;
      status: "failed";
      /** `render`: pdf.js could not draw it; `missing`: no drawing arrived. */
      reason: "render" | "missing";
      side: Side;
    };

export interface PairsResult {
  outcomes: PairOutcome[];
  /** A side's open or page budget refused the call, in its own words. */
  refused: { side: Side; message: string } | null;
  /** The browser ran out of memory drawing this page. */
  memory: { side: Side; index: number } | null;
  /** The person stopped it. */
  aborted: boolean;
}

export interface CapturePairsOptions {
  signal?: AbortSignal;
  /** Keep both planes on each outcome (the one pair the overlay shows). */
  keep?: boolean;
  /** Line PDF 2's page up with PDF 1's before comparing (default on). */
  align?: boolean;
  /** Each pair as it is decided, in page order. */
  onPair?: (outcome: PairOutcome) => void;
}

/** The luminance plane of a drawn canvas's pixels (the one the diff reads). */
export function planeOf(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Plane {
  return { w: width, h: height, data: luminancePlane(data) };
}

type Arrival = { plane: Plane; info: RasterCanvasInfo } | { failed: true };

interface Slot {
  left?: Arrival;
  right?: Arrival;
  waiters: (() => void)[];
  /** Both sides arrived (and the planes left the slot). */
  paired?: boolean;
  diff?: VisualDiff;
  planes?: { left: Plane; right: Plane } | null;
  facts: Partial<Record<Side, SideFacts>>;
  outcome?: PairOutcome;
}

const other = (s: Side): Side => (s === "left" ? "right" : "left");
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Draw and compare `pairs` (0-based pages present in BOTH files; unpaired
 * pages are counted by the caller, never requested) and resolve when both
 * calls have settled.
 */
export async function capturePairs(
  left: Uint8Array,
  right: Uint8Array,
  pairs: readonly number[],
  { signal, keep = false, align = true, onPair }: CapturePairsOptions = {},
): Promise<PairsResult> {
  const internal = new AbortController();
  const onOuterAbort = () => internal.abort();
  if (signal?.aborted) internal.abort();
  signal?.addEventListener("abort", onOuterAbort, { once: true });

  const slots = new Map<number, Slot>();
  const slotOf = (k: number) => {
    let s = slots.get(k);
    if (!s) {
      s = { waiters: [], facts: {} };
      slots.set(k, s);
    }
    return s;
  };
  const settled: Record<Side, boolean> = { left: false, right: false };
  const drawn: Record<Side, number> = { left: 0, right: 0 };
  let refused: PairsResult["refused"] = null;
  let memory: PairsResult["memory"] = null;
  const emitted: PairOutcome[] = [];

  const release = (slot: Slot) => {
    const waiting = slot.waiters.splice(0);
    for (const w of waiting) w();
  };
  const releaseAll = () => {
    for (const slot of slots.values()) release(slot);
  };
  internal.signal.addEventListener("abort", releaseAll, { once: true });

  const emit = (slot: Slot, outcome: PairOutcome) => {
    if (slot.outcome) return;
    slot.outcome = outcome;
    emitted.push(outcome);
    onPair?.(outcome);
  };
  const fail = (k: number, side: Side, reason: "render" | "missing") => {
    const slot = slotOf(k);
    slot.planes = null;
    delete slot.diff;
    emit(slot, { index: k, status: "failed", reason, side });
  };
  /** Both facts and the diff are in: the pair is decided. */
  const tryDecide = (k: number) => {
    const slot = slotOf(k);
    const { left: l, right: r } = slot.facts;
    if (!slot.diff || !l || !r) return;
    emit(slot, {
      index: k,
      status: "checked",
      diff: slot.diff,
      left: l,
      right: r,
      planes: slot.planes ?? null,
    });
  };

  /** A side's drawing of page k, or its failure, arrives; resolves when paired. */
  const arrive = async (side: Side, k: number, a: Arrival): Promise<void> => {
    const slot = slotOf(k);
    slot[side] = a;
    const partner = slot[other(side)];
    if (partner) {
      if ("failed" in a || "failed" in partner) {
        fail(k, "failed" in a ? side : other(side), "render");
      } else {
        const mine = a;
        const theirs = partner as { plane: Plane; info: RasterCanvasInfo };
        const [lA, rA] = side === "left" ? [mine, theirs] : [theirs, mine];
        const L = lA.plane;
        const R = rA.plane;
        // Yield between the stages, so the page paints and takes input.
        await tick();
        const shift =
          align && !internal.signal.aborted ? bestShift(L, R) : NO_SHIFT;
        await tick();
        if (!internal.signal.aborted) {
          const diff = diffPlanes(L, R, shift);
          // Sizes in POINTS too: an A1 page and an A3 page, each capped to
          // 2,000 px on its long side, are drawn the same size in pixels.
          const pointsDiffer =
            Math.abs(lA.info.pageWidth - rA.info.pageWidth) > 1 ||
            Math.abs(lA.info.pageHeight - rA.info.pageHeight) > 1;
          slot.diff = pointsDiffer ? { ...diff, sizeDiffers: true } : diff;

          slot.planes = keep ? { left: L, right: R } : null;
        }
      }
      // Drop both planes from the slot: only `planes` (kept) holds them now.
      delete slot.left;
      delete slot.right;
      slot.paired = true;
      release(slot);
      tryDecide(k);
      return;
    }
    if (settled[other(side)]) {
      // The partner's call is over without this page (out of range, or it
      // resolved early): this pair cannot be compared.
      delete slot[side];
      fail(k, other(side), "missing");
      return;
    }
    if ("failed" in a || internal.signal.aborted) return;
    await new Promise<void>((resolve) => slot.waiters.push(resolve));
    // Released without a partner (abort, or the partner's call ended): the
    // plane goes with this hook's frame.
    if (slot[side] === a) delete slot[side];
  };

  const hook =
    (side: Side) =>
    async (canvas: HTMLCanvasElement, info: RasterCanvasInfo) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error(`Page ${info.index + 1} could not be read.`);
      const image = ctx.getImageData(0, 0, info.width, info.height);
      // Zero the canvas BEFORE waiting: render.ts releases it only after
      // this hook settles, and the partner may be a page behind.
      canvas.width = 0;
      canvas.height = 0;
      const plane = planeOf(image.data, info.width, info.height);
      await arrive(side, info.index, { plane, info });
      return true;
    };

  const run = (side: Side, bytes: Uint8Array) =>
    visualRender
      .capture(bytes, {
        dpi: VISUAL_DPI,
        maxDevicePx: VISUAL_MAX_SIDE_PX,
        pages: pairs,
        signal: internal.signal,
        capture: hook(side),
        onProgress: (done) => {
          drawn[side] = done;
        },
        onPage: (page) => {
          const slot = slotOf(page.index);
          slot.facts[side] = {
            dpi: page.dpi,
            dpiCapped: page.dpiCapped,
            pageWidth: page.pageWidth,
            pageHeight: page.pageHeight,
            undecodedImages: page.undecodedImages,
          };
          tryDecide(page.index);
        },
        onPageFailed: ({ index }) => {
          void arrive(side, index, { failed: true });
          fail(index, side, "render");
        },
      })
      .then(
        () => {},
        (err: unknown) => {
          if (err instanceof RangeError) {
            memory ??= { side, index: pairs[drawn[side]] ?? pairs[0] ?? 0 };
          } else {
            refused ??= {
              side,
              message:
                err instanceof Error && err.message
                  ? err.message
                  : "This PDF could not be opened.",
            };
          }
          // The other side has nothing to wait for now.
          internal.abort();
        },
      )
      .finally(() => {
        settled[side] = true;
        // A call's RESOLUTION settles every waiter still open for its partner.
        for (const [k, slot] of slots)
          if (
            !slot.paired &&
            slot[other(side)] &&
            !slot[side] &&
            !slot.outcome
          ) {
            release(slot);
            fail(k, side, "missing");
          }
      });

  try {
    await Promise.all([run("left", left), run("right", right)]);
  } finally {
    signal?.removeEventListener("abort", onOuterAbort);
    internal.signal.removeEventListener("abort", releaseAll);
    releaseAll();
  }
  const aborted = Boolean(signal?.aborted);
  // A page neither side drew, outside an abort or a refusal, is missing.
  if (!aborted && !refused && !memory)
    for (const k of pairs)
      if (!slots.get(k)?.outcome) fail(k, "left", "missing");
  emitted.sort((a, b) => a.index - b.index);
  return { outcomes: emitted, refused, memory, aborted };
}

/** The claim state of a finished (or stopped) run. */
export function claimStateOf(
  result: PairsResult,
  scope: {
    pairsTotal: number;
    unpaired: number;
    /** Whether either file's text layer has text on page k (0-based). */
    hasText: (k: number) => boolean;
  },
): ClaimState {
  let pairsChecked = 0;
  let failed = result.memory ? 1 : 0;
  let undecoded = 0;
  let blankWithText = 0;
  let sizeDiffers = 0;
  let shifted = 0;
  let withRegions = 0;
  for (const o of result.outcomes) {
    if (o.status === "failed") {
      failed++;
      continue;
    }
    pairsChecked++;
    if (o.left.undecodedImages > 0 || o.right.undecodedImages > 0) undecoded++;
    if (o.diff.blank && scope.hasText(o.index)) blankWithText++;
    if (o.diff.sizeDiffers) sizeDiffers++;
    if (o.diff.shift.dx !== 0 || o.diff.shift.dy !== 0) shifted++;
    if (o.diff.regions.length > 0) withRegions++;
  }
  return {
    pairsTotal: scope.pairsTotal,
    pairsChecked,
    unpaired: scope.unpaired,
    refused: result.refused?.message ?? null,
    failed,
    undecoded,
    blankWithText,
    sizeDiffers,
    shifted,
    withRegions,
    aborted: result.aborted,
  };
}

/** The lowest dpi any checked page was drawn at, or {@link VISUAL_DPI}. */
export function lowestDpi(outcomes: readonly PairOutcome[]): number {
  let min = Infinity;
  for (const o of outcomes)
    if (o.status === "checked") min = Math.min(min, o.left.dpi, o.right.dpi);
  return min === Infinity ? VISUAL_DPI : min;
}

/**
 * Whether the bytes may be an encrypted PDF: the word /Encrypt anywhere.
 * Fail safe, and only ever a reason to ASK before Check all draws the
 * file, since such a file is never page-mapped (see the docblock).
 */
export function mayBeEncrypted(bytes: Uint8Array): boolean {
  const word = [0x2f, 0x45, 0x6e, 0x63, 0x72, 0x79, 0x70, 0x74]; // "/Encrypt"
  outer: for (
    let i = bytes.indexOf(0x2f);
    i !== -1;
    i = bytes.indexOf(0x2f, i + 1)
  ) {
    for (let j = 1; j < word.length; j++)
      if (bytes[i + j] !== word[j]) continue outer;
    return true;
  }
  return false;
}
