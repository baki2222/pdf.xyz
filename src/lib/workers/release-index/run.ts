/**
 * The node-free **orchestrator** for the release evidence index CLI (Phase 48).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-index.ts`) is a thin shell: it resolves argv, reads the artifact files (or
 * stdin), provides a `node:crypto` hash + a wall clock, and hands those capabilities here. That keeps
 * every branch — each input source, the ingest failure modes, the digest re-verification, the
 * retention posture, the rollup, and both output formats — unit-testable without a runtime, a
 * filesystem, or a subprocess.
 *
 * Honesty flows straight through: a file that cannot be read or parsed becomes ONE `unreadable` input
 * (recorded, never silently dropped, and its path never echoed); a recognized artifact whose digest
 * does not re-verify is `mismatch`/`malformed` (forcing the index to `invalid`); and an empty archive
 * is `unknown`, never a vacuous `ok`. A run NEVER throws on an operational/input problem — those
 * become a structured index + exit code; only a genuine internal fault (a hash seam crash) propagates,
 * to be caught by the entry's top-level handler and mapped to INSUFFICIENT.
 */

import type { HashFn } from "../release-artifact/digest";
import { buildIndex } from "./build";
import { ingestArtifact, type IngestedArtifact } from "./ingest";
import { recordReleaseIndex } from "./metrics";
import { renderReleaseIndex } from "./render";
import { releaseIndexExitCode, type ReleaseIndex } from "./types";
import type { ReleaseIndexArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`          — stamp the index + drive the age-bucket clock (behind a seam so tests are
 *                     deterministic);
 *  - `hash`         — sha256-hex of a canonical string (a `node:crypto` seam, kept out of this leaf);
 *  - `readArtifact` — read one artifact file's text; its throw is caught → one `unreadable` input;
 *  - `readStdin`    — read the whole of stdin (a JSON array or single artifact); only called when NO
 *                     `--artifact`/`--file` was given. Its throw is caught → an empty archive.
 */
export interface ReleaseIndexProvider {
  now(): string;
  hash: HashFn;
  readArtifact(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured index. */
export interface ReleaseIndexRun {
  readonly exitCode: number;
  readonly output: string;
  readonly index: ReleaseIndex;
}

/** A sentinel a failed read/parse contributes — ingest reduces it to one `unreadable` input. */
const UNREADABLE_INPUT = undefined;

/** Read + JSON.parse one artifact file; any read or parse failure yields the unreadable sentinel. */
async function readArtifactRoot(path: string, provider: ReleaseIndexProvider): Promise<unknown> {
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
}

/**
 * Read the artifact roots from stdin when no `--artifact`/`--file` was given: a JSON ARRAY becomes one
 * root per element, a single JSON OBJECT becomes one root, empty/whitespace stdin becomes an empty
 * archive, and non-empty-but-unparseable stdin becomes one `unreadable` input.
 */
async function readStdinRoots(provider: ReleaseIndexProvider): Promise<unknown[]> {
  let text: string;
  try {
    text = await provider.readStdin();
  } catch {
    return [];
  }
  if (text.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [UNREADABLE_INPUT];
  }
  return Array.isArray(parsed) ? parsed : [parsed];
}

/** Gather the artifact roots from the file inputs, else stdin. */
async function gatherRoots(
  args: ReleaseIndexArgs,
  provider: ReleaseIndexProvider,
): Promise<unknown[]> {
  if (args.artifactPaths.length > 0) {
    return Promise.all(args.artifactPaths.map((path) => readArtifactRoot(path, provider)));
  }
  return readStdinRoots(provider);
}

/** Run the index CLI for validated `args` using the injected `provider`. Never throws on input. */
export async function runReleaseIndex(
  args: ReleaseIndexArgs,
  provider: ReleaseIndexProvider,
): Promise<ReleaseIndexRun> {
  const roots = await gatherRoots(args, provider);
  const ingested: IngestedArtifact[] = roots.map((root) => ingestArtifact(root, provider.hash));

  const index = buildIndex(provider.now(), ingested, {
    maxArtifacts: args.maxArtifacts ?? null,
    maxAgeDays: args.maxAgeDays ?? null,
  });

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseIndex(index.rollup.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseIndexExitCode(index),
    output: renderReleaseIndex(index, args.format, args.pretty),
    index,
  };
}
