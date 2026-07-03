/**
 * Pure, node-free **release-gate ingest** for the release evidence artifact (Phase 47) — a trust
 * boundary.
 *
 * The artifact archives a `worker:release-gate` result: either one the operator supplied
 * (`--release-gate=<file>`) or one the CLI ran internally and captured on stdout. Either way the
 * JSON is UNTRUSTED input, and this module turns it into the bounded {@link ReleaseArtifactGate}
 * shape, in the same paranoid spirit as the ops-bundle ingest:
 *  - **No-leak by reconstruction.** It NEVER copies a string field out of the gate result. The
 *    verdict, each check's id + status, and the blocker ids are validated against the gate's own
 *    bounded enums; everything else (the checks' `summary`/`remediation`, the receipt, the guidance,
 *    the caveats — all app prose in a real gate, but a hostile input could put a secret there) is
 *    DROPPED. The section's `detail` is re-authored from the app's own map.
 *  - **Bounded counts.** Counts are coerced to finite, non-negative, safe integers; the checks/
 *    blockers arrays are capped, so a pathological input cannot bloat the artifact.
 *  - **Fail-closed honesty.** A `null` text (no result obtained) ⇒ `not-configured`; anything
 *    unreadable/unrecognized ⇒ `unreadable`; both resolve the verdict to `unknown` (which blocks a
 *    `pass`), never a false `pass`.
 */

import {
  RELEASE_CHECK_IDS,
  RELEASE_CHECK_STATUSES,
  RELEASE_GATE_SCHEMA,
  RELEASE_GATE_VERDICTS,
  isReleaseCheckId,
  type ReleaseCheckId,
  type ReleaseGateVerdict,
} from "../release-gate/types";
import {
  type GateSource,
  type ReleaseArtifactGate,
  type ReleaseArtifactGateCheck,
} from "./types";

/** Cap the archived per-check + blocker lists (the gate catalog is small; this bounds a hostile input). */
const MAX_CHECKS = 64;

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return `value` if it is one of `allowed`, else `undefined`. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** A finite, non-negative, safe integer, or `0`. Bounds a pathological ingested count. */
function safeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const n = Math.floor(value);
  if (n < 0) return 0;
  return Math.min(n, Number.MAX_SAFE_INTEGER);
}

/** An array, or `[]`. Never throws; a non-array degrades to empty. */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Re-author the bounded per-check digest (invalid ids/statuses dropped, length capped, prose discarded). */
function ingestChecks(raw: unknown): ReleaseArtifactGateCheck[] {
  const out: ReleaseArtifactGateCheck[] = [];
  for (const item of asArray(raw).slice(0, MAX_CHECKS)) {
    if (!isObject(item)) continue;
    const id = oneOf(item.id, RELEASE_CHECK_IDS);
    const status = oneOf(item.status, RELEASE_CHECK_STATUSES);
    if (id && status) out.push({ id, status });
  }
  return out;
}

/** Re-author the bounded blocker id list (invalid ids dropped, length capped, de-duplicated in order). */
function ingestBlockers(raw: unknown): ReleaseCheckId[] {
  const seen = new Set<ReleaseCheckId>();
  for (const item of asArray(raw).slice(0, MAX_CHECKS)) {
    if (isReleaseCheckId(item)) seen.add(item);
  }
  // Emit in catalog order so the archived order is stable regardless of input order.
  return RELEASE_CHECK_IDS.filter((id) => seen.has(id));
}

/** The authored detail for a gate section that carries no usable result. */
const GATE_ABSENT_DETAIL: Record<Exclude<GateSource, "generated" | "supplied">, string> = {
  "not-configured":
    "No release-gate result was obtained, so no gate evidence could be archived. Supply a `pnpm worker:release-gate --json` result via --release-gate=<file>, or omit the flag to run the gate internally.",
  unreadable:
    "The obtained release-gate result is not a recognized content-free `pdfxyz.worker-release-gate/1` result (unreadable, malformed, or the wrong shape), so its evidence could not be archived. The offending content is never echoed.",
};

/** Re-author the one-line detail for a PRESENT (ingested) gate result. */
function presentGateDetail(
  source: "generated" | "supplied",
  verdict: ReleaseGateVerdict,
  passedChecks: number,
  includedChecks: number,
  skippedChecks: number,
): string {
  const origin = source === "generated" ? "ran internally" : "supplied by the operator";
  const skipTail = skippedChecks > 0 ? `, ${skippedChecks} skipped` : "";
  return `The archived release gate (${origin}) resolved ${verdict} over ${passedChecks}/${includedChecks} passed checks${skipTail}.`;
}

/**
 * The bounded gate section for a SUPPLIED/INTERNAL result the runner could not read or run at all (a
 * file read error, a spawn failure). Same honest `unreadable` posture as a malformed result — the
 * offending error is never echoed.
 */
export function unreadableGate(): ReleaseArtifactGate {
  return absentGate("unreadable");
}

/** The bounded gate section for a result that could not be obtained/recognized (never echoes it). */
function absentGate(source: "not-configured" | "unreadable"): ReleaseArtifactGate {
  return {
    source,
    present: false,
    verdict: "unknown",
    includedChecks: 0,
    passedChecks: 0,
    skippedChecks: 0,
    blockers: [],
    checks: [],
    detail: GATE_ABSENT_DETAIL[source],
  };
}

/**
 * Parse + validate a release-gate result and reduce it to the bounded {@link ReleaseArtifactGate}.
 *
 * @param text   The raw gate JSON, or `null` when no result was obtained (⇒ `not-configured`).
 * @param source Whether the result was `generated` internally or `supplied` by the operator. If the
 *               input is unreadable/unrecognized, the returned section's source is `unreadable`
 *               regardless (the honest "we could not read what we obtained").
 */
export function ingestGateResult(
  text: string | null,
  source: "generated" | "supplied",
): ReleaseArtifactGate {
  if (text === null) return absentGate("not-configured");

  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return absentGate("unreadable");
  }
  if (!isObject(root) || root.schema !== RELEASE_GATE_SCHEMA) return absentGate("unreadable");

  const rollup = isObject(root.rollup) ? root.rollup : undefined;
  const verdict = rollup ? oneOf(rollup.verdict, RELEASE_GATE_VERDICTS) : undefined;
  // A gate result whose rollup carries no recognized verdict is not a usable result — fail closed.
  if (!rollup || !verdict) return absentGate("unreadable");

  const includedChecks = safeCount(rollup.includedChecks);
  const passedChecks = Math.min(safeCount(rollup.passedChecks), includedChecks);
  const skippedChecks = safeCount(rollup.skippedChecks);

  return {
    source,
    present: true,
    verdict,
    includedChecks,
    passedChecks,
    skippedChecks,
    blockers: ingestBlockers(rollup.blockers),
    checks: ingestChecks(root.checks),
    detail: presentGateDetail(source, verdict, passedChecks, includedChecks, skippedChecks),
  };
}
