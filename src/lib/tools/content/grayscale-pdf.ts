import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import {
  GRAYSCALE_DPI_PRESETS,
  grayscalePresetById,
} from "@/lib/pdf/grayscale";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";

/*
 * Behaviour claims below were read from the implementation on 2026-09-27:
 *  - src/components/tools/runner/grayscale-runner.tsx — the "Output quality"
 *    segmented control (labels built from GRAYSCALE_DPI_PRESETS, "print"
 *    preselected), "Convert to grayscale", the "Converting pages… n/total"
 *    progress, the result summary, "Download grayscale PDF", and
 *    UndecodedImagesNotice;
 *  - src/lib/pdf/grayscale.ts — pages rendered, then a NEW PDFDocument built
 *    from those images only, output named `<name>-grayscale.pdf`. CHANGED
 *    since (history kept): this said the pages were JPEGs and the file was
 *    titled "Grayscale PDF". Since L08 (85ee451) each page's luminance plane
 *    goes to createGrayscaleBuilder (grayscale-builder.ts), which stores it
 *    as whichever is smaller, a lossless FlateDecode image or a one-component
 *    JPEG (encodeGrayJpeg), both /DeviceGray; the title is
 *    grayscaleTitle(source title, file name) = "<title or stem> (grayscale)",
 *    "Grayscale PDF" only when both are empty;
 *  - src/lib/pdf/render.ts — rasterizePdf reports progress per page rendered
 *    (the new PDF is assembled only after every page is done), calls
 *    page.render() with no annotationMode, so pdfjs-dist 6.1.200 uses
 *    AnnotationMode.ENABLE (build/pdf.mjs render() default) and draws saved
 *    annotation/widget appearances; converts with Rec. 601 weights in
 *    grayscaleImageData; and clamps the LONGER rendered side to the private
 *    RASTER_MAX_DEVICE_PX. That constant is not exported, so no figure for it
 *    is stated below; the cap is reached at a smaller page size for the
 *    higher-DPI preset, so the copy does not claim both presets are cut.
 *  - use-single-pdf.ts → engine.ts loadPdf — PDFDocument.load without
 *    ignoreEncryption, so ANY /Encrypt dictionary is refused. RUN 2026-09-27:
 *    an owner-password-only PDF (pypdf, user password "", opens with an
 *    empty password) was refused by getPageRotations with "This PDF is
 *    password-protected. Unlock it first, then try again."; an unencrypted
 *    control loaded. AMENDED 2026-10-06: still refused, but since wave1's
 *    encryption work in the words of the pdf.js probe's verdict
 *    (src/lib/pdf/encryption.ts) — that file now gets the editing-
 *    restrictions sentence, and only a file that needs a password to open is
 *    called password-protected.
 *  - colour space, RUN 2026-09-27: Chromium 152's canvas.toBlob("image/jpeg")
 *    on an already-gray canvas wrote SOF components = 3; those bytes through
 *    embedRasterImage → pdf-lib saved an image XObject with /ColorSpace
 *    /DeviceRGB, and the preflight answer said the output was RGB.
 *    SUPERSEDED (history kept): canvas.toBlob is no longer called. Every page
 *    image is /DeviceGray (grayscale-output.test.ts walks every image XObject
 *    and every content stream), so the answer now says a colour-space
 *    preflight reports grayscale; tool-faq-substance builds pages through the
 *    builder and holds the served answer to what the saved file declares.
 *  - Unlock PDF's password field cannot be empty (unlock-pdf.ts header), and
 *    its owner-password acceptance is qpdf's documented behaviour, untested
 *    by pdf.xyz; the FAQ only repeats what that tool's own page says.
 *  - pdf-lib and pdf.js are dynamic imports (pdf-lib.ts loadPdfLib,
 *    render.ts loadPdfjs), fetched when a file is opened and when Convert
 *    runs — so the page needs the network until conversion is under way, not
 *    only to open.
 * Every number is interpolated from the constant that owns it.
 */
const SCREEN = grayscalePresetById("screen");
const PRINT = grayscalePresetById("print");
const MAX_MB = Math.round(RUNNER_FILE_CEILINGS.grayscale / (1024 * 1024));
const OUTPUT_TTL = DEFAULT_RETENTION.outputTtlMinutes;
const PRESET_LABELS = GRAYSCALE_DPI_PRESETS.map(
  (preset) => `${preset.label} (${preset.dpi} DPI)`,
).join(" or ");

const content: ToolContent = {
  slug: "grayscale-pdf",

  seoTitle: "Grayscale PDF — Convert a Color PDF to Grayscale",

  metaDescription: `Turn a color PDF into shades of gray in your browser, with no upload. Choose ${SCREEN.dpi} or ${PRINT.dpi} DPI. Text becomes part of a page image, so keep the original.`,

  intro: [
    "Grayscale PDF returns a copy of your document in which every page is shades of gray. Each page is drawn to an image and every pixel becomes a weighted brightness value that counts green most and blue least, so pure red and pure green end up as two distinct grays rather than one. The gray images go into a new PDF, each page at the size the original displays at.",
    `The conversion runs in your browser using a bundled copy of pdf.js, and your PDF is not uploaded to pdf.xyz: the file you choose is read into memory on your device, and the result is saved as a download named after the original with "-grayscale" added. The picker takes one PDF of up to ${MAX_MB} MB.`,
    "Because every page becomes a picture (a lossless image for text-heavy pages, a JPEG for photographic ones, whichever is smaller), the result is a copy for printing or submitting, not for editing. Selectable text, sharp vector lines, links and bookmarks do not carry over, and the new file is titled after the original's own title, or its file name if it has none, with \"(grayscale)\" added. Form fields or comments are painted in from their saved appearance, so they can no longer be filled in or clicked. The new file's size follows the page count, the resolution you pick and how busy each page is, so a short text-only file can grow while a photo-heavy one can shrink. Keep the original alongside it.",
  ],

  useCases: [
    {
      title: "Printing on a monochrome laser printer",
      body: "Colored charts, highlighted rows and brand-colored headings can collapse into similar gray blocks when a printer driver desaturates them. Converting first gives you a gray copy to inspect on screen, and printing that copy sends the printer gray pixels instead of leaving the color-to-gray mapping to its driver.",
    },
    {
      title: "Portals that ask for grayscale uploads",
      body: "Some application forms and document portals ask for grayscale files. This gives you a gray copy of a PDF you already have without re-scanning the paper. Its page images are stored in the single-channel grayscale (DeviceGray) color space, which is what a portal that inspects the file's declared color space looks for.",
    },
    {
      title: "Checking a chart before black-and-white handouts",
      body: "Two data series told apart only by hue, with similar brightness, will look almost identical in the output. That flags a chart that needs patterns or direct labels before it is photocopied.",
    },
    {
      title: "Toning down a scanned color document",
      body: "Receipts and forms scanned in color often carry a yellow or blue cast from the paper. In the gray version that cast becomes a light gray, so the page no longer looks tinted.",
    },
  ],

  steps: [
    {
      title: "Add your PDF",
      body: `Drag a single PDF into the dashed box, or click "browse" and choose it. Anything over ${MAX_MB} MB, empty, not a PDF, or encrypted is refused with a reason.`,
    },
    {
      title: "Pick the output quality",
      body: `Under "Output quality", choose ${PRESET_LABELS}. ${PRINT.label} is selected by default; ${SCREEN.label} renders fewer pixels per page and usually gives a smaller file.`,
    },
    {
      title: "Convert to grayscale",
      body: 'Press "Convert to grayscale". A progress line counts pages as each is rendered and turned gray; the new PDF is assembled after the last one.',
    },
    {
      title: "Download the result",
      body: 'Press "Download grayscale PDF". The summary shows how many pages were rasterized and the new file size, with a warning if any source image could not be decoded.',
    },
  ],

  faqs: [
    {
      q: "Does converting to grayscale send my PDF anywhere?",
      a: "No. Rendering, the gray conversion and building the new PDF all happen in your browser tab, and the file is not sent to pdf.xyz. The PDF engines themselves are fetched from the site when you choose a file and when you press Convert, so stay online until the conversion finishes; saving the finished file needs no connection.",
    },
    {
      q: "Can I still select or search the text after converting?",
      a: `No. Each page is stored as one image, so the text is part of the picture. OCR PDF can add a recognized text layer to the gray copy, and the ${PRINT.label} setting gives it more pixels to read. Unlike this tool, OCR PDF uploads the file over TLS to pdf.xyz's secure server; there the input is deleted when the job finishes, the result's download link expires after ${OUTPUT_TTL} minutes, and a daily storage rule erases the stored copy after that.`,
    },
    {
      q: `What is the difference between ${SCREEN.label} and ${PRINT.label}?`,
      a: `They set how many pixels each page is drawn at: ${SCREEN.dpi} DPI for ${SCREEN.label}, ${PRINT.dpi} DPI for ${PRINT.label}. ${SCREEN.label} suits reading on a monitor and keeps the file lighter; ${PRINT.label} keeps small type and fine lines crisper on paper. There is also a ceiling on how many pixels one side of a page may be drawn at, so the browser does not run out of memory: a poster-size page can come out with fewer pixels than the setting asks for, and ${PRINT.label} reaches that ceiling on smaller pages than ${SCREEN.label} does.`,
    },
    {
      q: "Will a print shop's preflight check see the file as grayscale?",
      a: "Yes, by color space. Every page image is stored as a single-channel grayscale (DeviceGray) image: either losslessly compressed or a one-channel JPEG, whichever is smaller for that page. Nothing on the page is drawn in color, so a preflight check that reads the declared color space reports grayscale, not RGB. The pages are images, though, so a check that also expects live text or vector artwork will not find any. Keep the original for that.",
    },
    {
      q: "Does it work on password-protected PDFs?",
      a: `No. Any encrypted PDF is turned away as soon as you choose it, and the message says which lock it has. One that needs a password to open is called password-protected. One that opens without a password but carries an owner password restricting printing or copying is told it has editing restrictions instead. Unlock PDF strips the encryption if you give it the open password, or the owner password for one of those restricted files; its password box cannot be left blank. Unlock PDF is not in-browser: the file and password go over TLS to pdf.xyz's secure server, the input is deleted when the job finishes, the unlocked copy's link lasts ${OUTPUT_TTL} minutes, and a daily storage rule erases it after that. Bring the unlocked copy back here.`,
    },
    {
      q: "Why does the result say some images could not be decoded?",
      a: "The renderer reports embedded pictures it could not decode, and each one is left out of the gray page rather than guessed at. The result screen gives the count; the rest of those pages converted normally, so open them in the downloaded file and decide whether the gap matters before you rely on it.",
    },
  ],

  relatedGuides: ["how-to-make-a-scanned-pdf-searchable"],
};

export default content;
