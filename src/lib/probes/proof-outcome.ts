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
 *  - `2` — incomplete, not failing: nothing failed, but at least one selected
 *    proof could not be made — the deployment's own policy refused it, or its
 *    input came from a proof that was itself never made. Stated as the
 *    PROPERTY ("the claim was not made") rather than the mechanism ("a policy
 *    refused"): the mechanism arrived first and is only one way to get here,
 *    and a summary that says "refused" about a proof nothing refused is the
 *    defect {@link unprovenSummaryLines} exists to prevent. Nothing is known
 *    to be broken; "all proven" is simply not licensed.
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
 * Why a proof could not be made. The two {@link UNPROVEN_VIAS} are OBSERVED
 * refusals — the deployment answered and said no. `dependency` is not: no
 * request was ever sent, because the artifact this proof consumes never
 * arrived (the chat follow-up when the opening turn was refused).
 *
 * They are kept apart because the roll-up line is the cheapest place in this
 * harness to spread one observed cause over a set that did not share it — the
 * defect `reservation-refusal.ts` exists to prevent, one file over. The first
 * run of this feature against production on 2026-08-21 did exactly that:
 * `5 UNPROVEN — refused by the deployment's own policy … chat-with-pdf
 * (follow-up)`, when the follow-up was refused by nothing and never asked.
 */
export const UNPROVEN_CAUSES = [...UNPROVEN_VIAS, "dependency"] as const;
export type UnprovenCause = (typeof UNPROVEN_CAUSES)[number];

/** What each cause is allowed to say about the tools it names. */
const CAUSE_SENTENCE: Record<UnprovenCause, string> = {
  "rate-limit":
    "refused by the deployment's own rate-limit policy, which is not evidence about the tools",
  "spend-ceiling":
    "refused by the deployment's AI spend ceiling, which is not evidence about the tools",
  dependency:
    "never asked — the artifact each consumes was not produced this run, so nothing here is evidence about them",
};

/**
 * The run's UNPROVEN roll-up, one line per cause actually observed, each line
 * naming only the proofs that carried that cause. Grouping (rather than one
 * sentence over the union) is the whole point: a probe may not report a cause
 * it did not observe, and that includes a cause it observed somewhere else.
 * Order follows {@link UNPROVEN_CAUSES} so the output is stable across runs.
 */
export function unprovenSummaryLines(
  rows: readonly { label: string; cause: UnprovenCause }[],
): string[] {
  const lines: string[] = [];
  for (const cause of UNPROVEN_CAUSES) {
    const labels = rows.filter((r) => r.cause === cause).map((r) => r.label);
    if (labels.length === 0) continue;
    lines.push(
      `${labels.length} UNPROVEN — ${CAUSE_SENTENCE[cause]}: ${labels.join(", ")}`,
    );
  }
  return lines;
}

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
 *  A proof whose PASS is a refusal
 * ------------------------------------------------------------------ */

/** The terminal job fields an expected-refusal proof reads. */
export interface ObservedJob {
  status?: string;
  error?: { code: string; message: string };
}

/**
 * Judge a proof that passes only when the job FAILS, with exactly the
 * sentence the worker gives users for that failure.
 *
 * Why this shape exists: webpage-to-pdf's proof renders https://example.com/
 * and requires "Example Domain" in the PDF — and example.com answers every
 * other path with a 404 carrying THE SAME PAGE. Until 2026-09 the worker
 * printed error pages like any other, so a proof that reads the text could not
 * tell the page from its 404. Only a proof that asks for the 404 and requires
 * the job to refuse it can see that the status is read at all.
 *
 * The expected sentence is passed in from the engine's own message function,
 * never retyped, so rewording it moves the proof with it. A COMPLETED job is
 * the loudest failure here: it means a user was handed a PDF of an error page.
 */
export function judgeExpectedRefusal(
  expectedMessage: string,
  job: ObservedJob,
): { ok: boolean; detail: string } {
  if (job.status === "completed")
    return {
      ok: false,
      detail:
        "the job COMPLETED — the worker delivered a PDF of a page the site refused, as if it were the page",
    };
  if (job.status !== "failed")
    return {
      ok: false,
      detail: `the job ended "${job.status ?? "timeout"}", not refused`,
    };
  if (job.error?.message !== expectedMessage)
    return {
      ok: false,
      detail:
        `the job failed, but not with the site's reason: ${job.error ? `${job.error.code}: ${job.error.message}` : "(no error)"}`.slice(
          0,
          240,
        ),
    };
  return {
    ok: true,
    detail: `refused as it should be — ${job.error.code}: ${job.error.message}`,
  };
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
