// @vitest-environment node
/**
 * Unit proofs for the release-report argv parser (Phase 52). Deterministic + side-effect-free: it validates
 * flags, requires at least one document, rejects two stdin inputs / duplicates / conflicts / unknowns, and
 * never reads the environment or filesystem.
 */

import { describe, expect, it } from "vitest";
import { parseReleaseReportArgs, RELEASE_REPORT_USAGE, STDIN_SENTINEL } from "./args";

/** Parse and return the args (asserting a successful run parse). */
function run(argv: string[]) {
  const parsed = parseReleaseReportArgs(argv);
  if (!parsed.ok || parsed.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

describe("release-report args — inputs", () => {
  it("parses --bundle and --audit (inline and spaced)", () => {
    expect(run(["--bundle=b.json", "--audit=a.json"])).toMatchObject({ bundlePath: "b.json", auditPath: "a.json" });
    expect(run(["--bundle", "b.json"])).toMatchObject({ bundlePath: "b.json" });
  });

  it("requires at least one document (an empty invocation is a usage error)", () => {
    const parsed = parseReleaseReportArgs([]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/at least one/i);
  });

  it("accepts the stdin sentinel `-` for either input", () => {
    expect(run(["--bundle=-"]).bundlePath).toBe(STDIN_SENTINEL);
    expect(run(["--bundle", "-"]).bundlePath).toBe(STDIN_SENTINEL); // `-` after a flag is a value, not a flag
    expect(run(["--audit=-"]).auditPath).toBe(STDIN_SENTINEL);
  });

  it("rejects two stdin inputs (a single stream cannot serve both)", () => {
    const parsed = parseReleaseReportArgs(["--bundle=-", "--audit=-"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/one document.*stdin/i);
  });

  it("rejects --output=- (output is never stdin)", () => {
    expect(parseReleaseReportArgs(["--bundle=b.json", "--output=-"]).ok).toBe(false);
  });
});

describe("release-report args — flags", () => {
  it("defaults format json + pretty, strict off", () => {
    expect(run(["--bundle=b.json"])).toMatchObject({ format: "json", pretty: true, strict: false });
  });

  it("--strict / --text / --output / --pretty parse", () => {
    expect(run(["--bundle=b.json", "--strict"]).strict).toBe(true);
    expect(run(["--bundle=b.json", "--text"]).format).toBe("text");
    expect(run(["--bundle=b.json", "--output=out.json"]).outputPath).toBe("out.json");
  });

  it("--help short-circuits to a help result", () => {
    expect(parseReleaseReportArgs(["--help"])).toMatchObject({ ok: true, kind: "help" });
    expect(parseReleaseReportArgs(["-h"])).toMatchObject({ ok: true, kind: "help" });
    expect(RELEASE_REPORT_USAGE).toMatch(/release evidence operator report/i);
  });
});

describe("release-report args — malformed", () => {
  it("rejects an unknown option", () => {
    expect(parseReleaseReportArgs(["--bundle=b.json", "--nope"]).ok).toBe(false);
  });

  it("rejects conflicting formats", () => {
    expect(parseReleaseReportArgs(["--bundle=b.json", "--json", "--text"]).ok).toBe(false);
  });

  it("rejects duplicate single-value flags", () => {
    expect(parseReleaseReportArgs(["--bundle=a", "--bundle=b"]).ok).toBe(false);
    expect(parseReleaseReportArgs(["--audit=a", "--audit=b"]).ok).toBe(false);
    expect(parseReleaseReportArgs(["--bundle=b", "--output=x", "--output=y"]).ok).toBe(false);
  });

  it("rejects a value flag with no value", () => {
    expect(parseReleaseReportArgs(["--bundle"]).ok).toBe(false);
    expect(parseReleaseReportArgs(["--audit", "--strict"]).ok).toBe(false); // next token is a flag
  });
});
