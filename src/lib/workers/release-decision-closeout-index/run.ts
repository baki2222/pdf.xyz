/**
 * The node-free **orchestrator** for the release decision closeout index CLI (Phase 65).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-decision-closeout-index.ts`) is a thin shell: it resolves argv, reads the closeout files /
 * stdin, writes the output, and exits. That keeps every branch — each input mode, the ingest failure modes, the record
 * self-consistency re-validation, the window cap, the fold, and both output formats — unit-testable without a runtime,
 * a filesystem, or a subprocess.
 *
 * Honesty flows straight through the trust boundary ({@link ingestCloseout}): a closeout file that cannot be read or
 * parsed becomes an UNRECOGNIZED closeout (⇒ an `unreadable` point, path never echoed); a recognized-but-self-
 * inconsistent closeout is a tamper (⇒ a `tampered` point, blocking); a window with no usable closeouts is inconclusive
 * (⇒ `index-incomplete`, never a vacuous indexed); and the fold over the usable closeouts is deterministic. A run
 * NEVER throws on an operational/input problem — those become a structured result + exit code; only a genuine internal
 * fault propagates, to be caught by the entry's top-level handler and mapped to BLOCKED.
 *
 * It reads NO secret, makes NO network call, runs no gate / index / decision / trend / plan / receipt / closeout
 * itself, and deletes / uploads / promotes / mutates nothing: it ingests closeout records
 * `worker:release-decision-closeout` already produced and summarizes their bounded, already content-free verdicts.
 */

import { buildCloseoutIndexResult } from "./build";
import { UNRECOGNIZED_CLOSEOUT, ingestCloseout, type IngestedCloseout } from "./ingest";
import { recordReleaseDecisionCloseoutIndex } from "./metrics";
import { renderReleaseDecisionCloseoutIndex } from "./render";
import {
  releaseDecisionCloseoutIndexExitCode,
  type ReleaseDecisionCloseoutIndexPolicy,
  type ReleaseDecisionCloseoutIndexResult,
} from "./types";
import type { ReleaseDecisionCloseoutIndexArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read one closeout file's text; its throw is caught → that closeout is `unreadable` (never echoed).
 *                  Called once per supplied closeout path;
 *  - `readStdin` — read the whole stdin payload (`--stdin` mode only); its throw is caught → an empty history (⇒
 *                  `index-incomplete`). Never called unless `--stdin` was supplied.
 */
export interface ReleaseDecisionCloseoutIndexProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseDecisionCloseoutIndexRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseDecisionCloseoutIndexResult;
}

/** The applied policy knobs, reduced from the validated args. */
function policyOf(args: ReleaseDecisionCloseoutIndexArgs): ReleaseDecisionCloseoutIndexPolicy {
  return {
    maxCloseouts: args.maxCloseouts,
    maxOpen: args.maxOpen,
    maxIncomplete: args.maxIncomplete,
    maxBlocked: args.maxBlocked,
    strictOpen: args.strictOpen,
  };
}

/**
 * Read + JSON.parse one closeout file, then reduce it through the trust boundary. A missing path, an empty file, or
 * any read/parse failure yields the UNRECOGNIZED closeout (⇒ an `unreadable` point) — it never throws and never echoes
 * the path.
 */
async function readIngest(
  path: string,
  provider: ReleaseDecisionCloseoutIndexProvider,
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
 * Parse the stdin payload into an ordered list of closeout roots (oldest → newest). It accepts, in this order:
 *  - a JSON array of closeouts (each element is one closeout);
 *  - a single JSON object / value (one closeout);
 *  - an NDJSON stream (one JSON value per line) — the fallback when the whole payload is not valid JSON.
 *
 * A blank payload is an empty history. A malformed NDJSON line becomes one UNRECOGNIZED closeout (the raw line is
 * passed to the trust boundary, which drops it — never echoed), so a corrupt line is an `unreadable` point, not a
 * throw.
 */
export function parseStdinCloseouts(text: string): unknown[] {
  if (text.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Not a single JSON document — treat as NDJSON (one closeout per non-blank line).
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
 * Build the ordered history of ingested closeouts (oldest → newest), from either repeated `--file` / `--closeout`
 * files or a `--stdin` payload. A stdin payload that is missing or unreadable yields an EMPTY history (⇒
 * `index-incomplete`) — never a throw and never a fabricated summary.
 */
async function ingestHistory(
  args: ReleaseDecisionCloseoutIndexArgs,
  provider: ReleaseDecisionCloseoutIndexProvider,
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
 * Run the release-decision-closeout-index CLI for validated `args` using the injected `provider`. Never throws on
 * input: every operational/input problem is a structured result + exit code.
 */
export async function runReleaseDecisionCloseoutIndex(
  args: ReleaseDecisionCloseoutIndexArgs,
  provider: ReleaseDecisionCloseoutIndexProvider,
): Promise<ReleaseDecisionCloseoutIndexRun> {
  const closeouts = await ingestHistory(args, provider);
  const result = buildCloseoutIndexResult(provider.now(), closeouts, policyOf(args));

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseDecisionCloseoutIndex(result.closeoutIndex.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseDecisionCloseoutIndexExitCode(result),
    output: renderReleaseDecisionCloseoutIndex(result, args.format, args.pretty),
    result,
  };
}
