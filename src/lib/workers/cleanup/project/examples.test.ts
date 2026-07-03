// @vitest-environment node
/**
 * The committed raw-export fixtures under docs/examples/cleanup-project/ are re-projected here
 * through the REAL transform, so an example can never silently drift from the tool's behavior —
 * and, crucially, so we prove that none of the `EXAMPLE-…` placeholder locators an operator might
 * paste into a raw capture survive into the projected document. This is the examples' privacy
 * guarantee, mirroring `../../artifacts/cleanup/examples.test.ts`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { projectProviderExport } from "./project";
import { exitCodeForProjectionVerdict } from "./run";
import type { ProjectionTarget, ProjectionVerdict } from "./types";

/** A fixed clock; fixtures use extreme instants so the verdict is clock-robust. */
const NOW = 1_700_000_000_000;
const DIR = "docs/examples/cleanup-project";

interface Fixture {
  file: string;
  target: ProjectionTarget;
  verdict: ProjectionVerdict;
  exit: number;
}

const FIXTURES: Fixture[] = [
  { file: "raw-inventory-projected.json", target: "inventory", verdict: "projected", exit: 0 },
  { file: "raw-evidence-projected.json", target: "evidence", verdict: "projected", exit: 0 },
  { file: "raw-unsafe-tombstoned.json", target: "inventory", verdict: "unsafe", exit: 4 },
  { file: "raw-insufficient-listing.json", target: "inventory", verdict: "insufficient", exit: 2 },
];

describe("cleanup-project example fixtures", () => {
  for (const fx of FIXTURES) {
    it(`${fx.file} projects to ${fx.verdict} (exit ${fx.exit}) and leaks no placeholder`, () => {
      const text = readFileSync(`${DIR}/${fx.file}`, "utf8");
      const result = projectProviderExport(text, { target: fx.target, source: "aws-s3", now: NOW });
      expect(result.ok, `${fx.file} should parse`).toBe(true);
      if (!result.ok) return;

      expect(result.verdict, fx.file).toBe(fx.verdict);
      expect(exitCodeForProjectionVerdict(result.verdict), fx.file).toBe(fx.exit);

      // The whole projected payload (records + embedded receipt) is content-free: not one
      // `EXAMPLE-` placeholder locator/identifier from the raw input may survive.
      const serialized = JSON.stringify({ records: result.records, receipt: result.receipt });
      expect(serialized).not.toContain("EXAMPLE-");
      // And the receipt confirms the projector actually saw and dropped fields for the fixtures
      // that carry hostile placeholders (every fixture but the empty cases does).
      expect(result.receipt.droppedFields).toBeGreaterThan(0);
    });
  }

  it("README documents exactly the shipped fixtures", () => {
    const readme = readFileSync(`${DIR}/README.md`, "utf8");
    for (const fx of FIXTURES) expect(readme).toContain(fx.file);
  });
});
