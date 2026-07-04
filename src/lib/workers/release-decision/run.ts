/**
 * The node-free **orchestrator** for the release decision record CLI (Phase 59).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-decision.ts`) is a thin shell: it resolves argv, reads the two documents / stdin, writes the
 * output, and exits. That keeps every branch — the two inputs, the ingest failure modes, the self-consistency
 * re-validations, the coherence cross-check, the decision fold, and both output formats — unit-testable without a
 * runtime, a filesystem, or a subprocess.
 *
 * Honesty flows straight through the two trust boundaries ({@link ingestPublishPack}, {@link ingestAck}): a document
 * that cannot be read or parsed becomes an UNRECOGNIZED document (⇒ an `unreadable` state, path never echoed); a
 * recognized-but-self-inconsistent document is a tamper (⇒ a `tampered` state, `invalid`); and the fold over the two
 * ingested documents + the coherence cross-check is deterministic. A run NEVER throws on an operational/input problem —
 * those become a structured result + exit code; only a genuine internal fault propagates, to be caught by the entry's
 * top-level handler and mapped to INVALID.
 *
 * It reads NO secret, makes NO network call, signs / approves / publishes / promotes / deploys / notifies / deletes /
 * mutates nothing: it ingests one `pdfxyz.release-publish-pack/1` + one `pdfxyz.release-ack/1` a release pipeline
 * already produced and records a bounded decision over them.
 */

import { buildDecisionResult } from "./build";
import {
  ingestAck,
  ingestPublishPack,
  type IngestedDecisionInputs,
} from "./ingest";
import { recordReleaseDecision } from "./metrics";
import { renderReleaseDecision } from "./render";
import { releaseDecisionExitCode, type ReleaseDecisionResult } from "./types";
import { STDIN_SENTINEL, type ReleaseDecisionArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read a document file's text; its throw is caught → the document is `unreadable` (never echoed);
 *  - `readStdin` — read the whole stdin payload (only when an input value is `-`); its throw is caught → that document
 *                  is `unreadable`. Never called unless a `-` input was supplied (and at most one input is `-`).
 */
export interface ReleaseDecisionProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseDecisionRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseDecisionResult;
}

/**
 * Read + JSON.parse one document from a file path or stdin (`-`). A missing/empty payload, or any read/parse failure,
 * yields `undefined` (⇒ an unrecognized document) — it never throws and never echoes the path.
 */
async function readParse(
  path: string,
  provider: ReleaseDecisionProvider,
): Promise<unknown> {
  let text: string;
  try {
    text =
      path === STDIN_SENTINEL
        ? await provider.readStdin()
        : await provider.readFile(path);
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

/**
 * Read + reduce the supplied publish pack + acknowledgement into the bounded {@link IngestedDecisionInputs}. Never
 * throws. The args parser guarantees at most one input is stdin, so the (at most one) `provider.readStdin()` call is
 * unambiguous.
 */
async function ingestInputs(
  args: ReleaseDecisionArgs,
  provider: ReleaseDecisionProvider,
): Promise<IngestedDecisionInputs> {
  const packRoot = await readParse(args.publishPackPath, provider);
  const ackRoot = await readParse(args.ackPath, provider);
  return {
    pack: { supplied: true, ingested: ingestPublishPack(packRoot) },
    ack: { supplied: true, ingested: ingestAck(ackRoot) },
  };
}

/**
 * Run the release-decision CLI for validated `args` using the injected `provider`. Never throws on input: every
 * operational/input problem is a structured result + exit code.
 */
export async function runReleaseDecision(
  args: ReleaseDecisionArgs,
  provider: ReleaseDecisionProvider,
): Promise<ReleaseDecisionRun> {
  const inputs = await ingestInputs(args, provider);
  const result = buildDecisionResult(provider.now(), inputs, args.strict);

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseDecision(result.decision.decision);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseDecisionExitCode(result),
    output: renderReleaseDecision(result, args.format, args.pretty),
    result,
  };
}
