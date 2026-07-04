import { describe, expect, it } from "vitest";
import { ingestRestoreArchive } from "./ingest";
import { archivablePack, notADocument } from "./fixtures";

/** Deep clone a pack to a mutable object for tamper probes. */
function clone(pack: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(pack));
}

describe("restore-drill archive anchor ingest (tamper-evidence)", () => {
  it("marks a clean archivable pack usable and surfaces its per-record postures", () => {
    const ingested = ingestRestoreArchive(archivablePack());
    expect(ingested.recognized).toBe(true);
    expect(ingested.usable).toBe(true);
    expect(ingested.posture).toBe("archivable");
    expect(ingested.facts?.records.map((r) => r.id)).toEqual(["governance", "trend", "report", "audit", "bundle"]);
    const gov = ingested.facts?.records.find((r) => r.id === "governance");
    expect(gov?.state).toBe("usable");
    expect(gov?.verdict).toBe("healthy");
  });

  it("does not recognize a wrong-schema input (unreadable anchor)", () => {
    const ingested = ingestRestoreArchive(notADocument());
    expect(ingested.recognized).toBe(false);
    expect(ingested.usable).toBe(false);
    expect(ingested.facts).toBeNull();
  });

  it("catches a hand-flipped archive posture (rollup no longer re-derives)", () => {
    const pack = clone(archivablePack()) as Record<string, unknown> & { archive: { posture: string } };
    pack.archive.posture = "archive-blocked";
    const ingested = ingestRestoreArchive(pack);
    expect(ingested.recognized).toBe(true);
    expect(ingested.usable).toBe(false);
    expect(ingested.posture).toBe("archive-blocked"); // the untrusted CLAIM is surfaced
  });

  it("catches a flipped per-record verdict that would change the re-derived reasons", () => {
    const pack = clone(archivablePack()) as Record<string, unknown> & {
      records: Array<{ id: string; verdict: string }>;
    };
    const trend = pack.records.find((r) => r.id === "trend")!;
    trend.verdict = "failing"; // a stable trend claimed as failing → the rollup would fire trend-failing
    const ingested = ingestRestoreArchive(pack);
    expect(ingested.usable).toBe(false);
  });

  it("catches a lied coverage count", () => {
    const pack = clone(archivablePack()) as Record<string, unknown> & { coverage: { recordsUsable: number } };
    pack.coverage.recordsUsable = pack.coverage.recordsUsable + 1;
    expect(ingestRestoreArchive(pack).usable).toBe(false);
  });

  it("catches a dropped record (wrong record count)", () => {
    const pack = clone(archivablePack()) as Record<string, unknown> & { records: unknown[] };
    pack.records = pack.records.slice(0, 4);
    expect(ingestRestoreArchive(pack).usable).toBe(false);
  });

  it("catches a state that no longer derives from its own supplied/recognized/usable flags", () => {
    const pack = clone(archivablePack()) as Record<string, unknown> & {
      records: Array<{ id: string; state: string; usable: boolean }>;
    };
    const gov = pack.records.find((r) => r.id === "governance")!;
    gov.state = "tampered"; // flip the state but leave usable=true → violates the reduce invariant
    expect(ingestRestoreArchive(pack).usable).toBe(false);
  });

  it("never throws or echoes on a hostile input", () => {
    const hostile = clone(archivablePack());
    (hostile as Record<string, unknown>).raw = "/tmp/evil-token-123";
    const ingested = ingestRestoreArchive(hostile);
    expect(JSON.stringify(ingested)).not.toContain("evil-token-123");
  });
});
