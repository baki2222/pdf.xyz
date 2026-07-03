/**
 * The node-free **orchestrator** for the cleanup-verification CLI (Phase 42).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-cleanup-check.ts`) is a thin shell: it resolves the storage provider from env
 * and reads stdin/files, then hands those capabilities here. That keeps every branch — each
 * source, the verify + fold, ingest failures, the metric/receipt emission, and every output
 * format — unit-testable without a runtime, a bucket, or a filesystem.
 *
 * Honesty flows straight through: the verdict is computed by the pure verifier from injected,
 * re-validated evidence; a `not-configured` provider short-circuits to the honest default; and
 * the exit code is the documented ops ladder (0 ok / 1 usage / 2 unknown / 3 warn).
 */

import { verifyArtifactCleanup } from "./verify";
import { parseCleanupEvidence } from "./ingest";
import { recordCleanupVerification } from "./metrics";
import { emitCleanupVerificationReceipt } from "./receipt";
import {
  buildCleanupCheckResult,
  buildCleanupUsageError,
  renderCleanupCheck,
  type CleanupCheckOutcome,
} from "./render";
import type { CleanupCheckArgs } from "./args";
import type { RetrievalStorageProvider } from "../artifacts/access";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 * `resolveProvider` maps the environment to the bounded storage provider (never reading a secret
 * VALUE — only whether storage is configured); `readInput` reads the raw evidence text for
 * `stdin`/`file`; `now` returns the wall clock in epoch ms (the one unavoidable side effect,
 * behind a seam so tests are deterministic).
 */
export interface CleanupCheckProvider {
  resolveProvider(): RetrievalStorageProvider;
  readInput(source: "stdin" | "file", filePath: string | undefined): Promise<string>;
  now(): number;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface CleanupCheckRun {
  readonly exitCode: number;
  readonly output: string;
  readonly outcome: CleanupCheckOutcome;
}

/** One hour in milliseconds — grace is supplied to the operator in hours, evaluated in ms. */
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Emit the content-free cleanup-verification metric + receipt for a completed verification.
 * Best-effort: observability must never turn a check into a crash, so a throwing sink is
 * swallowed (the receipt emitter already self-guards).
 */
function observe(
  verdict: Parameters<typeof recordCleanupVerification>[0],
  provider: RetrievalStorageProvider,
  totals: { total: number; reaped: number; drift: number },
  at: string,
): void {
  try {
    recordCleanupVerification(verdict, provider);
    emitCleanupVerificationReceipt({ verdict, provider, ...totals, at });
  } catch {
    // A misbehaving collector can never break an operator check.
  }
}

/**
 * Run the cleanup verification for validated `args` using the injected `provider`. Never throws
 * on an operational or input problem — those become a structured outcome + exit code; only a
 * genuine internal fault (a `resolveProvider` seam crash) propagates, to be caught by the
 * entry's top-level handler exactly like the daemon.
 */
export async function runCleanupCheck(
  args: CleanupCheckArgs,
  provider: CleanupCheckProvider,
): Promise<CleanupCheckRun> {
  const nowMs = provider.now();
  const generatedAt = new Date(nowMs).toISOString();
  const storageProvider = provider.resolveProvider();
  const graceMs = args.graceHours * MS_PER_HOUR;

  let outcome: CleanupCheckOutcome;

  if (args.source === "stdin" || args.source === "file") {
    let text: string;
    try {
      text = await provider.readInput(args.source, args.filePath);
    } catch {
      // A read failure is a usage error — never a crash, never an echo of the path.
      outcome = buildCleanupUsageError(args.source, generatedAt, ["input-unreadable"]);
      return { exitCode: outcome.exitCode, output: renderCleanupCheck(outcome, args.format), outcome };
    }
    const parsed = parseCleanupEvidence(text);
    if (!parsed.ok) {
      outcome = buildCleanupUsageError(args.source, generatedAt, parsed.issues);
      return { exitCode: outcome.exitCode, output: renderCleanupCheck(outcome, args.format), outcome };
    }
    const verification = verifyArtifactCleanup(parsed.objects, {
      provider: storageProvider,
      now: nowMs,
      graceMs,
    });
    observe(
      verification.verdict,
      verification.provider,
      { total: verification.total, reaped: verification.reaped, drift: verification.drift },
      generatedAt,
    );
    outcome = buildCleanupCheckResult(verification, {
      source: args.source,
      generatedAt,
      graceHours: args.graceHours,
    });
  } else {
    // `none`: no evidence supplied — report the env-resolved posture honestly. An empty evidence
    // set folds to `not-configured` (unconfigured deployment) or `unknown` (configured, but
    // nothing to verify yet); it never fabricates a `verified`.
    const verification = verifyArtifactCleanup([], {
      provider: storageProvider,
      now: nowMs,
      graceMs,
    });
    observe(
      verification.verdict,
      verification.provider,
      { total: verification.total, reaped: verification.reaped, drift: verification.drift },
      generatedAt,
    );
    outcome = buildCleanupCheckResult(verification, {
      source: "none",
      generatedAt,
      graceHours: args.graceHours,
    });
  }

  return { exitCode: outcome.exitCode, output: renderCleanupCheck(outcome, args.format), outcome };
}
