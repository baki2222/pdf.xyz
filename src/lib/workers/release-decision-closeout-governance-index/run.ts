/**
 * The node-free **orchestrator** for the release decision closeout governance index CLI (Phase 70).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-decision-closeout-governance-index.ts`) is a thin shell: it resolves argv, reads the bundle
 * files / stdin, writes the output, and exits. That keeps every branch — each input mode, the ingest failure modes, the
 * record self-consistency re-validation, the window cap, the fold, and both output formats — unit-testable without a
 * runtime, a filesystem, or a subprocess.
 *
 * Honesty flows straight through the trust boundary ({@link ingestGovernance}): a bundle file that cannot be read or
 * parsed becomes an UNRECOGNIZED bundle (⇒ an `unreadable` point, path never echoed); a recognized-but-self-inconsistent
 * bundle is a tamper (⇒ a `tampered` point, blocking); a window with no usable bundles is inconclusive (⇒
 * `index-incomplete`, never a vacuous indexed); and the fold over the usable bundles is deterministic. A run NEVER
 * throws on an operational/input problem — those become a structured result + exit code; only a genuine internal fault
 * propagates, to be caught by the entry's top-level handler and mapped to BLOCKED.
 *
 * It reads NO secret, makes NO network call, runs no gate / index / decision / trend / plan / receipt / closeout /
 * governance itself, and deletes / uploads / promotes / mutates nothing: it ingests governance bundles
 * `worker:release-decision-closeout-governance` already produced and summarizes their bounded, already content-free
 * verdicts.
 */

import { buildGovernanceIndexResult } from "./build";
import { UNRECOGNIZED_GOVERNANCE, ingestGovernance, type IngestedGovernance } from "./ingest";
import { recordReleaseDecisionCloseoutGovernanceIndex } from "./metrics";
import { renderReleaseDecisionCloseoutGovernanceIndex } from "./render";
import {
  releaseDecisionCloseoutGovernanceIndexExitCode,
  type ReleaseDecisionCloseoutGovernanceIndexPolicy,
  type ReleaseDecisionCloseoutGovernanceIndexResult,
} from "./types";
import type { ReleaseDecisionCloseoutGovernanceIndexArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read one bundle file's text; its throw is caught → that bundle is `unreadable` (never echoed).
 *                  Called once per supplied bundle path;
 *  - `readStdin` — read the whole stdin payload (`--stdin` mode only); its throw is caught → an empty history (⇒
 *                  `index-incomplete`). Never called unless `--stdin` was supplied.
 */
export interface ReleaseDecisionCloseoutGovernanceIndexProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseDecisionCloseoutGovernanceIndexRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseDecisionCloseoutGovernanceIndexResult;
}

/** The applied policy knobs, reduced from the validated args. */
function policyOf(
  args: ReleaseDecisionCloseoutGovernanceIndexArgs,
): ReleaseDecisionCloseoutGovernanceIndexPolicy {
  return {
    maxGovernance: args.maxGovernance,
    maxOpen: args.maxOpen,
    maxIncomplete: args.maxIncomplete,
    maxBlocked: args.maxBlocked,
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
  provider: ReleaseDecisionCloseoutGovernanceIndexProvider,
): Promise<IngestedGovernance> {
  let text: string;
  try {
    text = await provider.readFile(path);
  } catch {
    return UNRECOGNIZED_GOVERNANCE;
  }
  if (text.trim() === "") return UNRECOGNIZED_GOVERNANCE;
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return UNRECOGNIZED_GOVERNANCE;
  }
  return ingestGovernance(root);
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
export function parseStdinGovernance(text: string): unknown[] {
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
 * Build the ordered history of ingested bundles (oldest → newest), from either repeated `--file` / `--governance`
 * files or a `--stdin` payload. A stdin payload that is missing or unreadable yields an EMPTY history (⇒
 * `index-incomplete`) — never a throw and never a fabricated summary.
 */
async function ingestHistory(
  args: ReleaseDecisionCloseoutGovernanceIndexArgs,
  provider: ReleaseDecisionCloseoutGovernanceIndexProvider,
): Promise<IngestedGovernance[]> {
  if (args.stdin) {
    let text: string;
    try {
      text = await provider.readStdin();
    } catch {
      return [];
    }
    return parseStdinGovernance(text).map((root) => ingestGovernance(root));
  }
  const paths = args.governancePaths ?? [];
  return Promise.all(paths.map((path) => readIngest(path, provider)));
}

/**
 * Run the release-decision-closeout-governance-index CLI for validated `args` using the injected `provider`. Never
 * throws on input: every operational/input problem is a structured result + exit code.
 */
export async function runReleaseDecisionCloseoutGovernanceIndex(
  args: ReleaseDecisionCloseoutGovernanceIndexArgs,
  provider: ReleaseDecisionCloseoutGovernanceIndexProvider,
): Promise<ReleaseDecisionCloseoutGovernanceIndexRun> {
  const governance = await ingestHistory(args, provider);
  const result = buildGovernanceIndexResult(provider.now(), governance, policyOf(args));

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseDecisionCloseoutGovernanceIndex(result.governanceIndex.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseDecisionCloseoutGovernanceIndexExitCode(result),
    output: renderReleaseDecisionCloseoutGovernanceIndex(result, args.format, args.pretty),
    result,
  };
}
