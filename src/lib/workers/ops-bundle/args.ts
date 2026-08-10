/**
 * Pure, node-free parser for the operations evidence bundle CLI (`pnpm worker:ops-bundle`).
 *
 * Like the ops-check parser, it maps `process.argv` to a validated {@link OpsBundleArgs} with no
 * side effects, environment reads, or I/O, so every branch (including malformed input and
 * `--help`) is unit-tested deterministically. The CLI entry (`scripts/worker-ops-bundle.ts`) is
 * the only place that reads the real `argv`, prints {@link OPS_BUNDLE_USAGE}, reads stdin/files,
 * and exits.
 */

import type { OpsBundleFormat } from "./render";

/** Where the REQUIRED ops-check result comes from. */
export type OpsBundleOpsCheckSource = "stdin" | "file";

/** The validated arguments the CLI hands to the runner. */
export interface OpsBundleArgs {
  /** Where to read the `pdfxyz.ops-check/1` result (default `stdin`). */
  opsCheckSource: OpsBundleOpsCheckSource;
  /** Present iff `opsCheckSource === "file"`: the operator's own file reference (never logged). */
  opsCheckPath?: string;
  /** Present iff `--pipeline` was supplied: the operator's own file reference (never logged). */
  pipelinePath?: string;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered bundle. */
  outputPath?: string;
  /** Output format (default `json`). */
  format: OpsBundleFormat;
  /** Pretty JSON output. Defaults true for stdout JSON; explicit so tests can pin behavior. */
  pretty: boolean;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseOpsBundleArgsResult =
  | { ok: true; kind: "run"; args: OpsBundleArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, OpsBundleFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Human-readable usage, printed on `--help` or a parse error. */
export const OPS_BUNDLE_USAGE = `pdf.xyz secure-worker operations evidence bundle

Composes an operator's OWN content-free tool summaries into one stable, bounded diagnostic
artifact for a support ticket, an incident handoff, a CI artifact, or a scheduled monitor
attachment: the operations healthcheck (worker:ops-check), and — if supplied — the cleanup
evidence pipeline (worker:cleanup-pipeline). It makes NO network call, reads NO provider
export/secret/bucket, deletes nothing, and carries no locator, identifier, timestamp, size,
or byte. It is an AGGREGATOR of existing evidence, not a new proof.

Usage:
  pnpm worker:ops-bundle [ops-check source] [--pipeline=<path>] [format]

Operations input (REQUIRED — the pdfxyz.ops-check/1 result; choose at most one; default: --stdin):
  --stdin                  Read the ops-check result from stdin (e.g. piped from worker:ops-check).
  --ops-check=<path>       Read the ops-check result from a file.
  --operations-file=<path> Alias for --ops-check=<path>.

    Produce it with: pnpm worker:ops-check --runtime --json  (or --web / --file=<snapshot>).
    The result already carries readiness, liveness, subsystem, SLO, cleanup-evidence, and
    lifecycle-verification posture — all as bounded, content-free enums.

Optional composed input:
  --pipeline=<path>     Include a content-free pdfxyz.cleanup-pipeline/1 summary (from
                        pnpm worker:cleanup-pipeline --json). NOT a raw provider export.
                        Absent ⇒ the pipeline section is honestly "not-configured".

Output destination:
  --output=<path>       Write the rendered bundle to a file instead of stdout. The path is never
                        embedded in the bundle or printed on errors.
  --pretty             Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                Stable JSON, suitable for a ticket/CI artifact/SIEM to parse.
  --text                An operator-friendly incident-handoff runbook.

  -h, --help            Show this help.

The composite exit code is the worst of the composed signals. It never fabricates health: an
unreadable required input is a usage error, an absent optional input is honestly not-configured,
and an indeterminate signal is unknown — never a false OK.

Exit codes (higher = worse; 1 is a distinct "the check was misused" band):
  0  OK        — every composed signal is healthy; no action needed
  1  usage     — the CLI was used incorrectly, or the required input was unreadable/malformed
  2  UNKNOWN   — a composed signal is indeterminate (no data / an unreadable optional input)
  3  WARNING   — a composed signal is degraded (a recommended fix is outstanding, or drift)
  4  CRITICAL  — a composed signal is critical (a worker cannot run correctly, or a breach)`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1
    ? { name: token }
    : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/**
 * Parse the ops-bundle argv (already sliced past `node script`). Deterministic and
 * side-effect-free: it validates flags, rejects conflicting sources/formats/duplicate value
 * flags and unknown options, and never reads the environment.
 */
export function parseOpsBundleArgs(
  argv: readonly string[],
): ParseOpsBundleArgsResult {
  let opsCheckPath: string | undefined;
  let explicitStdin = false;
  let pipelinePath: string | undefined;
  let outputPath: string | undefined;
  let format: OpsBundleFormat | undefined;
  let pretty = true;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (name === "--stdin") {
      if (opsCheckPath !== undefined) {
        return {
          ok: false,
          message:
            "Conflicting operations input: --stdin and --ops-check cannot be combined.",
        };
      }
      explicitStdin = true;
      continue;
    }

    if (name === "--pretty") {
      pretty = true;
      continue;
    }

    if (
      name === "--ops-check" ||
      name === "--operations-file" ||
      name === "--pipeline" ||
      name === "--output"
    ) {
      // Value from `--flag=path` or the next argv token (not another flag).
      let value = inlineValue;
      if (value === undefined) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          value = next;
          i += 1;
        }
      }
      if (value === undefined || value === "") {
        return { ok: false, message: `${name} requires a path value.` };
      }
      if (name === "--ops-check" || name === "--operations-file") {
        if (explicitStdin) {
          return {
            ok: false,
            message:
              "Conflicting operations input: --stdin and --ops-check cannot be combined.",
          };
        }
        if (opsCheckPath !== undefined) {
          return { ok: false, message: "Duplicate --ops-check option." };
        }
        opsCheckPath = value;
      } else if (name === "--pipeline") {
        if (pipelinePath !== undefined)
          return { ok: false, message: "Duplicate --pipeline option." };
        pipelinePath = value;
      } else {
        if (outputPath !== undefined)
          return { ok: false, message: "Duplicate --output option." };
        outputPath = value;
      }
      continue;
    }

    if (name in FORMAT_FLAGS) {
      const next = FORMAT_FLAGS[name]!;
      if (format !== undefined && format !== next) {
        return {
          ok: false,
          message: `Conflicting formats: --${format} and ${name} cannot be combined.`,
        };
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
      opsCheckSource: opsCheckPath !== undefined ? "file" : "stdin",
      ...(opsCheckPath !== undefined ? { opsCheckPath } : {}),
      ...(pipelinePath !== undefined ? { pipelinePath } : {}),
      ...(outputPath !== undefined ? { outputPath } : {}),
      format: format ?? "json",
      pretty,
    },
  };
}
