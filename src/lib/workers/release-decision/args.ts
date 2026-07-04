/**
 * Pure, node-free **parser** for the release decision record CLI (`pnpm worker:release-decision`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated {@link ReleaseDecisionArgs} with
 * no side effects, environment reads, or I/O, so every branch (the two inputs, the format, the policy knob, `--help`,
 * and every malformed case) is unit-tested deterministically. The CLI entry (`scripts/worker-release-decision.ts`) is
 * the only place that reads the real `argv`, reads the documents / stdin, writes the output, and exits.
 *
 * Inputs: a REQUIRED `--publish-pack=<path>` (alias `--pack`; the `pdfxyz.release-publish-pack/1` to decide over, `-`
 * for stdin) and a REQUIRED `--ack=<path>` (alias `--acknowledgement`; the `pdfxyz.release-ack/1`, `-` for stdin). At
 * most ONE input may be stdin (a single process has one stdin). No input path is ever echoed.
 */

import type { ReleaseDecisionFormat } from "./render";

/** The stdin sentinel: `--publish-pack=-` or `--ack=-` reads that document from stdin. */
export const STDIN_SENTINEL = "-";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseDecisionArgs {
  /** Output format (default `json`). */
  format: ReleaseDecisionFormat;
  /** Pretty JSON output. Defaults true for stdout JSON; explicit so tests can pin behavior. */
  pretty: boolean;
  /** `--strict`: only a clean `publishable` pack + a clean `accepted` acknowledgement may `proceed`; else escalate to reject. */
  strict: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** The `pdfxyz.release-publish-pack/1` to decide over (a file path, or `-` for stdin). Always present after parse. */
  publishPackPath: string;
  /** The `pdfxyz.release-ack/1` acknowledgement of that pack (a file path, or `-` for stdin). Always present after parse. */
  ackPath: string;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseDecisionArgsResult =
  | { ok: true; kind: "run"; args: ReleaseDecisionArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseDecisionFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set(["--pretty", "--strict"]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set([
  "--output",
  "--publish-pack",
  "--pack",
  "--ack",
  "--acknowledgement",
]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_DECISION_USAGE = `pdf.xyz secure-worker release decision record ledger

Ingests a content-free \`pdfxyz.release-publish-pack/1\` (the Phase 57 publish / handoff pack) AND a
\`pdfxyz.release-ack/1\` (the Phase 58 acknowledgement of it), RE-VALIDATES each against ITSELF (so a hand-flipped
verdict / disclosure / decision is caught as a tamper), CROSS-CHECKS that the acknowledgement corresponds to the
supplied pack, and emits ONE stable, content-free \`pdfxyz.release-decision/1\` record: a bounded decision, per-source
summaries, a coherence cross-check status, and a next-action checklist. It answers ONE question for a release ledger:
"Given this publish pack and this acknowledgement of it, what is the recorded decision — proceed, proceed with a
follow-up, hold, reject, or is the evidence insufficient?"

It is local, offline, and READ-ONLY. It is a decision RECORD ONLY — NOT an external signature, an approval, an
identity attestation, legal / compliance sign-off, an actual deployment / promotion, or a compliance sign-off. It
makes NO network call, reads NO secret / bucket / object, signs / approves / publishes / promotes / deploys / notifies
/ mutates NOTHING, and carries no reviewer name / email, filename, path, object key, bucket, URL, raw ref, raw label,
raw note text, size, digest, raw log, provider error, or byte.

Usage:
  pnpm worker:release-decision --publish-pack=<path> --ack=<path> [options]
  cat publish-pack.json | pnpm worker:release-decision --publish-pack=- --ack=ack.json [options]

Inputs (both required; at most ONE may be \`-\` for stdin):
  --publish-pack=<path>   Ingest this \`pdfxyz.release-publish-pack/1\` (re-validated against itself). Alias: --pack.
                          A value of \`-\` reads the pack from stdin.
  --ack=<path>            Ingest this \`pdfxyz.release-ack/1\` acknowledgement (re-validated against itself, then
                          cross-checked against the pack). Alias: --acknowledgement. A value of \`-\` reads it from stdin.

Policy:
  --strict                Only a clean \`publishable\` (share-safe) pack acknowledged by a clean \`accepted\` decision may
                          PROCEED (exit 0); any follow-up / hold / insufficiency escalates to REJECT (exit 4).
                          Blocking / invalid outcomes are unaffected. Use for a hard "clean proceed or reject" gate.

Output:
  --output=<path>         Write the rendered output to a file instead of stdout. The path is never embedded in the
                          output or printed on errors.
  --pretty                Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                  Stable JSON, suitable for a CI artifact / release ledger / SIEM to parse.
  --text                  A ledger-friendly decision record summary (CI-summary ready).

  -h, --help              Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  PROCEED       — a share-safe pack + a clean acceptance + a matching cross-check
  1  USAGE         — the CLI was misused (a bad flag, a missing document, two stdin inputs, or an unwritable output)
  2  INSUFFICIENT  — an incomplete pack or a deferred acknowledgement (inconclusive evidence)
  3  ADVISORY      — proceed-with-followup (a tracked follow-up) or hold (needs internal review)
  4  REJECT        — a rejected / needs-changes acknowledgement, or a blocked pack
  4  INVALID       — a missing / unreadable / tampered document, or a cross-check mismatch (never a vacuous pass)`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1
    ? { name: token }
    : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/**
 * Parse the release-decision argv (already sliced past `node script`). Deterministic and side-effect-free: it validates
 * flags, rejects conflicting formats / duplicate single-value flags / unknown options / a missing value, requires both
 * a pack and an acknowledgement, rejects two stdin inputs, and never reads the environment or filesystem.
 */
export function parseReleaseDecisionArgs(
  argv: readonly string[],
): ParseReleaseDecisionArgsResult {
  let format: ReleaseDecisionFormat | undefined;
  let pretty = true;
  let strict = false;
  let outputPath: string | undefined;
  let publishPackPath: string | undefined;
  let ackPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (BOOL_FLAGS.has(name)) {
      if (name === "--pretty") pretty = true;
      else if (name === "--strict") strict = true;
      continue;
    }

    if (VALUE_FLAGS.has(name)) {
      // Value from `--flag=value`, or the next argv token — but NOT a following flag. A bare `-` is a valid value
      // (the stdin sentinel), so it is accepted and never treated as a flag.
      let value = inlineValue;
      if (value === undefined) {
        const next = argv[i + 1];
        if (
          next !== undefined &&
          (next === STDIN_SENTINEL || !next.startsWith("-"))
        ) {
          value = next;
          i += 1;
        }
      }
      if (value === undefined || value === "") {
        return { ok: false, message: `${name} requires a value.` };
      }
      switch (name) {
        case "--output":
          if (value === STDIN_SENTINEL)
            return { ok: false, message: "--output cannot be stdin (`-`)." };
          if (outputPath !== undefined)
            return { ok: false, message: "Duplicate --output option." };
          outputPath = value;
          break;
        case "--publish-pack":
        case "--pack":
          if (publishPackPath !== undefined) {
            return {
              ok: false,
              message:
                "Duplicate publish pack (--publish-pack / --pack) option.",
            };
          }
          publishPackPath = value;
          break;
        case "--ack":
        case "--acknowledgement":
          if (ackPath !== undefined) {
            return {
              ok: false,
              message:
                "Duplicate acknowledgement (--ack / --acknowledgement) option.",
            };
          }
          ackPath = value;
          break;
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

  // Both documents are required — a decision needs the pack AND its acknowledgement, and an empty / half invocation must
  // never be a vacuous pass.
  if (publishPackPath === undefined) {
    return {
      ok: false,
      message:
        "A publish pack is required: supply --publish-pack=<path> (or --pack, `-` for stdin).",
    };
  }
  if (ackPath === undefined) {
    return {
      ok: false,
      message:
        "An acknowledgement is required: supply --ack=<path> (or --acknowledgement, `-` for stdin).",
    };
  }
  // A single process has ONE stdin — at most one input may read from it.
  if (publishPackPath === STDIN_SENTINEL && ackPath === STDIN_SENTINEL) {
    return {
      ok: false,
      message:
        "At most one input can be stdin (`-`): supply a file path for the publish pack or the acknowledgement.",
    };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      strict,
      ...(outputPath !== undefined ? { outputPath } : {}),
      publishPackPath,
      ackPath,
    },
  };
}
