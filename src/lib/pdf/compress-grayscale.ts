/**
 * Compress PDF — what the secure-worker step's Grayscale switch does, said by
 * the panel and the FAQ from this one sentence. Ghostscript is run with
 * `-sColorConversionStrategy=Gray`, which converts every colour on the page,
 * and the engine re-reads the output's images (`workers/compression/
 * image-colour.ts`) and refuses the run if one still has more than one colour
 * component.
 *
 * Its own leaf rather than a line in `./offered-kinds`: that module is bundled
 * into most runners' chunks, and this sentence belongs to one panel.
 */
export const DEEP_COMPRESSION_GRAYSCALE_HINT =
  "Turns every colour on the pages — pictures, text and drawings — into shades of gray. Our server checks the result and refuses it if a picture is still in colour.";
