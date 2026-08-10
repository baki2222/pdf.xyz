/**
 * The pure, node-free **argument parser** for the artifact cleanup-verifier CLI
 * (`scripts/worker-artifact-cleanup.ts`). Mirrors the daemon/ops-check parsers: a
 * side-effect-free function over `argv` returning a discriminated union, so the script is
 * a thin shell and every flag rule is unit-tested in isolation. It reads no env, no file,
 * and no clock — the `--now` value is validated to a number here and the real clock is
 * only ever read by the script when the flag is absent.
 *
 * The parser encodes the tool's SAFETY posture: it is dry-run only. There is no
 * apply/delete flag; `--apply`/`--delete` are explicitly REJECTED with a message that
 * production deletion is operator-owned and out-of-band, so the safe default can never be
 * flipped by a flag.
 */

/** The parsed, validated run configuration the CLI acts on. */
export interface ArtifactCleanupArgs {
  /** Where the inventory JSON is read from. */
  readonly source: "stdin" | "file";
  /** The file path, when `source` is `file`. Read defensively by the script, never logged. */
  readonly filePath?: string;
  /** Output format. Defaults to `json` (stable, machine-readable). */
  readonly format: "json" | "text";
  /** Include the reconciliation plan section. */
  readonly includePlan: boolean;
  /** Include the descriptive breakdown tallies. */
  readonly includeBreakdown: boolean;
  /** Include the derived, content-free metric samples. */
  readonly includeMetrics: boolean;
  /**
   * The clock (epoch ms) lifecycle evidence is evaluated against. `undefined` ⇒ the
   * script fills in the real wall clock; a fixed value makes a run deterministic.
   */
  readonly nowMs?: number;
}

/** The result of parsing argv — success (run/help) or a content-free usage error. */
export type ParseArtifactCleanupResult =
  | { ok: true; kind: "run"; args: ArtifactCleanupArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** The `--help` text — also the single source of truth for the exit-code ladder. */
export const ARTIFACT_CLEANUP_USAGE = `pdf.xyz storage-artifact cleanup verifier (dry-run sweeper) — Phase 42

Evaluate a bounded, OFFLINE, content-free inventory of storage-artifact object
metadata and report expired/stale/orphaned/tombstoned artifacts. It reads NO real
bucket, contacts NO cloud API, and NEVER deletes anything: object deletion stays
operator-owned and out-of-band. Build the inventory by projecting your own
'aws s3api list-objects-v2' + 'head-object' output into the content-free record shape
(bounded lifecycle/manifest/provider/kind enums + the decoded {expiresAtMs,deleted}
retention evidence + coarse age/size), never raw keys, names, or bytes.

Usage:
  pnpm worker:artifact-cleanup --stdin [options]      # read inventory JSON from stdin
  pnpm worker:artifact-cleanup --file=<path> [options]

Input (exactly one required):
  --stdin              Read the inventory JSON document from standard input.
  --file=<path>        Read the inventory JSON document from a file.

Output:
  --json               Stable machine-readable JSON (default).
  --text               Human-readable summary.
  --plan               Include the content-free cleanup plan (counts + actions only).
  --breakdown          Include descriptive tallies (provider/kind/processor/age/size).
  --metrics            Include the derived, content-free metric samples.

Evaluation:
  --now=<epoch-ms|ISO> Clock to evaluate lifecycle evidence against (default: now).

Other:
  --dry-run            No-op; this tool is always dry-run.
  --help, -h           Print this help and exit 0.

Exit codes:
  0   no cleanup or drift found (all artifacts live with complete, healthy metadata)
  1   usage / input error
  2   unknown / not enough evidence (missing lifecycle or manifest, not-configured)
  3   cleanup recommended / warning drift (expired-but-present artifacts to sweep)
  4   invalid / breached policy (tombstoned-but-present objects or invalid records)
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
 * Parse the CLI argv (already sliced past `node script`). Pure and total: it never reads
 * env, files, or a clock, and every rejection is a fixed, content-free message that never
 * echoes a value the user passed (a file path could carry a filename).
 */
export function parseArtifactCleanupArgs(
  argv: readonly string[],
): ParseArtifactCleanupResult {
  let source: "stdin" | "file" | undefined;
  let filePath: string | undefined;
  let format: "json" | "text" | undefined;
  let includePlan = false;
  let includeBreakdown = false;
  let includeMetrics = false;
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
      case "--json":
        if (format === "text") {
          return {
            ok: false,
            message: "Choose only one output format: --json or --text.",
          };
        }
        format = "json";
        break;
      case "--text":
        if (format === "json") {
          return {
            ok: false,
            message: "Choose only one output format: --json or --text.",
          };
        }
        format = "text";
        break;
      case "--plan":
        includePlan = true;
        break;
      case "--breakdown":
        includeBreakdown = true;
        break;
      case "--metrics":
        includeMetrics = true;
        break;
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
      case "--dry-run":
        // Accepted no-op: this tool is always dry-run. Documents intent explicitly.
        break;
      case "--apply":
      case "--delete":
        return {
          ok: false,
          message:
            "This tool is dry-run only and never deletes. Object deletion is operator-owned and out-of-band.",
        };
      default:
        // Echo only a `--`-prefixed flag name (safe); a bare positional token could be a
        // file path carrying a filename, so it is never echoed back.
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
      format: format ?? "json",
      includePlan,
      includeBreakdown,
      includeMetrics,
      ...(nowMs !== undefined ? { nowMs } : {}),
    },
  };
}
