/**
 * The pure, node-free **argument parser** for the cleanup evidence exporter CLI
 * (`scripts/worker-cleanup-project.ts`, `pnpm worker:cleanup-project`). Mirrors the other
 * worker parsers: a side-effect-free function over `argv` returning a discriminated union, so
 * the script is a thin shell and every flag rule is unit-tested in isolation. It reads no env,
 * no file, and no clock — a `--now` value is validated to a number here; the real clock is only
 * read by the script when the flag is absent.
 *
 * The parser encodes the tool's SAFETY posture: it is an OFFLINE PROJECTION only. It makes no
 * cloud call and deletes nothing, so `--apply`/`--delete` are explicitly REJECTED with a
 * message that deletion is operator-owned and out-of-band — the same posture as the sweeper.
 */

import {
  PROJECTION_SOURCE_PROVIDERS,
  PROJECTION_TARGETS,
  type ProjectionSourceProvider,
  type ProjectionTarget,
} from "./types";

/** The parsed, validated run configuration the CLI acts on. */
export interface ProjectArgs {
  /** Where the raw provider export JSON is read from. */
  readonly source: "stdin" | "file";
  /** The file path, when `source` is `file`. Read defensively by the script, never logged. */
  readonly filePath?: string;
  /** The bounded target format to project into. */
  readonly target: ProjectionTarget;
  /** The bounded source dialect of the raw export. Defaults to `aws-s3`. */
  readonly provider: ProjectionSourceProvider;
  /**
   * The clock (epoch ms) that absolute `LastModified` instants are bucketed against.
   * `undefined` ⇒ the script fills in the real wall clock; a fixed value makes a run
   * deterministic (used by examples and tests).
   */
  readonly nowMs?: number;
}

/** The result of parsing argv — success (run/help) or a content-free usage error. */
export type ParseProjectArgsResult =
  | { ok: true; kind: "run"; args: ProjectArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** The `--help` text — the single source of truth for the flags and the exit-code ladder. */
export const PROJECT_USAGE = `pdf.xyz storage-artifact cleanup evidence exporter (offline projector) — Phase 43

Project a RAW provider export — your own out-of-band 'aws s3api list-objects-v2' /
'head-object' capture, or a normalized dump — into a bounded, CONTENT-FREE document the
Phase 42 cleanup tools read. It makes NO cloud call, needs NO credentials, and deletes
NOTHING. It reads ONLY a bounded allowlist of fields off each object (a coarse presence,
the decoded {expiresAtMs,deleted} retention evidence, a decoded manifest/kind, and coarse
age/size) and DROPS every other field — object keys, bucket names, signed URLs, endpoints,
regions, account ids, ETags, filenames, and arbitrary user-metadata — so nothing that
identifies an object or its content can survive into the projected output.

Usage:
  pnpm worker:cleanup-project --target=<evidence|inventory> --stdin [options]
  pnpm worker:cleanup-project --target=<evidence|inventory> --file=<path> [options]

Target (required):
  --target=evidence    Project into cleanup-check EVIDENCE ({presence,expiresAtMs?,deleted?,
                       activeDelete?}) for 'pnpm worker:cleanup-check --stdin'.
  --target=inventory   Project into artifact-cleanup INVENTORY (bounded lifecycle/manifest/
                       provider/kind enums + coarse age/size) for 'pnpm worker:artifact-cleanup
                       --stdin'.

Input (exactly one required):
  --stdin              Read the raw export JSON from standard input.
  --file=<path>        Read the raw export JSON from a file.

Options:
  --source=<dialect>   Raw export dialect: aws-s3 (default) or generic (already-normalized
                       field names).
  --now=<epoch-ms|ISO> Clock that absolute LastModified instants are bucketed against
                       (default: now). Pin it to make a projection deterministic.
  --project-provider-export  Accepted no-op; this tool only ever projects a provider export.
  --json               Accepted no-op; the projected document is always JSON.
  --help, -h           Print this help and exit 0.

The projected document embeds a content-free 'receipt' (record counts, dropped-field
counts by category, warnings by bounded reason) that the downstream tool ignores, so you can
save it and pipe it in the same step. Deletion/apply is never performed here.

Exit codes:
  0   projected successfully (usable records, no unsafe condition)
  1   usage / input error (bad flags, or an unreadable / malformed export)
  2   unknown / not enough usable metadata to project (a metadata-thin export)
  4   invalid / unsafe export (a present-but-tombstoned object, or a structurally invalid record)
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

/**
 * Parse the CLI argv (already sliced past `node script`). Pure and total: it never reads env,
 * files, or a clock, and every rejection is a fixed, content-free message that never echoes a
 * value the user passed (a file path could carry a filename).
 */
export function parseProjectArgs(
  argv: readonly string[],
): ParseProjectArgsResult {
  let source: "stdin" | "file" | undefined;
  let filePath: string | undefined;
  let target: ProjectionTarget | undefined;
  let provider: ProjectionSourceProvider | undefined;
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
      case "--target": {
        const value = takeValue();
        const parsed =
          value === null
            ? undefined
            : (PROJECTION_TARGETS as readonly string[]).includes(value)
              ? (value as ProjectionTarget)
              : undefined;
        if (parsed === undefined) {
          return {
            ok: false,
            message: "--target must be one of: evidence, inventory.",
          };
        }
        target = parsed;
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
      case "--project-provider-export":
      case "--json":
        // Accepted no-ops: this tool only ever projects a provider export, and its output is
        // always JSON. Documenting intent explicitly.
        break;
      case "--apply":
      case "--delete":
        return {
          ok: false,
          message:
            "This tool only projects an export offline and never deletes. Object deletion is operator-owned and out-of-band.",
        };
      default:
        // Echo only a `--`-prefixed flag name (safe); a bare positional token could be a file
        // path carrying a filename, so it is never echoed back.
        return {
          ok: false,
          message: name.startsWith("--")
            ? `Unknown argument: ${name}`
            : "Unexpected argument. Pass --target=<evidence|inventory> and --stdin or --file=<path>; see --help.",
        };
    }
  }

  if (target === undefined) {
    return {
      ok: false,
      message:
        "A --target is required: pass --target=evidence or --target=inventory.",
    };
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
      target,
      provider: provider ?? "aws-s3",
      ...(nowMs !== undefined ? { nowMs } : {}),
    },
  };
}
