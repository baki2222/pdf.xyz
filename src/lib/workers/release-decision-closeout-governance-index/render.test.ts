import { describe, expect, it } from "vitest";
import { renderReleaseDecisionCloseoutGovernanceIndex } from "./render";
import { makeIndex, closedGovernance, blockedGovernance, openGovernance, notAGovernance } from "./fixtures";

describe("renderReleaseDecisionCloseoutGovernanceIndex — json", () => {
  it("emits stable, parseable JSON with a trailing newline", () => {
    const result = makeIndex([closedGovernance(), blockedGovernance()]);
    const json = renderReleaseDecisionCloseoutGovernanceIndex(result, "json");
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json).governanceIndex.verdict).toBe("index-blocked");
  });

  it("compact vs pretty differ only in whitespace", () => {
    const result = makeIndex([closedGovernance()]);
    const pretty = renderReleaseDecisionCloseoutGovernanceIndex(result, "json", true);
    const compact = renderReleaseDecisionCloseoutGovernanceIndex(result, "json", false);
    expect(JSON.parse(pretty)).toEqual(JSON.parse(compact));
    expect(compact.length).toBeLessThan(pretty.length);
  });
});

describe("renderReleaseDecisionCloseoutGovernanceIndex — text", () => {
  it("renders the verdict, ledger, sequence, reasons, next actions, guidance, caveats", () => {
    const text = renderReleaseDecisionCloseoutGovernanceIndex(
      makeIndex([closedGovernance(), openGovernance()]),
      "text",
    );
    expect(text).toMatch(/INDEX: INDEX-OPEN \(exit 3\)/);
    expect(text).toMatch(/LEDGER/);
    expect(text).toMatch(/by governance: closed=1/);
    expect(text).toMatch(/SEQUENCE \(oldest → newest\)/);
    expect(text).toMatch(/NEXT ACTIONS/);
    expect(text).toMatch(/GUIDANCE/);
    expect(text).toMatch(/CAVEATS/);
    expect(text).toMatch(/latest=governance-open/);
  });

  it("an empty-considered window renders the '(no bundles considered)' sequence line", () => {
    const text = renderReleaseDecisionCloseoutGovernanceIndex(makeIndex([]), "text");
    expect(text).toMatch(/\(no bundles considered\)/);
    expect(text).toMatch(/INDEX-INCOMPLETE/);
  });

  it("surfaces the truncation note when --max-governance drops older bundles", () => {
    const text = renderReleaseDecisionCloseoutGovernanceIndex(
      makeIndex([closedGovernance(), closedGovernance(), notAGovernance()], { maxGovernance: 1 }),
      "text",
    );
    expect(text).toMatch(/older dropped by --max-governance=1/);
  });
});
