import { describe, expect, it } from "vitest";
import { parseReleaseDecisionCloseoutIndexArgs } from "./args";
import { DEFAULT_MAX_CLOSEOUTS } from "./types";

function run(argv: string[]) {
  const r = parseReleaseDecisionCloseoutIndexArgs(argv);
  if (r.ok && r.kind === "run") return r.args;
  throw new Error(`expected run, got ${JSON.stringify(r)}`);
}

describe("parseReleaseDecisionCloseoutIndexArgs — inputs", () => {
  it("repeated --file / --closeout builds the ordered history", () => {
    expect(run(["--file=a", "--closeout=b", "--file=c"]).closeoutPaths).toEqual(["a", "b", "c"]);
  });

  it("--stdin reads the history from stdin", () => {
    const a = run(["--stdin"]);
    expect(a.stdin).toBe(true);
    expect(a.closeoutPaths).toBeUndefined();
  });

  it("requires at least one input mode", () => {
    const r = parseReleaseDecisionCloseoutIndexArgs([]);
    expect(r.ok).toBe(false);
  });

  it("rejects --stdin combined with --file", () => {
    const r = parseReleaseDecisionCloseoutIndexArgs(["--stdin", "--file=a"]);
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/cannot be combined/) });
  });
});

describe("parseReleaseDecisionCloseoutIndexArgs — policy knobs", () => {
  it("defaults: max-closeouts=100, thresholds=0, no strict-open, json/pretty", () => {
    const a = run(["--file=a"]);
    expect(a).toMatchObject({
      maxCloseouts: DEFAULT_MAX_CLOSEOUTS,
      maxOpen: 0,
      maxIncomplete: 0,
      maxBlocked: 0,
      strictOpen: false,
      format: "json",
      pretty: true,
    });
  });

  it("--max-closeouts requires a positive integer", () => {
    expect(run(["--file=a", "--max-closeouts=5"]).maxCloseouts).toBe(5);
    expect(parseReleaseDecisionCloseoutIndexArgs(["--file=a", "--max-closeouts=0"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutIndexArgs(["--file=a", "--max-closeouts=-1"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutIndexArgs(["--file=a", "--max-closeouts=x"]).ok).toBe(false);
  });

  it("--max-open / --max-incomplete / --max-blocked accept a NON-negative integer (0 allowed)", () => {
    const a = run(["--file=a", "--max-open=2", "--max-incomplete=0", "--max-blocked=3"]);
    expect(a).toMatchObject({ maxOpen: 2, maxIncomplete: 0, maxBlocked: 3 });
    expect(parseReleaseDecisionCloseoutIndexArgs(["--file=a", "--max-open=-1"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutIndexArgs(["--file=a", "--max-blocked=x"]).ok).toBe(false);
  });

  it("--strict-open, --text, --output are parsed", () => {
    const a = run(["--file=a", "--strict-open", "--text", "--output=/o"]);
    expect(a).toMatchObject({ strictOpen: true, format: "text", outputPath: "/o" });
  });

  it("--output cannot be stdin, duplicate --output is rejected, unknown flag is rejected", () => {
    expect(parseReleaseDecisionCloseoutIndexArgs(["--file=a", "--output=-"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutIndexArgs(["--file=a", "--output=x", "--output=y"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutIndexArgs(["--file=a", "--nope"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutIndexArgs(["--file=a", "--json", "--text"]).ok).toBe(false);
  });
});

describe("parseReleaseDecisionCloseoutIndexArgs — help", () => {
  it("-h / --help returns the help kind", () => {
    expect(parseReleaseDecisionCloseoutIndexArgs(["-h"])).toEqual({ ok: true, kind: "help" });
    expect(parseReleaseDecisionCloseoutIndexArgs(["--help"])).toEqual({ ok: true, kind: "help" });
  });
});
