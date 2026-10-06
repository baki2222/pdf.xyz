import type { ToolContent } from "./types";
import {
  DEFAULT_JPEG_QUALITY,
  DEFAULT_RESOLUTION_ID,
  RASTER_PREVIEW_LIMIT,
  RASTER_RESOLUTIONS,
  pageImageName,
  rasterScaleForDpi,
  resolutionById,
  shouldZipPages,
  zipOutputName,
} from "@/lib/pdf/pdf-to-image";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";

/*
 * Every behavioural claim below was read from the code on 2026-09-27:
 *  - runner: src/components/tools/runner/pdf-to-image-runner.tsx (format
 *    "jpg") inside SinglePdfRunner — a Dropzone that renders "Drop your PDF
 *    here, or browse" (runner-kit.tsx) and uses only the first file dropped;
 *    FileHeader shows "<n> pages · <size>"; the "Resolution" section maps
 *    RASTER_RESOLUTIONS to chips showing label + "<dpi> DPI"; the run button
 *    reads "Render <n> page(s)" and "Rendering JPG… done/total" while busy.
 *    Result: "Download JPG" (one page) or "Download ZIP (<n> images)",
 *    "Change resolution" (clears the result, back to the chips), "Start over"
 *    (ResultPanel default), per-tile download buttons on a preview grid that
 *    is capped (PREVIEW_LIMIT, not exported, so no number is stated), and
 *    UndecodedImagesNotice with the count of images pdfjs failed to decode.
 *  - quality: the runner passes no quality, so rasterizePdf encodes with
 *    clampJpegQuality(DEFAULT_JPEG_QUALITY) on a "#ffffff" background.
 *  - file names: pageImageName / zipOutputName, called here with the same
 *    arguments shape the runner uses, so the examples cannot drift.
 *  - encryption (AMENDED 2026-10-06): the runner reads with reader="pdfjs"
 *    (single-pdf-reader.test.ts derives it, and that every function it hands
 *    the bytes opens them with pdf.js only), and pdf.js opens a file that only
 *    carries an owner password, so it converts. Only a file that needs a
 *    password to open is refused, with PDF_NEEDS_PASSWORD_MESSAGE. This said
 *    pdf-lib refused every /Encrypt until then; encryption-claims.test.ts now
 *    holds the page to the runner's reader. Unlock PDF is a SERVER tool and
 *    its panel requires a non-empty password, so the FAQ says both.
 *  - decoders: PDFJS_DOCUMENT_DEFAULTS (wasm-assets.ts) passes wasmUrl and
 *    cMapUrl pointing at /pdfjs-wasm/ and /pdfjs-cmaps/ on our own origin; the
 *    pdfjs worker is bundled via new URL(..., import.meta.url).
 *  - pixel cap: RASTER_MAX_DEVICE_PX in render.ts is not exported, so the copy
 *    says a cap exists without a number. The Letter example below (612 x 792
 *    pt at the highest preset = 2550 x 3300 px) is inside that cap (5000)
 *    today. NOTHING CHECKS THAT: this file cannot import the cap, and a
 *    comment is not a guard. If render.ts ever exports it, compare the
 *    example's long side against it here and throw, like the ZIP rule below.
 *  - size cap: toolFileCeilingMb, which resolves the slug through the runner
 *    registry to the constant validatePdfFile refuses above.
 */
const tool = getToolBySlug("pdf-to-jpg");
const maxMb = tool ? toolFileCeilingMb(tool) : null;
if (maxMb === null) {
  throw new Error("pdf-to-jpg content states a file ceiling it cannot find");
}

const presets = RASTER_RESOLUTIONS.map((r) => `${r.label} (${r.dpi} DPI)`);
const presetList = `${presets.slice(0, -1).join(", ")} or ${presets[presets.length - 1]}`;
const presetNames = RASTER_RESOLUTIONS.map((r) => r.label);
const presetNameList = `${presetNames.slice(0, -1).join(", ")} or ${presetNames[presetNames.length - 1]}`;
// The copy calls the first preset the smallest and the last the sharpest; that
// is only true while the list runs from lowest to highest DPI.
if (
  RASTER_RESOLUTIONS.length < 2 ||
  RASTER_RESOLUTIONS.some(
    (r, i) => i > 0 && r.dpi <= RASTER_RESOLUTIONS[i - 1]!.dpi,
  )
) {
  throw new Error(
    "pdf-to-jpg content: RASTER_RESOLUTIONS is no longer ascending",
  );
}
const lowest = RASTER_RESOLUTIONS[0]!;
const highest = RASTER_RESOLUTIONS[RASTER_RESOLUTIONS.length - 1]!;
const standard = resolutionById(DEFAULT_RESOLUTION_ID);
const quality = Math.round(DEFAULT_JPEG_QUALITY * 100);

/** US Letter is 612 x 792 PDF points; pixels = points x the renderer's scale. */
const LETTER_WIDTH_PT = 612;
const letterWidthAtHighest = Math.floor(
  LETTER_WIDTH_PT * rasterScaleForDpi(highest.dpi),
);

/** File names the runner would give a multi-page "report.pdf" and a 1-page one. */
const EXAMPLE_PAGES = 12;
const exampleFirst = pageImageName("report.pdf", 0, EXAMPLE_PAGES, "jpg");
const exampleLast = pageImageName(
  "report.pdf",
  EXAMPLE_PAGES - 1,
  EXAMPLE_PAGES,
  "jpg",
);
const exampleZip = zipOutputName("report.pdf", "jpg");
const exampleSingle = pageImageName("flyer.pdf", 0, 1, "jpg");
if (!shouldZipPages(EXAMPLE_PAGES) || shouldZipPages(1)) {
  throw new Error("pdf-to-jpg content: the single-vs-ZIP rule changed");
}

const content: ToolContent = {
  slug: "pdf-to-jpg",

  seoTitle: "PDF to JPG — Save Each Page as a JPEG, No Upload",

  metaDescription: `Convert PDF to JPG in your browser, with no upload. Each page becomes a JPEG at ${presetNameList} resolution; several pages download as one ZIP.`,

  intro: [
    `PDF to JPG paints every page of your PDF onto a canvas with pdf.js and saves each one as a JPEG picture, with the page's built-in rotation applied. The renderer and its decoders for JPEG 2000 and JBIG2 images load from pdf.xyz itself, and all of the drawing and encoding is done by your own browser: the PDF is not uploaded.`,
    `There are ${RASTER_RESOLUTIONS.length} resolutions to choose from: ${presetList}, with ${standard.label} selected at the start. There is no quality slider; every JPEG is encoded at quality ${quality} out of 100 on a white background, since JPEG cannot store transparency. A one-page PDF downloads as a single file (flyer.pdf becomes ${exampleSingle}). A longer one arrives as a ZIP: a ${EXAMPLE_PAGES}-page report.pdf becomes ${exampleZip}, holding ${exampleFirst} through ${exampleLast}, with page numbers zero-padded to the width of the page count so the images sort in reading order.`,
    `It converts a single PDF per run, up to ${maxMb} MB. One that needs a password to open stops at the loading step, with a message saying it is password-protected. A PDF that opens without a password converts even if its author restricted printing or copying. When pdf.js fails to decode an embedded image, the result panel states how many images could not be decoded rather than leaving you to spot the gap yourself.`,
  ],

  useCases: [
    {
      title: "Attach a page where only images are allowed",
      body: "Many photo fields, on listing sites, profile galleries and support-ticket forms, accept JPEG but not PDF. Convert the menu, certificate or poster and upload the JPG of the page you need.",
    },
    {
      title: "Put slides into a document or email",
      body: `A deck exported as PDF becomes one JPG per slide, ready to paste into a report, a newsletter or a wiki page. ${lowest.label} is enough when a slide is shown at its natural size; the preselected ${standard.label} leaves room for readers to zoom in on small print.`,
    },
    {
      title: "Send a print shop an image file",
      body: `Some printers and photo kiosks want images rather than PDFs. At ${highest.label} (${highest.dpi} DPI) a US Letter page comes out ${letterWidthAtHighest} pixels wide.`,
    },
    {
      title: "Make thumbnails for a catalogue or archive",
      body: `${lowest.label} (${lowest.dpi} DPI) gives the smallest images of the ${RASTER_RESOLUTIONS.length} presets, which suits preview grids, intranet listings and quick visual indexes of long reports.`,
    },
  ],

  steps: [
    {
      title: "Choose your PDF",
      body: `Drag the PDF onto the box labelled "Drop your PDF here, or browse", or click it to pick a file up to ${maxMb} MB; if you drop several, only the first is used. A header line then shows its page count and size.`,
    },
    {
      title: "Pick a resolution",
      body: `Under Resolution, click ${presetList}. A higher DPI gives sharper text and larger files.`,
    },
    {
      title: "Render the pages",
      body: `Click the button that reads "Render" followed by the page count, for example "Render ${EXAMPLE_PAGES} pages". While it works, a progress line and bar count the pages as they are drawn.`,
    },
    {
      title: "Download the images",
      body: `A one-page PDF gives a "Download JPG" button; a PDF of more than one page, say ${EXAMPLE_PAGES}, gives "Download ZIP (${EXAMPLE_PAGES} images)" instead. Each of the first ${RASTER_PREVIEW_LIMIT} pages can also be saved on its own from the download button on its preview tile. "Change resolution" goes back to the resolution choice so you can render again.`,
    },
  ],

  faqs: [
    {
      q: "What DPI should I use for JPG pages?",
      a: `Each inch of page becomes as many pixels as the DPI. ${lowest.label} (${lowest.dpi} DPI) suits screens, ${standard.label} (${standard.dpi} DPI) is the default middle ground, and ${highest.label} (${highest.dpi} DPI) is for print or zooming in. Poster-sized pages are scaled down to a fixed pixel limit.`,
    },
    {
      q: "Can I convert only some pages?",
      a: "The tool always renders every page. For a subset, run Extract Pages first and convert the smaller PDF. You can also save single pages from the preview tiles, but on a long document the grid shows only the opening pages; the rest are only in the ZIP that a PDF of several pages gets.",
    },
    {
      q: "Why was my password-protected PDF rejected?",
      a: "Because it needs a password to open, and the converter cannot read a page without it. A PDF that opens freely but restricts printing or copying converts like any other. Unlock PDF removes the password when you enter it; it cannot recover one. Be aware that Unlock PDF, unlike this conversion, does not run in your browser: the locked file and the password you type are uploaded to pdf.xyz's secure worker. Convert the unlocked copy here afterwards.",
    },
    {
      q: "Will the text in the JPG still be selectable or searchable?",
      a: "No. A JPG is a flat picture, so the words become pixels. If you need the text itself, use PDF to Text. If you want the embedded photos at their stored resolution rather than pictures of whole pages, Extract Images saves them as separate files and lists as skipped any image it cannot recover.",
    },
    {
      q: "Is JPG the right format for text-heavy pages?",
      a: `JPEG is lossy and suits photos and scans best; around sharp black-on-white edges it can leave faint smudges even at quality ${quality}. PDF to PNG renders the same pages at the same resolutions losslessly, keeping type and line art crisp.`,
    },
    {
      q: "What does the warning about images that could not be decoded mean?",
      a: "pdf.js counts each embedded image it could not decode. Those images are blank in the JPGs while the rest of each page converts normally, so the count tells you to check the output before relying on it.",
    },
  ],

  relatedGuides: ["how-to-convert-jpg-to-pdf"],
};

export default content;
