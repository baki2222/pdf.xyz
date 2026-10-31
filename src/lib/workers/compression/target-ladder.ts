/**
 * "Target size" for deep compression (2026-10-31): the bounded descending
 * ladder the worker climbs down until a file fits.
 *
 * ── WHAT IT DOES ───────────────────────────────────────────────────────────
 *
 * The rungs are image resolutions. The first is the Quality the person chose
 * (`targetDpi`, Balanced 150 by default); below it come the fixed rungs of
 * {@link TARGET_DPI_LADDER}, down to the worker's floor of 72 DPI (`MIN_DPI`
 * in `engine.ts`, the Extreme preset). The answer is the FIRST rung — the
 * highest resolution — whose file is at or under the target.
 *
 * The order is floor first, then top down. The floor is the smallest file
 * the ladder can make, so it answers "can anything fit?" in one run: when it
 * cannot, the job stops there and returns that smallest file, reported as
 * not met. When it can, the rungs above it run from the top, and the first
 * that fits wins; if none does, the floor's file is already in hand and is
 * not made twice. A target nothing can reach — the expensive case if the
 * ladder ran top down — costs ONE run; the worst case is one run per rung.
 *
 * That shortcut assumes a lower resolution never makes a bigger file. It is
 * how Ghostscript's downsampling behaves (fewer pixels, then the same
 * encoder), and the in-image proof (`../options-proof.ts`) measures each
 * rung's size on the real engine and fails if they do not descend.
 *
 * ── WHAT BOUNDS IT ─────────────────────────────────────────────────────────
 *
 *  - attempts: one per rung, at most {@link MAX_TARGET_ATTEMPTS};
 *  - time: every rung shares ONE budget — `limits.targetBudgetMs`, which the
 *    worker sets to the same `PDFXYZ_COMPRESSION_TIMEOUT_MS` a single run is
 *    allowed (`native.ts`). Each rung's subprocess timeout is what is left,
 *    and no rung starts with under {@link MIN_RUNG_MS}. So a target job can
 *    never take longer than one ordinary deep job is already allowed to.
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
  /** A rung fit (or every rung ran and the floor's file fit). */
  | "fit"
  /** The floor did not fit, so nothing could; its file is the smallest. */
  | "floor_missed"
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
  /** Only when the FIRST run (the floor) produced nothing usable. */
  | { ok: false; report: TargetLadderReport };

export interface TargetLadderDeps {
  engine: CompressionTool;
  native: NativeCompressor;
  validate: (bytes: Uint8Array) => boolean | Promise<boolean>;
  /** The shared time budget; absent ⇒ unbounded (tests, and callers with no limit). */
  budgetMs?: number;
  now: () => number;
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
  const floor = rungs[rungs.length - 1]!;
  const order = [floor, ...rungs.slice(0, -1)];
  const started = deps.now();
  const tried: TargetAttempt[] = [];
  const report = (
    chosenDpi: number | null,
    stoppedBy: TargetStop,
  ): TargetLadderReport => ({
    targetBytes: options.targetBytes,
    tried,
    chosenDpi,
    stoppedBy,
  });

  const attempt = async (dpi: number): Promise<Uint8Array | null> => {
    const remaining =
      deps.budgetMs === undefined
        ? undefined
        : deps.budgetMs - (deps.now() - started);
    let out: Uint8Array | null = null;
    try {
      const bytes = await deps.native(input, {
        engine: deps.engine,
        // Grayscale and every other option ride along untouched; only the
        // resolution changes from rung to rung.
        options: { ...options, targetDpi: dpi },
        ...(remaining === undefined ? {} : { timeoutMs: remaining }),
      });
      out = (await deps.validate(bytes)) ? bytes : null;
    } catch {
      out = null;
    }
    tried.push({ dpi, bytes: out ? out.byteLength : null });
    return out;
  };

  const smallest = await attempt(floor);
  if (!smallest) return { ok: false, report: report(null, "engine_error") };
  if (smallest.byteLength > options.targetBytes) {
    return {
      ok: true,
      output: smallest,
      report: report(floor, "floor_missed"),
    };
  }

  let stoppedBy: TargetStop = "fit";
  for (const dpi of order.slice(1)) {
    if (
      deps.budgetMs !== undefined &&
      deps.budgetMs - (deps.now() - started) < MIN_RUNG_MS
    ) {
      stoppedBy = "budget";
      break;
    }
    const out = await attempt(dpi);
    if (!out) {
      stoppedBy = "engine_error";
      break;
    }
    if (out.byteLength <= options.targetBytes) {
      return { ok: true, output: out, report: report(dpi, "fit") };
    }
  }
  // Nothing above the floor fit (or the ladder was cut short): the floor's
  // file, already made, is the highest-quality one known to fit.
  return { ok: true, output: smallest, report: report(floor, stoppedBy) };
}
