/**
 * The node-free **orchestrator** for the release CI bundle CLI (Phase 50).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-ci-bundle.ts`) is a thin shell: it resolves argv, reads the stage files,
 * provides a `node:crypto` hash (for the artifact digest re-verification) + a wall clock, and hands
 * those capabilities here. That keeps every branch — each stage input, the ingest failure modes, the
 * consistency verification, the rollup, and both output formats — unit-testable without a runtime, a
 * filesystem, or a subprocess.
 *
 * Honesty flows straight through: a stage file that cannot be read or parsed becomes an UNRECOGNIZED
 * stage (⇒ an `unreadable` source, path never echoed); a recognized-but-inconsistent index/policy is a
 * blocking consistency mismatch (⇒ `fail`); a chain with no archive-decision stage is `unknown`; and
 * every consistency link is evaluated deterministically. A run NEVER throws on an operational/input
 * problem — those become a structured result + exit code; only a genuine internal fault (a hash seam
 * crash) propagates, to be caught by the entry's top-level handler and mapped to UNKNOWN.
 */

import type { HashFn } from "../release-artifact/digest";
import { buildBundleResult } from "./build";
import {
  ingestArtifactStage,
  ingestGate,
  ingestIndexStage,
  ingestPolicy,
  type IngestedStages,
} from "./ingest";
import { recordReleaseCiBundle } from "./metrics";
import { renderReleaseCiBundle } from "./render";
import { releaseCiBundleExitCode, type ReleaseCiBundleResult } from "./types";
import type { ReleaseCiBundleArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`      — stamp the result (behind a seam so tests are deterministic);
 *  - `hash`     — sha256-hex of a canonical string, used to re-verify the artifact's integrity digest
 *                 (a `node:crypto` seam, kept out of this leaf);
 *  - `readFile` — read one stage file's text; its throw is caught → that stage is `unreadable`. Called
 *                 once per supplied stage; a stage with no `--release-<stage>` flag is never read.
 */
export interface ReleaseCiBundleProvider {
  now(): string;
  hash: HashFn;
  readFile(path: string): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseCiBundleRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseCiBundleResult;
}

/** Read + JSON.parse one optional stage file; a missing path, or any read/parse failure, yields `undefined`. */
async function readParse(
  path: string | undefined,
  provider: ReleaseCiBundleProvider,
): Promise<unknown> {
  if (path === undefined) return undefined;
  let text: string;
  try {
    text = await provider.readFile(path);
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

/** Read + reduce every supplied stage into the bounded {@link IngestedStages}. Never throws on input. */
async function ingestStages(
  args: ReleaseCiBundleArgs,
  provider: ReleaseCiBundleProvider,
): Promise<IngestedStages> {
  const [gateRoot, artifactRoot, indexRoot, policyRoot] = await Promise.all([
    readParse(args.gatePath, provider),
    readParse(args.artifactPath, provider),
    readParse(args.indexPath, provider),
    readParse(args.policyPath, provider),
  ]);
  return {
    gate: { supplied: args.gatePath !== undefined, ingested: ingestGate(gateRoot) },
    artifact: {
      supplied: args.artifactPath !== undefined,
      ingested: ingestArtifactStage(artifactRoot, provider.hash),
    },
    index: { supplied: args.indexPath !== undefined, ingested: ingestIndexStage(indexRoot) },
    policy: { supplied: args.policyPath !== undefined, ingested: ingestPolicy(policyRoot) },
  };
}

/** Run the CI bundle CLI for validated `args` using the injected `provider`. Never throws on input. */
export async function runReleaseCiBundle(
  args: ReleaseCiBundleArgs,
  provider: ReleaseCiBundleProvider,
): Promise<ReleaseCiBundleRun> {
  const ingested = await ingestStages(args, provider);
  const result = buildBundleResult(provider.now(), ingested);

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseCiBundle(result.rollup.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseCiBundleExitCode(result),
    output: renderReleaseCiBundle(result, args.format, args.pretty),
    result,
  };
}
