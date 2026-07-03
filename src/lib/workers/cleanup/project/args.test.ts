// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseProjectArgs } from "./args";

/** Assert a successful run parse and return the args. */
function run(argv: string[]): Extract<ReturnType<typeof parseProjectArgs>, { kind: "run" }>["args"] {
  const parsed = parseProjectArgs(argv);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok || parsed.kind !== "run") throw new Error("expected a run parse");
  return parsed.args;
}

describe("parseProjectArgs", () => {
  it("requires a --target", () => {
    const parsed = parseProjectArgs(["--stdin"]);
    expect(parsed).toEqual({ ok: false, message: expect.stringContaining("--target is required") });
  });

  it("requires an input source", () => {
    const parsed = parseProjectArgs(["--target=evidence"]);
    expect(parsed).toEqual({ ok: false, message: expect.stringContaining("input is required") });
  });

  it("parses the canonical evidence-from-stdin invocation with defaults", () => {
    expect(run(["--target=evidence", "--stdin"])).toEqual({
      source: "stdin",
      target: "evidence",
      provider: "aws-s3",
    });
  });

  it("parses inventory from a file with a generic source and a fixed clock", () => {
    expect(run(["--target", "inventory", "--file=/tmp/x.json", "--source=generic", "--now=1700000000000"])).toEqual({
      source: "file",
      filePath: "/tmp/x.json",
      target: "inventory",
      provider: "generic",
      nowMs: 1_700_000_000_000,
    });
  });

  it("accepts an ISO --now and the affirmation no-ops", () => {
    const args = run(["--target=evidence", "--stdin", "--project-provider-export", "--json", "--now=2023-11-14T00:00:00Z"]);
    expect(args.nowMs).toBe(Date.parse("2023-11-14T00:00:00Z"));
  });

  it("rejects an unknown --target value", () => {
    const parsed = parseProjectArgs(["--target=bogus", "--stdin"]);
    expect(parsed).toEqual({ ok: false, message: expect.stringContaining("evidence, inventory") });
  });

  it("rejects an unknown --source value", () => {
    const parsed = parseProjectArgs(["--target=evidence", "--stdin", "--source=gcs"]);
    expect(parsed).toEqual({ ok: false, message: expect.stringContaining("aws-s3, generic") });
  });

  it("rejects conflicting inputs", () => {
    const parsed = parseProjectArgs(["--target=evidence", "--stdin", "--file=/tmp/x"]);
    expect(parsed).toEqual({ ok: false, message: expect.stringContaining("only one input") });
  });

  it("refuses --apply / --delete with an out-of-band deletion message", () => {
    for (const flag of ["--apply", "--delete"]) {
      const parsed = parseProjectArgs(["--target=inventory", "--stdin", flag]);
      expect(parsed).toEqual({ ok: false, message: expect.stringContaining("operator-owned and out-of-band") });
    }
  });

  it("shows help on -h / --help", () => {
    for (const flag of ["-h", "--help"]) {
      expect(parseProjectArgs([flag])).toEqual({ ok: true, kind: "help" });
    }
  });

  it("never echoes a bare positional token (which could carry a filename)", () => {
    const parsed = parseProjectArgs(["--target=evidence", "secret-file.json"]);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).not.toContain("secret-file");
  });
});
