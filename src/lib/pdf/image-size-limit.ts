/**
 * "Max file size" for JPG to PDF and PNG to PDF (2026-10-31) — the pure half:
 * the panel's choices and words, the rung table, the bounded ladder, and the
 * sentence the panel says once a PDF is made. Nothing here touches a canvas;
 * the browser re-encoder is `image-reencode.ts`, and the two are joined in
 * `image-size-fit.ts`, which the runner loads only when a limit is set.
 *
 * ── WHAT THE LADDER DOES ──────────────────────────────────────────────────
 *
 * Attempt 0 is the PDF exactly as it is made with no limit. If it is at or
 * under the limit, it is the answer — byte for byte the same file — and
 * nothing is re-encoded. Otherwise each rung of {@link REENCODE_LADDER} saves
 * every image again as a JPEG at a lower quality and/or pixel size, the PDF
 * is rebuilt, and the REAL PDF is measured. The first attempt at or under the
 * limit wins: the rungs run from the best quality down, so the first fit is
 * the sharpest that fits. If none fits, the SMALLEST PDF actually made is
 * returned and reported as over the limit.
 *
 * Nothing assumes a lower rung makes a smaller file. PR #244 (Compress PDF's
 * Target size) shipped the lesson: real encoders are not monotonic — there
 * Ghostscript switched encoder at a lower resolution and made a BIGGER file.
 * A canvas JPEG of a small PNG can likewise outweigh the PNG. So every rung
 * that runs is measured, "smallest" means the smallest made, and the tests
 * drive the ladder with sizes that rise mid-way.
 *
 * ── WHAT BOUNDS IT ────────────────────────────────────────────────────────
 *
 *  - attempts: at most {@link MAX_LIMIT_ATTEMPTS} (attempt 0 plus one per rung);
 *  - time: one {@link LIMIT_TIME_BUDGET_MS} budget per PDF. The first attempt
 *    always runs; a later one starts only while budget is left, and a ladder
 *    cut short says so (`stoppedBy: "budget"`) and returns the smallest of
 *    what ran;
 *  - the page: the ladder awaits `pause()` between attempts, so the tab can
 *    paint and take input while a long ladder runs on the main thread (the
 *    image tools have no worker; decoding and encoding are the browser's own
 *    async `createImageBitmap` / `convertToBlob`).
 */
import { formatBytes } from "@/lib/utils";
import { IMAGE_OUTPUTS } from "./image-page-layout";
import { KB, SIZE_PRESETS, sizeLabel } from "./size-presets";

export { KB };

/** The presets: Compress PDF's Target size list itself (`size-presets.ts`). */
export const MAX_SIZE_PRESETS = SIZE_PRESETS;

/** The panel's words for the choice, named once so copy can quote them. */
export const MAX_SIZE_LABELS = {
  heading: "Max file size",
  none: "No limit",
  custom: "Custom",
} as const;

/**
 * The line under the choice, quoted by the tool pages' copy. Every promise in
 * it is a property of `image-reencode.ts`: a JPEG at a lower quality and pixel
 * size, no metadata (a canvas carries none), transparency onto white.
 */
export const MAX_SIZE_HINT =
  "If the PDF comes out bigger, your browser saves the images again as JPEGs, at a lower quality and pixel size, until it fits. Those images can look softer, lose their camera details, and any transparent areas turn white.";

/** The sizes the copy's worked example uses ("Now 93.0 KB — under your 100 KB limit."). */
export const LIMIT_EXAMPLE = { limitBytes: 100 * KB, outputBytes: 93 * KB };

/** The smallest limit a custom value may ask for: under it, hardly a page. */
export const MIN_LIMIT_BYTES = 10 * KB;
/** Seven digits of KB, the most the custom box takes. */
const CUSTOM_KB = /^\d{1,7}$/;

/** The panel's choice: no limit, a preset (its bytes), or a typed KB value. */
export type SizeLimitChoice = "none" | "custom" | number;

/**
 * The bytes a choice asks for: `undefined` for No limit, `"invalid"` for a
 * custom value that is not a whole number of KB at or over the floor. The
 * run waits on an invalid one.
 */
export function chosenLimitBytes(
  choice: SizeLimitChoice,
  customKb: string,
): number | undefined | "invalid" {
  if (choice === "none") return undefined;
  if (choice !== "custom") return choice;
  const typed = customKb.trim();
  if (!CUSTOM_KB.test(typed)) return "invalid";
  const bytes = Number(typed) * KB;
  return bytes >= MIN_LIMIT_BYTES ? bytes : "invalid";
}

/** One re-encode step: JPEG quality, and pixel size as a share of the image's own. */
export interface ReencodeRung {
  quality: number;
  scale: number;
}

/**
 * The rungs, best quality first. A 12-megapixel phone photo (4000 px wide)
 * reaches 1,000 px at the 0.25 rung and 720 px at the last one.
 */
export const REENCODE_LADDER: readonly ReencodeRung[] = [
  { quality: 0.85, scale: 1 },
  { quality: 0.75, scale: 0.8 },
  { quality: 0.7, scale: 0.6 },
  { quality: 0.65, scale: 0.45 },
  { quality: 0.6, scale: 0.33 },
  { quality: 0.55, scale: 0.25 },
  { quality: 0.5, scale: 0.18 },
];

/** No rung makes an image's long edge shorter than this (or than its own). */
export const MIN_LONG_EDGE_PX = 320;

/** Attempt 0 (the PDF as made) plus one per rung. */
export const MAX_LIMIT_ATTEMPTS = REENCODE_LADDER.length + 1;

/** The time one PDF's ladder may take before it stops with what it has. */
export const LIMIT_TIME_BUDGET_MS = 60_000;

/**
 * The pixel size an image of `width`×`height` is saved at on a rung of
 * `scale`: its shape kept, its long edge never under {@link MIN_LONG_EDGE_PX}
 * (an image already smaller keeps its own size), never larger than it is.
 */
export function rungPixelSize(
  width: number,
  height: number,
  scale: number,
): { width: number; height: number } {
  const long = Math.max(width, height);
  const floor = Math.min(1, MIN_LONG_EDGE_PX / long);
  const s = Math.min(1, Math.max(scale, floor));
  return {
    width: Math.max(1, Math.round(width * s)),
    height: Math.max(1, Math.round(height * s)),
  };
}

/** One attempt that ran: its rung (0 = as made) and the PDF's size. */
export interface LimitAttempt {
  rung: number;
  bytes: number;
}

export type LimitStop =
  /** An attempt fit; the rungs below it did not run. */
  | "fit"
  /** Every attempt ran and none fit. */
  | "exhausted"
  /** The time budget ran out before the next rung. */
  | "budget"
  /** A rung after the first threw (a canvas out of memory, say). */
  | "error";

/** What the ladder spent and found — the same shape on every outcome. */
export interface LimitReport {
  limitBytes: number;
  /** Every attempt that ran, in the order it ran. */
  tried: LimitAttempt[];
  /** The attempt whose PDF was returned. */
  chosenRung: number;
  /** The returned PDF is at or under the limit, by its bytes. */
  met: boolean;
  stoppedBy: LimitStop;
}

export interface FitDeps {
  now: () => number;
  /** Absent ⇒ unbounded (tests). The runner passes {@link LIMIT_TIME_BUDGET_MS}. */
  budgetMs?: number;
  /** Awaited between attempts, so the page can paint. */
  pause?: () => Promise<void>;
}

/**
 * Build attempt 0, then rung after rung, until one is at or under
 * `limitBytes`. See the module comment. `build(0)` throwing is the run
 * failing; a later rung throwing ends the ladder with what it has.
 */
export async function fitUnderLimit(
  limitBytes: number,
  attempts: number,
  build: (rung: number) => Promise<Uint8Array>,
  deps: FitDeps,
): Promise<{ output: Uint8Array; report: LimitReport }> {
  const started = deps.now();
  const tried: LimitAttempt[] = [];
  let smallest: { rung: number; output: Uint8Array } | null = null;
  let stoppedBy: LimitStop = "exhausted";

  for (let rung = 0; rung < attempts; rung++) {
    if (rung > 0) {
      if (
        deps.budgetMs !== undefined &&
        deps.now() - started >= deps.budgetMs
      ) {
        stoppedBy = "budget";
        break;
      }
      await deps.pause?.();
    }
    let output: Uint8Array;
    try {
      output = await build(rung);
    } catch (error) {
      if (rung === 0) throw error;
      stoppedBy = "error";
      break;
    }
    tried.push({ rung, bytes: output.byteLength });
    if (output.byteLength <= limitBytes) {
      return {
        output,
        report: {
          limitBytes,
          tried,
          chosenRung: rung,
          met: true,
          stoppedBy: "fit",
        },
      };
    }
    if (!smallest || output.byteLength < smallest.output.byteLength)
      smallest = { rung, output };
  }

  // Attempt 0 always runs, so there is always a smallest.
  const best = smallest!;
  return {
    output: best.output,
    report: {
      limitBytes,
      tried,
      chosenRung: best.rung,
      met: false,
      stoppedBy,
    },
  };
}

/** The Output chip that makes one PDF per image, by its own label. */
const PER_IMAGE_LABEL = IMAGE_OUTPUTS.find((o) => o.id === "per-image")!.label;

/** The sentence about re-encoding, quoted by the tool pages' copy. */
export const REENCODED_NOTE =
  "The images were saved again as JPEGs at a lower quality to make it smaller, so they can look softer.";
/** The sentence about transparency, quoted by the tool pages' copy. */
export const FLATTENED_NOTE =
  "Transparent areas were filled with white, the colour of the page.";

export interface LimitOutcomeInput {
  limitBytes: number;
  /** The size of the PDF the person gets. */
  outputBytes: number;
  /** Its images were saved again (a rung above 0 was chosen). */
  reencoded: boolean;
  /** A transparent image in it was composited onto white. */
  flattened: boolean;
  /** Images in this PDF. */
  images: number;
}

/**
 * The sentence the panel shows for one PDF made under a limit. `met` is read
 * from the bytes of the PDF the person gets, never from the ladder's verdict.
 */
export function limitOutcome({
  limitBytes,
  outputBytes,
  reencoded,
  flattened,
  images,
}: LimitOutcomeInput): { met: boolean; text: string } {
  const limit = sizeLabel(limitBytes);
  const now = formatBytes(outputBytes);
  const met = outputBytes <= limitBytes;
  const notes = [
    ...(reencoded ? [REENCODED_NOTE] : []),
    ...(reencoded && flattened ? [FLATTENED_NOTE] : []),
  ];
  const head = met
    ? `Now ${now} — under your ${limit} limit.`
    : `The smallest we could make is ${now}, above your ${limit} limit. ${
        images > 1
          ? `Try fewer images, or choose ${PER_IMAGE_LABEL}.`
          : "Try a larger limit."
      }`;
  return { met, text: [head, ...notes].join(" ") };
}
