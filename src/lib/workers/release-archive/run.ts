import { buildArchiveResult } from "./build";
import { ingestAuditRecord, ingestBundleRecord, ingestGovernance, ingestReportRecord, ingestTrendRecord, type IngestedArchiveRecords } from "./ingest";
import { recordReleaseArchive } from "./metrics";
import { renderReleaseArchive } from "./render";
import { releaseArchiveExitCode, type ReleaseArchivePolicy, type ReleaseArchiveResult } from "./types";
import { STDIN_SENTINEL, type ReleaseArchiveArgs } from "./args";

export interface ReleaseArchiveProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

export interface ReleaseArchiveRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseArchiveResult;
}

function policyOf(args: ReleaseArchiveArgs): ReleaseArchivePolicy {
  return {
    requireTrend: args.requireTrend,
    requireReport: args.requireReport,
    requireAudit: args.requireAudit,
    requireBundle: args.requireBundle,
    strictWatch: args.strictWatch,
  };
}

async function readParseSource(path: string, provider: ReleaseArchiveProvider): Promise<unknown> {
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

async function ingestRecords(args: ReleaseArchiveArgs, provider: ReleaseArchiveProvider): Promise<IngestedArchiveRecords> {
  const governanceSupplied = args.governancePath !== undefined;
  const trendSupplied = args.trendPath !== undefined;
  const reportSupplied = args.reportPath !== undefined;
  const auditSupplied = args.auditPath !== undefined;
  const bundleSupplied = args.bundlePath !== undefined;
  const [governanceRoot, trendRoot, reportRoot, auditRoot, bundleRoot] = await Promise.all([
    governanceSupplied ? readParseSource(args.governancePath as string, provider) : Promise.resolve(undefined),
    trendSupplied ? readParseSource(args.trendPath as string, provider) : Promise.resolve(undefined),
    reportSupplied ? readParseSource(args.reportPath as string, provider) : Promise.resolve(undefined),
    auditSupplied ? readParseSource(args.auditPath as string, provider) : Promise.resolve(undefined),
    bundleSupplied ? readParseSource(args.bundlePath as string, provider) : Promise.resolve(undefined),
  ]);
  return {
    governance: { supplied: governanceSupplied, ingested: ingestGovernance(governanceRoot) },
    trend: { supplied: trendSupplied, ingested: ingestTrendRecord(trendRoot) },
    report: { supplied: reportSupplied, ingested: ingestReportRecord(reportRoot) },
    audit: { supplied: auditSupplied, ingested: ingestAuditRecord(auditRoot) },
    bundle: { supplied: bundleSupplied, ingested: ingestBundleRecord(bundleRoot) },
  };
}

export async function runReleaseArchive(
  args: ReleaseArchiveArgs,
  provider: ReleaseArchiveProvider,
): Promise<ReleaseArchiveRun> {
  const ingested = await ingestRecords(args, provider);
  const result = buildArchiveResult(provider.now(), ingested, policyOf(args));
  try {
    recordReleaseArchive(result.archive.posture);
  } catch {
    // metrics must never break the CLI
  }
  return {
    exitCode: releaseArchiveExitCode(result),
    output: renderReleaseArchive(result, args.format, args.pretty),
    result,
  };
}
