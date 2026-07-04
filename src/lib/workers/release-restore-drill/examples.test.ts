import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRestoreResult } from "./build";
import { ingestDrillFrom } from "./fixtures";
import { defaultDrillPolicy } from "./fixtures";

const ROOT = process.cwd();
const D = join(ROOT, "docs/examples/release-restore-drill");
const NOW = "2026-07-04T00:00:00.000Z";

function load(name: string): unknown {
  return JSON.parse(readFileSync(join(D, name), "utf8"));
}

describe("release restore drill examples", () => {
  it("the committed archivable pack + full restore verifies (every record matches)", () => {
    const result = buildRestoreResult(
      NOW,
      ingestDrillFrom(load("archive-archivable.json"), {
        governance: load("governance-healthy.json"),
        trend: load("trend-stable.json"),
        report: load("report-promote-ready.json"),
        audit: load("audit-pass.json"),
        bundle: load("bundle-pass.json"),
      }),
      defaultDrillPolicy(),
      false,
    );
    expect(result.drill.verdict).toBe("restore-verified");
    expect(result.drill.exitCode).toBe(0);
    expect(result.coverage.recordsMatched).toBe(5);
  });

  it("restoring a different record than was archived is a mismatch (fail closed)", () => {
    const result = buildRestoreResult(
      NOW,
      ingestDrillFrom(load("archive-archivable.json"), { trend: load("trend-warning.json") }),
      defaultDrillPolicy(),
      false,
    );
    expect(result.drill.verdict).toBe("restore-failed");
    expect(result.drill.reasons).toContain("restore-mismatch");
  });

  it("the committed watch/blocked/incomplete/tampered packs surface their posture (archive-only)", () => {
    const policy = defaultDrillPolicy({ archiveOnly: true });
    const watch = buildRestoreResult(NOW, ingestDrillFrom(load("archive-watch.json")), policy, false);
    const blocked = buildRestoreResult(NOW, ingestDrillFrom(load("archive-blocked.json")), policy, false);
    const incomplete = buildRestoreResult(NOW, ingestDrillFrom(load("archive-incomplete.json")), policy, false);
    const tampered = buildRestoreResult(NOW, ingestDrillFrom(load("archive-tampered.json")), policy, false);
    expect(watch.drill.verdict).toBe("restore-drift");
    expect(blocked.drill.verdict).toBe("restore-failed");
    expect(incomplete.drill.verdict).toBe("restore-incomplete");
    expect(tampered.drill.verdict).toBe("restore-failed");
    expect(tampered.drill.reasons).toContain("archive-tampered");
  });

  it("an unreadable anchor is incomplete, never a fabricated verified", () => {
    const result = buildRestoreResult(NOW, ingestDrillFrom(load("not-a-document.json")), defaultDrillPolicy({ archiveOnly: true }), false);
    expect(result.drill.verdict).toBe("restore-incomplete");
    expect(result.drill.reasons).toContain("archive-unreadable");
  });
});
