/**
 * Pure, node-free **parser** for the release evidence handoff acknowledgement CLI (`pnpm worker:release-ack`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated {@link ReleaseAckArgs} with no
 * side effects, environment reads, or I/O, so every branch (the pack input, the required decision, the optional
 * reviewer / note classes, the format, the policy knob, `--help`, and every malformed case) is unit-tested
 * deterministically. The CLI entry (`scripts/worker-release-ack.ts`) is the only place that reads the real `argv`,
 * reads the pack / stdin, writes the output, and exits.
 *
 * Inputs: a REQUIRED `--publish-pack=<path>` (alias `--pack=<path>`; the `pdfxyz.release-publish-pack/1` to
 * acknowledge, `-` for stdin) and a REQUIRED `--decision=<enum>`. No input path is ever echoed.
 */

import {
  RELEASE_ACK_DECISIONS,
  RELEASE_ACK_NOTES,
  RELEASE_ACK_REVIEWERS,
  type ReleaseAckDecision,
  type ReleaseAckNote,
  type ReleaseAckReviewer,
} from "./types";
import type { ReleaseAckFormat } from "./render";

/** The stdin sentinel: `--publish-pack=-` reads the pack from stdin. */
export const STDIN_SENTINEL = "-";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseAckArgs {
  /** Output format (default `json`). */
  format: ReleaseAckFormat;
  /** Pretty JSON output. Defaults true for stdout JSON; explicit so tests can pin behavior. */
  pretty: boolean;
  /** The required acknowledgement decision. */
  decision: ReleaseAckDecision;
  /** The reviewer CLASS (a role, never an identity). Defaults `unknown`. */
  reviewer: ReleaseAckReviewer;
  /** The note CLASS (a follow-up category, never free text). Defaults `none`. */
  note: ReleaseAckNote;
  /** `--strict`: only an `accepted` decision over a `publishable` pack may pass; anything else escalates to rejected. */
  strict: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** The `pdfxyz.release-publish-pack/1` to acknowledge (a file path, or `-` for stdin). Always present after parse. */
  publishPackPath: string;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseAckArgsResult =
  | { ok: true; kind: "run"; args: ReleaseAckArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseAckFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set(["--pretty", "--strict"]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set(["--output", "--publish-pack", "--pack", "--decision", "--reviewer", "--note"]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_ACK_USAGE = `pdf.xyz secure-worker release evidence handoff acknowledgement receipt

Ingests a content-free \`pdfxyz.release-publish-pack/1\` (the Phase 57 publish / handoff pack), RE-VALIDATES it against
ITSELF (so a hand-flipped verdict / disclosure is caught as a tamper), applies a bounded acknowledgement DECISION you
supply, and emits ONE stable, content-free \`pdfxyz.release-ack/1\` RECEIPT: an acknowledgement verdict, a bounded
source summary (the pack's own verdict / disclosure / source counts), the recorded decision + reviewer class + note
class, and a next-action checklist. It answers ONE question for a handoff record: "This publish pack was reviewed /
received — what bounded outcome was chosen, and what happens next?"

It is local, offline, and READ-ONLY. It is an acknowledgement RECEIPT ONLY — NOT an external signature, an approval,
an identity attestation, legal / compliance sign-off, or a release promotion. It makes NO network call, reads NO
secret / bucket / object, signs / approves / publishes / promotes / notifies / deletes / mutates NOTHING, and carries
no reviewer name / email, filename, path, object key, bucket, URL, raw ref, raw label, raw note text, size, digest,
raw log, provider error, or byte. The reviewer is a bounded CLASS (a role), never an identity.

Usage:
  pnpm worker:release-ack --publish-pack=<path> --decision=<decision> [options]
  cat publish-pack.json | pnpm worker:release-ack --publish-pack=- --decision=accepted [options]

Inputs (both required):
  --publish-pack=<path>   Ingest this \`pdfxyz.release-publish-pack/1\` (re-validated against itself). Alias: --pack.
                          A value of \`-\` reads the pack from stdin.
  --decision=<decision>   The bounded acknowledgement decision. One of:
                            accepted             — reviewed / received and accepted as-is (no follow-up)
                            accepted-with-notes  — accepted with a recorded follow-up to track
                            needs-changes        — not acceptable as-is; changes required (a block)
                            rejected             — rejected (a block)
                            deferred             — decision postponed

Optional (bounded classes — never raw identity or free text):
  --reviewer=<class>      Who acknowledged, as a ROLE (default unknown): internal-approver | external-reviewer |
                          incident-responder | partner | unknown.
  --note=<class>          A follow-up CATEGORY (default none): none | operational-follow-up | evidence-gap |
                          policy-follow-up | legal-review | security-review.
  --strict                Only an \`accepted\` decision over a \`publishable\` (share-safe) pack may pass (exit 0); any
                          follow-up / deferral / incomplete pack escalates to REJECTED (exit 4). Blocking / invalid
                          outcomes are unaffected. Use for a hard "clean acceptance or reject" gate.

Output:
  --output=<path>         Write the rendered output to a file instead of stdout. The path is never embedded in the
                          output or printed on errors.
  --pretty                Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                  Stable JSON, suitable for a CI artifact / handoff record / SIEM to parse.
  --text                  A handoff-friendly acknowledgement summary (CI-summary ready).

  -h, --help              Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  ACKNOWLEDGED               — an \`accepted\` decision over a share-safe pack, no follow-up
  1  USAGE                      — the CLI was misused (a bad flag, no pack, a missing / duplicate decision, or an
                                  unwritable output)
  2  DEFERRED                   — a deferred decision, or an incomplete pack (insufficient)
  3  ACKNOWLEDGED WITH FOLLOW-UP— accepted with a recorded follow-up (accepted-with-notes / a review pack / a note)
  4  REJECTED                   — rejected / needs-changes / a blocked pack / a strict violation
  4  INVALID                    — a missing / unreadable / tampered pack (the input can't be trusted)`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/** Return `value` if it is one of `allowed`, else `undefined`. */
function oneOf<T extends string>(value: string, allowed: readonly T[]): T | undefined {
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * Parse the release-ack argv (already sliced past `node script`). Deterministic and side-effect-free: it validates
 * flags, rejects conflicting formats / duplicate single-value flags / unknown options / a missing value / an
 * off-enum decision / reviewer / note, requires a pack + a decision, and never reads the environment or filesystem.
 */
export function parseReleaseAckArgs(argv: readonly string[]): ParseReleaseAckArgsResult {
  let format: ReleaseAckFormat | undefined;
  let pretty = true;
  let strict = false;
  let outputPath: string | undefined;
  let publishPackPath: string | undefined;
  let decision: ReleaseAckDecision | undefined;
  let reviewer: ReleaseAckReviewer | undefined;
  let note: ReleaseAckNote | undefined;

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
        if (next !== undefined && (next === STDIN_SENTINEL || !next.startsWith("-"))) {
          value = next;
          i += 1;
        }
      }
      if (value === undefined || value === "") {
        return { ok: false, message: `${name} requires a value.` };
      }
      switch (name) {
        case "--output":
          if (value === STDIN_SENTINEL) return { ok: false, message: "--output cannot be stdin (`-`)." };
          if (outputPath !== undefined) return { ok: false, message: "Duplicate --output option." };
          outputPath = value;
          break;
        case "--publish-pack":
        case "--pack":
          if (publishPackPath !== undefined) {
            return { ok: false, message: "Duplicate publish pack (--publish-pack / --pack) option." };
          }
          publishPackPath = value;
          break;
        case "--decision": {
          if (decision !== undefined) return { ok: false, message: "Duplicate --decision option." };
          const d = oneOf(value, RELEASE_ACK_DECISIONS);
          if (d === undefined) {
            return { ok: false, message: `Invalid --decision: ${value}. One of: ${RELEASE_ACK_DECISIONS.join(", ")}.` };
          }
          decision = d;
          break;
        }
        case "--reviewer": {
          if (reviewer !== undefined) return { ok: false, message: "Duplicate --reviewer option." };
          const r = oneOf(value, RELEASE_ACK_REVIEWERS);
          if (r === undefined) {
            return { ok: false, message: `Invalid --reviewer: ${value}. One of: ${RELEASE_ACK_REVIEWERS.join(", ")}.` };
          }
          reviewer = r;
          break;
        }
        case "--note": {
          if (note !== undefined) return { ok: false, message: "Duplicate --note option." };
          const n = oneOf(value, RELEASE_ACK_NOTES);
          if (n === undefined) {
            return { ok: false, message: `Invalid --note: ${value}. One of: ${RELEASE_ACK_NOTES.join(", ")}.` };
          }
          note = n;
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

  // The publish pack is required — there is nothing to acknowledge without one, and an empty invocation must never be
  // a vacuous pass.
  if (publishPackPath === undefined) {
    return { ok: false, message: "A publish pack is required: supply --publish-pack=<path> (or --pack, `-` for stdin)." };
  }
  // The decision is required — the acknowledgement is meaningless without an operator's bounded stance.
  if (decision === undefined) {
    return {
      ok: false,
      message: `A decision is required: supply --decision=<${RELEASE_ACK_DECISIONS.join("|")}>.`,
    };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      decision,
      reviewer: reviewer ?? "unknown",
      note: note ?? "none",
      strict,
      ...(outputPath !== undefined ? { outputPath } : {}),
      publishPackPath,
    },
  };
}
