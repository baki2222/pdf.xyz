/**
 * The node-free **orchestrator** for the release decision index trend summary CLI (Phase 61).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-decision-trend.ts`) is a thin shell: it resolves argv, reads the window files / stdin,
 * writes the output, and exits. That keeps every branch — each input mode, the ingest failure modes, the window
 * self-consistency re-validation, the window cap, the fold, and both output formats — unit-testable without a runtime,
 * a filesystem, or a subprocess.
 *
 * Honesty flows straight through the trust boundary ({@link ingestDecisionIndex}): a window file that cannot be read
 * or parsed becomes an UNRECOGNIZED window (⇒ an `unreadable` point, path never echoed); a recognized-but-self-
 * inconsistent window is a tamper (⇒ a `tampered` point, invalid); a history with no usable windows is inconclusive
 * (⇒ `insufficient`, never a vacuous clean pass); an unreadable / tampered window is `invalid`; and the fold over the
 * usable windows is deterministic. A run NEVER throws on an operational/input problem — those become a structured
 * result + exit code; only a genuine internal fault propagates, to be caught by the entry's top-level handler and
 * mapped to INVALID.
 *
 * It reads NO secret, makes NO network call, runs no gate / index / decision itself, and deletes / uploads / promotes
 * / mutates nothing: it ingests decision-index windows `worker:release-decision-index` already produced and summarizes
 * their bounded, already content-free index verdicts + decision distributions.
 */

import { buildTrendResult } from "./build";
import { UNRECOGNIZED_INDEX, ingestDecisionIndex, type IngestedDecisionIndex } from "./ingest";
import { recordReleaseDecisionTrend } from "./metrics";
import { renderReleaseDecisionTrend } from "./render";
import {
  releaseDecisionTrendExitCode,
  type ReleaseDecisionTrendPolicy,
  type ReleaseDecisionTrendResult,
} from "./types";
import type { ReleaseDecisionTrendArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read one window file's text; its throw is caught → that window is `unreadable` (never echoed).
 *                  Called once per supplied window path;
 *  - `readStdin` — read the whole stdin payload (`--stdin` mode only); its throw is caught → an empty history (⇒
 *                  `insufficient`). Never called unless `--stdin` was supplied.
 */
export interface ReleaseDecisionTrendProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseDecisionTrendRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseDecisionTrendResult;
}

/** The applied policy knobs, reduced from the validated args. */
function policyOf(args: ReleaseDecisionTrendArgs): ReleaseDecisionTrendPolicy {
  return { maxWindows: args.maxWindows, strict: args.strict };
}

/**
 * Read + JSON.parse one window file, then reduce it through the trust boundary. A missing path, an empty file, or any
 * read/parse failure yields the UNRECOGNIZED window (⇒ an `unreadable` point) — it never throws and never echoes the
 * path.
 */
async function readIngest(path: string, provider: ReleaseDecisionTrendProvider): Promise<IngestedDecisionIndex> {
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
  return ingestDecisionIndex(root);
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
 * Build the ordered history of ingested windows (oldest → newest), from either repeated `--file` / `--window` files or
 * a `--stdin` payload. A stdin payload that is missing or unreadable yields an EMPTY history (⇒ `insufficient`) —
 * never a throw and never a fabricated summary.
 */
async function ingestHistory(
  args: ReleaseDecisionTrendArgs,
  provider: ReleaseDecisionTrendProvider,
): Promise<IngestedDecisionIndex[]> {
  if (args.stdin) {
    let text: string;
    try {
      text = await provider.readStdin();
    } catch {
      return [];
    }
    return parseStdinWindows(text).map((root) => ingestDecisionIndex(root));
  }
  const paths = args.windowPaths ?? [];
  return Promise.all(paths.map((path) => readIngest(path, provider)));
}

/**
 * Run the release-decision-trend CLI for validated `args` using the injected `provider`. Never throws on input: every
 * operational/input problem is a structured result + exit code.
 */
export async function runReleaseDecisionTrend(
  args: ReleaseDecisionTrendArgs,
  provider: ReleaseDecisionTrendProvider,
): Promise<ReleaseDecisionTrendRun> {
  const windows = await ingestHistory(args, provider);
  const result = buildTrendResult(provider.now(), windows, policyOf(args));

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseDecisionTrend(result.trend.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseDecisionTrendExitCode(result),
    output: renderReleaseDecisionTrend(result, args.format, args.pretty),
    result,
  };
}
