/**
 * The node-free **orchestrator** for the release evidence audit CLI (Phase 51).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-audit.ts`) is a thin shell: it resolves argv, reads the bundle files / stdin,
 * writes the output, and exits. That keeps every branch — each input mode, the ingest failure modes, the
 * bundle self-consistency re-validation, the diff, the rollup, and both output formats — unit-testable
 * without a runtime, a filesystem, or a subprocess.
 *
 * Honesty flows straight through the trust boundary ({@link ingestBundle}): a bundle file that cannot be
 * read or parsed becomes an UNRECOGNIZED bundle (⇒ `bundle-unreadable`, path never echoed); a recognized-
 * but-self-inconsistent bundle is a tamper (⇒ `bundle-tampered`, blocking); a pair that is not both usable,
 * or a history with fewer than two comparable bundles, is `unknown` (insufficient — never a vacuous pass);
 * and the diff over two usable bundles is deterministic. A run NEVER throws on an operational/input
 * problem — those become a structured result + exit code; only a genuine internal fault propagates, to be
 * caught by the entry's top-level handler and mapped to UNKNOWN.
 *
 * It reads NO secret, makes NO network call, runs no stage/bundle itself, and deletes/uploads/promotes/
 * mutates nothing: it ingests bundles `worker:release-ci-bundle` already produced and diffs their bounded,
 * already content-free postures.
 */

import { buildAuditResult, type BuildAuditInput } from "./build";
import { UNRECOGNIZED_BUNDLE, ingestBundle } from "./ingest";
import { recordReleaseAudit } from "./metrics";
import { renderReleaseAudit } from "./render";
import {
  releaseAuditExitCode,
  type AuditPolicy,
  type IngestedBundle,
  type ReleaseAuditResult,
} from "./types";
import type { ReleaseAuditArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read one bundle file's text; its throw is caught → that bundle is `unreadable` (never
 *                  echoed). Called once per supplied bundle path;
 *  - `readStdin` — read the whole stdin payload (history `--stdin` mode only); its throw is caught → an
 *                  empty history (⇒ `unknown`, insufficient). Never called unless `--stdin` was supplied.
 */
export interface ReleaseAuditProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseAuditRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseAuditResult;
}

/** The applied policy knobs, reduced from the validated args. */
function policyOf(args: ReleaseAuditArgs): AuditPolicy {
  return {
    allowWarnRegression: args.allowWarnRegression,
    maxNewWarnings: args.maxNewWarnings,
    failOnUnknown: args.failOnUnknown,
  };
}

/**
 * Read + JSON.parse one bundle file, then reduce it through the trust boundary. A missing path, an empty
 * file, or any read/parse failure yields the UNRECOGNIZED bundle (⇒ `bundle-unreadable`) — it never throws
 * and never echoes the path.
 */
async function readIngest(
  path: string,
  provider: ReleaseAuditProvider,
): Promise<IngestedBundle> {
  let text: string;
  try {
    text = await provider.readFile(path);
  } catch {
    return UNRECOGNIZED_BUNDLE;
  }
  if (text.trim() === "") return UNRECOGNIZED_BUNDLE;
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return UNRECOGNIZED_BUNDLE;
  }
  return ingestBundle(root);
}

/**
 * Build the ordered history list of ingested bundles (newest LAST), from either repeated `--bundle` files
 * or a `--stdin` JSON array. A stdin payload that is missing, unparseable, or not an array yields an EMPTY
 * history (⇒ `unknown`, insufficient) — never a throw and never a fabricated comparison.
 */
async function ingestHistory(
  args: ReleaseAuditArgs,
  provider: ReleaseAuditProvider,
): Promise<IngestedBundle[]> {
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
    return parsed.map((element) => ingestBundle(element));
  }
  const paths = args.bundlePaths ?? [];
  return Promise.all(paths.map((path) => readIngest(path, provider)));
}

/** Assemble the composer input for pair mode: read the baseline + current bundles concurrently. */
async function pairInput(
  args: ReleaseAuditArgs,
  provider: ReleaseAuditProvider,
): Promise<BuildAuditInput> {
  // Pair mode guarantees both paths (the parser rejects a missing one), so both slots are always SUPPLIED;
  // an unreadable file becomes a not-recognized bundle (⇒ `bundle-unreadable`, unknown), never a pass.
  const [baseline, current] = await Promise.all([
    readIngest(args.baselinePath as string, provider),
    readIngest(args.currentPath as string, provider),
  ]);
  return {
    generatedAt: provider.now(),
    mode: "pair",
    policy: policyOf(args),
    baseline: { supplied: true, ingested: baseline },
    current: { supplied: true, ingested: current },
  };
}

/**
 * Assemble the composer input for history mode: the current release is the LAST bundle and the baseline is
 * the one before it, plus a trend distribution over the whole list. Fewer than two supplied bundles leaves
 * a slot NOT supplied → the diff is not comparable → `unknown` (insufficient), the honest "too little
 * history", never a vacuous pass.
 */
async function historyInput(
  args: ReleaseAuditArgs,
  provider: ReleaseAuditProvider,
): Promise<BuildAuditInput> {
  const list = await ingestHistory(args, provider);
  const n = list.length;
  const current = n >= 1 ? (list[n - 1] as IngestedBundle) : UNRECOGNIZED_BUNDLE;
  const baseline = n >= 2 ? (list[n - 2] as IngestedBundle) : UNRECOGNIZED_BUNDLE;
  return {
    generatedAt: provider.now(),
    mode: "history",
    policy: policyOf(args),
    baseline: { supplied: n >= 2, ingested: baseline },
    current: { supplied: n >= 1, ingested: current },
    history: list,
  };
}

/**
 * Run the release-audit CLI for validated `args` using the injected `provider`. Never throws on input:
 * every operational/input problem is a structured result + exit code.
 */
export async function runReleaseAudit(
  args: ReleaseAuditArgs,
  provider: ReleaseAuditProvider,
): Promise<ReleaseAuditRun> {
  const input = args.mode === "pair" ? await pairInput(args, provider) : await historyInput(args, provider);
  const result = buildAuditResult(input);

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseAudit(result.rollup.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseAuditExitCode(result),
    output: renderReleaseAudit(result, args.format, args.pretty),
    result,
  };
}
