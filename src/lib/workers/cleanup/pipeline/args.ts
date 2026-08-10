/**
 * The pure, node-free **argument parser** for the cleanup evidence pipeline CLI
 * (`scripts/worker-cleanup-pipeline.ts`, `pnpm worker:cleanup-pipeline`). Mirrors the other
 * worker parsers: a side-effect-free function over `argv` returning a discriminated union, so
 * the script is a thin shell and every flag rule is unit-tested in isolation. It reads no env,
 * no file, and no clock — a `--now` value is validated to a number here; the real clock is only
 * read by the script when the flag is absent.
 *
 * The parser encodes the tool's SAFETY posture: the pipeline is READ-ONLY and DRY-RUN. It makes
 * no cloud call and deletes nothing, so `--apply`/`--delete` are explicitly REJECTED with a
 * message that deletion is operator-owned and out-of-band — the same posture as the projector
 * and the sweeper it composes.
 */

import {
  PROJECTION_SOURCE_PROVIDERS,
  type ProjectionSourceProvider,
} from "../project/types";
import { DEFAULT_GRACE_HOURS } from "../args";

/** The bounded output format for the composite result. */
export type PipelineFormatArg = "json" | "text";

/** The parsed, validated run configuration the CLI acts on. */
export interface PipelineArgs {
  /** Where the raw provider export JSON is read from. */
  readonly source: "stdin" | "file";
  /** The file path, when `source` is `file`. Read defensively by the script, never logged. */
  readonly filePath?: string;
  /** The bounded source dialect of the raw export, passed to the projector. Defaults to `aws-s3`. */
  readonly provider: ProjectionSourceProvider;
  /** Post-expiry reap grace in hours, passed to the verify arm. Bounded and non-negative. */
  readonly graceHours: number;
  /** Output format for the composite result. Defaults to `json`. */
  readonly format: PipelineFormatArg;
  /**
   * The clock (epoch ms) the arms evaluate retention evidence against. `undefined` ⇒ the script
   * fills in the real wall clock; a fixed value makes a run deterministic (used by tests).
   */
  readonly nowMs?: number;
}

/** The result of parsing argv — success (run/help) or a content-free usage error. */
export type ParsePipelineArgsResult =
  | { ok: true; kind: "run"; args: PipelineArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Bound on the post-expiry reap grace an operator can set (one year — a sanity cap). */
const MAX_GRACE_HOURS = 24 * 365;

/** The `--help` text — the single source of truth for the flags and the exit-code ladder. */
export const PIPELINE_USAGE = `pdf.xyz storage-artifact cleanup evidence pipeline (offline, read-only) — Phase 44

Run the whole cleanup evidence workflow as ONE fail-closed command: read a RAW provider export
you produced out-of-band (your own 'aws s3api list-objects-v2' / 'head-object' capture), PROJECT
it once into the two bounded, CONTENT-FREE Phase 42 shapes, then evaluate both:
  verify  — project into cleanup-check EVIDENCE  -> the absence verifier (worker:cleanup-check)
  sweep   — project into artifact-cleanup INVENTORY -> the dry-run sweeper (worker:artifact-cleanup)
and roll the two arms' exit codes into ONE composite result. It makes NO cloud call, needs NO
credentials, and deletes NOTHING — the raw export is captured out-of-band and any deletion stays
operator-owned and out-of-band. The raw export is read once and projected away (dropping every
object key, bucket, URL, endpoint, region, id, ETag, filename, and user-metadata) before either
arm runs, so nothing that identifies an object or its content can reach the output.

Usage:
  pnpm worker:cleanup-pipeline --stdin [options]        # read the raw export JSON from stdin
  pnpm worker:cleanup-pipeline --file=<path> [options]

Input (exactly one required):
  --stdin              Read the raw provider export JSON from standard input.
  --file=<path>        Read the raw provider export JSON from a file.

Options:
  --source=<dialect>   Raw export dialect: aws-s3 (default) or generic (already-normalized
                       field names). Passed through to the projector.
  --grace-hours=N      Post-expiry reap grace the verify arm tolerates before lingering bytes
                       are judged DRIFT (default ${DEFAULT_GRACE_HOURS}; 0..${MAX_GRACE_HOURS}).
  --now=<epoch-ms|ISO> Clock the arms evaluate retention evidence against (default: now). Pin it
                       to make a run deterministic.
  --json               Emit the composite result as JSON (default).
  --text               Emit a short human-readable summary instead.
  --help, -h           Print this help and exit 0.

The output embeds a content-free 'receipt' (per-arm severity + exit code) safe to log or forward.
Deletion/apply is never performed here.

Exit codes (higher = worse; 1 is a distinct "the pipeline was misused" band):
  0   OK       — both arms clean: absence verified and the dry-run sweep is clean
  1   usage    — the pipeline was misused, or the raw export was unreadable / malformed
  2   unknown  — cleanup could not be proven (a thin export, no wired storage, or unavailable)
  3   drift    — an artifact is present past its retention window + reap grace (page)
  4   breach   — a present-but-tombstoned object, or a structurally unsafe export (page urgently)
`;

/** Split a token into a flag name and an optional inline `=value`. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  if (!token.startsWith("--")) return { name: token };
  const eq = token.indexOf("=");
  if (eq === -1) return { name: token };
  return { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/** Parse a `--now` value: a bare epoch-ms integer, or an ISO-8601 date string. */
function parseNow(raw: string): number | null {
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse and validate a `--grace-hours` value into a bounded non-negative number. */
function parseGraceHours(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > MAX_GRACE_HOURS)
    return null;
  return value;
}

/**
 * Parse the CLI argv (already sliced past `node script`). Pure and total: it never reads env,
 * files, or a clock, and every rejection is a fixed, content-free message that never echoes a
 * value the user passed (a file path could carry a filename).
 */
export function parsePipelineArgs(
  argv: readonly string[],
): ParsePipelineArgsResult {
  let source: "stdin" | "file" | undefined;
  let filePath: string | undefined;
  let provider: ProjectionSourceProvider | undefined;
  let graceHours: number | undefined;
  let format: PipelineFormatArg | undefined;
  let nowMs: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    const { name, inlineValue } = toFlag(token);

    // Consume an inline `=value`, else the next non-flag token, for value flags.
    const takeValue = (): string | null => {
      if (inlineValue !== undefined) return inlineValue;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) return null;
      i += 1;
      return next;
    };

    switch (name) {
      case "--help":
      case "-h":
        return { ok: true, kind: "help" };
      case "--stdin":
        if (source === "file") {
          return {
            ok: false,
            message: "Choose only one input: --stdin or --file.",
          };
        }
        source = "stdin";
        break;
      case "--file": {
        if (source === "stdin") {
          return {
            ok: false,
            message: "Choose only one input: --stdin or --file.",
          };
        }
        const value = takeValue();
        if (value === null || value === "") {
          return { ok: false, message: "--file requires a path." };
        }
        source = "file";
        filePath = value;
        break;
      }
      case "--source": {
        const value = takeValue();
        const parsed =
          value === null
            ? undefined
            : (PROJECTION_SOURCE_PROVIDERS as readonly string[]).includes(value)
              ? (value as ProjectionSourceProvider)
              : undefined;
        if (parsed === undefined) {
          return {
            ok: false,
            message: "--source must be one of: aws-s3, generic.",
          };
        }
        provider = parsed;
        break;
      }
      case "--grace-hours": {
        const value = takeValue();
        if (value === null || value === "") {
          return {
            ok: false,
            message: "--grace-hours requires a numeric value.",
          };
        }
        const parsed = parseGraceHours(value);
        if (parsed === null) {
          return {
            ok: false,
            message: `--grace-hours must be a number in 0..${MAX_GRACE_HOURS}.`,
          };
        }
        graceHours = parsed;
        break;
      }
      case "--now": {
        const value = takeValue();
        if (value === null || value === "") {
          return {
            ok: false,
            message: "--now requires an epoch-ms integer or an ISO-8601 date.",
          };
        }
        const parsed = parseNow(value);
        if (parsed === null) {
          return {
            ok: false,
            message:
              "--now must be an epoch-ms integer or a valid ISO-8601 date.",
          };
        }
        nowMs = parsed;
        break;
      }
      case "--json":
        if (format === "text") {
          return {
            ok: false,
            message: "Choose only one format: --json or --text.",
          };
        }
        format = "json";
        break;
      case "--text":
        if (format === "json") {
          return {
            ok: false,
            message: "Choose only one format: --json or --text.",
          };
        }
        format = "text";
        break;
      case "--apply":
      case "--delete":
        return {
          ok: false,
          message:
            "This pipeline only projects and evaluates an export offline and never deletes. Object deletion is operator-owned and out-of-band.",
        };
      default:
        // Echo only a `--`-prefixed flag name (safe); a bare positional token could be a file
        // path carrying a filename, so it is never echoed back.
        return {
          ok: false,
          message: name.startsWith("--")
            ? `Unknown argument: ${name}`
            : "Unexpected argument. Pass --stdin or --file=<path>; see --help.",
        };
    }
  }

  if (source === undefined) {
    return {
      ok: false,
      message: "An input is required: pass --stdin or --file=<path>.",
    };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      source,
      ...(filePath !== undefined ? { filePath } : {}),
      provider: provider ?? "aws-s3",
      graceHours: graceHours ?? DEFAULT_GRACE_HOURS,
      format: format ?? "json",
      ...(nowMs !== undefined ? { nowMs } : {}),
    },
  };
}
