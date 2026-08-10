/**
 * The Node **reader** that resolves a live {@link CleanupEvidencePosture} from the configured
 * report files (Phase 44). It is the one seam here that touches the filesystem; every other
 * cleanup-evidence module is pure and node-free, so all of the interesting logic (config, parse,
 * fold) is unit-testable and this shell stays thin.
 *
 * It reads ONLY the operator-configured content-free report SUMMARIES, read-only, bounded in
 * size. A missing file, an I/O error, a malformed body, or a raw export the parser refuses each
 * becomes a bounded observation — never a throw, and never an echo of the path or the offending
 * bytes into the posture, output, logs, or errors. With no report configured it is a pure no-op
 * (the honest `disabled` posture), so importing this on the web route or the ops-check CLI costs
 * nothing until an operator opts in.
 *
 * The filesystem + clock are injected via {@link CleanupEvidenceReadDeps} (defaulting to a real
 * `node:fs` reader), so a test drives every branch — missing, unreadable, oversize, malformed,
 * stale, healthy — deterministically without a real file.
 */

import { readFileSync, statSync } from "node:fs";
import { resolveCleanupEvidenceConfig } from "./config";
import { parseCleanupReportText } from "./parse";
import {
  resolveCleanupEvidencePosture,
  type CleanupEvidenceObservation,
} from "./posture";
import {
  DISABLED_CLEANUP_EVIDENCE_POSTURE,
  type CleanupEvidencePosture,
} from "./types";

type EnvSource = Record<string, string | undefined>;

/** Hard cap on a report file; a content-free summary is tiny (a few hundred bytes). */
export const MAX_REPORT_BYTES = 1_048_576; // 1 MiB

/** The bounded outcome of reading one report file — no Node error object ever escapes. */
export type ReadReportOutcome =
  | {
      readonly kind: "ok";
      readonly text: string;
      readonly mtimeMs: number | null;
    }
  | { readonly kind: "missing" }
  | { readonly kind: "unreadable" };

/** The injectable capabilities the reader needs: read a report file, and read the clock. */
export interface CleanupEvidenceReadDeps {
  /** Read a report file to a bounded outcome. Must NEVER throw or leak the path. */
  readReportFile(path: string): ReadReportOutcome;
  /** Epoch ms wall clock, for freshness. */
  now(): number;
}

/**
 * The default `node:fs` reader: stat for size + mtime, then read up to the cap. Classifies a
 * missing file (`ENOENT`) distinctly from any other I/O error, and treats an oversize file as
 * unreadable (a content-free summary is never a megabyte). Catches everything — no path, errno,
 * or message escapes.
 */
function readReportFileFromFs(path: string): ReadReportOutcome {
  let mtimeMs: number | null = null;
  try {
    const stat = statSync(path);
    if (stat.size > MAX_REPORT_BYTES) return { kind: "unreadable" };
    mtimeMs = Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : null;
  } catch (err) {
    if (isMissing(err)) return { kind: "missing" };
    return { kind: "unreadable" };
  }
  try {
    return { kind: "ok", text: readFileSync(path, "utf8"), mtimeMs };
  } catch (err) {
    return { kind: isMissing(err) ? "missing" : "unreadable" };
  }
}

/** True when a caught error is a "no such file" error, without trusting its shape. */
function isMissing(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}

/** The real default deps: the `node:fs` reader and the system clock. */
const DEFAULT_DEPS: CleanupEvidenceReadDeps = {
  readReportFile: readReportFileFromFs,
  now: () => Date.now(),
};

/** Turn one configured path into a bounded observation the resolver can fold. */
function observe(
  path: string,
  deps: CleanupEvidenceReadDeps,
): CleanupEvidenceObservation {
  const outcome = deps.readReportFile(path);
  if (outcome.kind === "missing")
    return { kind: "error", reason: "report_missing" };
  if (outcome.kind === "unreadable")
    return { kind: "error", reason: "report_unreadable" };
  const parsed = parseCleanupReportText(outcome.text);
  if (!parsed.ok) return { kind: "error", reason: "report_malformed" };
  return { kind: "report", report: parsed.report, mtimeMs: outcome.mtimeMs };
}

/**
 * Resolve the live cleanup evidence posture from an environment. Reads each configured report
 * (disabled ⇒ a pure no-op returning the `disabled` posture), folds the observations against the
 * clock, and returns a content-free posture. Never throws. `env` and `deps` are injectable.
 */
export function readCleanupEvidencePosture(
  env: EnvSource = process.env,
  deps: CleanupEvidenceReadDeps = DEFAULT_DEPS,
): CleanupEvidencePosture {
  const config = resolveCleanupEvidenceConfig(env);
  if (!config.enabled) return DISABLED_CLEANUP_EVIDENCE_POSTURE;

  const observations: CleanupEvidenceObservation[] = [];
  for (const path of [config.checkReportPath, config.sweepReportPath]) {
    if (path === null) continue;
    observations.push(observe(path, deps));
  }
  return resolveCleanupEvidencePosture(config, observations, deps.now());
}
