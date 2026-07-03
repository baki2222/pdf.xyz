/**
 * The node-free **orchestrator** for the release policy CLI (Phase 49).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-policy.ts`) is a thin shell: it resolves argv, reads the index / artifact
 * files (or stdin), provides a `node:crypto` hash (for the `--artifact` re-verification) + a wall
 * clock, and hands those capabilities here. That keeps every branch — each input source, the ingest
 * failure modes, the policy evaluation, the rollup, and both output formats — unit-testable without a
 * runtime, a filesystem, or a subprocess.
 *
 * Honesty flows straight through: an index file that cannot be read or parsed becomes an UNRECOGNIZED
 * input (⇒ `unknown`, path never echoed); a recognized-but-inconsistent index is `fail`; an empty
 * archive is `unknown`; and every configured assertion is evaluated deterministically. A run NEVER
 * throws on an operational/input problem — those become a structured result + exit code; only a genuine
 * internal fault (a hash seam crash) propagates, to be caught by the entry's top-level handler and
 * mapped to UNKNOWN.
 */

import type { HashFn } from "../release-artifact/digest";
import { buildIndex } from "../release-index/build";
import { ingestArtifact, type IngestedArtifact } from "../release-index/ingest";
import { buildPolicyResult } from "./build";
import { ingestBuiltIndex, ingestIndex, UNRECOGNIZED_INDEX, type IngestedIndex } from "./ingest";
import { recordReleasePolicy } from "./metrics";
import { renderReleasePolicy } from "./render";
import { releasePolicyExitCode, type ReleasePolicyResult, type ReleasePolicySource } from "./types";
import type { ReleasePolicyArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`          — stamp the result (behind a seam so tests are deterministic);
 *  - `hash`         — sha256-hex of a canonical string, used ONLY in `--artifact` mode to re-verify
 *                     each artifact's integrity digest (a `node:crypto` seam, kept out of this leaf);
 *  - `readIndex`    — read the `--index` file's text; its throw is caught → an unrecognized input;
 *  - `readArtifact` — read one `--artifact` file's text; its throw is caught → one `unreadable` input;
 *  - `readStdin`    — read the whole of stdin (a single release-index object); only called when NEITHER
 *                     `--index` nor `--artifact` was given. Its throw is caught → an unrecognized input.
 */
export interface ReleasePolicyProvider {
  now(): string;
  hash: HashFn;
  readIndex(path: string): Promise<string>;
  readArtifact(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleasePolicyRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleasePolicyResult;
}

/** A sentinel a failed artifact read/parse contributes — release-index ingest reduces it to `unreadable`. */
const UNREADABLE_INPUT = undefined;

/** Read + JSON.parse one text source; any read or parse failure yields `undefined` (never echoes it). */
async function readJson(read: () => Promise<string>): Promise<unknown> {
  let text: string;
  try {
    text = await read();
  } catch {
    return UNREADABLE_INPUT;
  }
  if (text.trim() === "") return UNREADABLE_INPUT;
  try {
    return JSON.parse(text);
  } catch {
    return UNREADABLE_INPUT;
  }
}

/**
 * Build a TRUSTED index in-process from the `--artifact` files (re-verifying each digest via the
 * injected hash), then reduce it to the policy's ingest shape. No retention bounds are passed to the
 * build — retention is a POLICY concern, evaluated by the policy flags, not baked into the index.
 */
async function ingestFromArtifacts(
  args: ReleasePolicyArgs,
  provider: ReleasePolicyProvider,
): Promise<IngestedIndex> {
  const roots = await Promise.all(
    args.artifactPaths.map(async (path) => {
      let text: string;
      try {
        text = await provider.readArtifact(path);
      } catch {
        return UNREADABLE_INPUT;
      }
      try {
        return JSON.parse(text);
      } catch {
        return UNREADABLE_INPUT;
      }
    }),
  );
  const ingested: IngestedArtifact[] = roots.map((root) => ingestArtifact(root, provider.hash));
  const index = buildIndex(provider.now(), ingested, { maxArtifacts: null, maxAgeDays: null });
  return ingestBuiltIndex(index);
}

/** Resolve the evidence: an in-process artifact build, a `--index` file, or a release-index on stdin. */
async function gather(
  args: ReleasePolicyArgs,
  provider: ReleasePolicyProvider,
): Promise<{ ingested: IngestedIndex; source: ReleasePolicySource }> {
  if (args.artifactPaths.length > 0) {
    return { ingested: await ingestFromArtifacts(args, provider), source: "artifacts" };
  }
  if (args.indexPath !== undefined) {
    const path = args.indexPath;
    const root = await readJson(() => provider.readIndex(path));
    return { ingested: root === undefined ? UNRECOGNIZED_INDEX : ingestIndex(root), source: "index" };
  }
  const root = await readJson(() => provider.readStdin());
  return { ingested: root === undefined ? UNRECOGNIZED_INDEX : ingestIndex(root), source: "index" };
}

/** Run the policy CLI for validated `args` using the injected `provider`. Never throws on input. */
export async function runReleasePolicy(
  args: ReleasePolicyArgs,
  provider: ReleasePolicyProvider,
): Promise<ReleasePolicyRun> {
  const { ingested, source } = await gather(args, provider);
  const result = buildPolicyResult(provider.now(), source, ingested, args.policy);

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleasePolicy(result.rollup.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releasePolicyExitCode(result),
    output: renderReleasePolicy(result, args.format, args.pretty),
    result,
  };
}
