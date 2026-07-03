/**
 * The node-free **orchestrator** for the release evidence artifact CLI (Phase 47).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-artifact.ts`) is a thin shell: it resolves argv, gathers raw git facts,
 * reads/runs the gate result, reads an optional ops-bundle summary, provides a `node:crypto` hash,
 * and hands those capabilities here. That keeps every branch — each input source, the ingest failure
 * modes, the rollup, the digest, the verify path, and every output format — unit-testable without a
 * runtime, a filesystem, or a subprocess.
 *
 * Honesty flows straight through:
 *  - the git provenance is reduced to bounded enums by `./git` (the raw branch/commit are never
 *    copied), and an unavailable/suppressed VCS is honestly `unknown` — never a fabricated `clean`;
 *  - the archived gate result is re-authored by the `./gate` trust boundary from bounded enums, and a
 *    missing/unreadable result is honestly `unknown` (which blocks a `pass`), never a false `pass`;
 *  - the attached ops-bundle is context-only and never drives the verdict;
 *  - the integrity digest is computed over the canonical, already-content-free body.
 *
 * A run NEVER throws on an operational or input problem — those become a structured artifact/outcome
 * + exit code; only a genuine internal fault (a hash seam crash, say) propagates, to be caught by the
 * entry's top-level handler and mapped to UNKNOWN.
 */

import { assembleArtifact, buildBody, buildMetadata } from "./build";
import { computeIntegrity, verifyIntegrity, type HashFn } from "./digest";
import { reduceGitProvenance, UNKNOWN_GIT_PROVENANCE, type RawGitFacts } from "./git";
import { ingestGateResult, unreadableGate } from "./gate";
import {
  ingestOpsBundleSummary,
  NOT_CONFIGURED_OPS_BUNDLE,
  unreadableOpsBundle,
} from "./opsbundle";
import { recordReleaseArtifact } from "./metrics";
import { renderReleaseArtifact, renderVerifyOutcome } from "./render";
import {
  RELEASE_ARTIFACT_EXIT,
  RELEASE_ARTIFACT_SCHEMA,
  RELEASE_ARTIFACT_VERDICTS,
  releaseArtifactExitCode,
  type ReleaseArtifact,
  type ReleaseArtifactGate,
  type ReleaseArtifactOpsBundle,
  type ReleaseArtifactVerifyOutcome,
  type ReleaseArtifactVerdict,
  type ReleaseGitProvenance,
} from "./types";
import { isValidReleaseLabel, type ReleaseArtifactArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`         — stamp the artifact (a wall clock, behind a seam so tests are deterministic);
 *  - `hash`        — sha256-hex of a canonical string (a `node:crypto` seam, kept out of this leaf);
 *  - `gitFacts`    — gather raw git facts (the entry spawns git); only called in generate mode when
 *                    `--no-vcs` is absent, and its throw is caught → `unknown` provenance;
 *  - `readGate`    — read a supplied gate result file; its throw is caught → `unreadable` gate;
 *  - `runGate`     — run the gate internally and capture its JSON stdout; its throw is caught likewise;
 *  - `readOpsBundle` — read an optional ops-bundle summary; its throw is caught → `unreadable` bundle;
 *  - `readArtifact`  — read a previously written artifact (verify mode); its throw ⇒ `unreadable`.
 */
export interface ReleaseArtifactProvider {
  now(): string;
  hash: HashFn;
  gitFacts(): Promise<RawGitFacts>;
  readGate(path: string): Promise<string>;
  runGate(): Promise<string>;
  readOpsBundle(path: string): Promise<string>;
  readArtifact(path: string): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseArtifactRun {
  readonly exitCode: number;
  readonly output: string;
  /** Present in generate mode: the assembled artifact. */
  readonly artifact?: ReleaseArtifact;
  /** Present in verify mode: the verification outcome. */
  readonly verify?: ReleaseArtifactVerifyOutcome;
}

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/* ------------------------------------------------------------------ *
 *  Generate mode
 * ------------------------------------------------------------------ */

/** Reduce the build's git provenance, honoring `--no-vcs` and catching an unavailable VCS. */
async function resolveGitProvenance(
  args: ReleaseArtifactArgs,
  provider: ReleaseArtifactProvider,
): Promise<ReleaseGitProvenance> {
  if (args.noVcs) return UNKNOWN_GIT_PROVENANCE;
  try {
    return reduceGitProvenance(await provider.gitFacts());
  } catch {
    // Git unavailable / not a repo — honest unknown provenance, never a fabricated clean/default.
    return UNKNOWN_GIT_PROVENANCE;
  }
}

/** Obtain + ingest the archived gate result (supplied file, else an internal run). */
async function resolveGate(
  args: ReleaseArtifactArgs,
  provider: ReleaseArtifactProvider,
): Promise<ReleaseArtifactGate> {
  if (args.releaseGatePath !== undefined) {
    try {
      return ingestGateResult(await provider.readGate(args.releaseGatePath), "supplied");
    } catch {
      return unreadableGate();
    }
  }
  try {
    return ingestGateResult(await provider.runGate(), "generated");
  } catch {
    return unreadableGate();
  }
}

/** Read + ingest the optional ops-bundle summary (absent ⇒ not-configured; read failure ⇒ unreadable). */
async function resolveOpsBundle(
  args: ReleaseArtifactArgs,
  provider: ReleaseArtifactProvider,
): Promise<ReleaseArtifactOpsBundle> {
  if (args.opsBundlePath === undefined) return NOT_CONFIGURED_OPS_BUNDLE;
  try {
    return ingestOpsBundleSummary(await provider.readOpsBundle(args.opsBundlePath));
  } catch {
    return unreadableOpsBundle();
  }
}

/** Build + digest + render a fresh artifact. */
async function runGenerate(
  args: ReleaseArtifactArgs,
  provider: ReleaseArtifactProvider,
): Promise<ReleaseArtifactRun> {
  const generatedAt = provider.now();

  const [git, gate, opsBundle] = await Promise.all([
    resolveGitProvenance(args, provider),
    resolveGate(args, provider),
    resolveOpsBundle(args, provider),
  ]);

  // Defense in depth: the parser already validates the label, but re-check here so the label is
  // content-free BY CONSTRUCTION regardless of how `args` was built — a non-conforming label is
  // dropped to `null`, never archived.
  const label = args.label !== undefined && isValidReleaseLabel(args.label) ? args.label : null;
  const metadata = buildMetadata(label, git);
  const body = buildBody(generatedAt, metadata, gate, opsBundle);
  const integrity = computeIntegrity(body, provider.hash);
  const artifact = assembleArtifact(body, integrity);

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseArtifact(artifact.body.rollup.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseArtifactExitCode(artifact),
    output: renderReleaseArtifact(artifact, args.format, args.pretty),
    artifact,
  };
}

/* ------------------------------------------------------------------ *
 *  Verify mode
 * ------------------------------------------------------------------ */

/** The authored detail per verify reason. */
const VERIFY_DETAIL: Record<ReleaseArtifactVerifyOutcome["reason"], string> = {
  verified: "The recomputed digest matches the archived one over the canonical body: the artifact was not altered.",
  "digest-mismatch":
    "The recomputed digest does NOT match the archived one: the artifact body was altered or corrupted since it was written.",
  "malformed-digest":
    "The archived integrity digest is not a well-formed sha256 hex string, so the artifact cannot be trusted as intact.",
  unreadable:
    "The file is not a recognized content-free `pdfxyz.release-artifact/1` artifact (unreadable, malformed, or the wrong shape). The offending content is never echoed.",
};

/** Build a bounded verify outcome. */
function verifyOutcome(
  reason: ReleaseArtifactVerifyOutcome["reason"],
  exitCode: ReleaseArtifactVerifyOutcome["exitCode"],
  claimedDigest: string,
  computedDigest: string,
  verdict: ReleaseArtifactVerdict | null,
): ReleaseArtifactVerifyOutcome {
  return {
    schema: RELEASE_ARTIFACT_SCHEMA,
    ok: reason === "verified",
    reason,
    exitCode,
    claimedDigest,
    computedDigest,
    verdict,
    detail: VERIFY_DETAIL[reason],
  };
}

/** The unreadable-file verify outcome (exit USAGE — the operator pointed --verify at a non-artifact). */
function unreadableVerify(): ReleaseArtifactVerifyOutcome {
  return verifyOutcome("unreadable", RELEASE_ARTIFACT_EXIT.USAGE, "", "", null);
}

/** Re-verify a previously written artifact's integrity digest. */
async function runVerify(
  args: ReleaseArtifactArgs,
  provider: ReleaseArtifactProvider,
): Promise<ReleaseArtifactRun> {
  const render = (outcome: ReleaseArtifactVerifyOutcome): ReleaseArtifactRun => ({
    exitCode: outcome.exitCode,
    output: renderVerifyOutcome(outcome, args.format, args.pretty),
    verify: outcome,
  });

  let text: string;
  try {
    text = await provider.readArtifact(args.verifyPath!);
  } catch {
    return render(unreadableVerify());
  }

  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return render(unreadableVerify());
  }
  if (!isObject(root) || root.schema !== RELEASE_ARTIFACT_SCHEMA || !isObject(root.body)) {
    return render(unreadableVerify());
  }

  const body = root.body;
  const rollup = isObject(body.rollup) ? body.rollup : undefined;
  const verdict = rollup ? (oneOf(rollup.verdict, RELEASE_ARTIFACT_VERDICTS) ?? null) : null;
  const claimed = isObject(root.integrity) ? root.integrity.digest : undefined;

  const result = verifyIntegrity(body, claimed, provider.hash);
  if (result.ok) {
    return render(verifyOutcome("verified", RELEASE_ARTIFACT_EXIT.PASS, result.digest, result.digest, verdict));
  }
  // A structurally-valid artifact whose digest does not verify is a FAIL (corruption/tampering).
  return render(
    verifyOutcome(
      result.reason === "mismatch" ? "digest-mismatch" : "malformed-digest",
      RELEASE_ARTIFACT_EXIT.FAIL,
      result.claimed,
      result.computed,
      verdict,
    ),
  );
}

/* ------------------------------------------------------------------ *
 *  Entry
 * ------------------------------------------------------------------ */

/**
 * Run the artifact CLI for validated `args` using the injected `provider`. Dispatches to the
 * generate or verify flow; neither throws on an input/operational problem.
 */
export async function runReleaseArtifact(
  args: ReleaseArtifactArgs,
  provider: ReleaseArtifactProvider,
): Promise<ReleaseArtifactRun> {
  return args.mode === "verify" ? runVerify(args, provider) : runGenerate(args, provider);
}
