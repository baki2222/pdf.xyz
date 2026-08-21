/**
 * `fontkit@2` ships no types (and there is no `@types/fontkit` for v2), so the
 * surface we actually use is declared here rather than cast away at each call.
 *
 * Deliberately narrow: only the members `unicode-font.ts` and the guards touch.
 * A wider guess would be a claim about a library we did not check — and the
 * whole reason this dependency exists is that the recommended one silently
 * mis-encoded fonts. What is written here is what was exercised.
 */
declare module "fontkit" {
  export interface FontkitGlyph {
    readonly id: number;
    readonly codePoints: number[];
    readonly advanceWidth: number;
    readonly path: {
      readonly commands: unknown[];
      readonly bbox: {
        readonly width: number;
        readonly height: number;
        readonly minX: number;
        readonly minY: number;
        readonly maxX: number;
        readonly maxY: number;
      };
    };
  }

  export interface FontkitFont {
    readonly postscriptName: string;
    readonly numGlyphs: number;
    readonly unitsPerEm: number;
    /** Every code point the cmap maps, as reported by the font itself. */
    readonly characterSet: number[];
    hasGlyphForCodePoint(codePoint: number): boolean;
    /** Shapes `text` — GSUB, reordering, the lot — into positioned glyphs. */
    layout(text: string): { glyphs: FontkitGlyph[]; advanceWidth: number };
    getGlyph(id: number): FontkitGlyph;
    createSubset(): {
      includeGlyph(glyph: FontkitGlyph | number): number;
      encode(): Uint8Array;
    };
  }

  export function create(bytes: Uint8Array): FontkitFont;
  export function openSync(path: string): FontkitFont;

  const fontkit: {
    create: typeof create;
    openSync: typeof openSync;
  };
  export default fontkit;
}
