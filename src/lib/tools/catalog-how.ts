import { US_LETTER_LABEL } from "@/lib/pdf/page-geometry";
import {
  RASTER_RESOLUTION_CHOICES as RESOLUTION_CHOICES,
  RASTER_PREVIEW_LIMIT,
} from "@/lib/pdf/pdf-to-image";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { PDF_A_STANDARD } from "@/lib/jobs/pdfa-results";
import {
  MAX_REQUEST_SIGNERS,
  REQUEST_PACKAGE_FILES,
} from "@/lib/jobs/request-signatures";

/**
 * The authored "How it works" steps, by tool slug — server-side only.
 *
 * They lived on each catalogue entry until 2026-10-24, and the catalogue is
 * client code: every tool page shipped all thirty tools' steps to read its
 * own, which nothing in the browser does (`howToSteps` in tool-facts.ts, the
 * one reader, renders on the server). The option PRs #206–#210 lengthened
 * them and pushed tool pages past the bundle budget. Tools without an entry
 * get derived or default steps.
 */
export const TOOL_HOW: Readonly<Record<string, readonly string[]>> = {
  "merge-pdf": [
    "Add two or more PDF files.",
    "Drag files, or use each row's move buttons, to set the order you want.",
    "Merge and download your combined PDF.",
  ],
  "split-pdf": [
    "Pick the PDF you want to split — it stays on your device.",
    "Choose page ranges or a split-every-N-pages rule.",
    "Download the result — a single piece saves as a PDF, and several arrive together as one ZIP.",
  ],
  "organize-pages": [
    "Pick your PDF — every page opens as a tile on a page board, and the file stays on your device.",
    "Drag tiles into a new order, or use each tile's move buttons; rotate, duplicate or delete any page from its tile, or insert a blank page before or after it.",
    "Change your mind with “Undo” and “Redo” (Ctrl/⌘+Z and Ctrl/⌘+Shift+Z), or start over with “Reset”.",
    "Click “Apply & export”, then “Download organized PDF”.",
  ],
  "remove-pages": [
    "Pick your PDF — a thumbnail of every page appears, and the file stays on your device.",
    "Click the pages to delete, Shift-click to select a run of pages, or type a list like 2-4, 9 and press “Select”.",
    "Click “Delete” to remove them — at least one page has to stay.",
    "Click “Download PDF” to save the trimmed copy.",
  ],
  "rotate-pdf": [
    "Pick your PDF — every page appears as a thumbnail, and the file stays on your device.",
    "Select the pages to turn, or select none to turn them all; Shift-click selects a run, and “Odd pages” or “Even pages” selects every other page.",
    "Turn them with “Left”, “Right” or “180°”, or with the arrows on a single page; “Rotate all 180°” flips every page at once.",
    "Click “Apply rotation”, then “Download rotated PDF”.",
  ],
  "extract-images": [
    "Add your PDF — every page is scanned for embedded images, right in your browser.",
    "Embedded JPEGs are saved as-is; RGB and grayscale images are rebuilt losslessly as PNGs at native size.",
    "Download the images individually or as one ZIP; anything in an unsupported format is listed as skipped.",
  ],
  "compress-pdf": [
    "Add your PDF — it's analyzed privately, right in your browser.",
    "Review the size breakdown and download a lossless-optimized copy.",
    "For image-heavy files, deep image compression runs on a secure, auto-deleting server — the page checks one is available before anything leaves your device.",
  ],
  "repair-pdf": [
    "Upload the damaged PDF over an encrypted connection — it only has to start like a PDF, so a truncated file is taken in.",
    "Press “Repair on our secure server”: qpdf rewrites the file's structure on our secure server, which deletes the input when the job finishes.",
    `Download the repaired PDF — the link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes. If the file had to be rebuilt, a list above the download says what was reconstructed.`,
  ],
  // Authored because the runner takes MANY images, and the default steps
  // say "pick your file" (tool-page-content.test.ts discovers multi-file
  // runners and requires their own steps).
  "jpg-to-pdf": [
    "Pick one or more JPG or PNG images — they stay on your device.",
    "Put them in page order with each image's “Move up” and “Move down” buttons.",
    `Set “Page size”, “Orientation”, “Margin” and “Output” if you want to — left alone, each image is centred on its own ${US_LETTER_LABEL} portrait page in one PDF.`,
    "Click “Create PDF” — the PDF is assembled in your browser.",
    "Download the PDF — or, with One PDF per image and more than one image, the ZIP of PDFs.",
  ],
  "png-to-pdf": [
    "Pick one or more PNG or JPG images — they stay on your device.",
    "Put them in page order with each image's “Move up” and “Move down” buttons.",
    "Set “Page size”, “Orientation”, “Margin” and “Output” if you want to — left alone, each image goes on its own page in one PDF.",
    "Click “Create PDF” — the PDF is assembled in your browser.",
    "Download the PDF — or, with One PDF per image and more than one image, the ZIP of PDFs.",
  ],
  "html-to-pdf": [
    "Upload one .html or .htm file over an encrypted connection.",
    "Select Render PDF — Chromium renders it on a secure server that deletes the input when the job finishes.",
    `Download the PDF — the link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes.`,
  ],
  "webpage-to-pdf": [
    "Paste a public http(s) URL.",
    "Select Render PDF — Chromium captures the page on a secure server.",
    `Download the PDF — the link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes.`,
  ],
  "markdown-to-pdf": [
    "Paste Markdown into the editor, or pick a .md file — it stays on your device.",
    "Click “Create PDF” — the Markdown is typeset into pages in your browser.",
    "Click “Download PDF” to save it.",
  ],
  "text-to-pdf": [
    "Paste or type your text, or pick a .txt file — it stays on your device.",
    "Click “Create PDF” — the text is paginated in your browser.",
    "Click “Download PDF” to save it.",
  ],
  "pdf-to-jpg": [
    "Pick your PDF — it stays on your device.",
    `Choose a resolution: ${RESOLUTION_CHOICES}.`,
    "Keep “All pages”, or choose “Select pages” and type a range such as 1-3, 5; pick colour or grayscale under “Colour”.",
    "Click “Render” — each chosen page becomes a JPG image, in your browser.",
    `Download the result — several pages arrive together as one ZIP, and each of the first ${RASTER_PREVIEW_LIMIT} pages can also be saved on its own from its preview.`,
  ],
  "pdf-to-png": [
    "Pick your PDF — it stays on your device.",
    `Choose a resolution: ${RESOLUTION_CHOICES}.`,
    "Keep “All pages”, or choose “Select pages” and type a range such as 1-3, 5; pick colour or grayscale under “Colour”.",
    "Click “Render” — each chosen page becomes a PNG image, in your browser.",
    `Download the result — several pages arrive together as one ZIP, and each of the first ${RASTER_PREVIEW_LIMIT} pages can also be saved on its own from its preview.`,
  ],
  "pdf-to-pdfa": [
    "Upload your PDF over an encrypted connection.",
    `Press “Convert to PDF/A”: Ghostscript converts it to ${PDF_A_STANDARD} on our secure server, which deletes the input when the job finishes.`,
    `Download the result — the link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes. Anything the conversion had to remove is listed with the download.`,
  ],
  "pdf-to-markdown": [
    "Pick your PDF — it stays on your device.",
    "Select Create Markdown to convert its selectable text in your browser.",
    "Preview the Markdown on the page.",
    "Download the .md file.",
  ],
  "pdf-to-text": [
    "Pick your PDF — it stays on your device.",
    "Select Extract text.",
    "Preview the extracted text on the page.",
    "Download it as a .txt file.",
  ],
  "edit-pdf": [
    "Open your PDF — every page is shown as your viewer shows it.",
    "Click a line of text to retype it, or pick a tool and click on the page to add text, images, signatures or shapes.",
    "Apply & download a PDF with your changes written into the page.",
  ],
  "annotate-pdf": [
    "Open your PDF — Highlight is ready in the Mark up group.",
    "Drag or click on the page to highlight, draw, white out or add a note.",
    "Apply & download the annotated PDF with the markups in the page.",
  ],
  "crop-pdf": [
    "Open the PDF you want to crop.",
    "Set the crop margins in pt, mm or in, or let Auto find the white margins, and choose which pages to apply them to.",
    "Download your cropped PDF.",
  ],
  "header-footer": [
    "Open the PDF you want to label — it stays on your device.",
    "Type your header text, footer text, or both — {n}, {total} and {date} insert the page number, the page count and today's date.",
    "Choose Left, Center or Right alignment for each.",
    "Download your PDF.",
  ],
  "sign-pdf": [
    "Open the PDF you need to sign.",
    "Create a signature by drawing, typing, or picking an image.",
    "Tap or click the page to place it, then Apply & download.",
  ],
  "request-signatures": [
    "Upload your PDF over an encrypted connection.",
    `Add up to ${MAX_REQUEST_SIGNERS} signers — a name and an email each — with “Add signer”, then choose the “Signing order”, the “Signature page” their fields go on, and whether each signature gets a date field beside it.`,
    "Press “Prepare signature request”: our secure server adds a named, fillable field for each signer and deletes the input when the job finishes.",
    `Download the ZIP — the link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes — and send ${REQUEST_PACKAGE_FILES.prepared} to your signers yourself: pdf.xyz does not email it or track who has signed.`,
  ],
  "unlock-pdf": [
    "Upload the password-protected PDF over an encrypted connection.",
    "Type the password that currently opens it.",
    "Our secure server removes the encryption and deletes the input when the job finishes.",
    `Download the unlocked copy — the link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes.`,
  ],
  "redact-pdf": [
    "Add your PDF — everything runs privately in your browser.",
    "Find a word or detect emails, phone and card numbers, then tick the matches to remove — or add boxes by page and position.",
    "Download a PDF flattened to images with the content erased under each box, or one with only the text under each box removed.",
  ],
  "flatten-pdf": [
    "Open a PDF with fillable form fields.",
    "Select Flatten form fields — each field's current value is drawn into the page.",
    "Download a PDF whose field values can no longer be edited.",
  ],
  // Two files, in an order that matters: compare-pdf.ts reports lines only
  // in the FIRST as removed and lines only in the SECOND as added.
  "compare-pdf": [
    "Pick two PDFs — the first is treated as the original, the second as the revised version. Both stay on your device.",
    "Select Compare PDFs to compare their page count, file size and selectable text.",
    "Review the lines marked removed (-) and added (+), then download the comparison report as a .txt file.",
  ],
  "chat-with-pdf": [
    "Upload your PDF.",
    "Ask a question in plain language.",
    "Get a grounded answer with page-level citations, then ask follow-ups.",
  ],
};
