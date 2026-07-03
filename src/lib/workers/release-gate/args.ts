/**
 * Pure, node-free parser for the release readiness gate CLI (`pnpm worker:release-gate`).
 *
 * Like the ops-bundle parser, it maps `process.argv` to a validated {@link ReleaseGateArgs} with no
 * side effects, environment reads, or I/O, so every branch (including malformed input and `--help`)
 * is unit-tested deterministically. The CLI entry (`scripts/worker-release-gate.ts`) is the only
 * place that reads the real `argv`, prints {@link RELEASE_GATE_USAGE}, spawns the checks, writes the
 * output, and exits.
 *
 * Scope flags (`--skip` / `--only`) accept ONLY the bounded {@link ReleaseCheckId} tokens; an
 * unrecognized id is a usage error (never silently ignored), so a typo can never quietly drop a
 * check from a promotion gate.
 */

import { RELEASE_CHECK_IDS, isReleaseCheckId, type ReleaseCheckId } from "./types";
import type { ReleaseGateFormat } from "./render";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseGateArgs {
  /** Output format (default `json`). */
  format: ReleaseGateFormat;
  /** Pretty JSON output. Defaults true for stdout JSON; explicit so tests can pin behavior. */
  pretty: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered report. */
  outputPath?: string;
  /** Bounded ids to skip (mutually exclusive with `only`). Empty ⇒ run everything not skipped. */
  skip: readonly ReleaseCheckId[];
  /** Present iff `--only` was supplied: run ONLY these bounded ids (mutually exclusive with `skip`). */
  only?: readonly ReleaseCheckId[];
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseGateArgsResult =
  | { ok: true; kind: "run"; args: ReleaseGateArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseGateFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_GATE_USAGE = `pdf.xyz secure-worker release readiness gate

Runs the existing offline, content-free worker checks as subprocesses, reads ONLY each one's exit
code (never a byte of its output), and folds them into ONE stable PASS/WARN/FAIL release-readiness
report to run before promoting a worker build. It makes NO network call, reads NO provider
export/secret/bucket, deletes nothing, and carries no locator, identifier, timestamp, size, path, or
byte. It is a PRE-DEPLOY EVIDENCE gate — not live cloud validation, deletion proof, or the promotion.

Composed checks (bounded ids for --skip / --only):
  deploy-examples            deployment blueprints valid & secret-free (pnpm deploy:examples:check)
  worker-smoke               daemon no-config honesty + offline lifecycle contract (pnpm worker:smoke)
  worker-engines             native engine preflight on this host (pnpm worker:engines; ADVISORY)
  ops-check-healthy          healthcheck reads a healthy snapshot as healthy
  ops-check-critical         healthcheck flags a critical snapshot as critical
  ops-bundle-healthy         evidence bundle composes a healthy result as healthy
  ops-bundle-critical        evidence bundle composes a critical result as critical
  cleanup-pipeline-unknown   pipeline reports honest 'unknown' with no backend wired
  cleanup-pipeline-breach    pipeline fails closed on a present-but-tombstoned object
  lifecycle-verify           lifecycle verification accepts a matching observed policy
  lifecycle-drift            lifecycle verification flags a drifted observed policy

Usage:
  pnpm worker:release-gate [format] [scope] [--output=<path>]

Scope (choose at most one):
  --skip=<id,...>       Skip these bounded check ids (run everything else).
  --only=<id,...>       Run ONLY these bounded check ids.
                        An unrecognized id is a usage error, never a silent no-op.

Output:
  --output=<path>       Write the rendered report to a file instead of stdout. The path is never
                        embedded in the report or printed on errors.
  --pretty             Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                Stable JSON, suitable for a CI artifact / release record / SIEM to parse.
  --text                An operator-friendly pre-deploy checklist.

  -h, --help            Show this help.

Exit codes (higher = worse; 1 is a distinct "the gate CLI was misused" band):
  0  PASS      — every included check passed; ready to promote from the evidence here
  1  USAGE     — the gate CLI was used incorrectly (a bad flag / unknown scope id)
  2  UNKNOWN   — a check was indeterminate, no check was included, or an internal fault occurred
  3  WARNING   — an advisory check flagged a concern
  4  FAIL      — a blocking check failed`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1
    ? { name: token }
    : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/**
 * Parse a comma-separated list of bounded check ids. Returns the validated, de-duplicated ids in
 * catalog order, or an error message naming the first unrecognized token (a bounded id, never
 * arbitrary input beyond the flag the operator typed).
 */
function parseIdList(raw: string): { ok: true; ids: ReleaseCheckId[] } | { ok: false; message: string } {
  const tokens = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return { ok: false, message: "Scope flag requires at least one check id." };
  const set = new Set<ReleaseCheckId>();
  for (const t of tokens) {
    if (!isReleaseCheckId(t)) {
      return { ok: false, message: `Unknown check id: ${t}. Valid ids: ${RELEASE_CHECK_IDS.join(", ")}` };
    }
    set.add(t);
  }
  // Return in catalog order so the run/report order is stable regardless of how they were typed.
  return { ok: true, ids: RELEASE_CHECK_IDS.filter((id) => set.has(id)) };
}

/**
 * Parse the release-gate argv (already sliced past `node script`). Deterministic and
 * side-effect-free: it validates flags, rejects conflicting formats/scopes/duplicate value flags and
 * unknown options, and never reads the environment.
 */
export function parseReleaseGateArgs(argv: readonly string[]): ParseReleaseGateArgsResult {
  let format: ReleaseGateFormat | undefined;
  let pretty = true;
  let outputPath: string | undefined;
  let skip: ReleaseCheckId[] | undefined;
  let only: ReleaseCheckId[] | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (name === "--pretty") {
      pretty = true;
      continue;
    }

    if (name === "--output" || name === "--skip" || name === "--only") {
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
      if (name === "--output") {
        if (outputPath !== undefined) return { ok: false, message: "Duplicate --output option." };
        outputPath = value;
      } else if (name === "--skip") {
        if (only !== undefined) return { ok: false, message: "Choose only one scope: --skip or --only." };
        if (skip !== undefined) return { ok: false, message: "Duplicate --skip option." };
        const parsed = parseIdList(value);
        if (!parsed.ok) return { ok: false, message: parsed.message };
        skip = parsed.ids;
      } else {
        if (skip !== undefined) return { ok: false, message: "Choose only one scope: --skip or --only." };
        if (only !== undefined) return { ok: false, message: "Duplicate --only option." };
        const parsed = parseIdList(value);
        if (!parsed.ok) return { ok: false, message: parsed.message };
        only = parsed.ids;
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
      skip: skip ?? [],
      ...(only !== undefined ? { only } : {}),
    },
  };
}
