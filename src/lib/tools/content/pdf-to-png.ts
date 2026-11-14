import type { ToolContent } from "./types";
import { BOARD_PAGE_LIMIT_SENTENCE } from "@/lib/pdf/pdfjs-board-limit";
import {
  DEFAULT_RASTER_BACKGROUND,
  DEFAULT_RESOLUTION_ID,
  RASTER_BACKGROUNDS,
  RASTER_BACKGROUND_LABEL,
  RASTER_PREVIEW_LIMIT,
  RASTER_RESOLUTIONS,
  pageImageName,
  rasterScaleForDpi,
  resolutionById,
  shouldZipPages,
  zipOutputName,
} from "@/lib/pdf/pdf-to-image";
import { LARGE_RASTER_PAGES, defaultResolution } from "@/lib/intent/defaults";
import { getRunnerKind } from "@/lib/pdf/registry";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import {
  IMAGE_BATCH_FOLDERS,
  IMAGE_BATCH_TOOLS,
  batchLimitsSentence,
} from "@/lib/batch/tools";

/**
 * Background (2026-11-07, audit pdf-to-png#5): the heading and chips from
 * the runner's table. Until then the intro said "Pages are painted onto
 * white, so the PNGs are opaque", which was true: pdf.js made its context
 * with `alpha: false`. render-transparent.test.ts reads the alpha channel.
 */
const bgLabel = (id: string) =>
  RASTER_BACKGROUNDS.find((b) => b.id === id)!.label;
const BG_WHITE = bgLabel(DEFAULT_RASTER_BACKGROUND);
const BG_CLEAR = bgLabel("transparent");

/*
 * Every figure below is read from the code that enforces it:
 *  - the resolution presets and the default one from `pdf-to-image.ts`, the
 *    same list the runner's Resolution chips map over;
 *  - points-per-inch from `rasterScaleForDpi`, the function the renderer uses
 *    to turn a DPI into a pdfjs scale (scale 1 is reached at that DPI);
 *  - the size cap from the ceiling of the runner this slug dispatches to,
 *    which is the constant `validatePdfFile` refuses a file above;
 *  - the file names from `pageImageName` / `zipOutputName`, called with the
 *    argument shape pdf-to-image-runner.tsx uses, so the example cannot drift.
 *
 * Behaviour read from the code on 2026-09-27 (none of it is a number):
 *  - runner: pdf-to-image-runner.tsx (format "png") inside SinglePdfRunner.
 *    Dropzone title "Drop your PDF here, or" + "browse"; only files[0] is used.
 *    Run button "Render <n> page(s)"; result buttons "Download PNG" (one page)
 *    or "Download ZIP (<n> images)", and "Change resolution". Preview grid is
 *    capped by PREVIEW_LIMIT (not exported, so no number is stated); the ZIP
 *    holds every page.
 *  - background: the runner passes none, so rasterizePdf paints "#ffffff".
 *  - rotation: rasterizePdf calls page.getViewport({ scale }) with the default
 *    (embedded) rotation.
 *  - pixel cap: RASTER_MAX_DEVICE_PX in render.ts is not exported, so the copy
 *    says a cap exists and gives no number, and no page size is promised the
 *    full DPI. AMENDED 2026-10-31: RASTER_MAX_DEVICE_PX and
 *    RASTER_PREVIEW_LIMIT are now exported from src/lib/pdf/pdf-to-image.ts,
 *    and the PDF to PNG guide states both; this page still states neither.
 *  - encryption (AMENDED 2026-10-06): the runner reads with reader="pdfjs"
 *    (single-pdf-reader.test.ts), and pdf.js opens an owner-password-only file,
 *    so it converts; only a file that needs a password to open is refused, with
 *    PDF_NEEDS_PASSWORD_MESSAGE. Until then this said ANY /Encrypt was refused;
 *    encryption-claims.test.ts now holds the page to the runner's reader.
 *    Unlock PDF is processing "server" in the catalogue.
 *  - pages and colour (ADDED 2026-10-24): a "Pages" section with "All
 *    pages" (the default) and "Select pages", which shows a text box read by
 *    rasterPageSelection → parsePageList (ranges.ts, the parser Extract Pages
 *    uses), and a "Colour" section with Colour (default) and Grayscale. The
 *    run button counts the CHOSEN pages; file names keep the page's number
 *    in the document (pageImageName with the document's page count), so a
 *    single chosen page of a longer PDF downloads as "<name>-page-NN".
 *    Grayscale PNG is the canvas after the grayscale pass, encoded by the
 *    browser: grey pixels in its usual RGB(A) PNG, NOT a one-channel PNG, and
 *    the copy says so.
 *  - undecoded images: UndecodedImagesNotice receives the SUM over all pages,
 *    so it gives a total, not page numbers.
 */
const runner = getRunnerKind("pdf-to-png");
if (!runner) {
  throw new Error(
    'pdf-to-png content: no in-browser runner is registered for "pdf-to-png"',
  );
}
const MIB = 1024 * 1024;
const ceilingMb = Math.round(RUNNER_FILE_CEILINGS[runner] / MIB);

const presets = RASTER_RESOLUTIONS;
const lowest = presets[0]!;
const highest = presets[presets.length - 1]!;
const standard = resolutionById(DEFAULT_RESOLUTION_ID);
// What the runner opens at (pdf-to-image-runner.tsx): a long PDF at the
// smart default, otherwise the resolution last picked in this browser
// (option memory), otherwise DEFAULT_RESOLUTION_ID. ADDED 2026-11-06 (audit
// #41): the page said only that the default was "selected at the start".
const longStart = defaultResolution(LARGE_RASTER_PAGES + 1, RASTER_RESOLUTIONS);
if (!longStart || longStart.id === DEFAULT_RESOLUTION_ID) {
  throw new Error("pdf-to-png content: the long-PDF resolution rule changed");
}
const longLabel = resolutionById(longStart.id).label;
const startSentence = `${standard.label} is selected at the start for a PDF of up to ${LARGE_RASTER_PAGES} pages and ${longLabel} for a longer one; once you convert at a resolution you picked, this browser remembers it and opens a PDF of up to ${LARGE_RASTER_PAGES} pages at it next time.`;
const POINTS_PER_INCH = Math.round(1 / rasterScaleForDpi(1));

const presetChoices = presets.map((r) => `${r.label} (${r.dpi} DPI)`);
const presetSentence =
  presetChoices.length > 1
    ? `${presetChoices.slice(0, -1).join(", ")} or ${presetChoices[presetChoices.length - 1]}`
    : presetChoices.join("");
const dpiList =
  presets.length > 1
    ? `${presets
        .slice(0, -1)
        .map((r) => r.dpi)
        .join(", ")} or ${highest.dpi}`
    : `${highest.dpi}`;

/** Names the runner gives a 120-page "manual.pdf" and a one-page "logo.pdf". */
const EXAMPLE_PAGES = 120;
const exampleZip = zipOutputName("manual.pdf", "png");
const exampleFirst = pageImageName("manual.pdf", 0, EXAMPLE_PAGES, "png");
const exampleLast = pageImageName(
  "manual.pdf",
  EXAMPLE_PAGES - 1,
  EXAMPLE_PAGES,
  "png",
);
const exampleSingle = pageImageName("logo.pdf", 0, 1, "png");
if (!shouldZipPages(EXAMPLE_PAGES) || shouldZipPages(1)) {
  throw new Error("pdf-to-png content: the single-vs-ZIP rule changed");
}

const content: ToolContent = {
  slug: "pdf-to-png",

  seoTitle: "PDF to PNG Converter — Runs in Your Browser",

  metaDescription: `Turn every PDF page into a lossless PNG at ${dpiList} DPI. Rendering happens on your device with no upload, and a multi-page PDF downloads as one ZIP.`,

  intro: [
    "PDF to PNG, a page-to-image converter, draws each page of a PDF (or only the pages you pick) onto a canvas and saves the result as a PNG: a picture of the whole page, with text, vector graphics and photos flattened into one image. PNG is lossless, so small type and hairline rules keep their edges instead of gaining the ringing JPEG leaves around sharp contrast. As with any page image, the words inside can no longer be selected or searched.",
    `The conversion runs on your own device: a copy of pdf.js bundled with pdf.xyz draws the pages inside your browser tab, and the PDF is not uploaded. When a page holds JBIG2 or JPEG 2000 images, the code that decodes them is fetched from pdf.xyz's own site, never a third-party CDN. It takes PDFs of at most ${ceilingMb} MB each, and two or more at once open as a batch. ${BOARD_PAGE_LIMIT_SENTENCE} A PDF that needs a password to open stops as it loads, with a message that it is password-protected and must be unlocked first. One that opens without a password and merely restricts printing or copying converts like any other.`,
    `Pick ${presetSentence}; pages render at that density and keep the rotation stored in the PDF, though an oversized page such as a poster is scaled down to a fixed pixel ceiling. Under ${RASTER_BACKGROUND_LABEL}, ${BG_WHITE} is selected at the start and paints each page onto white; ${BG_CLEAR} leaves every part of the page that the PDF does not paint see-through, so a logo, signature or diagram can sit on a coloured slide. A one-page PDF saves as a single image (logo.pdf gives ${exampleSingle}). When more than one page is rendered they are bundled into a ZIP, with leading zeros on the page numbers so they have as many digits as the page count: all pages of a ${EXAMPLE_PAGES}-page manual.pdf give ${exampleZip}, which contains ${exampleFirst} up to ${exampleLast}. Grayscale renders the pages in shades of grey.`,
  ],

  useCases: [
    {
      title: "Dropping a page into slides or a design file",
      body: "Presentation and design apps that handle PDFs awkwardly accept a PNG of the page, which you can crop and layer like any picture.",
    },
    {
      title: "Diagrams and charts for documentation",
      body: "Line art and small print are where lossless output matters: a wiring diagram or a chart stays legible in a wiki, help article or bug report without smudges around every stroke.",
    },
    {
      title: "Sharing a page where PDFs are not accepted",
      body: "Chat apps, CMS image fields, marketplace listings and social posts often want an image file rather than a PDF; this gives you one image per page.",
    },
    {
      title: "Convert a stack of PDFs at once",
      body: `Add two or more PDFs and they open as a batch list. Pick one resolution, colour and background for all of them and press Convert with the number of files: every page of each file becomes a PNG, each file in turn, in your browser, and nothing is uploaded. Download a file's images from its row, or press “Download all” for ${IMAGE_BATCH_TOOLS["pdf-to-png"].zipName}. ${IMAGE_BATCH_FOLDERS} ${batchLimitsSentence("pdf-to-png")} To choose pages, open one file on its own. A file whose author restricted it fails on its own row in a batch; opened on its own, it converts.`,
    },
    {
      title: `${highest.label}-resolution page images at ${highest.dpi} DPI`,
      body: `${highest.label} asks for ${highest.dpi} pixels per inch of page, for printing a page as an image or zooming into fine detail; only a page large enough to hit the pixel ceiling comes out with fewer. ${lowest.label} at ${lowest.dpi} DPI keeps files small for on-screen use.`,
    },
  ],

  steps: [
    {
      title: "Add your PDF",
      body: 'Drag a PDF onto the "Drop your PDF here, or browse" panel; clicking anywhere on that panel opens a file picker instead. Two or more files open a batch list. Once one has loaded, a header above the Resolution row shows its name, how many pages it has and how large it is.',
    },
    {
      title: "Choose a resolution",
      body: `The Resolution row has one chip per preset, each captioned with its DPI: ${presetSentence}. ${startSentence} Choose another before you render if you need smaller or sharper images.`,
    },
    {
      title: "Choose the pages, colour and background",
      body: `Under Pages, keep All pages, or click Select pages and type the pages you want, such as 1-3, 5, or press them on the thumbnails drawn below the box; a press updates the box, and Select all, Clear, Odd pages and Even pages pick in one go. Under Colour, keep Colour or pick Grayscale. Under ${RASTER_BACKGROUND_LABEL}, keep ${BG_WHITE} or pick ${BG_CLEAR}.`,
    },
    {
      title: "Render the pages",
      body: "Press the Render button, which states how many pages it will convert. A progress line counts pages as they finish, then a preview grid appears.",
    },
    {
      title: "Download the PNGs",
      body: `Press "Download PNG" for a single-page file, or "Download ZIP" (followed by the image count) when more than one page was rendered. Each of the first ${RASTER_PREVIEW_LIMIT} pages can also be saved on its own from the download button on its preview tile. "Change resolution" takes you back to render again at a different setting.`,
    },
  ],

  faqs: [
    {
      q: "Is my PDF uploaded when I convert it to PNG?",
      a: "No. pdf.js renders the pages inside your browser, and the PNG files are built in the same tab. The PDF is not sent to a pdf.xyz server, or anywhere else, to be converted.",
    },
    {
      q: "Which resolution should I choose?",
      a: `PDF pages are sized in points, ${POINTS_PER_INCH} of them per inch, and the renderer turns every inch of page into as many pixels as the chosen DPI, unless the page is big enough to reach the pixel ceiling. Choose ${lowest.label} (${lowest.dpi} DPI) for pages that will only be looked at on a monitor, keep ${standard.label} (${standard.dpi} DPI) when unsure, and move up to ${highest.label} (${highest.dpi} DPI) for printing or for zooming into small print. Doubling the DPI roughly quadruples the pixels on each page, so files grow and rendering slows.`,
    },
    {
      q: "Can I convert only some pages?",
      a: `Yes. Click Select pages and type the page, or a list such as 1-3, 5, or press the pages you want on the thumbnails under the box. Only those pages are rendered. One page downloads on its own and keeps its number from the PDF — page 7 of the ${EXAMPLE_PAGES}-page manual.pdf is ${pageImageName("manual.pdf", 6, EXAMPLE_PAGES, "png")} — and several arrive in the ZIP.`,
    },
    {
      q: "Why is a picture missing from one of my PNGs?",
      a: "If the engine cannot decode an embedded image, that image comes out blank while the rest of the page converts normally. The result panel then shows a warning with the total number of images affected across the document; it does not name the pages, so look over the ones that carry photos or scans.",
    },
    {
      q: "Can the PNG have a transparent background?",
      a: `Yes. Pick ${BG_CLEAR} under ${RASTER_BACKGROUND_LABEL} before you render, and whatever the page does not paint comes out see-through instead of white. It works when the PDF really leaves its background empty, as a logo, stamp or signature exported from a design app usually does. Many PDFs made by word processors and scanners paint a white rectangle over the whole page, and that rectangle stays white in the PNG: it is part of the page.`,
    },
    {
      q: "Should I pick PNG or JPG for PDF pages?",
      a: "PNG is lossless, which suits text, line drawings and flat colour. JPEG is built for photographs and usually makes smaller files from photo-heavy pages; PDF to JPG offers the same resolution choices. Neither keeps text selectable.",
    },
  ],

  relatedGuides: [],
};

export default content;
