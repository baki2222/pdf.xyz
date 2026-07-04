/**
 * The node-free **orchestrator** for the release evidence handoff acknowledgement CLI (Phase 58).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-ack.ts`) is a thin shell: it resolves argv, reads the pack / stdin, writes the output, and
 * exits. That keeps every branch — the input, the ingest failure modes, the self-consistency re-validation, the
 * decision fold, and both output formats — unit-testable without a runtime, a filesystem, or a subprocess.
 *
 * Honesty flows straight through the trust boundary ({@link ingestPublishPack}): a pack that cannot be read or parsed
 * becomes an UNRECOGNIZED pack (⇒ an `unreadable` state, path never echoed); a recognized-but-self-inconsistent pack
 * is a tamper (⇒ a `tampered` state, `invalid`); and the fold over the ingested pack + the operator's decision is
 * deterministic. A run NEVER throws on an operational/input problem — those become a structured result + exit code;
 * only a genuine internal fault propagates, to be caught by the entry's top-level handler and mapped to INVALID.
 *
 * It reads NO secret, makes NO network call, signs / approves / publishes / promotes / notifies / deletes / mutates
 * nothing: it ingests one `pdfxyz.release-publish-pack/1` a `worker:release-publish-pack` run already produced and
 * records a bounded acknowledgement of it.
 */

import { buildAckResult } from "./build";
import { ingestPublishPack, type IngestedAckSource } from "./ingest";
import { recordReleaseAck } from "./metrics";
import { renderReleaseAck } from "./render";
import { releaseAckExitCode, type ReleaseAckResult } from "./types";
import { STDIN_SENTINEL, type ReleaseAckArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read the pack file's text; its throw is caught → the pack is `unreadable` (never echoed);
 *  - `readStdin` — read the whole stdin payload (only when the input value is `-`); its throw is caught → the pack is
 *                  `unreadable`. Never called unless a `-` input was supplied.
 */
export interface ReleaseAckProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseAckRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseAckResult;
}

/**
 * Read + JSON.parse the pack from a file path or stdin (`-`). A missing/empty payload, or any read/parse failure,
 * yields `undefined` (⇒ an unrecognized pack) — it never throws and never echoes the path.
 */
async function readParsePack(path: string, provider: ReleaseAckProvider): Promise<unknown> {
  let text: string;
  try {
    text = path === STDIN_SENTINEL ? await provider.readStdin() : await provider.readFile(path);
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

/** Read + reduce the supplied pack into the bounded {@link IngestedAckSource}. Never throws. */
async function ingestSource(args: ReleaseAckArgs, provider: ReleaseAckProvider): Promise<IngestedAckSource> {
  const root = await readParsePack(args.publishPackPath, provider);
  return { supplied: true, ingested: ingestPublishPack(root) };
}

/**
 * Run the release-ack CLI for validated `args` using the injected `provider`. Never throws on input: every
 * operational/input problem is a structured result + exit code.
 */
export async function runReleaseAck(
  args: ReleaseAckArgs,
  provider: ReleaseAckProvider,
): Promise<ReleaseAckRun> {
  const ingested = await ingestSource(args, provider);
  const result = buildAckResult(
    provider.now(),
    ingested,
    args.decision,
    args.reviewer,
    args.note,
    args.strict,
  );

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseAck(result.ack.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseAckExitCode(result),
    output: renderReleaseAck(result, args.format, args.pretty),
    result,
  };
}
