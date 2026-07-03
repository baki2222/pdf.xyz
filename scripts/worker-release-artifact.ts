#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release evidence artifact — the offline, content-free release archive CLI.
 *
 * `pnpm worker:release-artifact` builds a deterministic RELEASE EVIDENCE ARTIFACT: it archives the
 * `worker:release-gate` result (run internally, or supplied via --release-gate) with bounded
 * git/release provenance, optionally attaches a `worker:ops-bundle` summary as context, and computes
 * an INTEGRITY DIGEST (sha256 over the canonical body) so a CI job / incident handoff / deployment-
 * approval record can archive a stable, tamper-evident, content-free artifact. `--verify=<file>`
 * re-verifies a previously written artifact's digest.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under
 * `src/lib/workers/release-artifact/`; this file only reads argv, gathers raw git facts behind a
 * spawn seam, reads/runs the gate result, reads files, hashes via `node:crypto`, writes the output,
 * and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside
 * `src/` and is invoked only as `pnpm worker:release-artifact`).
 *
 * Honesty & privacy:
 *  - It is evidence AGGREGATION + INTEGRITY over content-free data, not a new proof, a signature, or
 *    the promotion. It makes NO network call, reads NO provider export/secret/bucket, and
 *    deletes/uploads/mutates nothing. Its explicit caveats say so.
 *  - Its output is content-free by construction: the git provenance is reduced to bounded enums (the
 *    raw branch name / remote URL is never read into the artifact), the archived gate result is
 *    re-authored from bounded enums, and the digest is over the already-content-free canonical body —
 *    so no filename, key, path, secret, or document content can enter an artifact, even from a
 *    hostile input.
 *  - It exits with the documented ladder (0 pass / 2 unknown / 3 warn / 4 fail) for the composite
 *    verdict and a distinct 1 for CLI misuse (a bad flag / invalid label / unreadable verify target);
 *    in --verify mode a digest mismatch fails closed (4).
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, e.g.:
 *   pnpm worker:release-gate --json > gate.json                                   # pre-run the gate
 *   pnpm worker:release-artifact --release-gate=gate.json --output=release.json   # archive it
 *   pnpm worker:release-artifact --verify=release.json                            # confirm integrity
 *   pnpm worker:release-artifact --text                                           # run the gate + summarize
 */

import {
  RELEASE_ARTIFACT_EXIT,
  RELEASE_ARTIFACT_USAGE,
  parseReleaseArtifactArgs,
  runReleaseArtifact,
  type RawGitFacts,
  type ReleaseArtifactProvider,
} from "@/lib/workers/release-artifact";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";

/** Hard cap on each ingested file; a content-free tool result / artifact is tiny. */
const MAX_INPUT_BYTES = 4 * 1024 * 1024; // 4 MiB

/** Per-git-command budget. Each rev-parse/status returns in milliseconds; this only bounds a hang. */
const GIT_TIMEOUT_MS = 15_000;

/** Wall-clock budget for an internal gate run (the gate itself spawns worker:smoke many times). */
const GATE_TIMEOUT_MS = 300_000;

/** Cap on captured subprocess output. The gate result is small; this only prevents an OOM. */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024; // 16 MiB

/**
 * Run one read-only `git` command and return its trimmed stdout, or `undefined` if it failed / was
 * not a repo. The raw output is UNTRUSTED and is only ever handed to the node-free git reducer, which
 * bounds it to enums; it is never printed here.
 */
function git(args: string[]): string | undefined {
  const r = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
  if (r.error || typeof r.status !== "number" || r.status !== 0) return undefined;
  return typeof r.stdout === "string" ? r.stdout.trim() : undefined;
}

/**
 * Gather the raw git facts (abbreviated commit, ref name, detached flag, dirty flag). Every field is
 * best-effort: a missing/failed command leaves it `undefined`, which the reducer renders as a bounded
 * `unknown`/`null`. NONE of these raw strings is printed — they exist only to be reduced.
 */
async function gitFacts(): Promise<RawGitFacts> {
  // Not a git work tree at all ⇒ no facts (the reducer yields fully-unknown provenance).
  if (git(["rev-parse", "--is-inside-work-tree"]) !== "true") return {};

  const commit = git(["rev-parse", "--short=12", "HEAD"]);
  const ref = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  // `git status --porcelain` prints one line per change; presence ⇒ dirty. We read only its
  // emptiness, never its content.
  const status = git(["status", "--porcelain"]);
  const dirty = status === undefined ? undefined : status.length > 0;
  const facts: RawGitFacts = {
    ...(commit !== undefined ? { commit } : {}),
    ...(ref !== undefined ? { ref } : {}),
    ...(dirty !== undefined ? { dirty } : {}),
    detached: ref === "HEAD",
  };
  return facts;
}

/** Read a file's text, bounding its size first. Throws on any failure (caught by the runner). */
function readBounded(path: string): string {
  if (statSync(path).size > MAX_INPUT_BYTES) throw new Error("input-too-large");
  return readFileSync(path, "utf8");
}

/**
 * Run the release gate internally and capture its JSON stdout. The gate writes its JSON report to
 * stdout for EVERY verdict (it uses the exit code, not stdout, to signal pass/warn/fail), so a
 * non-zero gate exit is expected and NOT an error here — only a spawn failure / empty output is.
 */
function runGate(): string {
  const r = spawnSync("pnpm", ["-s", "worker:release-gate", "--json"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    timeout: GATE_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  if (r.error) throw r.error;
  const out = typeof r.stdout === "string" ? r.stdout : "";
  if (out.trim() === "") throw new Error("empty-gate-output");
  return out;
}

const provider: ReleaseArtifactProvider = {
  now: () => new Date().toISOString(),
  hash: (canonical: string) => createHash("sha256").update(canonical, "utf8").digest("hex"),
  gitFacts,
  readGate: async (path: string) => readBounded(path),
  runGate: async () => runGate(),
  readOpsBundle: async (path: string) => readBounded(path),
  readArtifact: async (path: string) => readBounded(path),
};

async function main(): Promise<number> {
  const parsed = parseReleaseArtifactArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_ARTIFACT_USAGE}\n`);
    return RELEASE_ARTIFACT_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_ARTIFACT_USAGE}\n`);
    return RELEASE_ARTIFACT_EXIT.PASS;
  }

  const { output, exitCode } = await runReleaseArtifact(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(`Could not write release artifact output.\n\n${RELEASE_ARTIFACT_USAGE}\n`);
      return RELEASE_ARTIFACT_EXIT.USAGE;
    }
  } else {
    process.stdout.write(output);
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch(() => {
    // Never print the raw error — it could carry a message we must not log. A genuine internal fault
    // means we could not assemble/verify the artifact → UNKNOWN.
    process.exit(RELEASE_ARTIFACT_EXIT.UNKNOWN);
  });
