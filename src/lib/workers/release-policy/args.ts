/**
 * Pure, node-free **parser** for the release policy CLI (`pnpm worker:release-policy`).
 *
 * Like the release-gate / release-artifact / release-index parsers, it maps `process.argv` to a
 * validated {@link ReleasePolicyArgs} with no side effects, environment reads, or I/O, so every branch
 * (each input source, each policy flag, the format, `--help`, and every malformed case) is unit-tested
 * deterministically. The CLI entry (`scripts/worker-release-policy.ts`) is the only place that reads
 * the real `argv`, reads the index / artifact files / stdin, computes digests, writes the output, and
 * exits.
 *
 * Inputs: a single `--index=<path>` for a `pdfxyz.release-index/1` manifest, OR one or more
 * `--artifact=<path>` (repeatable) `pdfxyz.release-artifact/1` files to index IN-PROCESS, OR — when
 * NEITHER is given — a single release-index object on stdin. `--index` and `--artifact` are mutually
 * exclusive. Policy flags are optional and bounded; a bad flag, a non-numeric/negative bound, an
 * invalid age bucket, both input modes, or a contradictory `--min-artifacts`/`--max-artifacts` is a
 * usage error (never a silent default), and no input path is ever echoed.
 */

import { RELEASE_POLICY_AGE_BOUNDS, type ReleasePolicyAgeBound } from "./types";
import type { ReleasePolicyFormat } from "./render";

/** The validated arguments the CLI hands to the runner. */
export interface ReleasePolicyArgs {
  /** Output format (default `json`). */
  format: ReleasePolicyFormat;
  /** Pretty JSON output. Defaults true for stdout JSON; explicit so tests can pin behavior. */
  pretty: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present iff `--index` was supplied: the `pdfxyz.release-index/1` manifest to evaluate. */
  indexPath?: string;
  /** Repeated `--artifact` paths (in order). Non-empty ⇒ index them in-process instead of `--index`. */
  artifactPaths: string[];
  /** The bounded, parsed policy assertions. */
  policy: {
    requireClean: boolean;
    requireLatestOk: boolean;
    maxInvalid: number | null;
    maxFail: number | null;
    minArtifacts: number | null;
    maxArtifacts: number | null;
    maxAgeBucket: ReleasePolicyAgeBound | null;
    maxWarn: number | null;
    maxSkipped: number | null;
    forbidOverRetention: boolean;
  };
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleasePolicyArgsResult =
  | { ok: true; kind: "run"; args: ReleasePolicyArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleasePolicyFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean policy / output flags (no value). */
const BOOL_FLAGS = new Set([
  "--require-clean",
  "--require-latest-ok",
  "--forbid-over-retention",
  "--pretty",
]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set([
  "--output",
  "--index",
  "--artifact",
  "--max-invalid",
  "--max-fail",
  "--min-artifacts",
  "--max-artifacts",
  "--max-age-bucket",
  "--max-warn",
  "--max-skipped",
]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_POLICY_USAGE = `pdf.xyz secure-worker release evidence policy assertions

Evaluates a small, explicit set of operator policy thresholds against a content-free
\`pdfxyz.release-index/1\` manifest (or an in-process index of \`pdfxyz.release-artifact/1\` files) and
emits a stable, content-free policy result: a rollup verdict, the evaluated policy, bounded violation
ids with counts + remediation, and an exit code. It answers ONE question for CI/operators: "Is this
release evidence archive acceptable under our explicit release policy?"

It is local, offline, and READ-ONLY: it makes NO network call, reads NO secret/bucket/object, and NEVER
deletes, prunes, uploads, promotes, or mutates any artifact, index, or deployment. It carries no
filename, path, object key, bucket, URL, raw ref, raw label, commit URL, size, or byte. It is bounded
policy EVALUATION over content-free evidence — not signing, auth, cloud validation, storage retention
enforcement, or deployment promotion.

Usage:
  pnpm worker:release-policy --index=<path> [policy...] [options]
  pnpm worker:release-policy --artifact=<path> [--artifact=<path> ...] [policy...] [options]
  cat index.json | pnpm worker:release-policy [policy...] [options]   # a release-index on stdin

Input (choose one; omit BOTH to read a single release-index object on stdin):
  --index=<path>         Evaluate this pre-built \`pdfxyz.release-index/1\` manifest.
  --artifact=<path>      Index this \`pdfxyz.release-artifact/1\` file IN-PROCESS (re-verifying its
                         digest), repeatable. Mutually exclusive with --index; the strongest mode.

Policy assertions (all optional; an unset flag asserts nothing). Bounds are non-negative integers:
  --require-clean        BLOCK unless the archive rollup verdict is \`ok\`.
  --require-latest-ok    BLOCK unless the newest indexed artifact's verdict is \`pass\`.
  --max-invalid=N        BLOCK if more than N artifacts failed digest integrity.
  --max-fail=N           BLOCK if more than N indexed artifacts carry a \`fail\` verdict.
  --min-artifacts=N      BLOCK if fewer than N artifacts are indexed.
  --max-artifacts=N      BLOCK if more than N artifacts are indexed.
  --max-age-bucket=<b>   BLOCK if the newest artifact is older than bucket <b>
                         (one of: ${RELEASE_POLICY_AGE_BOUNDS.join(", ")}).
  --max-warn=N           WARN if more than N indexed artifacts carry a \`warn\` verdict.
  --max-skipped=N        WARN if more than N inputs were skipped as unreadable.
  --forbid-over-retention  WARN if any artifact is flagged over the index's retention bounds.

Output:
  --output=<path>        Write the rendered output to a file instead of stdout. The path is never
                         embedded in the output or printed on errors.
  --pretty               Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                 Stable JSON, suitable for a CI artifact / release record / SIEM to parse.
  --text                 An operator-friendly policy summary.

  -h, --help             Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  PASS    — the archive is acceptable under the policy
  1  USAGE   — the CLI was misused (a bad flag, a bad bound/bucket, both inputs, an unwritable output)
  2  UNKNOWN — the policy could not be evaluated (no readable index, or an empty archive)
  3  WARN    — a warning-only assertion was violated (a non-blocking policy concern)
  4  FAIL    — a blocking assertion was violated, or the index is invalid / tampered`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/** Parse a strict non-negative integer, or `undefined` if the text is not one (never echoes it). */
function parseCount(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** True iff `value` is one of the bounded ordered age thresholds (never `future`/`unknown`). */
function isAgeBound(value: string): value is ReleasePolicyAgeBound {
  return (RELEASE_POLICY_AGE_BOUNDS as readonly string[]).includes(value);
}

/**
 * Parse the release-policy argv (already sliced past `node script`). Deterministic and side-effect-
 * free: it validates flags, rejects conflicting formats / duplicate single-value flags / unknown
 * options / a non-numeric or negative bound / an invalid age bucket / both input modes / a
 * contradictory min>max, and never reads the environment or filesystem. `--artifact` is REPEATABLE.
 */
export function parseReleasePolicyArgs(argv: readonly string[]): ParseReleasePolicyArgsResult {
  let format: ReleasePolicyFormat | undefined;
  let pretty = true;
  let outputPath: string | undefined;
  let indexPath: string | undefined;
  const artifactPaths: string[] = [];

  let requireClean = false;
  let requireLatestOk = false;
  let forbidOverRetention = false;
  let maxInvalid: number | undefined;
  let maxFail: number | undefined;
  let minArtifacts: number | undefined;
  let maxArtifacts: number | undefined;
  let maxWarn: number | undefined;
  let maxSkipped: number | undefined;
  let maxAgeBucket: ReleasePolicyAgeBound | undefined;

  /** Parse + validate a `--flag=N` non-negative integer, rejecting a duplicate. */
  const takeCount = (
    name: string,
    value: string,
    current: number | undefined,
  ): { ok: true; value: number } | { ok: false; message: string } => {
    if (current !== undefined) return { ok: false, message: `Duplicate ${name} option.` };
    const n = parseCount(value);
    if (n === undefined) {
      return { ok: false, message: `Invalid ${name}: must be a non-negative integer.` };
    }
    return { ok: true, value: n };
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (BOOL_FLAGS.has(name)) {
      switch (name) {
        case "--pretty":
          pretty = true;
          break;
        case "--require-clean":
          requireClean = true;
          break;
        case "--require-latest-ok":
          requireLatestOk = true;
          break;
        case "--forbid-over-retention":
          forbidOverRetention = true;
          break;
      }
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
        case "--index":
          if (indexPath !== undefined) return { ok: false, message: "Duplicate --index option." };
          indexPath = value;
          break;
        case "--artifact":
          artifactPaths.push(value);
          break;
        case "--max-invalid": {
          const r = takeCount(name, value, maxInvalid);
          if (!r.ok) return r;
          maxInvalid = r.value;
          break;
        }
        case "--max-fail": {
          const r = takeCount(name, value, maxFail);
          if (!r.ok) return r;
          maxFail = r.value;
          break;
        }
        case "--min-artifacts": {
          const r = takeCount(name, value, minArtifacts);
          if (!r.ok) return r;
          minArtifacts = r.value;
          break;
        }
        case "--max-artifacts": {
          const r = takeCount(name, value, maxArtifacts);
          if (!r.ok) return r;
          maxArtifacts = r.value;
          break;
        }
        case "--max-warn": {
          const r = takeCount(name, value, maxWarn);
          if (!r.ok) return r;
          maxWarn = r.value;
          break;
        }
        case "--max-skipped": {
          const r = takeCount(name, value, maxSkipped);
          if (!r.ok) return r;
          maxSkipped = r.value;
          break;
        }
        case "--max-age-bucket": {
          if (maxAgeBucket !== undefined) return { ok: false, message: "Duplicate --max-age-bucket option." };
          if (!isAgeBound(value)) {
            return {
              ok: false,
              message: `Invalid --max-age-bucket: must be one of ${RELEASE_POLICY_AGE_BOUNDS.join(", ")}.`,
            };
          }
          maxAgeBucket = value;
          break;
        }
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

  // --index and --artifact are two ways to name the same evidence; requiring exactly one keeps the
  // provenance of the evaluated facts unambiguous.
  if (indexPath !== undefined && artifactPaths.length > 0) {
    return { ok: false, message: "Choose --index OR --artifact, not both." };
  }

  // A contradictory count band can never be satisfied — reject it as misuse, not a guaranteed fail.
  if (minArtifacts !== undefined && maxArtifacts !== undefined && minArtifacts > maxArtifacts) {
    return { ok: false, message: "Contradictory bounds: --min-artifacts exceeds --max-artifacts." };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(indexPath !== undefined ? { indexPath } : {}),
      artifactPaths,
      policy: {
        requireClean,
        requireLatestOk,
        maxInvalid: maxInvalid ?? null,
        maxFail: maxFail ?? null,
        minArtifacts: minArtifacts ?? null,
        maxArtifacts: maxArtifacts ?? null,
        maxAgeBucket: maxAgeBucket ?? null,
        maxWarn: maxWarn ?? null,
        maxSkipped: maxSkipped ?? null,
        forbidOverRetention,
      },
    },
  };
}
