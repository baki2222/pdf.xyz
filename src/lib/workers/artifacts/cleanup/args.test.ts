// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseArtifactCleanupArgs, type ArtifactCleanupArgs } from "./args";

/** Assert a run parse and return its args. */
function run(argv: string[]): ArtifactCleanupArgs {
  const parsed = parseArtifactCleanupArgs(argv);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok || parsed.kind !== "run") throw new Error("expected a run");
  return parsed.args;
}

/** Assert a rejection and return its message. */
function reject(argv: string[]): string {
  const parsed = parseArtifactCleanupArgs(argv);
  expect(parsed.ok).toBe(false);
  if (parsed.ok) throw new Error("expected a rejection");
  return parsed.message;
}

describe("parseArtifactCleanupArgs", () => {
  it("--help / -h yields help", () => {
    for (const flag of ["--help", "-h"]) {
      const parsed = parseArtifactCleanupArgs([flag]);
      expect(parsed).toEqual({ ok: true, kind: "help" });
    }
  });

  it("defaults to json output with no optional sections", () => {
    expect(run(["--stdin"])).toEqual({
      source: "stdin",
      format: "json",
      includePlan: false,
      includeBreakdown: false,
      includeMetrics: false,
    });
  });

  it("reads a file path (inline and spaced)", () => {
    expect(run(["--file=in.json"]).filePath).toBe("in.json");
    expect(run(["--file", "in.json"]).filePath).toBe("in.json");
  });

  it("honors output + section flags", () => {
    const args = run([
      "--file=in.json",
      "--text",
      "--plan",
      "--breakdown",
      "--metrics",
    ]);
    expect(args).toMatchObject({
      format: "text",
      includePlan: true,
      includeBreakdown: true,
      includeMetrics: true,
    });
  });

  it("parses --now as epoch ms and ISO", () => {
    expect(run(["--stdin", "--now=1700000000000"]).nowMs).toBe(1700000000000);
    expect(run(["--stdin", "--now=2023-11-14T22:13:20.000Z"]).nowMs).toBe(
      1700000000000,
    );
  });

  it("accepts --dry-run as a no-op", () => {
    expect(run(["--stdin", "--dry-run"]).source).toBe("stdin");
  });

  it("rejects conflicting inputs", () => {
    expect(reject(["--stdin", "--file=in.json"])).toMatch(/one input/i);
    expect(reject(["--file=in.json", "--stdin"])).toMatch(/one input/i);
  });

  it("rejects conflicting output formats", () => {
    expect(reject(["--stdin", "--json", "--text"])).toMatch(/one output/i);
  });

  it("requires an input", () => {
    expect(reject(["--json"])).toMatch(/input is required/i);
  });

  it("rejects --file without a path", () => {
    expect(reject(["--file"])).toMatch(/requires a path/i);
    expect(reject(["--file="])).toMatch(/requires a path/i);
  });

  it("rejects an invalid --now", () => {
    expect(reject(["--stdin", "--now=not-a-date"])).toMatch(/epoch-ms|iso/i);
    expect(reject(["--stdin", "--now"])).toMatch(/requires/i);
  });

  it("refuses --apply / --delete: the tool never deletes", () => {
    expect(reject(["--stdin", "--apply"])).toMatch(
      /dry-run only and never deletes/i,
    );
    expect(reject(["--stdin", "--delete"])).toMatch(
      /dry-run only and never deletes/i,
    );
  });

  it("echoes an unknown flag name but never a bare positional (which could be a filename)", () => {
    expect(reject(["--stdin", "--bogus"])).toBe("Unknown argument: --bogus");
    const message = reject(["secret-invoice.pdf"]);
    expect(message).not.toContain("secret-invoice");
    expect(message).not.toContain(".pdf");
  });
});
