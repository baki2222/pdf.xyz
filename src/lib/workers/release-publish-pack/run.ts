/**
 * The node-free **orchestrator** for the release evidence publish / handoff pack CLI (Phase 57).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-publish-pack.ts`) is a thin shell: it resolves argv, reads the documents / stdin,
 * writes the output, and exits. That keeps every branch — each input, the ingest failure modes, the
 * self-consistency re-validation, the fold, and both output formats — unit-testable without a runtime, a
 * filesystem, or a subprocess.
 *
 * Honesty flows straight through the trust boundary ({@link ingestGovernanceSource} / {@link ingestArchiveSource} /
 * {@link ingestRestoreDrill} / {@link ingestReportSource} / {@link ingestTrendSource}): a document that cannot be
 * read or parsed becomes an UNRECOGNIZED source (⇒ an `unreadable` state, path never echoed); a
 * recognized-but-self-inconsistent document is a tamper (⇒ a `tampered` state, blocking); a governance-absent (or
 * governance-unusable) run has no usable primary summary (⇒ `incomplete`, never a share-safe pack); and the fold
 * over the usable sources is deterministic. A run NEVER throws on an operational/input problem — those become a
 * structured result + exit code; only a genuine internal fault propagates, to be caught by the entry's top-level
 * handler and mapped to INCOMPLETE.
 *
 * It reads NO secret, makes NO network call, runs no gate / bundle / audit / report / trend / governance / archive
 * / restore-drill itself, and publishes / shares / sends / deletes / uploads / promotes / mutates nothing: it
 * ingests documents `worker:release-governance` / `worker:release-archive` / `worker:release-restore-drill` /
 * `worker:release-report` / `worker:release-trend` already produced and classifies their bounded, already
 * content-free postures for a handoff.
 */

import { buildPublishPackResult } from "./build";
import {
  ingestArchiveSource,
  ingestGovernanceSource,
  ingestReportSource,
  ingestRestoreDrill,
  ingestTrendSource,
  type IngestedPublishPackSources,
} from "./ingest";
import { recordReleasePublishPack } from "./metrics";
import { renderReleasePublishPack } from "./render";
import {
  releasePublishPackExitCode,
  type ReleasePublishPackPolicy,
  type ReleasePublishPackResult,
} from "./types";
import { STDIN_SENTINEL, type ReleasePublishPackArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read one document file's text; its throw is caught → that source is `unreadable` (never
 *                  echoed). Called once per supplied file path;
 *  - `readStdin` — read the whole stdin payload (only when an input value is `-`); its throw is caught → that
 *                  source is `unreadable`. Never called unless a `-` input was supplied.
 */
export interface ReleasePublishPackProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleasePublishPackRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleasePublishPackResult;
}

/** The applied policy knobs, reduced from the validated args. */
function policyOf(args: ReleasePublishPackArgs): ReleasePublishPackPolicy {
  return {
    requireArchive: args.requireArchive,
    requireRestoreDrill: args.requireRestoreDrill,
    strict: args.strict,
  };
}

/**
 * Read + JSON.parse one document from a file path or stdin (`-`). A missing/empty payload, or any read/parse
 * failure, yields `undefined` (⇒ an unrecognized source) — it never throws and never echoes the path.
 */
async function readParseSource(path: string, provider: ReleasePublishPackProvider): Promise<unknown> {
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

/** Read + reduce every supplied document into the bounded {@link IngestedPublishPackSources}. Never throws. */
async function ingestSources(
  args: ReleasePublishPackArgs,
  provider: ReleasePublishPackProvider,
): Promise<IngestedPublishPackSources> {
  const governanceSupplied = args.governancePath !== undefined;
  const archiveSupplied = args.archivePath !== undefined;
  const restoreDrillSupplied = args.restoreDrillPath !== undefined;
  const reportSupplied = args.reportPath !== undefined;
  const trendSupplied = args.trendPath !== undefined;
  const [governanceRoot, archiveRoot, restoreDrillRoot, reportRoot, trendRoot] = await Promise.all([
    governanceSupplied ? readParseSource(args.governancePath as string, provider) : Promise.resolve(undefined),
    archiveSupplied ? readParseSource(args.archivePath as string, provider) : Promise.resolve(undefined),
    restoreDrillSupplied ? readParseSource(args.restoreDrillPath as string, provider) : Promise.resolve(undefined),
    reportSupplied ? readParseSource(args.reportPath as string, provider) : Promise.resolve(undefined),
    trendSupplied ? readParseSource(args.trendPath as string, provider) : Promise.resolve(undefined),
  ]);
  return {
    governance: { supplied: governanceSupplied, ingested: ingestGovernanceSource(governanceRoot) },
    archive: { supplied: archiveSupplied, ingested: ingestArchiveSource(archiveRoot) },
    restoreDrill: { supplied: restoreDrillSupplied, ingested: ingestRestoreDrill(restoreDrillRoot) },
    report: { supplied: reportSupplied, ingested: ingestReportSource(reportRoot) },
    trend: { supplied: trendSupplied, ingested: ingestTrendSource(trendRoot) },
  };
}

/**
 * Run the release-publish-pack CLI for validated `args` using the injected `provider`. Never throws on input:
 * every operational/input problem is a structured result + exit code.
 */
export async function runReleasePublishPack(
  args: ReleasePublishPackArgs,
  provider: ReleasePublishPackProvider,
): Promise<ReleasePublishPackRun> {
  const ingested = await ingestSources(args, provider);
  const result = buildPublishPackResult(provider.now(), ingested, policyOf(args));

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleasePublishPack(result.pack.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releasePublishPackExitCode(result),
    output: renderReleasePublishPack(result, args.format, args.pretty),
    result,
  };
}
