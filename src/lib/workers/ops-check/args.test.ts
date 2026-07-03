// @vitest-environment node
/**
 * Ops-check argv parser proofs. Pure and side-effect-free: it validates flags, defaults
 * the source (`runtime`) and format (`json`), rejects conflicting selectors and unknown
 * options, and surfaces `--help` — every branch deterministic.
 */
import { describe, expect, it } from "vitest";
import { parseOpsCheckArgs } from "./args";

function run(argv: string[]) {
  const r = parseOpsCheckArgs(argv);
  if (r.ok && r.kind === "run") return r.args;
  throw new Error(`expected run, got ${JSON.stringify(r)}`);
}

describe("parseOpsCheckArgs — defaults + sources", () => {
  it("defaults to the runtime source and json format", () => {
    expect(run([])).toEqual({ source: "runtime", format: "json" });
  });

  it("selects --web / --stdin / --runtime", () => {
    expect(run(["--web"]).source).toBe("web");
    expect(run(["--stdin"]).source).toBe("stdin");
    expect(run(["--runtime"]).source).toBe("runtime");
  });

  it("reads --file=<path> and --file <path>", () => {
    expect(run(["--file=snap.json"])).toMatchObject({ source: "file", filePath: "snap.json" });
    expect(run(["--file", "snap.json"])).toMatchObject({ source: "file", filePath: "snap.json" });
  });
});

describe("parseOpsCheckArgs — formats", () => {
  it("selects --json / --prometheus / --text", () => {
    expect(run(["--json"]).format).toBe("json");
    expect(run(["--prometheus"]).format).toBe("prometheus");
    expect(run(["--text"]).format).toBe("text");
  });

  it("combines a source and a format", () => {
    expect(run(["--web", "--prometheus"])).toEqual({ source: "web", format: "prometheus" });
  });
});

describe("parseOpsCheckArgs — help + errors", () => {
  it("returns help for -h / --help", () => {
    expect(parseOpsCheckArgs(["-h"])).toEqual({ ok: true, kind: "help" });
    expect(parseOpsCheckArgs(["--help"])).toEqual({ ok: true, kind: "help" });
  });

  it("rejects conflicting sources", () => {
    const r = parseOpsCheckArgs(["--web", "--stdin"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Conflicting sources/);
  });

  it("rejects conflicting formats", () => {
    const r = parseOpsCheckArgs(["--json", "--prometheus"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Conflicting formats/);
  });

  it("rejects an unknown option", () => {
    const r = parseOpsCheckArgs(["--definitely-not-a-flag"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Unknown option/);
  });

  it("rejects --file with no value", () => {
    const r = parseOpsCheckArgs(["--file"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/--file requires a path/);
  });

  it("treats a repeated identical selector as non-conflicting", () => {
    expect(run(["--web", "--web"]).source).toBe("web");
    expect(run(["--json", "--json"]).format).toBe("json");
  });
});
