/**
 * Deterministic parser tests for the release-artifact CLI. Cover both run modes, the label
 * validation (charset + redaction-stability), the verify/generate mutual exclusion, and every usage
 * error — without any I/O.
 */

import { describe, expect, it } from "vitest";
import { isValidReleaseLabel, parseReleaseArtifactArgs } from "./args";

function run(argv: string[]) {
  const r = parseReleaseArtifactArgs(argv);
  if (!r.ok || r.kind !== "run") throw new Error("expected a run result");
  return r.args;
}

describe("parseReleaseArtifactArgs — generate mode", () => {
  it("defaults to generate + json + pretty with no flags", () => {
    expect(run([])).toEqual({ mode: "generate", format: "json", pretty: true, noVcs: false });
  });

  it("accepts --text and --pretty", () => {
    expect(run(["--text"]).format).toBe("text");
    expect(run(["--json", "--pretty"]).pretty).toBe(true);
  });

  it("accepts --release-gate / --ops-bundle / --output (inline and spaced)", () => {
    expect(run(["--release-gate=gate.json"]).releaseGatePath).toBe("gate.json");
    expect(run(["--release-gate", "gate.json"]).releaseGatePath).toBe("gate.json");
    expect(run(["--ops-bundle=b.json"]).opsBundlePath).toBe("b.json");
    expect(run(["--output=out.json"]).outputPath).toBe("out.json");
  });

  it("accepts --no-vcs", () => {
    expect(run(["--no-vcs"]).noVcs).toBe(true);
  });

  it("accepts a valid label and records it", () => {
    expect(run(["--label=v1.2.3-rc1"]).label).toBe("v1.2.3-rc1");
    expect(run(["--label", "release_2026.07"]).label).toBe("release_2026.07");
  });

  it("rejects an invalid label without echoing it", () => {
    for (const bad of ["has space", "a/b", "way-too-long".repeat(10), "réaction", "report.pdf", "h_abc123"]) {
      const r = parseReleaseArtifactArgs([`--label=${bad}`]);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) {
        expect(r.message).toMatch(/Invalid --label/);
        expect(r.message).not.toContain(bad);
      }
    }
  });
});

describe("parseReleaseArtifactArgs — verify mode", () => {
  it("switches to verify mode with --verify", () => {
    const args = run(["--verify=artifact.json"]);
    expect(args.mode).toBe("verify");
    expect(args.verifyPath).toBe("artifact.json");
  });

  it("allows format + output flags alongside --verify", () => {
    const args = run(["--verify=a.json", "--text", "--output=o.txt"]);
    expect(args.mode).toBe("verify");
    expect(args.format).toBe("text");
    expect(args.outputPath).toBe("o.txt");
  });

  it("rejects --verify combined with any generate-only flag", () => {
    for (const flag of ["--release-gate=g.json", "--ops-bundle=b.json", "--label=x", "--no-vcs"]) {
      const r = parseReleaseArtifactArgs(["--verify=a.json", flag]);
      expect(r.ok, flag).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/--verify cannot be combined/);
    }
  });
});

describe("parseReleaseArtifactArgs — help and usage errors", () => {
  it("returns help for -h/--help", () => {
    expect(parseReleaseArtifactArgs(["--help"])).toEqual({ ok: true, kind: "help" });
    expect(parseReleaseArtifactArgs(["-h"])).toEqual({ ok: true, kind: "help" });
  });

  it("rejects an unknown option", () => {
    const r = parseReleaseArtifactArgs(["--nope"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Unknown option/);
  });

  it("rejects conflicting formats", () => {
    const r = parseReleaseArtifactArgs(["--json", "--text"]);
    expect(r.ok).toBe(false);
  });

  it("rejects duplicate value flags", () => {
    for (const argv of [
      ["--output=a", "--output=b"],
      ["--release-gate=a", "--release-gate=b"],
      ["--ops-bundle=a", "--ops-bundle=b"],
      ["--label=a", "--label=b"],
      ["--verify=a", "--verify=b"],
    ]) {
      const r = parseReleaseArtifactArgs(argv);
      expect(r.ok, argv.join(" ")).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/Duplicate/);
    }
  });

  it("rejects a value flag with no value", () => {
    const r = parseReleaseArtifactArgs(["--output"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/requires a value/);
  });
});

describe("isValidReleaseLabel", () => {
  it("accepts bounded, redaction-stable labels", () => {
    for (const ok of ["v1.2.3", "rc1", "2026-07-03", "release_2026.07", "A.B-c_1"]) {
      expect(isValidReleaseLabel(ok), ok).toBe(true);
    }
  });

  it("rejects out-of-charset or redaction-unstable labels", () => {
    for (const bad of ["has space", "a/b", "x".repeat(65), "café", "invoice.pdf", "h_token123"]) {
      expect(isValidReleaseLabel(bad), bad).toBe(false);
    }
  });
});
