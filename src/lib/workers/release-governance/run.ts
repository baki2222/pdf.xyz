/**
 * The node-free **orchestrator** for the release evidence governance bundle CLI (Phase 54).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-governance.ts`) is a thin shell: it resolves argv, reads the documents / stdin,
 * writes the output, and exits. That keeps every branch — each input, the ingest failure modes, the
 * self-consistency re-validation, the fold, and both output formats — unit-testable without a runtime, a
 * filesystem, or a subprocess.
 *
 * Honesty flows straight through the trust boundary ({@link ingestTrend} / {@link ingestReportSource} /
 * {@link ingestAuditSource}): a document that cannot be read or parsed becomes an UNRECOGNIZED source (⇒ an
 * `unreadable` state, path never echoed); a recognized-but-self-inconsistent document is a tamper (⇒ a
 * `tampered` state, blocking); a trend-absent (or trend-unusable) run has no usable primary window signal (⇒
 * `incomplete`, never a healthy); and the fold over the usable sources is deterministic. A run NEVER throws on
 * an operational/input problem — those become a structured result + exit code; only a genuine internal fault
 * propagates, to be caught by the entry's top-level handler and mapped to INCOMPLETE.
 *
 * It reads NO secret, makes NO network call, runs no gate / bundle / audit / report / trend itself, and deletes
 * / uploads / promotes / mutates nothing: it ingests documents `worker:release-trend` / `worker:release-report`
 * / `worker:release-audit` already produced and folds their bounded, already content-free postures.
 */

import { buildGovernanceResult } from "./build";
import {
  ingestAuditSource,
  ingestReportSource,
  ingestTrend,
  type IngestedGovernanceSources,
} from "./ingest";
import { recordReleaseGovernance } from "./metrics";
import { renderReleaseGovernance } from "./render";
import { releaseGovernanceExitCode, type ReleaseGovernancePolicy, type ReleaseGovernanceResult } from "./types";
import { STDIN_SENTINEL, type ReleaseGovernanceArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read one document file's text; its throw is caught → that source is `unreadable` (never
 *                  echoed). Called once per supplied file path;
 *  - `readStdin` — read the whole stdin payload (only when an input value is `-`); its throw is caught → that
 *                  source is `unreadable`. Never called unless a `-` input was supplied.
 */
export interface ReleaseGovernanceProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseGovernanceRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseGovernanceResult;
}

/** The applied policy knobs, reduced from the validated args. */
function policyOf(args: ReleaseGovernanceArgs): ReleaseGovernancePolicy {
  return {
    requireReport: args.requireReport,
    requireAudit: args.requireAudit,
    strictWatch: args.strictWatch,
  };
}

/**
 * Read + JSON.parse one document from a file path or stdin (`-`). A missing/empty payload, or any read/parse
 * failure, yields `undefined` (⇒ an unrecognized source) — it never throws and never echoes the path.
 */
async function readParseSource(path: string, provider: ReleaseGovernanceProvider): Promise<unknown> {
  let text: string;
  try {
    text = path === STDIN_SENTINEL ? await provider.readStdin() : await provider.readFile(path);
  } catch {
    return undefined;
  }
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Read + reduce every supplied document into the bounded {@link IngestedGovernanceSources}. Never throws. */
async function ingestSources(
  args: ReleaseGovernanceArgs,
  provider: ReleaseGovernanceProvider,
): Promise<IngestedGovernanceSources> {
  const trendSupplied = args.trendPath !== undefined;
  const reportSupplied = args.reportPath !== undefined;
  const auditSupplied = args.auditPath !== undefined;
  const [trendRoot, reportRoot, auditRoot] = await Promise.all([
    trendSupplied ? readParseSource(args.trendPath as string, provider) : Promise.resolve(undefined),
    reportSupplied ? readParseSource(args.reportPath as string, provider) : Promise.resolve(undefined),
    auditSupplied ? readParseSource(args.auditPath as string, provider) : Promise.resolve(undefined),
  ]);
  return {
    trend: { supplied: trendSupplied, ingested: ingestTrend(trendRoot) },
    report: { supplied: reportSupplied, ingested: ingestReportSource(reportRoot) },
    audit: { supplied: auditSupplied, ingested: ingestAuditSource(auditRoot) },
  };
}

/**
 * Run the release-governance CLI for validated `args` using the injected `provider`. Never throws on input:
 * every operational/input problem is a structured result + exit code.
 */
export async function runReleaseGovernance(
  args: ReleaseGovernanceArgs,
  provider: ReleaseGovernanceProvider,
): Promise<ReleaseGovernanceRun> {
  const ingested = await ingestSources(args, provider);
  const result = buildGovernanceResult(provider.now(), ingested, policyOf(args));

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseGovernance(result.governance.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseGovernanceExitCode(result),
    output: renderReleaseGovernance(result, args.format, args.pretty),
    result,
  };
}
