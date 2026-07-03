/**
 * Pure, node-free **parser** for the release evidence index CLI (`pnpm worker:release-index`).
 *
 * Like the release-gate / release-artifact parsers, it maps `process.argv` to a validated
 * {@link ReleaseIndexArgs} with no side effects, environment reads, or I/O, so every branch (repeated
 * inputs, retention bounds, format, `--help`, and each malformed case) is unit-tested
 * deterministically. The CLI entry (`scripts/worker-release-index.ts`) is the only place that reads
 * the real `argv`, reads the artifact files / stdin, computes the digests, writes the output, and
 * exits.
 *
 * Inputs: one or more `--artifact=<path>` / `--file=<path>` (repeatable), and/or — when NONE is given
 * — a JSON array (or a single artifact object) on stdin. Retention bounds `--max-artifacts=N` /
 * `--max-age-days=N` are optional non-negative integers. A bad flag, a non-numeric/negative bound, or
 * an empty value is a usage error (never a silent default), and no input path is ever echoed.
 */

import type { ReleaseIndexFormat } from "./render";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseIndexArgs {
  /** Output format (default `json`). */
  format: ReleaseIndexFormat;
  /** Pretty JSON output. Defaults true for stdout JSON; explicit so tests can pin behavior. */
  pretty: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Repeated `--artifact`/`--file` paths (in order). Empty ⇒ the entry reads stdin instead. */
  artifactPaths: string[];
  /** Optional `--max-artifacts` retention cap (a non-negative integer). */
  maxArtifacts?: number;
  /** Optional `--max-age-days` retention cap (a non-negative integer). */
  maxAgeDays?: number;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseIndexArgsResult =
  | { ok: true; kind: "run"; args: ReleaseIndexArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseIndexFormat> = {
  "--json": "json",
  "--text": "text",
};

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set([
  "--output",
  "--artifact",
  "--file",
  "--max-artifacts",
  "--max-age-days",
]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_INDEX_USAGE = `pdf.xyz secure-worker release evidence index / retention manifest

Ingests one or more content-free \`pdfxyz.release-artifact/1\` files, RE-VERIFIES each one's integrity
digest, and emits a stable, content-free INDEX / RETENTION MANIFEST: a rollup verdict, per-verdict and
per-digest-status counts, a bounded newest/oldest age span, a retention posture (over-count, over-age,
stale), and a bounded per-artifact summary. For CI archives, release handoff, and retention reviews.

It is local, offline, and READ-ONLY: it makes NO network call, reads NO secret/bucket/object, and
NEVER deletes, prunes, uploads, or mutates any artifact. It carries no filename, path, object key,
bucket, URL, raw ref, raw label, commit URL, size, or byte. It is content-free INDEXING + digest
verification — not storage retention ENFORCEMENT, signing, auth, cloud validation, or promotion.

Usage:
  pnpm worker:release-index --artifact=<path> [--artifact=<path> ...] [options]
  cat artifacts.json | pnpm worker:release-index [options]      # a JSON array on stdin

Inputs (repeatable; omit ALL to read a JSON array / single artifact on stdin):
  --artifact=<path>      Index this \`pdfxyz.release-artifact/1\` file (may be repeated).
  --file=<path>          Alias for --artifact (may be repeated).

Retention (optional; both are non-negative integers):
  --max-artifacts=N      Flag the archive as over-retention if more than N artifacts are indexed, and
                         mark the oldest as prune candidates. Never deletes anything.
  --max-age-days=N       Flag any artifact older than N days as over-retention, and the whole archive
                         as STALE if its newest artifact is older than N days.

Output:
  --output=<path>        Write the rendered output to a file instead of stdout. The path is never
                         embedded in the output or printed on errors.
  --pretty               Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                 Stable JSON, suitable for a CI artifact / release record / SIEM to parse.
  --text                 An operator-friendly retention summary.

  -h, --help             Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  OK          — an intact, within-retention manifest was written
  1  USAGE       — the CLI was misused (a bad flag, a non-numeric/negative bound, an unwritable output)
  2  INSUFFICIENT— the archive is empty/insufficient (no usable artifact), or an internal fault
  3  WARN        — a retention concern (over-count, over-age, stale) or a skipped non-artifact input
  4  INVALID     — an indexed artifact FAILED digest verification (a tampered / corrupt artifact)`;

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

/**
 * Parse the release-index argv (already sliced past `node script`). Deterministic and side-effect-
 * free: it validates flags, rejects conflicting formats / duplicate single-value flags / unknown
 * options / a non-numeric or negative retention bound, and never reads the environment or filesystem.
 * `--artifact`/`--file` are REPEATABLE (each appends), so they are never a "duplicate" error.
 */
export function parseReleaseIndexArgs(argv: readonly string[]): ParseReleaseIndexArgsResult {
  let format: ReleaseIndexFormat | undefined;
  let pretty = true;
  let outputPath: string | undefined;
  const artifactPaths: string[] = [];
  let maxArtifacts: number | undefined;
  let maxAgeDays: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (name === "--pretty") {
      pretty = true;
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
        case "--artifact":
        case "--file":
          artifactPaths.push(value);
          break;
        case "--max-artifacts": {
          if (maxArtifacts !== undefined) return { ok: false, message: "Duplicate --max-artifacts option." };
          const n = parseCount(value);
          if (n === undefined) {
            return { ok: false, message: "Invalid --max-artifacts: must be a non-negative integer." };
          }
          maxArtifacts = n;
          break;
        }
        case "--max-age-days": {
          if (maxAgeDays !== undefined) return { ok: false, message: "Duplicate --max-age-days option." };
          const n = parseCount(value);
          if (n === undefined) {
            return { ok: false, message: "Invalid --max-age-days: must be a non-negative integer." };
          }
          maxAgeDays = n;
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

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      ...(outputPath !== undefined ? { outputPath } : {}),
      artifactPaths,
      ...(maxArtifacts !== undefined ? { maxArtifacts } : {}),
      ...(maxAgeDays !== undefined ? { maxAgeDays } : {}),
    },
  };
}
