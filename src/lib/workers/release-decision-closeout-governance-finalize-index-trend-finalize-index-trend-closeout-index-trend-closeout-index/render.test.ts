import { describe, expect, it } from "vitest";
import {
  renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndex as render,
  renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexJson as renderJson,
} from "./render";
import { blockedCloseout, closedCloseout, makeIndex, openCloseout } from "./fixtures";

describe("render — json", () => {
  it("round-trips to the structured result and ends with a newline", () => {
    const result = makeIndex([closedCloseout(), closedCloseout()]);
    const json = renderJson(result);
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json).closeoutIndex.verdict).toBe("all-closed");
  });

  it("compact vs pretty differ only in whitespace", () => {
    const result = makeIndex([closedCloseout()]);
    const pretty = renderJson(result, true);
    const compact = renderJson(result, false);
    expect(JSON.parse(pretty)).toEqual(JSON.parse(compact));
    expect(pretty.length).toBeGreaterThan(compact.length);
  });
});

describe("render — text", () => {
  it("renders the verdict, coverage, distribution, sequence, next actions, and caveats", () => {
    const result = makeIndex([closedCloseout(), openCloseout()]);
    const text = render(result, "text");
    expect(text).toMatch(/release decision closeout governance finalize index trend finalize index trend closeout index trend closeout index/i);
    expect(text).toMatch(/INDEX: OPEN \(exit 3\)/);
    expect(text).toMatch(/COVERAGE/);
    expect(text).toMatch(/by closeout: closed=1/);
    expect(text).toMatch(/SEQUENCE \(oldest → newest\)/);
    expect(text).toMatch(/NEXT ACTIONS/);
    expect(text).toMatch(/CAVEATS/);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("shows the blocked verdict for a blocked history", () => {
    const result = makeIndex([blockedCloseout()]);
    const text = render(result, "text");
    expect(text).toMatch(/INDEX: BLOCKED \(exit 4\)/);
  });

  it("handles an empty considered window without crashing", () => {
    const result = makeIndex([]);
    const text = render(result, "text");
    expect(text).toMatch(/\(no records considered\)/);
  });
});
