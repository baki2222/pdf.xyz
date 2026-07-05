import { describe, expect, it } from "vitest";
import { parseReleaseDecisionCloseoutGovernanceIndexArgs } from "./args";
import { DEFAULT_MAX_GOVERNANCE } from "./types";

function run(argv: string[]) {
  const r = parseReleaseDecisionCloseoutGovernanceIndexArgs(argv);
  if (r.ok && r.kind === "run") return r.args;
  throw new Error(`expected run, got ${JSON.stringify(r)}`);
}

describe("parseReleaseDecisionCloseoutGovernanceIndexArgs — inputs", () => {
  it("repeated --file / --governance builds the ordered history", () => {
    expect(run(["--file=a", "--governance=b", "--file=c"]).governancePaths).toEqual(["a", "b", "c"]);
  });

  it("--stdin reads the history from stdin", () => {
    const a = run(["--stdin"]);
    expect(a.stdin).toBe(true);
    expect(a.governancePaths).toBeUndefined();
  });

  it("requires at least one input mode", () => {
    const r = parseReleaseDecisionCloseoutGovernanceIndexArgs([]);
    expect(r.ok).toBe(false);
  });

  it("rejects --stdin combined with --file", () => {
    const r = parseReleaseDecisionCloseoutGovernanceIndexArgs(["--stdin", "--file=a"]);
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/cannot be combined/) });
  });
});

describe("parseReleaseDecisionCloseoutGovernanceIndexArgs — policy knobs", () => {
  it("defaults: max-governance=100, thresholds=0, no strict-open, json/pretty", () => {
    const a = run(["--file=a"]);
    expect(a).toMatchObject({
      maxGovernance: DEFAULT_MAX_GOVERNANCE,
      maxOpen: 0,
      maxIncomplete: 0,
      maxBlocked: 0,
      strictOpen: false,
      format: "json",
      pretty: true,
    });
  });

  it("--max-governance requires a positive integer", () => {
    expect(run(["--file=a", "--max-governance=5"]).maxGovernance).toBe(5);
    expect(parseReleaseDecisionCloseoutGovernanceIndexArgs(["--file=a", "--max-governance=0"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutGovernanceIndexArgs(["--file=a", "--max-governance=-1"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutGovernanceIndexArgs(["--file=a", "--max-governance=x"]).ok).toBe(false);
  });

  it("--max-open / --max-incomplete / --max-blocked accept a NON-negative integer (0 allowed)", () => {
    const a = run(["--file=a", "--max-open=2", "--max-incomplete=0", "--max-blocked=3"]);
    expect(a).toMatchObject({ maxOpen: 2, maxIncomplete: 0, maxBlocked: 3 });
    expect(parseReleaseDecisionCloseoutGovernanceIndexArgs(["--file=a", "--max-open=-1"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutGovernanceIndexArgs(["--file=a", "--max-blocked=x"]).ok).toBe(false);
  });

  it("--strict-open, --text, --output are parsed", () => {
    const a = run(["--file=a", "--strict-open", "--text", "--output=/o"]);
    expect(a).toMatchObject({ strictOpen: true, format: "text", outputPath: "/o" });
  });

  it("--output cannot be stdin, duplicate --output is rejected, unknown flag is rejected", () => {
    expect(parseReleaseDecisionCloseoutGovernanceIndexArgs(["--file=a", "--output=-"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutGovernanceIndexArgs(["--file=a", "--output=x", "--output=y"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutGovernanceIndexArgs(["--file=a", "--nope"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutGovernanceIndexArgs(["--file=a", "--json", "--text"]).ok).toBe(false);
  });
});

describe("parseReleaseDecisionCloseoutGovernanceIndexArgs — help", () => {
  it("-h / --help returns the help kind", () => {
    expect(parseReleaseDecisionCloseoutGovernanceIndexArgs(["-h"])).toEqual({ ok: true, kind: "help" });
    expect(parseReleaseDecisionCloseoutGovernanceIndexArgs(["--help"])).toEqual({ ok: true, kind: "help" });
  });
});
