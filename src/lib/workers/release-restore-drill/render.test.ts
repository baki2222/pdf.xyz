import { describe, expect, it } from "vitest";
import { buildRestoreResult } from "./build";
import { renderReleaseRestoreDrill } from "./render";
import { NOW, archivablePack, defaultDrillPolicy, healthyPackObjects, ingestDrillFrom } from "./fixtures";

describe("renderReleaseRestoreDrill", () => {
  it("renders stable JSON with a trailing newline", () => {
    const result = buildRestoreResult(NOW, ingestDrillFrom(archivablePack()), defaultDrillPolicy({ archiveOnly: true }), false);
    const json = renderReleaseRestoreDrill(result, "json");
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json).schema).toBe("pdfxyz.release-restore-drill/1");
  });

  it("renders a DR-friendly text summary with the verdict, coverage, checks, and caveats", () => {
    const { governance, trend } = healthyPackObjects();
    const result = buildRestoreResult(NOW, ingestDrillFrom(archivablePack(), { governance, trend }), defaultDrillPolicy(), false);
    const text = renderReleaseRestoreDrill(result, "text");
    expect(text).toMatch(/release evidence restore drill/i);
    expect(text).toMatch(/DRILL: RESTORE-VERIFIED/);
    expect(text).toMatch(/RESTORE COVERAGE/);
    expect(text).toMatch(/RESTORE CHECKS/);
    expect(text).toMatch(/CAVEATS/);
  });
});
