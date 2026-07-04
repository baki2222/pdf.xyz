/**
 * The node-free **orchestrator** for the release decision ledger index CLI (Phase 60).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-decision-index.ts`) is a thin shell: it resolves argv, reads the record files / stdin,
 * writes the output, and exits. That keeps every branch — each input mode, the ingest failure modes, the record
 * self-consistency re-validation, the window cap, the fold, and both output formats — unit-testable without a
 * runtime, a filesystem, or a subprocess.
 *
 * Honesty flows straight through the trust boundary ({@link ingestDecision}): a record file that cannot be read or
 * parsed becomes an UNRECOGNIZED record (⇒ an `unreadable` point, path never echoed); a recognized-but-self-
 * inconsistent record is a tamper (⇒ a `tampered` point, invalid); a window with no usable records is inconclusive
 * (⇒ `insufficient`, never a vacuous stable); an unreadable / tampered record is `invalid`; and the fold over the
 * usable records is deterministic. A run NEVER throws on an operational/input problem — those become a structured
 * result + exit code; only a genuine internal fault propagates, to be caught by the entry's top-level handler and
 * mapped to INVALID.
 *
 * It reads NO secret, makes NO network call, runs no gate / bundle / audit / report / decision itself, and deletes /
 * uploads / promotes / mutates nothing: it ingests decision records `worker:release-decision` already produced and
 * summarizes their bounded, already content-free decisions.
 */

import { buildIndexResult } from "./build";
import { UNRECOGNIZED_DECISION, ingestDecision, type IngestedDecision } from "./ingest";
import { recordReleaseDecisionIndex } from "./metrics";
import { renderReleaseDecisionIndex } from "./render";
import {
  releaseDecisionIndexExitCode,
  type ReleaseDecisionIndexPolicy,
  type ReleaseDecisionIndexResult,
} from "./types";
import type { ReleaseDecisionIndexArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read one record file's text; its throw is caught → that record is `unreadable` (never echoed).
 *                  Called once per supplied record path;
 *  - `readStdin` — read the whole stdin payload (`--stdin` mode only); its throw is caught → an empty batch (⇒
 *                  `insufficient`). Never called unless `--stdin` was supplied.
 */
export interface ReleaseDecisionIndexProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseDecisionIndexRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseDecisionIndexResult;
}

/** The applied policy knobs, reduced from the validated args. */
function policyOf(args: ReleaseDecisionIndexArgs): ReleaseDecisionIndexPolicy {
  return { maxRecords: args.maxRecords, strict: args.strict };
}

/**
 * Read + JSON.parse one record file, then reduce it through the trust boundary. A missing path, an empty file, or
 * any read/parse failure yields the UNRECOGNIZED record (⇒ an `unreadable` point) — it never throws and never
 * echoes the path.
 */
async function readIngest(path: string, provider: ReleaseDecisionIndexProvider): Promise<IngestedDecision> {
  let text: string;
  try {
    text = await provider.readFile(path);
  } catch {
    return UNRECOGNIZED_DECISION;
  }
  if (text.trim() === "") return UNRECOGNIZED_DECISION;
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return UNRECOGNIZED_DECISION;
  }
  return ingestDecision(root);
}

/**
 * Parse the stdin payload into an ordered list of record roots (oldest → newest). It accepts, in this order:
 *  - a JSON array of records (each element is one record);
 *  - a single JSON object / value (one record);
 *  - an NDJSON stream (one JSON value per line) — the fallback when the whole payload is not valid JSON.
 *
 * A blank payload is an empty batch. A malformed NDJSON line becomes one UNRECOGNIZED record (the raw line is passed
 * to the trust boundary, which drops it — never echoed), so a corrupt line is an `unreadable` point, not a throw.
 */
export function parseStdinRecords(text: string): unknown[] {
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
 * Build the ordered batch of ingested records (oldest → newest), from either repeated `--file` / `--decision` files
 * or a `--stdin` payload. A stdin payload that is missing or unreadable yields an EMPTY batch (⇒ `insufficient`) —
 * never a throw and never a fabricated summary.
 */
async function ingestBatch(
  args: ReleaseDecisionIndexArgs,
  provider: ReleaseDecisionIndexProvider,
): Promise<IngestedDecision[]> {
  if (args.stdin) {
    let text: string;
    try {
      text = await provider.readStdin();
    } catch {
      return [];
    }
    return parseStdinRecords(text).map((root) => ingestDecision(root));
  }
  const paths = args.recordPaths ?? [];
  return Promise.all(paths.map((path) => readIngest(path, provider)));
}

/**
 * Run the release-decision-index CLI for validated `args` using the injected `provider`. Never throws on input:
 * every operational/input problem is a structured result + exit code.
 */
export async function runReleaseDecisionIndex(
  args: ReleaseDecisionIndexArgs,
  provider: ReleaseDecisionIndexProvider,
): Promise<ReleaseDecisionIndexRun> {
  const records = await ingestBatch(args, provider);
  const result = buildIndexResult(provider.now(), records, policyOf(args));

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseDecisionIndex(result.index.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseDecisionIndexExitCode(result),
    output: renderReleaseDecisionIndex(result, args.format, args.pretty),
    result,
  };
}
