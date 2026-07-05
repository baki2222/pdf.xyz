/**
 * The node-free **orchestrator** for the release decision closeout governance bundle CLI (Phase 69).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-decision-closeout-governance.ts`) is a thin shell: it resolves argv, reads the records /
 * stdin, writes the output, and exits. That keeps every branch — each input, the ingest failure modes, the
 * self-consistency re-validation, the cross-check fold, and both output formats — unit-testable without a runtime, a
 * filesystem, or a subprocess.
 *
 * Honesty flows straight through the trust boundary ({@link ingestCloseoutGovernanceReceipt} / {@link ingestRelated}): a
 * record that cannot be read or parsed becomes an UNRECOGNIZED source (⇒ an `unreadable` state, path never echoed); a
 * recognized-but-self-inconsistent record is a tamper (⇒ a `tampered` state, blocking); a missing / unusable PRIMARY
 * receipt has nothing to certify (⇒ `governance-incomplete`, never a closed); and the cross-check fold over the usable
 * records is deterministic. A run NEVER throws on an operational/input problem — those become a structured result + exit
 * code; only a genuine internal fault propagates, to be caught by the entry's top-level handler and mapped to BLOCKED.
 *
 * It reads NO secret, makes NO network call, runs no gate / index / decision / trend / plan / closeout / receipt itself,
 * and deletes / uploads / promotes / mutates nothing: it ingests records the closeout-chain workers already produced and
 * folds their bounded, already content-free postures.
 */

import { buildGovernanceResult } from "./build";
import {
  absentRecord,
  ingestCloseoutGovernanceReceipt,
  ingestRelated,
  type IngestedGovernanceRelatedRecord,
  type IngestedGovernanceSources,
} from "./ingest";
import { recordReleaseDecisionCloseoutGovernance } from "./metrics";
import { renderReleaseDecisionCloseoutGovernance } from "./render";
import {
  releaseDecisionCloseoutGovernanceExitCode,
  type ReleaseDecisionCloseoutGovernancePolicy,
  type ReleaseDecisionCloseoutGovernanceRecordKind,
  type ReleaseDecisionCloseoutGovernanceResult,
} from "./types";
import type { ReleaseDecisionCloseoutGovernanceArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read one record file's text; its throw is caught → that source is `unreadable` (never echoed). Called
 *                  once per supplied file path;
 *  - `readStdin` — read the whole stdin payload (only in `--stdin` primary mode); its throw is caught → the primary
 *                  receipt is `unreadable`. Never called unless `--stdin` was supplied.
 */
export interface ReleaseDecisionCloseoutGovernanceProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseDecisionCloseoutGovernanceRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseDecisionCloseoutGovernanceResult;
}

/** The applied policy knobs, reduced from the validated args. */
function policyOf(args: ReleaseDecisionCloseoutGovernanceArgs): ReleaseDecisionCloseoutGovernancePolicy {
  return {
    require: {
      plan: args.requirePlan,
      trend: args.requireTrend,
      index: args.requireIndex,
      closeout: args.requireCloseout,
    },
    strictOpen: args.strictOpen,
  };
}

/**
 * Read + JSON.parse one record from a file path or stdin. A missing/empty payload, or any read/parse failure, yields
 * `undefined` (⇒ an unrecognized source) — it never throws and never echoes the path.
 */
async function readParseSource(
  read: () => Promise<string>,
): Promise<unknown> {
  let text: string;
  try {
    text = await read();
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

/** The related-record slots + the arg path for each, in canonical order. */
const RELATED_SLOTS: readonly {
  readonly kind: ReleaseDecisionCloseoutGovernanceRecordKind;
  readonly path: (args: ReleaseDecisionCloseoutGovernanceArgs) => string | undefined;
}[] = [
  { kind: "plan", path: (a) => a.planPath },
  { kind: "trend", path: (a) => a.trendPath },
  { kind: "index", path: (a) => a.indexPath },
  { kind: "closeout", path: (a) => a.closeoutPath },
];

/** Read + reduce every supplied record into the bounded {@link IngestedGovernanceSources}. Never throws. */
async function ingestSources(
  args: ReleaseDecisionCloseoutGovernanceArgs,
  provider: ReleaseDecisionCloseoutGovernanceProvider,
): Promise<IngestedGovernanceSources> {
  const receiptRoot = await readParseSource(() =>
    args.stdin ? provider.readStdin() : provider.readFile(args.receiptPath ?? ""),
  );
  const related = await Promise.all(
    RELATED_SLOTS.map(async (slot): Promise<IngestedGovernanceRelatedRecord> => {
      const path = slot.path(args);
      if (path === undefined) return absentRecord(slot.kind);
      const root = await readParseSource(() => provider.readFile(path));
      return ingestRelated(slot.kind, root);
    }),
  );
  return {
    receipt: { supplied: true, ingested: ingestCloseoutGovernanceReceipt(receiptRoot) },
    related,
  };
}

/**
 * Run the release-decision-closeout-governance CLI for validated `args` using the injected `provider`. Never throws on
 * input: every operational/input problem is a structured result + exit code.
 */
export async function runReleaseDecisionCloseoutGovernance(
  args: ReleaseDecisionCloseoutGovernanceArgs,
  provider: ReleaseDecisionCloseoutGovernanceProvider,
): Promise<ReleaseDecisionCloseoutGovernanceRun> {
  const ingested = await ingestSources(args, provider);
  const result = buildGovernanceResult(provider.now(), ingested, policyOf(args));

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseDecisionCloseoutGovernance(result.governance.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseDecisionCloseoutGovernanceExitCode(result),
    output: renderReleaseDecisionCloseoutGovernance(result, args.format, args.pretty),
    result,
  };
}
