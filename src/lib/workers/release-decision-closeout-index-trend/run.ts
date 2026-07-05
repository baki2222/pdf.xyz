/**
 * The node-free **orchestrator** for the release decision closeout index trend CLI (Phase 66).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-decision-closeout-index-trend.ts`) is a thin shell: it resolves argv, reads the window files
 * / stdin, writes the output, and exits. That keeps every branch — each input mode, the ingest failure modes, the
 * window self-consistency re-validation, the window cap, the fold, and both output formats — unit-testable without a
 * runtime, a filesystem, or a subprocess.
 *
 * Honesty flows straight through the trust boundary ({@link ingestCloseoutIndex}): a window file that cannot be read or
 * parsed becomes an UNRECOGNIZED window (⇒ an `unreadable` point, path never echoed); a recognized-but-self-inconsistent
 * window is a tamper (⇒ a `tampered` point, blocking); a history with no usable windows is inconclusive (⇒
 * `trend-incomplete`, never a vacuous `trend-stable`); and the fold over the usable windows is deterministic. A run
 * NEVER throws on an operational/input problem — those become a structured result + exit code; only a genuine internal
 * fault propagates, to be caught by the entry's top-level handler and mapped to BLOCKED.
 *
 * It reads NO secret, makes NO network call, runs no gate / index / decision / trend / plan / receipt / closeout
 * itself, and deletes / uploads / promotes / mutates nothing: it ingests closeout-index windows
 * `worker:release-decision-closeout-index` already produced and summarizes their bounded, already content-free index
 * verdicts + closeout distributions.
 */

import { buildTrendResult } from "./build";
import { UNRECOGNIZED_INDEX, ingestCloseoutIndex, type IngestedCloseoutIndex } from "./ingest";
import { recordReleaseDecisionCloseoutIndexTrend } from "./metrics";
import { renderReleaseDecisionCloseoutIndexTrend } from "./render";
import {
  releaseDecisionCloseoutIndexTrendExitCode,
  type ReleaseDecisionCloseoutIndexTrendPolicy,
  type ReleaseDecisionCloseoutIndexTrendResult,
} from "./types";
import type { ReleaseDecisionCloseoutIndexTrendArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read one window file's text; its throw is caught → that window is `unreadable` (never echoed).
 *                  Called once per supplied window path;
 *  - `readStdin` — read the whole stdin payload (`--stdin` mode only); its throw is caught → an empty history (⇒
 *                  `trend-incomplete`). Never called unless `--stdin` was supplied.
 */
export interface ReleaseDecisionCloseoutIndexTrendProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseDecisionCloseoutIndexTrendRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseDecisionCloseoutIndexTrendResult;
}

/** The applied policy knobs, reduced from the validated args. */
function policyOf(args: ReleaseDecisionCloseoutIndexTrendArgs): ReleaseDecisionCloseoutIndexTrendPolicy {
  return {
    maxIndexes: args.maxIndexes,
    maxWatch: args.maxWatch,
    maxIncomplete: args.maxIncomplete,
    maxBlocked: args.maxBlocked,
    strictWatch: args.strictWatch,
  };
}

/**
 * Read + JSON.parse one window file, then reduce it through the trust boundary. A missing path, an empty file, or any
 * read/parse failure yields the UNRECOGNIZED window (⇒ an `unreadable` point) — it never throws and never echoes the
 * path.
 */
async function readIngest(
  path: string,
  provider: ReleaseDecisionCloseoutIndexTrendProvider,
): Promise<IngestedCloseoutIndex> {
  let text: string;
  try {
    text = await provider.readFile(path);
  } catch {
    return UNRECOGNIZED_INDEX;
  }
  if (text.trim() === "") return UNRECOGNIZED_INDEX;
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return UNRECOGNIZED_INDEX;
  }
  return ingestCloseoutIndex(root);
}

/**
 * Parse the stdin payload into an ordered list of window roots (oldest → newest). It accepts, in this order:
 *  - a JSON array of windows (each element is one window);
 *  - a single JSON object / value (one window);
 *  - an NDJSON stream (one JSON value per line) — the fallback when the whole payload is not valid JSON.
 *
 * A blank payload is an empty history. A malformed NDJSON line becomes one UNRECOGNIZED window (the raw line is passed
 * to the trust boundary, which drops it — never echoed), so a corrupt line is an `unreadable` point, not a throw.
 */
export function parseStdinWindows(text: string): unknown[] {
  if (text.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Not a single JSON document — treat as NDJSON (one window per non-blank line).
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
 * Build the ordered history of ingested windows (oldest → newest), from either repeated `--file` / `--index` files or a
 * `--stdin` payload. A stdin payload that is missing or unreadable yields an EMPTY history (⇒ `trend-incomplete`) —
 * never a throw and never a fabricated summary.
 */
async function ingestHistory(
  args: ReleaseDecisionCloseoutIndexTrendArgs,
  provider: ReleaseDecisionCloseoutIndexTrendProvider,
): Promise<IngestedCloseoutIndex[]> {
  if (args.stdin) {
    let text: string;
    try {
      text = await provider.readStdin();
    } catch {
      return [];
    }
    return parseStdinWindows(text).map((root) => ingestCloseoutIndex(root));
  }
  const paths = args.indexPaths ?? [];
  return Promise.all(paths.map((path) => readIngest(path, provider)));
}

/**
 * Run the release-decision-closeout-index-trend CLI for validated `args` using the injected `provider`. Never throws on
 * input: every operational/input problem is a structured result + exit code.
 */
export async function runReleaseDecisionCloseoutIndexTrend(
  args: ReleaseDecisionCloseoutIndexTrendArgs,
  provider: ReleaseDecisionCloseoutIndexTrendProvider,
): Promise<ReleaseDecisionCloseoutIndexTrendRun> {
  const windows = await ingestHistory(args, provider);
  const result = buildTrendResult(provider.now(), windows, policyOf(args));

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseDecisionCloseoutIndexTrend(result.closeoutIndexTrend.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseDecisionCloseoutIndexTrendExitCode(result),
    output: renderReleaseDecisionCloseoutIndexTrend(result, args.format, args.pretty),
    result,
  };
}
