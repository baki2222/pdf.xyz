/**
 * The node-free **orchestrator** for the release evidence operator report CLI (Phase 52).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-report.ts`) is a thin shell: it resolves argv, reads the documents / stdin, writes
 * the output, and exits. That keeps every branch — each input, the ingest failure modes, the self-consistency
 * re-validation, the fold, and both output formats — unit-testable without a runtime, a filesystem, or a
 * subprocess.
 *
 * Honesty flows straight through the trust boundary ({@link ingestBundleSource} / {@link ingestAudit}): a
 * document that cannot be read or parsed becomes an UNRECOGNIZED source (⇒ an `unreadable` state, path never
 * echoed); a recognized-but-self-inconsistent document is a tamper (⇒ a `tampered` state, blocking); an
 * audit-only (or bundle-absent) run has no usable coherence evidence (⇒ `needs-evidence`, never a promote);
 * and the fold over the usable sources is deterministic. A run NEVER throws on an operational/input problem —
 * those become a structured result + exit code; only a genuine internal fault propagates, to be caught by the
 * entry's top-level handler and mapped to NEEDS-EVIDENCE.
 *
 * It reads NO secret, makes NO network call, runs no stage / bundle / audit itself, and deletes / uploads /
 * promotes / approves / mutates nothing: it ingests documents `worker:release-ci-bundle` /
 * `worker:release-audit` already produced and folds their bounded, already content-free postures.
 */

import { buildReportResult } from "./build";
import { ingestAudit, ingestBundleSource, type IngestedSources } from "./ingest";
import { recordReleaseReport } from "./metrics";
import { renderReleaseReport } from "./render";
import { releaseReportExitCode, type ReleaseReportResult } from "./types";
import { STDIN_SENTINEL, type ReleaseReportArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read one document file's text; its throw is caught → that source is `unreadable` (never
 *                  echoed). Called once per supplied file path;
 *  - `readStdin` — read the whole stdin payload (only when an input value is `-`); its throw is caught → that
 *                  source is `unreadable`. Never called unless a `-` input was supplied.
 */
export interface ReleaseReportProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseReportRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseReportResult;
}

/**
 * Read + JSON.parse one document from a file path or stdin (`-`). A missing/empty payload, or any read/parse
 * failure, yields `undefined` (⇒ an unrecognized source) — it never throws and never echoes the path.
 */
async function readParseSource(
  path: string,
  provider: ReleaseReportProvider,
): Promise<unknown> {
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

/** Read + reduce every supplied document into the bounded {@link IngestedSources}. Never throws on input. */
async function ingestSources(
  args: ReleaseReportArgs,
  provider: ReleaseReportProvider,
): Promise<IngestedSources> {
  const bundleSupplied = args.bundlePath !== undefined;
  const auditSupplied = args.auditPath !== undefined;
  const [bundleRoot, auditRoot] = await Promise.all([
    bundleSupplied ? readParseSource(args.bundlePath as string, provider) : Promise.resolve(undefined),
    auditSupplied ? readParseSource(args.auditPath as string, provider) : Promise.resolve(undefined),
  ]);
  return {
    bundle: { supplied: bundleSupplied, ingested: ingestBundleSource(bundleRoot) },
    audit: { supplied: auditSupplied, ingested: ingestAudit(auditRoot) },
  };
}

/** Run the release-report CLI for validated `args` using the injected `provider`. Never throws on input. */
export async function runReleaseReport(
  args: ReleaseReportArgs,
  provider: ReleaseReportProvider,
): Promise<ReleaseReportRun> {
  const ingested = await ingestSources(args, provider);
  const result = buildReportResult(provider.now(), ingested, args.strict);

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseReport(result.recommendation.recommendation);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseReportExitCode(result),
    output: renderReleaseReport(result, args.format, args.pretty),
    result,
  };
}
