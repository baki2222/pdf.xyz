// @vitest-environment node
/**
 * The checked-in coverage tables still describe the fonts that ship.
 *
 * `font-coverage.generated.ts` is what routing consults before it downloads
 * anything, and a bitmap has no relationships to constrain it: nothing about
 * 8,192 bytes of base64 looks wrong when a font underneath it changes. So it is
 * re-derived here from the same TTFs `copy-noto-fonts.ts` copies, and compared
 * byte for byte.
 *
 * Drift is not loud on its own. A stale table sends the browser after a face
 * that no longer has the glyphs, the `.notdef` check in `unicode-font.ts`
 * catches it, and the user gets a refusal for text we could actually draw —
 * a wrong answer arrived at correctly. This is the guard that keeps the first
 * of the two bounds honest.
 */
import { describe, expect, it } from "vitest";
import { FONT_PACKS } from "./font-packs";
import { FONT_COVERAGE } from "./font-coverage.generated";
import {
  coverageHas,
  coverageSize,
  decodeBmp,
  encodeCoverage,
} from "./coverage-bitmap";
import { notoCharacterSet } from "./noto-source";

describe("generated font coverage", () => {
  it("matches what the installed faces actually contain", async () => {
    for (const pack of FONT_PACKS) {
      const fresh = encodeCoverage(await notoCharacterSet(pack));
      const stored = FONT_COVERAGE[pack.id];
      expect(
        stored.bmp,
        `${pack.id} coverage is stale — run \`pnpm fonts:coverage\`. Until then routing is deciding which font to download from a description of a different file.`,
      ).toBe(fresh.bmp);
      expect(stored.astral).toEqual(fresh.astral);
    }
  }, 60_000);

  it("has an entry for every pack and no entry for anything else", () => {
    expect(Object.keys(FONT_COVERAGE).sort()).toEqual(
      FONT_PACKS.map((p) => p.id).sort(),
    );
  });

  it("is not vacuously small", () => {
    // `[] ⊆ X` is true, and an empty bitmap would answer "not covered" for
    // every character — a total refusal that reads exactly like an honest one.
    // The smallest face we ship reports 445 code points.
    for (const pack of FONT_PACKS) {
      const entry = FONT_COVERAGE[pack.id];
      const size = coverageSize(decodeBmp(entry), entry.astral);
      expect(size, `${pack.id}`).toBeGreaterThan(400);
    }
  });

  it("is not vacuously LARGE either", () => {
    // The opposite failure is quieter: a bitmap of all ones would claim every
    // face draws everything, routing would always pick the first candidate, and
    // only the `.notdef` check downstream would notice — one bound doing the
    // work of two. The biggest face we ship carries 30,890 code points, a
    // little under half the BMP.
    for (const pack of FONT_PACKS) {
      const entry = FONT_COVERAGE[pack.id];
      const size = coverageSize(decodeBmp(entry), entry.astral);
      expect(size, `${pack.id}`).toBeLessThan(0x10000 / 2);
    }
  });

  it("answers the specific questions routing depends on", () => {
    // A positive control per face, on the character that decides its routing.
    // Without these the assertions above would pass on five bitmaps that were
    // each self-consistent and all wrong.
    const probes: [string, string, boolean][] = [
      ["bengali", "গ", true],
      ["bengali", "机", false],
      ["latin", "Ж", true],
      ["latin", "क", true],
      ["latin", "গ", false],
      ["japanese", "ひ", true],
      ["japanese", "기", false],
      ["korean", "기", true],
      ["chinese", "机", true],
      ["chinese", "기", false],
    ];
    for (const [id, char, expected] of probes) {
      const entry = FONT_COVERAGE[id as keyof typeof FONT_COVERAGE];
      const has = coverageHas(
        decodeBmp(entry),
        entry.astral,
        char.codePointAt(0)!,
      );
      expect(has, `${id} vs ${char}`).toBe(expected);
    }
  });
});
