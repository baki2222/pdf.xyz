import { describe, expect, it } from "vitest";
import { parseReleaseArchiveArgs } from "./args";

describe("parseReleaseArchiveArgs", () => {
  it("parses governance plus related records", () => {
    const parsed = parseReleaseArchiveArgs([
      "--governance=gov.json",
      "--trend",
      "trend.json",
      "--report=report.json",
      "--audit=audit.json",
      "--bundle=bundle.json",
      "--text",
      "--require-trend",
      "--require-bundle",
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.kind === "run") {
      expect(parsed.args.format).toBe("text");
      expect(parsed.args.governancePath).toBe("gov.json");
      expect(parsed.args.requireTrend).toBe(true);
      expect(parsed.args.requireBundle).toBe(true);
    }
  });

  it("rejects an empty invocation and multiple stdin records without echoing paths", () => {
    expect(parseReleaseArchiveArgs([]).ok).toBe(false);
    const parsed = parseReleaseArchiveArgs(["--governance=-", "--trend=-"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).not.toContain("/tmp/secret");
  });
});
