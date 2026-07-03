/**
 * Pure, node-free **parser** for the release CI bundle CLI (`pnpm worker:release-ci-bundle`).
 *
 * Like the release-gate / release-artifact / release-index / release-policy parsers, it maps
 * `process.argv` to a validated {@link ReleaseCiBundleArgs} with no side effects, environment reads, or
 * I/O, so every branch (each stage input, the format, `--help`, and every malformed case) is unit-tested
 * deterministically. The CLI entry (`scripts/worker-release-ci-bundle.ts`) is the only place that reads
 * the real `argv`, reads the stage files, computes the artifact digest, writes the output, and exits.
 *
 * Inputs: up to one file per release-evidence stage — `--release-gate`, `--release-artifact`,
 * `--release-index`, `--release-policy` — each optional, but AT LEAST ONE is required (an empty
 * invocation is a usage error, never a vacuous pass). Each flag may appear at most once. No input path
 * is ever echoed.
 */

import type { ReleaseCiBundleFormat } from "./render";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseCiBundleArgs {
  /** Output format (default `json`). */
  format: ReleaseCiBundleFormat;
  /** Pretty JSON output. Defaults true for stdout JSON; explicit so tests can pin behavior. */
  pretty: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present iff `--release-gate` was supplied: the `pdfxyz.worker-release-gate/1` report to ingest. */
  gatePath?: string;
  /** Present iff `--release-artifact` was supplied: the `pdfxyz.release-artifact/1` file to ingest. */
  artifactPath?: string;
  /** Present iff `--release-index` was supplied: the `pdfxyz.release-index/1` manifest to ingest. */
  indexPath?: string;
  /** Present iff `--release-policy` was supplied: the `pdfxyz.release-policy/1` result to ingest. */
  policyPath?: string;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseCiBundleArgsResult =
  | { ok: true; kind: "run"; args: ReleaseCiBundleArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseCiBundleFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set(["--pretty"]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set([
  "--output",
  "--release-gate",
  "--release-artifact",
  "--release-index",
  "--release-policy",
]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_CI_BUNDLE_USAGE = `pdf.xyz secure-worker release evidence CI bundle

Composes the content-free release-evidence chain — a \`pdfxyz.worker-release-gate/1\` report, a
\`pdfxyz.release-artifact/1\` file, a \`pdfxyz.release-index/1\` manifest, and/or a
\`pdfxyz.release-policy/1\` result — into ONE stable, content-free bundle: per-stage summaries, the
cross-stage + self-consistency checks, a rollup verdict, which stage outputs to archive, the next safe
operator action, and an exit code. It answers ONE question for CI/operators: "What did the release
evidence chain decide end-to-end, do the stages agree, and what is the next safe action?"

It is local, offline, and READ-ONLY: it INGESTS stage outputs a release job already produced; it RUNS no
stage itself, makes NO network call, reads NO secret/bucket/object, and NEVER deletes, prunes, uploads,
promotes, or mutates anything. It carries no filename, path, object key, bucket, URL, raw ref, raw label,
commit URL, size, digest, or byte. It is content-free bundling + consistency checking over evidence —
not signing, auth, cloud validation, storage retention enforcement, or deployment promotion.

Usage:
  pnpm worker:release-ci-bundle --release-policy=<path> [stages...] [options]
  pnpm worker:release-ci-bundle --release-gate=<path> --release-artifact=<path> \\
                                --release-index=<path> --release-policy=<path> [options]

Stage inputs (each optional; supply AT LEAST ONE — an archive-decision stage for a certifiable bundle):
  --release-gate=<path>      Ingest this \`pdfxyz.worker-release-gate/1\` report.
  --release-artifact=<path>  Ingest this \`pdfxyz.release-artifact/1\` file (re-verifying its digest).
  --release-index=<path>     Ingest this \`pdfxyz.release-index/1\` manifest (re-checked against itself).
  --release-policy=<path>    Ingest this \`pdfxyz.release-policy/1\` result (re-checked against itself).

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never
                             embedded in the output or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / release record / SIEM to parse.
  --text                     An operator-friendly bundle summary.

  -h, --help                 Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  PASS    — the bundle is coherent and promote-able under the evidence supplied
  1  USAGE   — the CLI was misused (a bad flag, no stage file supplied, or an unwritable output)
  2  UNKNOWN — the chain could not be certified (an unreadable/indeterminate stage, or no index/policy)
  3  WARN    — an advisory stage verdict was raised (a non-blocking concern)
  4  FAIL    — a stage failed, or two stages disagree (a blocking inconsistency / tamper)`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/**
 * Parse the release-ci-bundle argv (already sliced past `node script`). Deterministic and side-effect-
 * free: it validates flags, rejects conflicting formats / duplicate single-value flags / unknown
 * options / a missing value, requires at least one stage input, and never reads the environment or
 * filesystem.
 */
export function parseReleaseCiBundleArgs(argv: readonly string[]): ParseReleaseCiBundleArgsResult {
  let format: ReleaseCiBundleFormat | undefined;
  let pretty = true;
  let outputPath: string | undefined;
  let gatePath: string | undefined;
  let artifactPath: string | undefined;
  let indexPath: string | undefined;
  let policyPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (BOOL_FLAGS.has(name)) {
      if (name === "--pretty") pretty = true;
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
          if (gatePath !== undefined) return { ok: false, message: "Duplicate --release-gate option." };
          gatePath = value;
          break;
        case "--release-artifact":
          if (artifactPath !== undefined) return { ok: false, message: "Duplicate --release-artifact option." };
          artifactPath = value;
          break;
        case "--release-index":
          if (indexPath !== undefined) return { ok: false, message: "Duplicate --release-index option." };
          indexPath = value;
          break;
        case "--release-policy":
          if (policyPath !== undefined) return { ok: false, message: "Duplicate --release-policy option." };
          policyPath = value;
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

  // At least one stage input is required — an empty invocation has nothing to bundle and must never be a
  // vacuous pass. (Whether the supplied stages certify a chain is a RUN concern, resolved to unknown.)
  if (
    gatePath === undefined &&
    artifactPath === undefined &&
    indexPath === undefined &&
    policyPath === undefined
  ) {
    return {
      ok: false,
      message: "Supply at least one stage: --release-gate / --release-artifact / --release-index / --release-policy.",
    };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(gatePath !== undefined ? { gatePath } : {}),
      ...(artifactPath !== undefined ? { artifactPath } : {}),
      ...(indexPath !== undefined ? { indexPath } : {}),
      ...(policyPath !== undefined ? { policyPath } : {}),
    },
  };
}
