/**
 * The pure decisions behind `scripts/worker-prove-tools.ts`: what one proof
 * attempt's outcome is allowed to claim, what the process exit code means, and
 * how AI proofs rotate under the free daily allowance.
 *
 * WHY A THIRD OUTCOME EXISTS (TASK-72). The harness used to know two states,
 * and on 2026-08-21 that binary told a lie: production refused the fourth AI
 * run of the day with `429 rate_limited` — the free allowance working exactly
 * as designed — and the harness printed `FAIL` and exited 1. Nothing was
 * broken. The harness is this codebase's instrument of last resort (every
 * other readiness surface is presence-only), and an instrument that goes red
 * for a non-defect trains its reader to discount red; a red guard nobody can
 * explain gets deleted. A refusal by the deployment's own policy is not
 * evidence about the tool, so it gets its own outcome: UNPROVEN.
 *
 * THE PROPERTY (the license for "unproven", stated as a property so a future
 * rewrite can check itself against it): **a proof may claim "unproven — not
 * evidence about the tool" only when the observed response says the
 * deployment's own policy refused to run the job.** Two responses say that,
 * and both are matched against the constants the routes actually serve, so
 * the definition cannot drift from the deployment in this tree:
 *
 *  - `429` with the app's typed `rate_limited` envelope — the only emitter is
 *    `rateLimitErrorResult` in `src/lib/ratelimit/response.ts` (the free AI
 *    allowance and the generic flood throttle share it; the served message
 *    names which policy spoke).
 *  - `503 service_unavailable` carrying {@link AI_CEILING_REACHED_MESSAGE}
 *    verbatim — the global AI spend ceiling's peek in `POST /api/jobs`. The
 *    code alone does NOT license "unproven": storage and delivery failures
 *    reuse `service_unavailable`, and excusing those would hide a real outage
 *    in the convenient direction. Only the ceiling's own sentence counts, and
 *    it is compared against the imported constant, never retyped.
 *
 * Everything else stays FAILED. An untyped 429 (a platform page), the
 * ceiling's sentence under the wrong status, a 503 with any other message —
 * none of them carry the license, so the instrument stays red and a human
 * looks. A false alarm costs one investigation; a false "not evidence" is the
 * convenient defect this repo keeps cataloguing.
 *
 * EXIT-CODE SEMANTICS, decided deliberately:
 *
 *  - `0` — every selected proof PASSED (and, on a full run, every worker tool
 *    has a spec). Green keeps meaning "proven", undiluted: letting an
 *    incomplete run exit 0 would recreate the presence-only readiness problem
 *    this harness exists to fix.
 *  - `1` — evidence of a defect: at least one proof FAILED, or a worker tool
 *    arrived without a proof spec. Red is *reserved* for evidence.
 *  - `2` — incomplete, not failing: nothing failed, but at least one proof
 *    was refused by the deployment's own policy. The claim "all proven" is
 *    not licensed, and nothing is known to be broken.
 *
 * What should CI do with 2? Nothing that it does with 1. A pipeline that
 * treats any nonzero as "stop" still stops — safe by default, an incomplete
 * run never silently upgrades to proven — but it must not page anyone or
 * block on it as a defect: the right response is to rerun after the allowance
 *  resets, letting the rotation below prove the tools yesterday's run could
 * not reach.
 *
 * ROTATION. One connection's daily allowance cannot cover all the AI proof
 * runs in one day (five runs across four tools, three runs a day), and the
 * harness must not route around the limiter — the limiter is a real cost
 * control, and a probe that dodges it stops proving what users actually hit.
 * So coverage is spread over runs: AI tools are attempted least-recently-
 * proven first, from a per-deployment ledger of when each spec last passed. A
 * failed or refused run does not advance a tool's position — the ledger
 * records only proofs, so the rotation repairs itself instead of marching
 * past a tool that never passes. A tool's staleness is its LEAST recently
 * proven spec: half-proving the chat pair must not make the conversation
 * claim look covered.
 */

import { AI_CEILING_REACHED_MESSAGE } from "@/lib/jobs/ai-spend-ceiling";

/* ------------------------------------------------------------------ *
 *  Outcomes
 * ------------------------------------------------------------------ */

/** Exported as a value so guards can DISCOVER the vocabulary, not retype it. */
export const PROOF_OUTCOMES = ["proven", "failed", "unproven"] as const;
export type ProofOutcome = (typeof PROOF_OUTCOMES)[number];

/* ------------------------------------------------------------------ *
 *  Classifying an observed refusal
 * ------------------------------------------------------------------ */

/** What the harness actually saw on a refused request. No field is inferred. */
export interface ObservedRefusal {
  status: number;
  /** The typed `error.code` from the app's envelope, or null if none came back. */
  code: string | null;
  /** The typed `error.message`, or null. Passed through, never paraphrased. */
  message: string | null;
}

/**
 * The two policies that can license "unproven". Exported as a value so the
 * corpus test can assert every branch is exercised by a served response.
 */
export const UNPROVEN_VIAS = ["rate-limit", "spend-ceiling"] as const;
export type UnprovenVia = (typeof UNPROVEN_VIAS)[number];

export type RefusalVerdict =
  | { outcome: "unproven"; via: UnprovenVia; reason: string }
  | { outcome: "failed" };

/**
 * Classify a refused HTTP exchange. See the module docblock for the property;
 * the short form: "unproven" must be licensed by the observation, everything
 * unlicensed stays "failed".
 */
export function refusalVerdict(observed: ObservedRefusal): RefusalVerdict {
  if (observed.status === 429 && observed.code === "rate_limited") {
    return {
      outcome: "unproven",
      via: "rate-limit",
      reason:
        `refused by the deployment's own rate-limit policy — not evidence ` +
        `about the tool. Server said: ${observed.message ?? "(no message)"}`,
    };
  }
  if (
    observed.status === 503 &&
    observed.code === "service_unavailable" &&
    observed.message === AI_CEILING_REACHED_MESSAGE
  ) {
    return {
      outcome: "unproven",
      via: "spend-ceiling",
      reason:
        `refused by the deployment's AI spend ceiling — a cost control on ` +
        `their side, not evidence about the tool. Server said: ${observed.message}`,
    };
  }
  return { outcome: "failed" };
}

/* ------------------------------------------------------------------ *
 *  Exit code
 * ------------------------------------------------------------------ */

export const EXIT_ALL_PROVEN = 0;
export const EXIT_DEFECT = 1;
export const EXIT_INCOMPLETE = 2;

/**
 * The trichotomy, with defect evidence dominating: any FAILED (or, on a full
 * run, a worker tool with no spec) is 1 no matter what else happened; any
 * UNPROVEN without a failure is 2; only a clean, complete run is 0.
 */
export function harnessExitCode(run: {
  outcomes: readonly ProofOutcome[];
  unspecifiedToolCount: number;
  fullRun: boolean;
}): number {
  const defect =
    run.outcomes.includes("failed") ||
    (run.fullRun && run.unspecifiedToolCount > 0);
  if (defect) return EXIT_DEFECT;
  if (run.outcomes.includes("unproven")) return EXIT_INCOMPLETE;
  return EXIT_ALL_PROVEN;
}

/* ------------------------------------------------------------------ *
 *  Rotation under the allowance
 * ------------------------------------------------------------------ */

export interface ProofLedgerEntry {
  /** ISO-8601 UTC instant of the spec's last PASS against this deployment. */
  lastProvenAt: string;
}

/** One deployment's ledger, keyed by spec key (`label ?? tool`). */
export type DeploymentProofLedger = Record<
  string,
  ProofLedgerEntry | undefined
>;

/** The minimal shape rotation needs; the harness's ProofSpec satisfies it. */
export interface RotatableSpec {
  tool: string;
  label?: string;
}

/** A spec's ledger key. One definition, shared by rotation and the harness. */
export function specKey(spec: RotatableSpec): string {
  return spec.label ?? spec.tool;
}

/**
 * When a spec was last proven, as epoch millis; never-proven (or unparsable —
 * re-prove, do not trust) is -Infinity so it sorts first.
 */
function provenAtMillis(
  ledger: DeploymentProofLedger,
  spec: RotatableSpec,
): number {
  const raw = ledger[specKey(spec)]?.lastProvenAt;
  if (raw === undefined) return -Infinity;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? -Infinity : parsed;
}

/**
 * Order the selected specs so the allowance is spent where proof is stalest.
 *
 * Non-AI specs keep their original order and run first — they cost no
 * allowance and their chains (protect → unlock) depend on that order. AI
 * specs run after, grouped by tool with each group's internal order kept
 * (the chat follow-up must follow its opening turn in the same process),
 * groups sorted by the tool's LEAST recently proven spec, never-proven
 * first, ties kept stable in original order.
 */
export function orderSpecsForAllowance<T extends RotatableSpec>(
  specs: readonly T[],
  isAi: (spec: T) => boolean,
  ledger: DeploymentProofLedger,
): T[] {
  const nonAi = specs.filter((s) => !isAi(s));

  const groups = new Map<string, T[]>();
  for (const spec of specs) {
    if (!isAi(spec)) continue;
    const group = groups.get(spec.tool);
    if (group) group.push(spec);
    else groups.set(spec.tool, [spec]);
  }

  // Map iteration preserves insertion order, which is the original SPECS
  // order of each tool's first spec — the stable tie-break. Sort a copy of
  // the entries by staleness; JS sort is stable, so ties keep that order.
  const ordered = [...groups.values()].sort(
    (a, b) =>
      Math.min(...a.map((s) => provenAtMillis(ledger, s))) -
      Math.min(...b.map((s) => provenAtMillis(ledger, s))),
  );

  return [...nonAi, ...ordered.flat()];
}
