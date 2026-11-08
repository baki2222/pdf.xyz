/**
 * What PDF to PDF/A does to colour, said where the user decides (audit
 * pdf-to-pdfa#5, 2026-11-08). A LEAF, no imports: the worker's argv takes
 * its strategy from here, and the panel and the page take their sentence
 * from here, so the claim moves with the flag.
 *
 * Ghostscript runs with `-sColorConversionStrategy=RGB` and the prefix embeds
 * an sRGB profile as the OutputIntent (`./native`). Every DeviceCMYK,
 * Separation (spot) and DeviceN colour in the input is therefore converted
 * to RGB. PDF/A itself would allow CMYK under a CMYK OutputIntent; keeping
 * CMYK is NOT offered here, so the sentence says what happens instead.
 */

/** Ghostscript's ColorConversionStrategy for every PDF/A job. */
export const PDFA_COLOUR_STRATEGY = "RGB";

/** The profile the copy's OutputIntent embeds. */
export const PDFA_OUTPUT_PROFILE = "sRGB";

/** The one sentence the panel and the page both show. */
export const PDFA_COLOUR_NOTE = `Colours are converted to ${PDFA_COLOUR_STRATEGY} with an ${PDFA_OUTPUT_PROFILE} profile, so CMYK and spot colours in a print-ready file come back as ${PDFA_COLOUR_STRATEGY}. Keep your original if you send it to a printer.`;
