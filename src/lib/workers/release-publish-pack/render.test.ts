import { describe, expect, it } from "vitest";
import { renderReleasePublishPack } from "./render";
import { archivablePack, failedDrill, healthyGovernance, makePublishPack, watchGovernance } from "./fixtures";

describe("renderReleasePublishPack — json", () => {
  it("emits stable, round-trippable JSON with a trailing newline", () => {
    const result = makePublishPack({ governance: healthyGovernance(), archive: archivablePack() });
    const json = renderReleasePublishPack(result, "json");
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(result)));
  });

  it("--pretty vs compact differ only in whitespace", () => {
    const result = makePublishPack({ governance: healthyGovernance() });
    const pretty = renderReleasePublishPack(result, "json", true);
    const compact = renderReleasePublishPack(result, "json", false);
    expect(pretty).toContain("\n  ");
    expect(JSON.parse(pretty)).toEqual(JSON.parse(compact));
  });
});

describe("renderReleasePublishPack — text", () => {
  it("renders the verdict, disclosure, coverage, sources, checklist, and caveats", () => {
    const result = makePublishPack({ governance: healthyGovernance(), archive: archivablePack() });
    const text = renderReleasePublishPack(result, "text");
    expect(text).toMatch(/PUBLISH: PUBLISHABLE \(exit 0\)/);
    expect(text).toMatch(/DISCLOSURE: SHARE-SAFE/);
    expect(text).toMatch(/EVIDENCE COVERAGE/);
    expect(text).toMatch(/SOURCES/);
    expect(text).toMatch(/HANDOFF CHECKLIST/);
    expect(text).toMatch(/CAVEATS/);
    expect(text).toMatch(/governance — state=usable, posture=healthy/);
  });

  it("shows the reasons + strict escalation on an escalated pack", () => {
    const result = makePublishPack({ governance: watchGovernance() }, { strict: true });
    const text = renderReleasePublishPack(result, "text");
    expect(text).toMatch(/PUBLISH: BLOCKED \(exit 4\)/);
    expect(text).toMatch(/strict, escalated from review/);
    expect(text).toMatch(/reasons: governance-watch/);
  });

  it("renders a blocked pack's do-not-share disclosure note", () => {
    const result = makePublishPack({ governance: healthyGovernance(), restoreDrill: failedDrill() });
    const text = renderReleasePublishPack(result, "text");
    expect(text).toMatch(/DISCLOSURE: BLOCKED/);
    expect(text).toMatch(/restore-failed/);
  });
});
