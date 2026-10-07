import type { ToolContent } from "./types";
import { MAX_IMAGE_MB } from "@/lib/tools/limits";

/**
 * Search-facing copy for PNG to PDF.
 *
 * Every behavioural claim below was read from the code that runs, not from
 * the sibling JPG page:
 *  - runner: src/components/tools/runner/image-to-pdf-runner.tsx (kind "png")
 *    — Dropzone "Drop PNG images here, or browse", "Image order" list with
 *    Move up / Move down / Remove, Clear, Create PDF ("Creating PDF…"),
 *    result panel "PNG PDF created" with Download PDF. No page-size,
 *    orientation or margin controls exist.
 *  - The result panel's "Start over" is deliberately NOT described: its
 *    onReset is `clearItems`, which empties the list but never clears the
 *    run's `result`, so the panel stays up reading "0 images" (as of
 *    2026-09-27). Describe it only once it really resets.
 *  - engine: src/lib/pdf/image-to-pdf.ts — one fixed portrait US Letter page
 *    per image, white rectangle under it, fixed margin, scale capped at 1
 *    (downscale only; below that, one point per pixel — the PNG's pHYs/DPI is
 *    never read), centred; output named `<first image>-pdf.pdf`; the first
 *    undecodable file throws and stops the whole run.
 *  - pdf-lib 1.17.1's PNG path (utils/png.js, PngEmbedder.js) decodes to
 *    8-bit RGBA, stores colour as DeviceRGB (greyscale included) with plain
 *    Flate (no PNG predictors), keeps alpha as an SMask only when some value
 *    is < 255, and throws on more than one frame. Probed 2026-09-27 with
 *    synthetic files: opaque → no SMask; alpha → SMask; 1-frame APNG → OK;
 *    2-frame APNG and JPEG bytes named .png → "could not be decoded as a PNG
 *    image"; 16-bit greyscale → 8-bit DeviceRGB. Not yet run in a browser.
 *    Also probed 2026-09-27 through imagesToPdf itself: an 8-colour palette PNG
 *    of 1,798 bytes became a 16,714-byte PDF, which is why the FAQ names
 *    palette PNGs (not only greyscale) as the case that grows.
 *  - Workspace handoff (use-tool-handoff → src/lib/handoff) passes files via
 *    IndexedDB, or an in-memory map when that is unavailable; never a server.
 *  - gate, re-read 2026-10-06: `isImageAllowedForKind` takes PNG OR JPEG on
 *    both image tools (type or name), then the runner reads the bytes as the
 *    file is ADDED (`sniffRasterFormat`): a JPEG named .png goes in as a
 *    JPEG, and a WebP/GIF/BMP/TIFF/HEIC/AVIF named .png is refused at once
 *    with `unsupportedImageMessage`. What still reaches Create PDF and fails
 *    is a file with a valid signature pdf-lib cannot parse (a 2-frame APNG,
 *    a damaged image). tool-page-substance.test.ts holds the steps to every
 *    refusal the runner gives, in its words.
 *  - The page-size words ("US Letter", "narrow margin") are NOT derived: the
 *    engine's PAGE_WIDTH/PAGE_HEIGHT/MARGIN are module-private. If they
 *    change, this copy goes stale with nothing to catch it.
 *  - relatedGuides is empty on purpose, matching jpg-to-pdf: the only image
 *    guide ("how-to-convert-jpg-to-pdf", which lists png-to-pdf in its
 *    tools) promises page size, orientation and margin controls and says the
 *    tool is built on WebAssembly. None of that exists. Link it once fixed.
 */
const content: ToolContent = {
  slug: "png-to-pdf",
  seoTitle: "PNG to PDF — Screenshots & Logos, No Upload",
  metaDescription: `Combine PNG screenshots, diagrams and logos into a single PDF in your browser. Pixels are kept without JPEG blur, up to ${MAX_IMAGE_MB} MB a file, and nothing is uploaded.`,
  intro: [
    "PNG to PDF places every PNG you add on a page of its own and saves the set as a single PDF. It suits what people keep as PNG in the first place — screenshots, diagrams, line art, logos on a transparent background — where crisp edges matter more than a small file. Nothing is turned into JPEG on the way: pixels are stored with lossless Flate compression, so small interface text is not smudged by block artefacts. The one exception is a PNG with sixteen bits per channel, which is cut down to eight.",
    "Every page is a portrait US Letter sheet with a white background and a narrow margin. A PNG bigger than that area is scaled down to fit and centred. A smaller one is never enlarged: it is drawn at one PDF point per pixel and sits at that size in the middle of the sheet, so a tiny icon stays tiny. Any DPI value stored inside the PNG is ignored.",
    `The work happens in this browser tab: your PNGs are read from your device, laid out there, and handed back as a download, and none of them is uploaded to pdf.xyz. Each file may be up to ${MAX_IMAGE_MB} MB.`,
  ],
  useCases: [
    {
      title: "A step-by-step screenshot trail",
      body: "Bug reports and how-to notes often start as a folder of numbered screenshots. Put them in sequence and send one PDF whose interface text is still sharp.",
    },
    {
      title: "Logo and artwork proofs",
      body: "A logo exported with a transparent background is shown against a plain white page. Check light-coloured artwork first: a white logo on a transparent background comes out white on white and disappears.",
    },
    {
      title: "Charts and diagrams as one handout",
      body: "Plotting libraries and design tools tend to export PNG. Collect the figures for a meeting or report appendix into one document instead of a dozen loose attachments.",
    },
    {
      title: "Portals that only accept PDF",
      body: "When a form or receipt was saved as PNG and the upload form insists on PDF, this converts it without sending the image to anyone's server first.",
    },
  ],
  steps: [
    {
      title: "Add your PNG files",
      body: `Drag PNGs onto the box reading "Drop PNG images here, or browse", or click anywhere in it to open your file picker; JPG photos are accepted too. Files added later join the end of the list. A file that is left out gets a note naming it and the reason: "Choose PNG or JPG images." for another type, "File is empty." for a zero-byte file, "Max ${MAX_IMAGE_MB} MB per image." for one that is too big, "Could not read this file — pick it again." when the file cannot be read, and a note naming the real format, such as "chart.png" is a WebP image., when its contents are not a PNG or JPG.`,
    },
    {
      title: "Arrange the image order",
      body: "Under Image order, each card shows a thumbnail, the file name and the page it will become. Move up and Move down shift a card one place; Remove drops it, and Clear empties the list.",
    },
    {
      title: "Press Create PDF",
      body: "The button reads Creating PDF… while your browser builds one page per image in the order shown. An image that cannot be decoded halts the whole run, and the error names that file; remove it and press Create PDF again.",
    },
    {
      title: "Save the PDF",
      body: "The PNG PDF created panel shows the image count and file size. Download PDF names the file after your first image, so chart.png becomes chart-pdf.pdf.",
    },
  ],
  faqs: [
    {
      q: "What happens to the transparent parts of my PNG?",
      a: "Each image is drawn over a white page, so see-through areas look white on screen and in print. The alpha channel is kept as a soft mask in the PDF, so partly transparent edges blend smoothly into the white. A PNG with no transparent pixels at all is stored without a mask.",
    },
    {
      q: "Will my screenshots lose quality?",
      a: "No pixel is re-saved as JPEG, so edges and on-screen text survive intact, even when a large image is shown scaled down on the page. Two caveats. A sixteen-bit PNG is reduced to eight bits per channel. And every image is stored as eight-bit RGB without PNG's own row filtering, so a palette or greyscale PNG is expanded to full colour and can make a PDF far heavier than the file you added.",
    },
    {
      q: "Can I put PNG and JPG images in the same PDF?",
      a: "Yes. This page also takes JPG and JPEG photos, so screenshots and photos can go into one PDF in a single pass, each on its own page in the order you set. PNGs are stored losslessly. A JPG keeps its original JPEG data and is not compressed again; only a rotation recorded in its EXIF data is applied, so a phone photo stands upright.",
    },
    {
      q: "Why did Create PDF fail on a file it accepted?",
      a: 'Adding a file checks its name, its size and the first bytes of its contents, so a WebP, GIF or other format renamed to .png is turned away as you add it, and a JPEG saved with a .png name is accepted and placed as a JPEG. What that check cannot see is an animated PNG with more than one frame, or a damaged image whose first bytes look right: it gets into the list and then fails with "could not be decoded as a PNG image" (or "as a JPG image"), which stops the whole PDF. Remove the file the message names and run it again.',
    },
    {
      q: "Are my images uploaded anywhere?",
      a: "No. Your images are read, ordered and turned into a PDF by code running in this tab on your own device, and the finished file goes straight from the tab to your downloads. If you arrived from the workspace with images already picked, they were handed to this page inside your browser, not through a server.",
    },
  ],
  relatedGuides: [],
};

export default content;
