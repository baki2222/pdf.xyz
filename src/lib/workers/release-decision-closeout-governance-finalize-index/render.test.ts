import { describe, expect, it } from "vitest";
import {
  renderReleaseDecisionCloseoutGovernanceFinalizeIndex,
  renderReleaseDecisionCloseoutGovernanceFinalizeIndexJson,
} from "./render";
import { blockedFinalize, finalizedFinalize, makeIndex, openFinalize } from "./fixtures";

describe("render — json", () => {
  it("round-trips to the structured result and ends with a newline", () => {
    const result = makeIndex([finalizedFinalize(), finalizedFinalize()]);
    const json = renderReleaseDecisionCloseoutGovernanceFinalizeIndexJson(result);
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json).finalizeIndex.verdict).toBe("indexed");
  });

  it("compact vs pretty differ only in whitespace", () => {
    const result = makeIndex([finalizedFinalize()]);
    const pretty = renderReleaseDecisionCloseoutGovernanceFinalizeIndexJson(result, true);
    const compact = renderReleaseDecisionCloseoutGovernanceFinalizeIndexJson(result, false);
    expect(JSON.parse(pretty)).toEqual(JSON.parse(compact));
    expect(pretty.length).toBeGreaterThan(compact.length);
  });
});

describe("render — text", () => {
  it("renders the verdict, coverage, distribution, sequence, next actions, and caveats", () => {
    const result = makeIndex([finalizedFinalize(), openFinalize()]);
    const text = renderReleaseDecisionCloseoutGovernanceFinalizeIndex(result, "text");
    expect(text).toMatch(/release decision closeout governance finalize index/i);
    expect(text).toMatch(/INDEX: INDEX-OPEN \(exit 3\)/);
    expect(text).toMatch(/COVERAGE/);
    expect(text).toMatch(/by finalization: finalized=1/);
    expect(text).toMatch(/SEQUENCE \(oldest → newest\)/);
    expect(text).toMatch(/NEXT ACTIONS/);
    expect(text).toMatch(/CAVEATS/);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("shows the invalid verdict and the tampered/unreadable coverage for a broken history", () => {
    const result = makeIndex([blockedFinalize()]);
    const text = renderReleaseDecisionCloseoutGovernanceFinalizeIndex(result, "text");
    expect(text).toMatch(/INDEX: INDEX-BLOCKED \(exit 4\)/);
  });

  it("handles an empty considered window without crashing", () => {
    const result = makeIndex([]);
    const text = renderReleaseDecisionCloseoutGovernanceFinalizeIndex(result, "text");
    expect(text).toMatch(/\(no bundles considered\)/);
  });
});
