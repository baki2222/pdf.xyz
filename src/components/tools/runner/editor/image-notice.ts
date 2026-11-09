/**
 * Said after the output paths' sentence (`EditorPdf.imageTooLarge`) when the
 * view leaves an over-budget image out (CO-08). pdf.js skips by ONE size,
 * its `maxImageSize`, set just below the smallest over-budget image, so every
 * image of that many pixels or more is left out with it, within budget or
 * not (a large bilevel page scan, say). The editor writes onto the file with
 * pdf-lib and never rasterizes it, so nothing is removed from the file.
 *
 * History (2026-11-09): this said the pages were drawn without "it", one
 * image, while a 144 MP page scan within budget vanished beside it.
 */
export const EDITOR_IMAGES_SKIPPED =
  "The pages here are drawn without it, or any other image at least as large; the editor removes none of them from your file.";
