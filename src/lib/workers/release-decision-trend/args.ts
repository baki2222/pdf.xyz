/**
 * Pure, node-free **parser** for the release decision index trend summary CLI (`pnpm worker:release-decision-trend`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated {@link ReleaseDecisionTrendArgs}
 * with no side effects, environment reads, or I/O, so every branch (each input, the format, the policy knobs, `--help`,
 * and every malformed case) is unit-tested deterministically. The CLI entry
 * (`scripts/worker-release-decision-trend.ts`) is the only place that reads the real `argv`, reads the windows / stdin,
 * writes the output, and exits.
 *
 * Inputs (choose ONE mode): one or more `--file=<path>` / `--window=<path>` (a bounded history, oldest first / newest
 * LAST), OR `--stdin` (a JSON array of windows, an NDJSON stream, or a single window, newest last). At least one window
 * is required — an empty invocation has nothing to summarize and must never be a vacuous clean pass. No input path is
 * ever echoed.
 */

import type { ReleaseDecisionTrendFormat } from "./render";
import { DEFAULT_MAX_WINDOWS } from "./types";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseDecisionTrendArgs {
  /** Output format (default `json`). */
  format: ReleaseDecisionTrendFormat;
  /** Pretty JSON output. Defaults true; explicit so tests can pin behavior. */
  pretty: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present iff `--file` / `--window` was supplied: the history list (oldest first, newest last). */
  windowPaths?: string[];
  /** True when the window history is read from stdin (a JSON array / NDJSON / single window). */
  stdin: boolean;
  /** `--max-windows=N`: consider only the newest N windows (default {@link DEFAULT_MAX_WINDOWS}). */
  maxWindows: number;
  /** `--strict`: any non-`stable` window escalates the trend to `blocked`. */
  strict: boolean;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseDecisionTrendArgsResult =
  | { ok: true; kind: "run"; args: ReleaseDecisionTrendArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseDecisionTrendFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set(["--pretty", "--stdin", "--strict"]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set(["--output", "--file", "--window", "--max-windows"]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_DECISION_TREND_USAGE = `pdf.xyz secure-worker release decision index trend summary

Summarizes a bounded history of content-free \`pdfxyz.release-decision-index/1\` ledger windows (a quarter / year of
weekly or monthly decision-index windows) into ONE stable, content-free trend summary — the per-window index-verdict
distribution, the aggregate decision distribution, a per-window posture sequence, an arc direction + trend class, a
trend verdict + bounded reasons, and an ordered next-action checklist. It re-validates each window against ITSELF and
answers ONE question for a governance review: "Over the recent decision-index windows, are the decisions improving,
stable, or degrading, is anything blocking / inconclusive / untrustworthy, and what follow-up is warranted?"

It is local, offline, and READ-ONLY: it INGESTS windows \`worker:release-decision-index\` already produced; it RUNS no
gate / index / decision itself, makes NO network call, reads NO secret/bucket/object, and NEVER deletes, prunes,
uploads, promotes, approves, signs, or mutates anything. It carries no reviewer name/email, filename, path, object key,
bucket, URL, raw ref, raw label, raw note, size, digest, or byte, and never echoes an ingested window's own stamp. It
is a content-free ledger-index TREND SUMMARY over decision-index windows — NOT a legal audit log, a compliance
attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger.

Usage:
  pnpm worker:release-decision-trend --file=<older> --file=<newer> [--file=...] [options]
  pnpm worker:release-decision-trend --window=<path> [--window=...] [options]
  cat windows.json | pnpm worker:release-decision-trend --stdin [options]

Inputs (choose ONE mode; supply windows oldest first, newest LAST):
  --file=<path>              A \`pdfxyz.release-decision-index/1\` window. Repeat for a bounded history (newest last).
                             \`--window=<path>\` is an accepted alias.
  --stdin                    Read the history from stdin: a JSON array of windows, an NDJSON stream (one window per
                             line), or a single window. Cannot combine with --file / --window.

Policy (small bounded knobs):
  --max-windows=N            Consider only the newest N windows (default ${DEFAULT_MAX_WINDOWS}). Older windows are
                             dropped from the history (the count dropped is surfaced, never silent).
  --strict                   Escalate any non-stable window (watch / insufficient / blocked / invalid index) to a
                             blocked history — a hard \`all-stable or block\` gate for a high-assurance review.

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never embedded in the
                             output or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / governance record / SIEM to parse.
  --text                     A review-friendly trend summary (CI-summary ready).

  -h, --help                 Show this help.

Direction is derived from ORDERED INPUT POSITIONS (oldest first, newest last), never from any ingested timestamp.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  CLEAR        — a clean history (improving or stable: every usable window a clean stable index)
  1  USAGE        — the CLI was misused (a bad flag, no window supplied, or an unwritable output)
  2  INSUFFICIENT — the history was inconclusive (zero usable windows, or an only-insufficient history)
  3  WATCH        — an advisory / worsening history (watch or degrading)
  4  BLOCKED      — a blocking window (a blocked / invalid index, or a strict violation)
  4  INVALID      — an untrustworthy input (an unreadable / tampered window)`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/** Parse a positive integer flag value (≥ 1), or return an error message. A zero window would summarize nothing. */
function positiveInt(name: string, value: string): { ok: true; n: number } | { ok: false; message: string } {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) {
    return { ok: false, message: `${name} requires a positive integer (at least 1).` };
  }
  return { ok: true, n };
}

/**
 * Parse the release-decision-trend argv (already sliced past `node script`). Deterministic and side-effect-free: it
 * validates flags, rejects conflicting formats / duplicate `--output` / unknown options / a missing value, requires
 * exactly one input mode, rejects a `--stdin` + `--file` combination, and never reads the environment or filesystem.
 */
export function parseReleaseDecisionTrendArgs(
  argv: readonly string[],
): ParseReleaseDecisionTrendArgsResult {
  let format: ReleaseDecisionTrendFormat | undefined;
  let pretty = true;
  let outputPath: string | undefined;
  const windowPaths: string[] = [];
  let stdin = false;
  let maxWindows = DEFAULT_MAX_WINDOWS;
  let strict = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (BOOL_FLAGS.has(name)) {
      if (name === "--pretty") pretty = true;
      else if (name === "--stdin") stdin = true;
      else if (name === "--strict") strict = true;
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
          if (value === "-") return { ok: false, message: "--output cannot be stdin (`-`)." };
          if (outputPath !== undefined) return { ok: false, message: "Duplicate --output option." };
          outputPath = value;
          break;
        case "--file":
        case "--window":
          windowPaths.push(value);
          break;
        case "--max-windows": {
          const parsed = positiveInt("--max-windows", value);
          if (!parsed.ok) return parsed;
          maxWindows = parsed.n;
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

  if (windowPaths.length > 0 && stdin) {
    return { ok: false, message: "--stdin cannot be combined with --file / --window." };
  }
  // At least one window input is required — an empty invocation has nothing to summarize and must never be a vacuous
  // clean pass. (Whether the supplied windows trend clean is a RUN concern, resolved by the fold.)
  if (windowPaths.length === 0 && !stdin) {
    return {
      ok: false,
      message: "Supply at least one window: --file=<path> (repeatable), --window=<path>, or --stdin.",
    };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      stdin,
      maxWindows,
      strict,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(windowPaths.length > 0 ? { windowPaths } : {}),
    },
  };
}
