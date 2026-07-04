/**
 * The node-free **orchestrator** for the release evidence trend summary CLI (Phase 53).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-trend.ts`) is a thin shell: it resolves argv, reads the report files / stdin, writes
 * the output, and exits. That keeps every branch — each input mode, the ingest failure modes, the report
 * self-consistency re-validation, the window cap, the fold, and both output formats — unit-testable without a
 * runtime, a filesystem, or a subprocess.
 *
 * Honesty flows straight through the trust boundary ({@link ingestReport}): a report file that cannot be read or
 * parsed becomes an UNRECOGNIZED report (⇒ an `unreadable` point, path never echoed); a recognized-but-self-
 * inconsistent report is a tamper (⇒ a `tampered` point, blocking); a window with no usable reports is
 * insufficient (⇒ `unknown`, never a vacuous stable); and the fold over the usable reports is deterministic. A
 * run NEVER throws on an operational/input problem — those become a structured result + exit code; only a
 * genuine internal fault propagates, to be caught by the entry's top-level handler and mapped to UNKNOWN.
 *
 * It reads NO secret, makes NO network call, runs no gate / bundle / audit / report itself, and deletes /
 * uploads / promotes / mutates nothing: it ingests reports `worker:release-report` already produced and
 * summarizes their bounded, already content-free recommendations.
 */

import { buildTrendResult } from "./build";
import { UNRECOGNIZED_REPORT, ingestReport, type IngestedReport } from "./ingest";
import { recordReleaseTrend } from "./metrics";
import { renderReleaseTrend } from "./render";
import { releaseTrendExitCode, type ReleaseTrendPolicy, type ReleaseTrendResult } from "./types";
import type { ReleaseTrendArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read one report file's text; its throw is caught → that report is `unreadable` (never
 *                  echoed). Called once per supplied report path;
 *  - `readStdin` — read the whole stdin payload (`--stdin` mode only); its throw is caught → an empty history
 *                  (⇒ `unknown`, insufficient). Never called unless `--stdin` was supplied.
 */
export interface ReleaseTrendProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseTrendRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseTrendResult;
}

/** The applied policy knobs, reduced from the validated args. */
function policyOf(args: ReleaseTrendArgs): ReleaseTrendPolicy {
  return {
    maxReports: args.maxReports,
    maxHoldWarning: args.maxHoldWarning,
    maxHoldFail: args.maxHoldFail,
    requireLatestReady: args.requireLatestReady,
  };
}

/**
 * Read + JSON.parse one report file, then reduce it through the trust boundary. A missing path, an empty file,
 * or any read/parse failure yields the UNRECOGNIZED report (⇒ an `unreadable` point) — it never throws and never
 * echoes the path.
 */
async function readIngest(path: string, provider: ReleaseTrendProvider): Promise<IngestedReport> {
  let text: string;
  try {
    text = await provider.readFile(path);
  } catch {
    return UNRECOGNIZED_REPORT;
  }
  if (text.trim() === "") return UNRECOGNIZED_REPORT;
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return UNRECOGNIZED_REPORT;
  }
  return ingestReport(root);
}

/**
 * Build the ordered history of ingested reports (oldest → newest), from either repeated `--report` / `--file`
 * files or a `--stdin` JSON array. A stdin payload that is missing, unparseable, or not an array yields an EMPTY
 * history (⇒ `unknown`, insufficient) — never a throw and never a fabricated summary.
 */
async function ingestHistory(
  args: ReleaseTrendArgs,
  provider: ReleaseTrendProvider,
): Promise<IngestedReport[]> {
  if (args.stdin) {
    let text: string;
    try {
      text = await provider.readStdin();
    } catch {
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.map((element) => ingestReport(element));
  }
  const paths = args.reportPaths ?? [];
  return Promise.all(paths.map((path) => readIngest(path, provider)));
}

/**
 * Run the release-trend CLI for validated `args` using the injected `provider`. Never throws on input: every
 * operational/input problem is a structured result + exit code.
 */
export async function runReleaseTrend(
  args: ReleaseTrendArgs,
  provider: ReleaseTrendProvider,
): Promise<ReleaseTrendRun> {
  const reports = await ingestHistory(args, provider);
  const result = buildTrendResult(provider.now(), reports, policyOf(args));

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseTrend(result.trend.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseTrendExitCode(result),
    output: renderReleaseTrend(result, args.format, args.pretty),
    result,
  };
}
