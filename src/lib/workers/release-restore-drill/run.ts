import { canonicalize } from "../release-artifact/canonicalize";
import { buildRestoreResult } from "./build";
import {
  ingestRestoreArchive,
  ingestRestoredAudit,
  ingestRestoredBundle,
  ingestRestoredGovernance,
  ingestRestoredReport,
  ingestRestoredTrend,
  type IngestedRestoreDrill,
} from "./ingest";
import { recordReleaseRestoreDrill } from "./metrics";
import { renderReleaseRestoreDrill } from "./render";
import { releaseRestoreDrillExitCode, type ReleaseRestoreDrillPolicy, type ReleaseRestoreDrillResult } from "./types";
import { STDIN_SENTINEL, type ReleaseRestoreDrillArgs } from "./args";

export interface ReleaseRestoreDrillProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
  /** Optional canonical-content hasher (a `node:crypto` sha256 at the CLI). Absent ⇒ digests are `null`. */
  hash?(canonical: string): string;
}

export interface ReleaseRestoreDrillRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseRestoreDrillResult;
}

function policyOf(args: ReleaseRestoreDrillArgs): ReleaseRestoreDrillPolicy {
  return {
    archiveOnly: args.archiveOnly,
    requireFullRestore: args.requireFullRestore,
    strictDrift: args.strictDrift,
  };
}

/** Read + parse a source path (or stdin). Returns the parsed root, or `undefined` on any read / parse failure. */
async function readParseSource(path: string, provider: ReleaseRestoreDrillProvider): Promise<unknown> {
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

/** The canonical content digest of a parsed root, or `null` when absent / no hasher. */
function digestOf(root: unknown, provider: ReleaseRestoreDrillProvider): string | null {
  if (root === undefined || provider.hash === undefined) return null;
  return provider.hash(canonicalize(root));
}

async function ingestDrill(
  args: ReleaseRestoreDrillArgs,
  provider: ReleaseRestoreDrillProvider,
): Promise<IngestedRestoreDrill> {
  const governanceSupplied = args.governancePath !== undefined;
  const trendSupplied = args.trendPath !== undefined;
  const reportSupplied = args.reportPath !== undefined;
  const auditSupplied = args.auditPath !== undefined;
  const bundleSupplied = args.bundlePath !== undefined;
  const [archiveRoot, governanceRoot, trendRoot, reportRoot, auditRoot, bundleRoot] = await Promise.all([
    readParseSource(args.archivePath, provider),
    governanceSupplied ? readParseSource(args.governancePath as string, provider) : Promise.resolve(undefined),
    trendSupplied ? readParseSource(args.trendPath as string, provider) : Promise.resolve(undefined),
    reportSupplied ? readParseSource(args.reportPath as string, provider) : Promise.resolve(undefined),
    auditSupplied ? readParseSource(args.auditPath as string, provider) : Promise.resolve(undefined),
    bundleSupplied ? readParseSource(args.bundlePath as string, provider) : Promise.resolve(undefined),
  ]);
  return {
    archive: { supplied: true, ingested: ingestRestoreArchive(archiveRoot), digest: digestOf(archiveRoot, provider) },
    governance: { supplied: governanceSupplied, ingested: ingestRestoredGovernance(governanceRoot), digest: digestOf(governanceRoot, provider) },
    trend: { supplied: trendSupplied, ingested: ingestRestoredTrend(trendRoot), digest: digestOf(trendRoot, provider) },
    report: { supplied: reportSupplied, ingested: ingestRestoredReport(reportRoot), digest: digestOf(reportRoot, provider) },
    audit: { supplied: auditSupplied, ingested: ingestRestoredAudit(auditRoot), digest: digestOf(auditRoot, provider) },
    bundle: { supplied: bundleSupplied, ingested: ingestRestoredBundle(bundleRoot), digest: digestOf(bundleRoot, provider) },
  };
}

export async function runReleaseRestoreDrill(
  args: ReleaseRestoreDrillArgs,
  provider: ReleaseRestoreDrillProvider,
): Promise<ReleaseRestoreDrillRun> {
  const ingested = await ingestDrill(args, provider);
  const result = buildRestoreResult(provider.now(), ingested, policyOf(args), provider.hash !== undefined);
  try {
    recordReleaseRestoreDrill(result.drill.verdict);
  } catch {
    // metrics must never break the CLI
  }
  return {
    exitCode: releaseRestoreDrillExitCode(result),
    output: renderReleaseRestoreDrill(result, args.format, args.pretty),
    result,
  };
}
