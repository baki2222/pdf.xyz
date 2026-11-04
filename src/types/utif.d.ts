/**
 * `utif@3` (photopea's UTIF.js) ships no types, and `@types/utif` is not a
 * package we chose to trust, so the surface `src/lib/pdf/tiff.ts` touches is
 * declared here and nothing else.
 *
 * Deliberately narrow, and deliberately INTERNAL: the engine does not call
 * `UTIF.decode` / `UTIF.decodeImage` (their IFD reader allocates whatever a
 * header claims, and an unknown compression silently leaves the page zeroed).
 * It walks the IFDs itself, with bounds and ceilings, and borrows only the
 * CCITT and JPEG strip decoders plus the tables they read, which it wraps so
 * a damaged strip throws instead of spinning. What is written here is what
 * `tiff.ts` exercises.
 */
declare module "utif" {
  /** A strip decoder's IFD: UTIF's `t<tag>` arrays, plus `isLE`. */
  export type UtifIfd = Record<string, unknown>;

  export interface UtifStripDecoders {
    _decodeG3: ((
      data: Uint8Array,
      off: number,
      len: number,
      tgt: Uint8Array,
      toff: number,
      width: number,
      fillOrder: number,
    ) => void) & { allow2D: boolean | null };
    _decodeG4: (
      data: Uint8Array,
      off: number,
      len: number,
      tgt: Uint8Array,
      toff: number,
      width: number,
      fillOrder: number,
    ) => void;
    _decodeNewJPEG: (
      img: UtifIfd,
      data: Uint8Array,
      off: number,
      len: number,
      tgt: Uint8Array,
      toff: number,
    ) => void;
    /** Code tables the CCITT decoders index by the bits read so far. */
    _dmap: Record<string, number>;
    _lens: [Record<string, number>, Record<string, number>];
    _addNtimes: (arr: number[], n: number, val: number) => void;
    _writeBits: (bits: number[], tgt: Uint8Array, boff: number) => void;
  }

  const UTIF: { decode: UtifStripDecoders };
  export default UTIF;
}
