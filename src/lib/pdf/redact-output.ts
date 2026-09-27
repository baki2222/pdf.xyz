/**
 * What Redact PDF's output is made of, defined once for the engine that builds
 * it, the runner that offers the choices, and the tool page that describes it.
 *
 * A leaf on purpose: `redact.ts` pulls pdfjs and pdf-lib, and `tool-facts.ts`
 * ships in the client bundle of every runner that imports it — the page must
 * be able to name the presets and the image format without either.
 * `redact-answers.test.ts` builds a redacted PDF with the engine's own
 * assembler and holds the page's sentences to the bytes that come out.
 */

/** The resolutions the runner offers, in the order it lists them. */
export const REDACT_DPI_PRESETS = [
  { id: "screen", label: "Screen", dpi: 96 },
  { id: "print", label: "Print", dpi: 150 },
] as const;

export type RedactDpiPreset = (typeof REDACT_DPI_PRESETS)[number]["id"];

/** The preset selected when the tool opens, and the engine's fallback. */
export const DEFAULT_REDACT_PRESET_ID: RedactDpiPreset = "print";

/** Every page of a redacted PDF is rebuilt from an image in this format. */
export const REDACT_IMAGE_FORMAT = "jpg" as const;

/** The only title a redacted PDF carries; nothing of the original's info survives. */
export const REDACTED_PDF_TITLE = "Redacted PDF";
