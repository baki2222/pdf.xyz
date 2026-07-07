/**
 * The node-free **orchestrator** for the release decision closeout governance finalize index trend finalize index trend closeout index trend closeout index trend
 * closeout INDEX CLI (Phase 90).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index.ts`) is a
 * thin shell: it resolves argv, reads the record files / stdin, writes the output, and exits. That keeps every branch —
 * each input mode, the ingest failure modes, the record self-consistency re-validation, the window cap, the fold, and
 * both output formats — unit-testable without a runtime, a filesystem, or a subprocess.
 *
 * Honesty flows straight through the trust boundary ({@link ingestCloseout}): a record file that cannot be read or parsed
 * becomes an UNRECOGNIZED record (⇒ an `unreadable` point, path never echoed, ⇒ `invalid`); a
 * recognized-but-self-inconsistent record is a tamper (⇒ a `tampered` point, ⇒ `invalid`); a window with no usable
 * records is inconclusive (⇒ `incomplete`, never a vacuous all-closed); and the fold over the usable records is
 * deterministic. A run NEVER throws on an operational/input problem — those become a structured result + exit code; only
 * a genuine internal fault propagates, to be caught by the entry's top-level handler and mapped to INVALID.
 *
 * It reads NO secret, makes NO network call, runs no gate / index / decision / trend / plan / receipt / closeout /
 * governance / finalize itself, and deletes / uploads / promotes / mutates nothing: it ingests closeout records
 * `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout` already produced and
 * summarizes their bounded, already content-free verdicts.
 */

import { buildCloseoutIndexResult } from "./build";
import { UNRECOGNIZED_CLOSEOUT, ingestCloseout, type IngestedCloseout } from "./ingest";
import { recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndex } from "./metrics";
import { renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndex } from "./render";
import {
  releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexExitCode,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexResult,
} from "./types";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read one record file's text; its throw is caught → that record is `unreadable` (never echoed).
 *                  Called once per supplied record path;
 *  - `readStdin` — read the whole stdin payload (`--stdin` mode only); its throw is caught → an empty history (⇒
 *                  `incomplete`). Never called unless `--stdin` was supplied.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexResult;
}

/** The applied policy knobs, reduced from the validated args. */
function policyOf(
  args: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexArgs,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPolicy {
  return {
    maxCloseouts: args.maxCloseouts,
    maxOpen: args.maxOpen,
    maxIncomplete: args.maxIncomplete,
    strictOpen: args.strictOpen,
  };
}

/**
 * Read + JSON.parse one record file, then reduce it through the trust boundary. A missing path, an empty file, or any
 * read/parse failure yields the UNRECOGNIZED record (⇒ an `unreadable` point) — it never throws and never echoes the
 * path.
 */
async function readIngest(
  path: string,
  provider: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexProvider,
): Promise<IngestedCloseout> {
  let text: string;
  try {
    text = await provider.readFile(path);
  } catch {
    return UNRECOGNIZED_CLOSEOUT;
  }
  if (text.trim() === "") return UNRECOGNIZED_CLOSEOUT;
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return UNRECOGNIZED_CLOSEOUT;
  }
  return ingestCloseout(root);
}

/**
 * Parse the stdin payload into an ordered list of record roots (oldest → newest). It accepts, in this order:
 *  - a JSON array of records (each element is one record);
 *  - a single JSON object / value (one record);
 *  - an NDJSON stream (one JSON value per line) — the fallback when the whole payload is not valid JSON.
 *
 * A blank payload is an empty history. A malformed NDJSON line becomes one UNRECOGNIZED record (the raw line is passed to
 * the trust boundary, which drops it — never echoed), so a corrupt line is an `unreadable` point, not a throw.
 */
export function parseStdinCloseouts(text: string): unknown[] {
  if (text.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Not a single JSON document — treat as NDJSON (one record per non-blank line).
    const roots: unknown[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      try {
        roots.push(JSON.parse(trimmed));
      } catch {
        roots.push(trimmed); // a non-object → UNRECOGNIZED (unreadable); the raw line is never echoed
      }
    }
    return roots;
  }
}

/**
 * Build the ordered history of ingested records (oldest → newest), from either repeated `--file` / `--closeout` files or
 * a `--stdin` payload. A stdin payload that is missing or unreadable yields an EMPTY history (⇒ `incomplete`) —
 * never a throw and never a fabricated summary.
 */
async function ingestHistory(
  args: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexArgs,
  provider: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexProvider,
): Promise<IngestedCloseout[]> {
  if (args.stdin) {
    let text: string;
    try {
      text = await provider.readStdin();
    } catch {
      return [];
    }
    return parseStdinCloseouts(text).map((root) => ingestCloseout(root));
  }
  const paths = args.closeoutPaths ?? [];
  return Promise.all(paths.map((path) => readIngest(path, provider)));
}

/**
 * Run the release-decision-…-closeout-index CLI for validated `args` using the injected `provider`. Never throws on
 * input: every operational/input problem is a structured result + exit code.
 */
export async function runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndex(
  args: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexArgs,
  provider: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexProvider,
): Promise<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexRun> {
  const closeouts = await ingestHistory(args, provider);
  const result = buildCloseoutIndexResult(provider.now(), closeouts, policyOf(args));

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndex(result.closeoutIndex.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexExitCode(result),
    output: renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndex(
      result,
      args.format,
      args.pretty,
    ),
    result,
  };
}
