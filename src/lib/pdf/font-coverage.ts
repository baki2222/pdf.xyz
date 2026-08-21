/**
 * Choosing a face for a string, exactly — and the one dynamic boundary in front
 * of the coverage tables.
 *
 * `font-coverage.generated.ts` is ~67 KB of base64 bitmaps. A page that stamps
 * "CONFIDENTIAL" must not pay for it, so it is reached only through
 * {@link loadCoverage}, on the branch where a character has already failed the
 * WinAnsi test. Everything above that branch stays in `font-packs.ts`, which is
 * a few hundred bytes of labels.
 */
import {
  FONT_PACKS,
  isSignalCodePoint,
  type FontPack,
  type FontPackId,
} from "./font-packs";
import {
  coverageHas,
  coverageSize,
  decodeBmp,
  type PackCoverage,
} from "./coverage-bitmap";

interface DecodedCoverage {
  bmp: Uint8Array;
  astral: readonly (readonly [number, number])[];
  size: number;
}

let decoded: Promise<Record<FontPackId, DecodedCoverage>> | null = null;

/** Load (once) and decode the per-face coverage bitmaps. */
export function loadCoverage(): Promise<Record<FontPackId, DecodedCoverage>> {
  decoded ??= import("./font-coverage.generated")
    .then(({ FONT_COVERAGE }) => {
      const out = {} as Record<FontPackId, DecodedCoverage>;
      for (const pack of FONT_PACKS) {
        const entry: PackCoverage = FONT_COVERAGE[pack.id];
        const bmp = decodeBmp(entry);
        const size = coverageSize(bmp, entry.astral);
        // A table that decoded to nearly nothing would refuse almost every
        // string, and the refusal would read exactly like an honest one. The
        // smallest face we ship reports 445 code points; anything under a
        // hundred is a broken artifact, not a small font.
        if (size < 100) {
          throw new Error(
            `font coverage for ${pack.id} claims only ${size} code points`,
          );
        }
        out[pack.id] = { bmp, astral: entry.astral, size };
      }
      return out;
    })
    .catch((error) => {
      // Not memoized on failure: the typed-source tools reach this with no file
      // pick and no warm-up, so one offline blip would otherwise brick every
      // later run until a full reload.
      decoded = null;
      throw error;
    });
  return decoded;
}

/** Begin fetching the coverage tables without waiting (call on file pick). */
export function warmCoverage(): void {
  void loadCoverage().catch(() => {
    // Swallowed: the real await inside the operation reports errors.
  });
}

/** True when the shipped face for `pack` has a glyph for `cp`. */
export function packCovers(
  coverage: Record<FontPackId, DecodedCoverage>,
  pack: FontPack,
  cp: number,
): boolean {
  const entry = coverage[pack.id];
  return coverageHas(entry.bmp, entry.astral, cp);
}

/**
 * Every face that has a glyph for EVERY code point in `text`, best first.
 *
 * "Best" is signal, then size. Three CJK faces overlap heavily — SC carries
 * 100% of CJK Unified, JP 61%, KR 39% — so ordering by size alone would send a
 * Chinese watermark through a 5 MB Japanese download that cannot finish the
 * job. Kana means Japanese, Hangul means Korean, bare Han means Chinese; among
 * equals the smaller file wins.
 *
 * One face per run is a real constraint rather than an oversight: pdf-lib emits
 * one `Tj` against one font resource, and splitting a line across faces means
 * re-measuring and re-placing every fragment at eight call sites. A string
 * mixing Bengali and Korean therefore returns nothing here and is refused with
 * a message naming the two scripts, instead of a half-drawn line.
 */
export function candidatePacks(
  coverage: Record<FontPackId, DecodedCoverage>,
  text: string,
): FontPack[] {
  const codePoints: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined) codePoints.push(cp);
  }
  const able = FONT_PACKS.filter((pack) =>
    codePoints.every((cp) => packCovers(coverage, pack, cp)),
  );
  return able.sort((a, b) => {
    const aSignal = codePoints.some((cp) => isSignalCodePoint(a, cp)) ? 0 : 1;
    const bSignal = codePoints.some((cp) => isSignalCodePoint(b, cp)) ? 0 : 1;
    return aSignal - bSignal || a.bytes - b.bytes;
  });
}

/** The distinct code points in `text` no shipped face has a glyph for. */
export function uncoveredCodePoints(
  coverage: Record<FontPackId, DecodedCoverage>,
  text: string,
): number[] {
  const missing = new Set<number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (FONT_PACKS.some((pack) => packCovers(coverage, pack, cp))) continue;
    missing.add(cp);
  }
  return [...missing];
}

/** Which of our faces each character in `text` belongs to — for a mixed-script message. */
export function packLabelsInText(
  coverage: Record<FontPackId, DecodedCoverage>,
  text: string,
): string[] {
  const labels = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    const signalled = FONT_PACKS.find((pack) => isSignalCodePoint(pack, cp));
    if (signalled) {
      labels.add(signalled.label);
      continue;
    }
    const any = FONT_PACKS.find((pack) => packCovers(coverage, pack, cp));
    if (any) labels.add(any.label);
  }
  return [...labels];
}
