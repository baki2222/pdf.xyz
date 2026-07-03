/**
 * Pure, node-free **parser** for the release evidence artifact CLI (`pnpm worker:release-artifact`).
 *
 * Like the release-gate / ops-bundle parsers, it maps `process.argv` to a validated
 * {@link ReleaseArtifactArgs} with no side effects, environment reads, or I/O, so every branch
 * (including malformed input, `--help`, and the two run modes) is unit-tested deterministically. The
 * CLI entry (`scripts/worker-release-artifact.ts`) is the only place that reads the real `argv`,
 * gathers git facts, spawns/reads the gate result, computes the digest, writes the output, and exits.
 *
 * Two modes:
 *  - GENERATE (default) — build a fresh artifact. Optional inputs: a supplied gate result
 *    (`--release-gate`, else the gate runs internally), an ops-bundle summary (`--ops-bundle`), an
 *    operator release label (`--label`, validated to a strict charset + redaction-stable), and
 *    `--no-vcs` to suppress all git provenance.
 *  - VERIFY (`--verify=<file>`) — re-verify a previously written artifact's integrity digest. It
 *    accepts only the format/output flags; combining it with a generation-only flag is a usage error
 *    (never a silent no-op), so a verify can never quietly ignore an operator's intent.
 */

import { redactText } from "@/lib/telemetry/redact";
import type { ReleaseArtifactFormat } from "./render";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseArtifactArgs {
  /** Which operation to run. */
  mode: "generate" | "verify";
  /** Output format (default `json`). */
  format: ReleaseArtifactFormat;
  /** Pretty JSON output. Defaults true for stdout JSON; explicit so tests can pin behavior. */
  pretty: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** GENERATE: a supplied `worker:release-gate --json` result file. Absent ⇒ run the gate internally. */
  releaseGatePath?: string;
  /** GENERATE: an optional `worker:ops-bundle --json` summary file to attach as context. */
  opsBundlePath?: string;
  /** GENERATE: an optional, validated operator release label (strict charset + redaction-stable). */
  label?: string;
  /** GENERATE: suppress ALL git/VCS provenance (record it as `unknown`). */
  noVcs: boolean;
  /** VERIFY: the previously written artifact file to re-verify. */
  verifyPath?: string;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseArtifactArgsResult =
  | { ok: true; kind: "run"; args: ReleaseArtifactArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseArtifactFormat> = {
  "--json": "json",
  "--text": "text",
};

/** The strict charset an operator release label must match — bounded, and (by design) redaction-stable. */
const LABEL_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** True iff `value` is an acceptable release label: strict charset AND unchanged by the redactor. */
export function isValidReleaseLabel(value: string): boolean {
  return LABEL_PATTERN.test(value) && redactText(value) === value;
}

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_ARTIFACT_USAGE = `pdf.xyz secure-worker release evidence artifact

Builds a deterministic, content-free RELEASE EVIDENCE ARTIFACT around the offline release gate: it
archives the \`worker:release-gate\` result (run internally, or supplied) with bounded git/release
provenance, and computes an INTEGRITY DIGEST (sha256 over the canonical body) so a CI job / incident
handoff / deployment-approval record can archive a stable, tamper-evident, content-free artifact.

It makes NO network call, reads NO provider export/secret/bucket, deletes NOTHING, and carries no
filename, object key, bucket, URL, endpoint, region, id, token, size, path, or byte. It is evidence
AGGREGATION + INTEGRITY over content-free data — not signing, auth, cloud validation, deletion proof,
or the promotion itself.

Usage:
  pnpm worker:release-artifact [format] [options]
  pnpm worker:release-artifact --verify=<artifact-file> [format]

Generate options:
  --release-gate=<path>  Archive this pre-run \`worker:release-gate --json\` result. If omitted, the
                         gate is run internally in content-free mode and its result is archived.
  --ops-bundle=<path>    Attach a \`worker:ops-bundle --json\` summary as incident-handoff context.
                         It is archived for context only and does NOT change the release verdict.
  --label=<label>        An operator release label to record. Must match [A-Za-z0-9._-]{1,64} and be
                         redaction-stable; anything else is a usage error (never silently dropped).
  --no-vcs               Suppress ALL git provenance (record cleanliness/ref-class/commit as unknown).

Verify:
  --verify=<path>        Re-verify a previously written artifact: recompute the digest over its
                         canonical body and confirm it matches. Cannot be combined with a generate
                         option. A mismatch fails closed (exit 4).

Output:
  --output=<path>        Write the rendered output to a file instead of stdout. The path is never
                         embedded in the output or printed on errors.
  --pretty               Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                 Stable JSON, suitable for a CI artifact / release record / SIEM to parse.
  --text                 An operator-friendly evidence summary.

  -h, --help             Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  PASS      — a promote-able evidence artifact was written (or --verify confirmed the digest)
  1  USAGE     — the CLI was misused (a bad flag, an invalid label, an unreadable/absent input)
  2  UNKNOWN   — the gate result was indeterminate/absent, or an internal fault occurred
  3  WARNING   — an advisory signal (the gate warned, or the working tree is dirty)
  4  FAIL      — a blocking gate check failed, or --verify found a digest mismatch`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set(["--output", "--release-gate", "--ops-bundle", "--label", "--verify"]);

/**
 * Parse the release-artifact argv (already sliced past `node script`). Deterministic and
 * side-effect-free: it validates flags, rejects conflicting formats / duplicate value flags /
 * unknown options / an invalid label / a verify-plus-generate combination, and never reads the
 * environment or the filesystem.
 */
export function parseReleaseArtifactArgs(argv: readonly string[]): ParseReleaseArtifactArgsResult {
  let format: ReleaseArtifactFormat | undefined;
  let pretty = true;
  let outputPath: string | undefined;
  let releaseGatePath: string | undefined;
  let opsBundlePath: string | undefined;
  let label: string | undefined;
  let verifyPath: string | undefined;
  let noVcs = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (name === "--pretty") {
      pretty = true;
      continue;
    }
    if (name === "--no-vcs") {
      noVcs = true;
      continue;
    }

    if (VALUE_FLAGS.has(name)) {
      // Value from `--flag=value` or the next argv token (not another flag).
      let value = inlineValue;
      if (value === undefined) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          value = next;
          i += 1;
        }
      }
      if (value === undefined || value === "") {
        return { ok: false, message: `${name} requires a value.` };
      }
      switch (name) {
        case "--output":
          if (outputPath !== undefined) return { ok: false, message: "Duplicate --output option." };
          outputPath = value;
          break;
        case "--release-gate":
          if (releaseGatePath !== undefined) return { ok: false, message: "Duplicate --release-gate option." };
          releaseGatePath = value;
          break;
        case "--ops-bundle":
          if (opsBundlePath !== undefined) return { ok: false, message: "Duplicate --ops-bundle option." };
          opsBundlePath = value;
          break;
        case "--label":
          if (label !== undefined) return { ok: false, message: "Duplicate --label option." };
          // The offending label is never echoed — only the rule is stated.
          if (!isValidReleaseLabel(value)) {
            return { ok: false, message: "Invalid --label: must be 1–64 chars of [A-Za-z0-9._-] and redaction-stable." };
          }
          label = value;
          break;
        case "--verify":
          if (verifyPath !== undefined) return { ok: false, message: "Duplicate --verify option." };
          verifyPath = value;
          break;
      }
      continue;
    }

    if (name in FORMAT_FLAGS) {
      const next = FORMAT_FLAGS[name]!;
      if (format !== undefined && format !== next) {
        return { ok: false, message: `Conflicting formats: --${format} and ${name} cannot be combined.` };
      }
      format = next;
      continue;
    }

    return { ok: false, message: `Unknown option: ${name}` };
  }

  // VERIFY mode is mutually exclusive with every generate-only input.
  if (verifyPath !== undefined) {
    const generateFlag =
      releaseGatePath !== undefined
        ? "--release-gate"
        : opsBundlePath !== undefined
          ? "--ops-bundle"
          : label !== undefined
            ? "--label"
            : noVcs
              ? "--no-vcs"
              : undefined;
    if (generateFlag !== undefined) {
      return { ok: false, message: `--verify cannot be combined with ${generateFlag}.` };
    }
  }

  return {
    ok: true,
    kind: "run",
    args: {
      mode: verifyPath !== undefined ? "verify" : "generate",
      format: format ?? "json",
      pretty,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(releaseGatePath !== undefined ? { releaseGatePath } : {}),
      ...(opsBundlePath !== undefined ? { opsBundlePath } : {}),
      ...(label !== undefined ? { label } : {}),
      ...(verifyPath !== undefined ? { verifyPath } : {}),
      noVcs,
    },
  };
}
