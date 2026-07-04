import { describe, expect, it } from "vitest";
import { buildRestoreResult } from "./build";
import { renderReleaseRestoreDrill } from "./render";
import { NOW, archivablePack, defaultDrillPolicy, ingestDrillFrom, promoteReadyReport, tamperReport } from "./fixtures";

/** Locator-shaped tokens the drill must never echo out of a hostile input. */
const FORBIDDEN = [
  "evil-token-123",
  "/tmp/",
  "s3://",
  "amazonaws.com",
  "AKIAIOSFODNN7EXAMPLE",
  "secret-value-xyz",
  "statement.pdf",
];

describe("restore drill never echoes hostile input", () => {
  it("drops raw fields smuggled into the pack and a restored record, in JSON and text", () => {
    // Poison the pack with extra raw fields (dropped by ingest reconstruction).
    const pack = JSON.parse(JSON.stringify(archivablePack())) as Record<string, unknown>;
    pack.raw = "/tmp/evil-token-123";
    (pack.metadata as Record<string, unknown>).leak = "s3://secret-value-xyz/statement.pdf";

    // Poison a restored (tampered) report with a hostile raw field.
    const hostileReport = tamperReport(promoteReadyReport(), "hold-fail") as Record<string, unknown>;
    hostileReport.raw = "AKIAIOSFODNN7EXAMPLE";
    hostileReport.leak = "amazonaws.com/secret-value-xyz";

    const result = buildRestoreResult(NOW, ingestDrillFrom(pack, { report: hostileReport }), defaultDrillPolicy(), false);
    const json = JSON.stringify(result);
    const text = renderReleaseRestoreDrill(result, "text");

    expect(result.drill.verdict).toBe("restore-failed");
    expect(result.drill.reasons).toContain("restore-corrupt");
    for (const bad of FORBIDDEN) {
      expect(json, `json leaked ${bad}`).not.toContain(bad);
      expect(text, `text leaked ${bad}`).not.toContain(bad);
    }
  });

  it("emits only bounded enums, counts, an ISO stamp, hex digests, and prose (no ingested stamp)", () => {
    const pack = JSON.parse(JSON.stringify(archivablePack())) as Record<string, unknown>;
    pack.generatedAt = "1999-01-01T00:00:00.000Z"; // an ingested stamp we must NOT echo
    const result = buildRestoreResult(NOW, ingestDrillFrom(pack, {}, true), defaultDrillPolicy({ archiveOnly: true }), true);
    const json = JSON.stringify(result);
    expect(result.generatedAt).toBe(NOW);
    expect(json).not.toContain("1999-01-01");
    // A recorded digest is an opaque bounded token (the CLI computes a real sha256; see cli.smoke.test).
    expect(result.digests.algorithm).toBe("sha256");
    expect(typeof result.digests.archive).toBe("string");
  });
});
