/**
 * The node-free **orchestrator** for the release decision closeout governance finalize index CLI (Phase 75).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-decision-closeout-governance-finalize-index.ts`) is a thin shell: it resolves argv, reads the
 * bundle files / stdin, writes the output, and exits. That keeps every branch — each input mode, the ingest failure
 * modes, the record self-consistency re-validation, the window cap, the fold, and both output formats — unit-testable
 * without a runtime, a filesystem, or a subprocess.
 *
 * Honesty flows straight through the trust boundary ({@link ingestFinalize}): a bundle file that cannot be read or
 * parsed becomes an UNRECOGNIZED bundle (⇒ an `unreadable` point, path never echoed, ⇒ `index-invalid`); a
 * recognized-but-self-inconsistent bundle is a tamper (⇒ a `tampered` point, ⇒ `index-invalid`); a window with no
 * usable bundles is inconclusive (⇒ `index-incomplete`, never a vacuous indexed); and the fold over the usable bundles
 * is deterministic. A run NEVER throws on an operational/input problem — those become a structured result + exit code;
 * only a genuine internal fault propagates, to be caught by the entry's top-level handler and mapped to INVALID.
 *
 * It reads NO secret, makes NO network call, runs no gate / index / decision / trend / plan / receipt / closeout /
 * governance / finalize itself, and deletes / uploads / promotes / mutates nothing: it ingests finalization bundles
 * `worker:release-decision-closeout-governance-finalize` already produced and summarizes their bounded, already
 * content-free verdicts.
 */

import { buildFinalizeIndexResult } from "./build";
import { UNRECOGNIZED_FINALIZE, ingestFinalize, type IngestedFinalize } from "./ingest";
import { recordReleaseDecisionCloseoutGovernanceFinalizeIndex } from "./metrics";
import { renderReleaseDecisionCloseoutGovernanceFinalizeIndex } from "./render";
import {
  releaseDecisionCloseoutGovernanceFinalizeIndexExitCode,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexResult,
} from "./types";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read one bundle file's text; its throw is caught → that bundle is `unreadable` (never echoed).
 *                  Called once per supplied bundle path;
 *  - `readStdin` — read the whole stdin payload (`--stdin` mode only); its throw is caught → an empty history (⇒
 *                  `index-incomplete`). Never called unless `--stdin` was supplied.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseDecisionCloseoutGovernanceFinalizeIndexResult;
}

/** The applied policy knobs, reduced from the validated args. */
function policyOf(
  args: ReleaseDecisionCloseoutGovernanceFinalizeIndexArgs,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexPolicy {
  return {
    maxFinalizations: args.maxFinalizations,
    maxOpen: args.maxOpen,
    maxIncomplete: args.maxIncomplete,
    requireLatestFinalized: args.requireLatestFinalized,
    strictOpen: args.strictOpen,
  };
}

/**
 * Read + JSON.parse one bundle file, then reduce it through the trust boundary. A missing path, an empty file, or any
 * read/parse failure yields the UNRECOGNIZED bundle (⇒ an `unreadable` point) — it never throws and never echoes the
 * path.
 */
async function readIngest(
  path: string,
  provider: ReleaseDecisionCloseoutGovernanceFinalizeIndexProvider,
): Promise<IngestedFinalize> {
  let text: string;
  try {
    text = await provider.readFile(path);
  } catch {
    return UNRECOGNIZED_FINALIZE;
  }
  if (text.trim() === "") return UNRECOGNIZED_FINALIZE;
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return UNRECOGNIZED_FINALIZE;
  }
  return ingestFinalize(root);
}

/**
 * Parse the stdin payload into an ordered list of bundle roots (oldest → newest). It accepts, in this order:
 *  - a JSON array of bundles (each element is one bundle);
 *  - a single JSON object / value (one bundle);
 *  - an NDJSON stream (one JSON value per line) — the fallback when the whole payload is not valid JSON.
 *
 * A blank payload is an empty history. A malformed NDJSON line becomes one UNRECOGNIZED bundle (the raw line is passed
 * to the trust boundary, which drops it — never echoed), so a corrupt line is an `unreadable` point, not a throw.
 */
export function parseStdinFinalize(text: string): unknown[] {
  if (text.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Not a single JSON document — treat as NDJSON (one bundle per non-blank line).
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
 * Build the ordered history of ingested bundles (oldest → newest), from either repeated `--file` / `--finalization`
 * files or a `--stdin` payload. A stdin payload that is missing or unreadable yields an EMPTY history (⇒
 * `index-incomplete`) — never a throw and never a fabricated summary.
 */
async function ingestHistory(
  args: ReleaseDecisionCloseoutGovernanceFinalizeIndexArgs,
  provider: ReleaseDecisionCloseoutGovernanceFinalizeIndexProvider,
): Promise<IngestedFinalize[]> {
  if (args.stdin) {
    let text: string;
    try {
      text = await provider.readStdin();
    } catch {
      return [];
    }
    return parseStdinFinalize(text).map((root) => ingestFinalize(root));
  }
  const paths = args.finalizationPaths ?? [];
  return Promise.all(paths.map((path) => readIngest(path, provider)));
}

/**
 * Run the release-decision-closeout-governance-finalize-index CLI for validated `args` using the injected `provider`.
 * Never throws on input: every operational/input problem is a structured result + exit code.
 */
export async function runReleaseDecisionCloseoutGovernanceFinalizeIndex(
  args: ReleaseDecisionCloseoutGovernanceFinalizeIndexArgs,
  provider: ReleaseDecisionCloseoutGovernanceFinalizeIndexProvider,
): Promise<ReleaseDecisionCloseoutGovernanceFinalizeIndexRun> {
  const finalizations = await ingestHistory(args, provider);
  const result = buildFinalizeIndexResult(provider.now(), finalizations, policyOf(args));

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseDecisionCloseoutGovernanceFinalizeIndex(result.finalizeIndex.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseDecisionCloseoutGovernanceFinalizeIndexExitCode(result),
    output: renderReleaseDecisionCloseoutGovernanceFinalizeIndex(result, args.format, args.pretty),
    result,
  };
}
