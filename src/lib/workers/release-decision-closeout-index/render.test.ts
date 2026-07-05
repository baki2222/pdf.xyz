import { describe, expect, it } from "vitest";
import { renderReleaseDecisionCloseoutIndex } from "./render";
import { makeIndex, closedCloseout, blockedCloseout, openCloseout, notACloseout } from "./fixtures";

describe("renderReleaseDecisionCloseoutIndex — json", () => {
  it("emits stable, parseable JSON with a trailing newline", () => {
    const result = makeIndex([closedCloseout(), blockedCloseout()]);
    const json = renderReleaseDecisionCloseoutIndex(result, "json");
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json).closeoutIndex.verdict).toBe("index-blocked");
  });

  it("compact vs pretty differ only in whitespace", () => {
    const result = makeIndex([closedCloseout()]);
    const pretty = renderReleaseDecisionCloseoutIndex(result, "json", true);
    const compact = renderReleaseDecisionCloseoutIndex(result, "json", false);
    expect(JSON.parse(pretty)).toEqual(JSON.parse(compact));
    expect(compact.length).toBeLessThan(pretty.length);
  });
});

describe("renderReleaseDecisionCloseoutIndex — text", () => {
  it("renders the verdict, ledger, sequence, reasons, next actions, guidance, caveats", () => {
    const text = renderReleaseDecisionCloseoutIndex(makeIndex([closedCloseout(), openCloseout()]), "text");
    expect(text).toMatch(/INDEX: INDEX-OPEN \(exit 3\)/);
    expect(text).toMatch(/LEDGER/);
    expect(text).toMatch(/by closeout: closed=1/);
    expect(text).toMatch(/SEQUENCE \(oldest → newest\)/);
    expect(text).toMatch(/NEXT ACTIONS/);
    expect(text).toMatch(/GUIDANCE/);
    expect(text).toMatch(/CAVEATS/);
    expect(text).toMatch(/latest=closeout-open/);
  });

  it("an empty-considered window renders the '(no closeouts considered)' sequence line", () => {
    const text = renderReleaseDecisionCloseoutIndex(makeIndex([]), "text");
    expect(text).toMatch(/\(no closeouts considered\)/);
    expect(text).toMatch(/INDEX-INCOMPLETE/);
  });

  it("surfaces the truncation note when --max-closeouts drops older closeouts", () => {
    const text = renderReleaseDecisionCloseoutIndex(
      makeIndex([closedCloseout(), closedCloseout(), notACloseout()], { maxCloseouts: 1 }),
      "text",
    );
    expect(text).toMatch(/older dropped by --max-closeouts=1/);
  });
});
