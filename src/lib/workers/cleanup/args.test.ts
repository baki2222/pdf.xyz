// @vitest-environment node
/**
 * Contract for the cleanup-check CLI arg parser: defaults, source/format selection, the
 * bounded `--grace-hours` knob, conflict detection, `--help`, and unknown-flag rejection.
 * Pure and deterministic — never reads argv or env itself.
 */
import { describe, expect, it } from "vitest";
import { parseCleanupCheckArgs, DEFAULT_GRACE_HOURS } from "./args";

describe("parseCleanupCheckArgs", () => {
  it("defaults to source=none, format=json, the default grace", () => {
    const result = parseCleanupCheckArgs([]);
    expect(result).toEqual({
      ok: true,
      kind: "run",
      args: { source: "none", format: "json", graceHours: DEFAULT_GRACE_HOURS },
    });
  });

  it("selects --stdin and --text", () => {
    const result = parseCleanupCheckArgs(["--stdin", "--text"]);
    expect(result.ok && result.kind === "run" && result.args).toMatchObject({
      source: "stdin",
      format: "text",
    });
  });

  it("selects --file with an inline value", () => {
    const result = parseCleanupCheckArgs(["--file=evidence.json"]);
    expect(result.ok && result.kind === "run" && result.args).toMatchObject({
      source: "file",
      filePath: "evidence.json",
    });
  });

  it("selects --file with a following token", () => {
    const result = parseCleanupCheckArgs(["--file", "e.json", "--prometheus"]);
    expect(result.ok && result.kind === "run" && result.args).toMatchObject({
      source: "file",
      filePath: "e.json",
      format: "prometheus",
    });
  });

  it("parses --grace-hours as a bounded number", () => {
    const result = parseCleanupCheckArgs(["--grace-hours=24"]);
    expect(result.ok && result.kind === "run" && result.args.graceHours).toBe(24);
  });

  it("accepts a fractional grace", () => {
    const result = parseCleanupCheckArgs(["--grace-hours=0.5"]);
    expect(result.ok && result.kind === "run" && result.args.graceHours).toBe(0.5);
  });

  it("accepts a zero grace (strictest)", () => {
    const result = parseCleanupCheckArgs(["--grace-hours=0"]);
    expect(result.ok && result.kind === "run" && result.args.graceHours).toBe(0);
  });

  it("rejects a negative grace", () => {
    const result = parseCleanupCheckArgs(["--grace-hours=-1"]);
    expect(result.ok).toBe(false);
  });

  it("rejects a non-numeric grace", () => {
    const result = parseCleanupCheckArgs(["--grace-hours=soon"]);
    expect(result.ok).toBe(false);
  });

  it("rejects an absurdly large grace", () => {
    const result = parseCleanupCheckArgs(["--grace-hours=100000"]);
    expect(result.ok).toBe(false);
  });

  it("returns help for -h and --help", () => {
    expect(parseCleanupCheckArgs(["-h"])).toEqual({ ok: true, kind: "help" });
    expect(parseCleanupCheckArgs(["--help"])).toEqual({ ok: true, kind: "help" });
  });

  it("rejects conflicting formats", () => {
    const result = parseCleanupCheckArgs(["--json", "--text"]);
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown option", () => {
    const result = parseCleanupCheckArgs(["--wat"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/unknown option/i);
  });

  it("rejects --file with no value", () => {
    const result = parseCleanupCheckArgs(["--file"]);
    expect(result.ok).toBe(false);
  });

  it("is idempotent when the same format flag is repeated", () => {
    const result = parseCleanupCheckArgs(["--json", "--json"]);
    expect(result.ok && result.kind === "run" && result.args.format).toBe("json");
  });
});
