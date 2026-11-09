import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as shared from "./annot-flags";
import * as overlay from "./overlay";

/**
 * The annotation flags have one shared definition (`./annot-flags`) and one
 * kept local to Overlay's engine, so that its first-load chunk does not
 * carry the shared module's XFA reader (see the docblock in
 * `./annot-flags`). Two definitions are a relationship to pin, not a
 * comment to trust: if either drifts, Flatten, Overlay and Remove
 * Annotations disagree about which annotation a reader shows.
 */
describe("annotation flags", () => {
  it("Overlay's local flags are the shared ones", () => {
    expect(overlay.ANNOT_HIDDEN).toBe(shared.ANNOT_HIDDEN);
    expect(overlay.ANNOT_NO_VIEW).toBe(shared.ANNOT_NO_VIEW);
  });

  it("are ISO 32000's bits: Hidden is bit 2, NoView bit 6 (independent bound)", () => {
    expect(shared.ANNOT_HIDDEN).toBe(2);
    expect(shared.ANNOT_NO_VIEW).toBe(32);
    // Print (bit 3) exists only in Overlay's engine, for PDF Booklet Maker's
    // print-mode baking; pinned to ISO here, as the other two are.
    expect(overlay.ANNOT_PRINT).toBe(4);
  });

  it("Overlay's engine does not import the shared module", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src", "lib", "pdf", "overlay.ts"),
      "utf8",
    );
    expect(source).toContain('from "./'); // it does import siblings (health)
    expect(source).not.toMatch(/from\s+"\.\/annot-flags"/);
  });
});
