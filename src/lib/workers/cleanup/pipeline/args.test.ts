// @vitest-environment node
/**
 * Unit proofs for the pipeline CLI arg parser: defaults, each flag, the fail-closed rejection of
 * `--apply`/`--delete`, and the content-free error messages (a rejected bare positional — which
 * could be a file path carrying a filename — is never echoed back).
 */
import { describe, expect, it } from "vitest";
import { parsePipelineArgs, PIPELINE_USAGE } from "./index";
import { DEFAULT_GRACE_HOURS } from "../args";

/** Narrow to the run branch (fails the test if it is not a run). */
function run(argv: string[]) {
  const parsed = parsePipelineArgs(argv);
  if (!parsed.ok || parsed.kind !== "run") {
    throw new Error(`expected a run, got ${JSON.stringify(parsed)}`);
  }
  return parsed.args;
}

describe("parsePipelineArgs", () => {
  it("--help / -h returns help", () => {
    for (const flag of ["--help", "-h"]) {
      const parsed = parsePipelineArgs([flag]);
      expect(parsed.ok && parsed.kind).toBe("help");
    }
  });

  it("defaults: aws-s3 dialect, default grace, json format", () => {
    const args = run(["--stdin"]);
    expect(args.source).toBe("stdin");
    expect(args.provider).toBe("aws-s3");
    expect(args.graceHours).toBe(DEFAULT_GRACE_HOURS);
    expect(args.format).toBe("json");
    expect(args.nowMs).toBeUndefined();
  });

  it("reads a file source and never requires the file to exist here", () => {
    const args = run(["--file=/some/export.json"]);
    expect(args.source).toBe("file");
    expect(args.filePath).toBe("/some/export.json");
  });

  it("accepts the bounded dialect, grace, format, and clock flags", () => {
    const args = run([
      "--stdin",
      "--source=generic",
      "--grace-hours=12",
      "--text",
      "--now=1700000000000",
    ]);
    expect(args.provider).toBe("generic");
    expect(args.graceHours).toBe(12);
    expect(args.format).toBe("text");
    expect(args.nowMs).toBe(1700000000000);
  });

  it("parses --now from an ISO date", () => {
    const args = run(["--stdin", "--now=2026-01-02T03:04:05Z"]);
    expect(args.nowMs).toBe(Date.parse("2026-01-02T03:04:05Z"));
  });

  it("requires an input", () => {
    const parsed = parsePipelineArgs(["--source=generic"]);
    expect(parsed.ok).toBe(false);
  });

  it("rejects conflicting inputs and formats", () => {
    expect(parsePipelineArgs(["--stdin", "--file=x.json"]).ok).toBe(false);
    expect(parsePipelineArgs(["--stdin", "--json", "--text"]).ok).toBe(false);
  });

  it("rejects an out-of-enum dialect and a bad grace value", () => {
    expect(parsePipelineArgs(["--stdin", "--source=gcs"]).ok).toBe(false);
    expect(parsePipelineArgs(["--stdin", "--grace-hours=nope"]).ok).toBe(false);
    expect(parsePipelineArgs(["--stdin", "--grace-hours=-1"]).ok).toBe(false);
  });

  it("fails closed on --apply / --delete: deletion is out-of-band", () => {
    for (const flag of ["--apply", "--delete"]) {
      const parsed = parsePipelineArgs(["--stdin", flag]);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.message).toMatch(/out-of-band/i);
    }
  });

  it("echoes an unknown --flag name but never a bare positional (could be a filename)", () => {
    const unknown = parsePipelineArgs(["--frobnicate", "--stdin"]);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.message).toContain("--frobnicate");

    const positional = parsePipelineArgs(["Bank-Statement.pdf"]);
    expect(positional.ok).toBe(false);
    if (!positional.ok) {
      expect(positional.message).not.toContain("Bank-Statement");
      expect(positional.message.toLowerCase()).not.toContain(".pdf");
    }
  });

  it("the usage text documents the exit ladder and the read-only posture", () => {
    expect(PIPELINE_USAGE).toMatch(/Exit codes/);
    expect(PIPELINE_USAGE).toMatch(/0\s+OK/);
    expect(PIPELINE_USAGE).toMatch(/4\s+breach/);
    expect(PIPELINE_USAGE).toMatch(/deletes NOTHING/i);
  });
});
