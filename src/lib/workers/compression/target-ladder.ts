/**
 * "Target size" for deep compression (2026-10-31): the bounded descending
 * ladder the worker climbs down until a file fits.
 *
 * ── WHAT IT DOES ───────────────────────────────────────────────────────────
 *
 * The rungs are image resolutions. The first is the Quality the person chose
 * (`targetDpi`, Balanced 150 by default); below it come the fixed rungs of
 * {@link TARGET_DPI_LADDER}, down to the worker's floor of 72 DPI (`MIN_DPI`
 * in `engine.ts`, the Extreme preset). They run from the top, and the answer
 * is the FIRST rung — the highest resolution — whose file is at or under the
 * target. If none is, the answer is the SMALLEST file among the rungs that
 * ran, reported as not met.
 *
 * ── WHY NOT FLOOR FIRST (inverted the same day) ───────────────────────────
 *
 * The first version ran the 72 DPI floor first and, when it did not fit,
 * stopped: "the floor is the smallest file the ladder can make". That assumed
 * a lower resolution never makes a bigger file, and the in-image proof — which
 * asserted the assumption — failed on the real Ghostscript (container.yml,
 * run 41164786989): 300 DPI 347,330 B, 200 DPI 158,359 B, 150 DPI 579,622 B,
 * 120 DPI 392,474 B, 96 DPI 252,391 B, 72 DPI 143,420 B. Sizes are NOT
 * monotonic in resolution: Ghostscript's AutoFilter chooses the image encoder
 * per image and per run (DCT or Flate), so a lower rung can switch to the
 * lossless encoder and come out bigger (`native.ts`, and the PR for the
 * measurement). So nothing here assumes an order of sizes: every rung that
 * runs is measured, the first fit wins, and "smallest" means the smallest
 * file actually made. The proof now asserts those properties instead.
 *
 * ── WHAT BOUNDS IT ─────────────────────────────────────────────────────────
 *
 *  - attempts: one per rung, at most {@link MAX_TARGET_ATTEMPTS};
 *  - time: every rung shares ONE budget — `limits.targetBudgetMs`, which the
 *    worker sets to the same `PDFXYZ_COMPRESSION_TIMEOUT_MS` a single run is
 *    allowed (`native.ts`). Each rung's subprocess timeout is what is left,
 *    and no rung starts with under {@link MIN_RUNG_MS}. So a target job can
 *    never take longer than one ordinary deep job is already allowed to. A
 *    ladder cut short by the budget says so (`stoppedBy: "budget"`), and its
 *    "smallest" is the smallest of what ran.
 *  - grayscale: carried to every rung exactly as asked. The ladder never
 *    drops colour to hit a size; the panel suggests it, the person decides.
 *  - engines: only Ghostscript reads the resolution. qpdf and mutool would
 *    make the same file on every rung, so for them the ladder is one run.
 */
import type {
  CompressionOptions,
  CompressionTool,
  NativeCompressor,
} from "./engine";
import { rethrowIfAttemptAbort } from "../attempt-abort";

/** The rungs below the chosen Quality, highest first. Ends at the worker's 72 DPI floor. */
export const TARGET_DPI_LADDER = [300, 200, 150, 120, 96, 72] as const;

/** One run per rung, plus the chosen Quality when it is not itself a rung. */
export const MAX_TARGET_ATTEMPTS = TARGET_DPI_LADDER.length + 1;

/** No rung starts with less time than this left in the budget. */
export const MIN_RUNG_MS = 1_000;

/** The engines whose output depends on the resolution asked for. */
const DPI_TOOLS: readonly CompressionTool[] = ["ghostscript"];

/** The rungs for a run whose chosen Quality is `startDpi`, highest first. */
export function ladderRungs(startDpi: number): number[] {
  return [startDpi, ...TARGET_DPI_LADDER.filter((dpi) => dpi < startDpi)];
}

/** One rung that ran: its resolution and the size it made (`null`: it failed). */
export interface TargetAttempt {
  dpi: number;
  bytes: number | null;
}

/** Why the ladder stopped where it did. */
export type TargetStop =
  /** A rung fit; the rungs below it did not run. */
  | "fit"
  /** Every rung ran and none fit; the smallest of them was returned. */
  | "exhausted"
  /** The shared time budget ran out before the next rung. */
  | "budget"
  /** A rung's engine run failed or made an unreadable file. */
  | "engine_error";

/** What the ladder spent and found — the same shape on every outcome. */
export interface TargetLadderReport {
  targetBytes: number;
  /** Every rung that ran, in the order it ran. */
  tried: TargetAttempt[];
  /** The rung whose file was chosen; `null` when none was usable. */
  chosenDpi: number | null;
  stoppedBy: TargetStop;
}

export type TargetLadderRun =
  | { ok: true; output: Uint8Array; report: TargetLadderReport }
  /** Only when NO rung produced a usable file. */
  | { ok: false; report: TargetLadderReport };

export interface TargetLadderDeps {
  engine: CompressionTool;
  native: NativeCompressor;
  validate: (bytes: Uint8Array) => boolean | Promise<boolean>;
  /** The shared time budget; absent ⇒ unbounded (tests, and callers with no limit). */
  budgetMs?: number;
  now: () => number;
  /** The attempt's abort signal: an aborted rung stops the ladder, no rung after it runs. */
  signal?: AbortSignal;
}

/** Climb down the ladder for `options.targetBytes`. See the module comment. */
export async function runTargetLadder(
  input: Uint8Array,
  options: CompressionOptions & { targetBytes: number },
  deps: TargetLadderDeps,
): Promise<TargetLadderRun> {
  const rungs = DPI_TOOLS.includes(deps.engine)
    ? ladderRungs(options.targetDpi)
    : [options.targetDpi];
  const started = deps.now();
  const remaining = () =>
    deps.budgetMs === undefined
      ? undefined
      : deps.budgetMs - (deps.now() - started);
  const tried: TargetAttempt[] = [];
  /** The smallest usable file made so far, and its rung. */
  let smallest: { dpi: number; output: Uint8Array } | null = null;
  let stoppedBy: TargetStop = "exhausted";

  for (const [i, dpi] of rungs.entries()) {
    const left = remaining();
    // The first rung always runs, on the whole budget; later ones only with
    // enough of it left to be worth starting.
    if (i > 0 && left !== undefined && left < MIN_RUNG_MS) {
      stoppedBy = "budget";
      break;
    }
    let out: Uint8Array | null = null;
    try {
      const bytes = await deps.native(input, {
        engine: deps.engine,
        // Grayscale and every other option ride along untouched; only the
        // resolution changes from rung to rung.
        options: { ...options, targetDpi: dpi },
        ...(left === undefined ? {} : { timeoutMs: left }),
        ...(deps.signal ? { signal: deps.signal } : {}),
      });
      out = (await deps.validate(bytes)) ? bytes : null;
    } catch (error) {
      // Not an `engine_error` rung: nobody is waiting for this ladder.
      rethrowIfAttemptAbort(error);
      out = null;
    }
    tried.push({ dpi, bytes: out ? out.byteLength : null });
    if (!out) {
      stoppedBy = "engine_error";
      break;
    }
    if (out.byteLength <= options.targetBytes) {
      return {
        ok: true,
        output: out,
        report: {
          targetBytes: options.targetBytes,
          tried,
          chosenDpi: dpi,
          stoppedBy: "fit",
        },
      };
    }
    if (!smallest || out.byteLength < smallest.output.byteLength) {
      smallest = { dpi, output: out };
    }
  }

  const report: TargetLadderReport = {
    targetBytes: options.targetBytes,
    tried,
    chosenDpi: smallest ? smallest.dpi : null,
    stoppedBy,
  };
  return smallest
    ? { ok: true, output: smallest.output, report }
    : { ok: false, report };
}
