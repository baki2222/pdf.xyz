import { describe, expect, it } from "vitest";
import { parseOpsBundleArgs } from "./args";

describe("parseOpsBundleArgs", () => {
  it("defaults to stdin + json + pretty when no flags are given", () => {
    const r = parseOpsBundleArgs([]);
    expect(r).toEqual({ ok: true, kind: "run", args: { opsCheckSource: "stdin", format: "json", pretty: true } });
  });

  it("reads --ops-check with an inline value and switches source to file", () => {
    const r = parseOpsBundleArgs(["--ops-check=ops.json"]);
    expect(r).toEqual({
      ok: true,
      kind: "run",
      args: { opsCheckSource: "file", opsCheckPath: "ops.json", format: "json", pretty: true },
    });
  });

  it("accepts --operations-file as an alias for --ops-check", () => {
    const r = parseOpsBundleArgs(["--operations-file=ops.json"]);
    expect(r).toEqual({
      ok: true,
      kind: "run",
      args: { opsCheckSource: "file", opsCheckPath: "ops.json", format: "json", pretty: true },
    });
  });

  it("reads --ops-check with a following-token value", () => {
    const r = parseOpsBundleArgs(["--ops-check", "ops.json", "--text"]);
    expect(r).toEqual({
      ok: true,
      kind: "run",
      args: { opsCheckSource: "file", opsCheckPath: "ops.json", format: "text", pretty: true },
    });
  });

  it("reads an optional --pipeline path alongside stdin", () => {
    const r = parseOpsBundleArgs(["--pipeline=pipe.json"]);
    expect(r).toEqual({
      ok: true,
      kind: "run",
      args: { opsCheckSource: "stdin", pipelinePath: "pipe.json", format: "json", pretty: true },
    });
  });

  it("reads an optional --output destination", () => {
    const r = parseOpsBundleArgs(["--output=bundle.json"]);
    expect(r).toEqual({
      ok: true,
      kind: "run",
      args: { opsCheckSource: "stdin", outputPath: "bundle.json", format: "json", pretty: true },
    });
  });

  it("accepts --stdin and --pretty explicitly", () => {
    const r = parseOpsBundleArgs(["--stdin", "--json", "--pretty"]);
    expect(r).toEqual({ ok: true, kind: "run", args: { opsCheckSource: "stdin", format: "json", pretty: true } });
  });

  it("returns help for -h / --help", () => {
    expect(parseOpsBundleArgs(["-h"])).toEqual({ ok: true, kind: "help" });
    expect(parseOpsBundleArgs(["--help"])).toEqual({ ok: true, kind: "help" });
  });

  it("rejects an unknown option", () => {
    const r = parseOpsBundleArgs(["--nope"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Unknown option: --nope/);
  });

  it("rejects a value flag with no value", () => {
    expect(parseOpsBundleArgs(["--ops-check"]).ok).toBe(false);
    expect(parseOpsBundleArgs(["--pipeline"]).ok).toBe(false);
    expect(parseOpsBundleArgs(["--output"]).ok).toBe(false);
  });

  it("rejects --stdin combined with --ops-check (either order)", () => {
    expect(parseOpsBundleArgs(["--stdin", "--ops-check=o.json"]).ok).toBe(false);
    expect(parseOpsBundleArgs(["--ops-check=o.json", "--stdin"]).ok).toBe(false);
  });

  it("rejects duplicate value flags and conflicting formats", () => {
    expect(parseOpsBundleArgs(["--ops-check=a", "--ops-check=b"]).ok).toBe(false);
    expect(parseOpsBundleArgs(["--pipeline=a", "--pipeline=b"]).ok).toBe(false);
    expect(parseOpsBundleArgs(["--output=a", "--output=b"]).ok).toBe(false);
    expect(parseOpsBundleArgs(["--json", "--text"]).ok).toBe(false);
  });

  it("never surfaces the path value in a conflict/usage message", () => {
    const r = parseOpsBundleArgs(["--ops-check=/secret/customer.pdf", "--stdin"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toContain("customer");
  });
});
