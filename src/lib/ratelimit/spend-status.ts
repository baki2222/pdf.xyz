/**
 * The AI spend ceiling's POSTURE — what a reading tier can honestly say about a
 * cost control it does not itself write to.
 *
 * The counterpart of `./status.ts`, and deliberately its shape: a bounded code
 * vocabulary plus a pure resolver, so the snapshot layer can re-author every
 * derived field from the code alone and no surface can drift from another.
 *
 * **It exists because two true statements had never been put side by side.** The
 * ceiling is written by the worker (only it knows what a call cost) and read by
 * the web tier (only it can refuse a job). Both sides reported healthy for the
 * whole of the feature's life while the worker carried no limiter at all: every
 * `recordAiSpend` resolved `disabled` and returned `false`, the counter could
 * never rise, and the tier that must refuse jobs was reading a number nobody was
 * writing. Twenty-six tests were green. No test in the repo runs in two tiers.
 *
 * So the question this answers is not "is a limiter configured here" — that one
 * was always answerable and always answered yes. It is **"is the counter I read
 * the counter they write?"**, and the only honest way to answer it is to observe
 * a value the other tier wrote. Nothing here compares configuration.
 */
import {
  peekAiSpendCeiling,
  readSpendProbe,
  type AiSpendVerdict,
} from "./guard";
import type { SpendProbeVerdict } from "./spend-probe";

type EnvSource = Record<string, string | undefined>;

/**
 * The bounded states a reading tier can be in. Four, and every one of them is
 * operationally distinct — a posture whose codes collapse two situations is a
 * decoration, which is the lesson `remote-configured-shared` was carved out to
 * record.
 */
export type AiSpendStatusCode =
  /**
   * No limiter resolves in THIS process, so the ceiling bounds nothing here.
   * Production's exact state until 2026-08-11, on the writing side.
   */
  | "unenforced"
  /**
   * A limiter is enforcing here, but no value written by the other tier is
   * visible — so the two tiers cannot be shown to share one bucket.
   *
   * **This is deliberately not called "misconfigured".** It cannot distinguish
   * "the worker has not written yet" from "the tiers point at different
   * buckets", and must not claim to: a red posture on a worker that had simply
   * not started would be the confident-wrong answer this codebase keeps
   * removing. It is still NOT ok — absent must not read as agreement.
   */
  | "tiers-unproven"
  /** A value the other tier wrote was read back here. Empirical, not inferred. */
  | "shared"
  /**
   * The day's tokens are gone and AI is degrading. **Its own code**, so an
   * hourly watcher can tell "the ceiling did its job" from "something is
   * broken" — those need different responses and a shared `warn` would give
   * them the same one.
   */
  | "ceiling-reached";

/** The three honest probe readings, carried BESIDE the code, never folded into it. */
export type AiSpendProbeState =
  | "shared"
  | "no-probe-visible"
  | "unenforced"
  /** This vantage did not read the probe at all (a worker-side snapshot). */
  | "unknown";

/** A reading tier's full observation: the derived code and the raw probe state. */
export interface AiSpendStatus {
  readonly code: AiSpendStatusCode;
  /**
   * The probe reading as observed, kept separate on purpose.
   *
   * A tripped ceiling and an unproven pair of tiers are INDEPENDENT
   * observations: a ceiling can be reached while nothing has ever proven the
   * two tiers share a bucket, and folding them into one field would let either
   * erase the other. The whole reason this module exists is that two correct
   * statements about different axes were never compared.
   */
  readonly probe: AiSpendProbeState;
}

/** Map a probe verdict to its bounded state. Total; no default arm. */
export function probeStateOf(probe: SpendProbeVerdict): AiSpendProbeState {
  return probe.shared ? "shared" : probe.reason;
}

/**
 * Derive the posture from the two observations. **Pure** — every branch is a
 * fact about its inputs, so the whole table is testable without a store.
 *
 * The precedence, and why:
 *  1. `unenforced` first. If nothing bounds spend in this process, no further
 *     reading means anything — a `used` of zero from a disabled limiter is not
 *     evidence of a quiet day.
 *  2. `ceiling-reached` next. It is the state a user is feeling right now, and
 *     it is actionable in a way the others are not.
 *  3. `shared` only on an empirical read-back.
 *  4. `tiers-unproven` otherwise — the honest residual, never a green default.
 */
export function resolveAiSpendStatus(
  verdict: AiSpendVerdict,
  probe: SpendProbeVerdict,
): AiSpendStatus {
  const probeState = probeStateOf(probe);
  if (!verdict.enforced) return { code: "unenforced", probe: probeState };
  if (!verdict.affordable)
    return { code: "ceiling-reached", probe: probeState };
  return {
    code: probeState === "shared" ? "shared" : "tiers-unproven",
    probe: probeState,
  };
}

/**
 * Read both observations and derive the posture. Never throws: both underlying
 * reads fail open and report their own honesty bit, so a store outage produces
 * `unenforced` rather than an exception or a fabricated green.
 *
 * TWO STORE READS, and they are the reason this is not resolved inside the
 * snapshot collector like the abuse guard's posture is. Both short-circuit
 * before any network when no limiter is configured (the default), so an
 * unconfigured deployment pays nothing.
 */
export async function readAiSpendStatus(
  env: EnvSource = process.env,
  nowMs: number = Date.now(),
): Promise<AiSpendStatus> {
  const [verdict, probe] = await Promise.all([
    peekAiSpendCeiling(env, nowMs),
    readSpendProbe(env, nowMs),
  ]);
  return resolveAiSpendStatus(verdict, probe);
}

/*
 * A DELIBERATELY REJECTED SIMPLIFICATION, recorded because it is the one a
 * future reader will reach for.
 *
 * A no-limiter deployment now reports `unenforced` (warn) on the spend row while
 * the abuse guard reports `disabled` (ok) — two rows, one configuration choice,
 * and the second reads as noise on a dev box. The obvious fix is to quiet the
 * spend row whenever no limiter is selected at all.
 *
 * It was implemented and then removed. From the reading tier, "this whole
 * product runs without a limiter" (deliberate) and "THIS TIER has no limiter
 * while the other does" (production's exact bug, mirrored) are INDISTINGUISHABLE
 * — the probe read returns `unenforced` either way and teaches nothing. So
 * quieting the first necessarily quiets the second, and the second is the defect
 * this entire module exists to make visible.
 *
 * The two rows are not duplicates. `rate-limit: disabled` says a fairness device
 * is off by choice; `ai-spend: unenforced` says total cost is unbounded. The
 * second is worth a warning on its own terms even when the first is deliberate.
 */
