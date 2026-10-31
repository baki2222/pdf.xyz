import type { ToolContent } from "./types";
import { MAX_IMAGE_MB } from "@/lib/tools/limits";
import {
  IMAGE_MARGINS,
  IMAGE_ORIENTATIONS,
  IMAGE_PAGE_SIZES,
} from "@/lib/pdf/image-page-layout";
import { inches } from "@/lib/pdf/page-geometry";

/** "A, B or C" from the runner's own chip tables. */
const or = (items: readonly string[]) =>
  `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
const SIZES = or(IMAGE_PAGE_SIZES.map((s) => s.label));
const ORIENTATIONS = or(IMAGE_ORIENTATIONS.map((o) => o.label));
const MARGINS = or(
  IMAGE_MARGINS.map((m) =>
    m.points > 0 ? `${m.label} (${inches(m.points)} in)` : m.label,
  ),
);

/**
 * Search-facing copy for PNG to PDF.
 *
 * Every behavioural claim below was read from the code that runs, not from
 * the sibling JPG page:
 *  - runner: src/components/tools/runner/image-to-pdf-runner.tsx (kind "png")
 *    — Dropzone "Drop PNG images here, or browse", "Image order" list with
 *    Move up / Move down / Remove, Clear, Create PDF ("Creating PDF…"),
 *    result panel "PNG PDF created" with Download PDF. Since 2026-10-24 also
 *    Page size, Orientation, Margin and Output chips
 *    (src/lib/pdf/image-page-layout.ts), defaulting to the old fixed layout;
 *    "One PDF per image (ZIP)" gives Download ZIP for more than one image.
 *  - The result panel's "Start over" is deliberately NOT described: its
 *    onReset is `clearItems`, which empties the list but never clears the
 *    run's `result`, so the panel stays up reading "0 images" (as of
 *    2026-09-27). Describe it only once it really resets.
 *  - engine: src/lib/pdf/image-to-pdf.ts — one page per image (by default
 *    portrait US Letter), white rectangle under it, margin, scale capped at 1
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
 *    with `unsupportedImageMessage`. SUPERSEDED 2026-10-30, history kept:
 *    WebP, GIF and BMP are now sniffed (`sniffImageFormat`), decoded by the
 *    browser and re-encoded (src/lib/pdf/image-transcode.ts: PNG with
 *    alpha, JPEG at 0.92 without; a GIF's first frame), read back from the
 *    saved PDF by src/lib/pdf/image-formats.test.ts. TIFF, HEIC and AVIF are
 *    still refused by name; the steps' example names an AVIF. What still reaches Create PDF and fails
 *    is a file with a valid signature pdf-lib cannot parse (a 2-frame APNG,
 *    a damaged image). tool-page-substance.test.ts holds the steps to every
 *    refusal the runner gives, in its words.
 *  - The option lists are derived from the chip tables; the default page
 *    words are held to the engine by claims-vs-capability.test.ts.
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
    "PNG to PDF places every PNG you add on a page of its own and saves the set as a single PDF. It suits what people keep as PNG in the first place — screenshots, diagrams, line art, logos on a transparent background — where crisp edges matter more than a small file. A PNG is never turned into JPEG on the way: its pixels are stored with lossless Flate compression, so small interface text is not smudged by block artefacts. The one exception is a PNG with sixteen bits per channel, which is cut down to eight. WebP, GIF and BMP images are taken too: your browser decodes each one and it is saved again, as a PNG when it has transparency and as a high-quality JPEG when it has none, and an animated GIF gives its first frame only.",
    `Unless you change the page setup, every page is a portrait US Letter sheet with a white background and a 0.5 in margin. You can pick the page size (${SIZES}), the orientation (${ORIENTATIONS}) and the margin (${MARGINS}) first; Fit to image makes each page the size of its PNG plus the margin, which suits screenshots. A PNG bigger than the space is scaled down to fit and centred. A smaller one is never enlarged: it is drawn at one PDF point per pixel, so a tiny icon stays tiny. Any DPI value stored inside the PNG is ignored.`,
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
      body: `Drag PNGs onto the box reading "Drop PNG images here, or browse", or click anywhere in it to open your file picker; JPG photos are accepted too, and so are WebP, GIF and BMP images. Files added later join the end of the list. A file that is left out gets a note naming it and the reason: "Choose PNG, JPG, WebP, GIF or BMP images." for another type, "File is empty." for a zero-byte file, "Max ${MAX_IMAGE_MB} MB per image." for one that is too big, "Could not read this file — pick it again." when the file cannot be read, and a note naming the real format, such as "chart.png" is an AVIF image., when its contents are none of those.`,
    },
    {
      title: "Arrange the image order",
      body: "Under Image order, each card shows a thumbnail, the file name and the page it will become. The up and down arrows on a card (Move up, Move down) shift it one place; the cross (Remove) drops it, and Clear empties the list.",
    },
    {
      title: "Choose the page setup",
      body: "Below the list, Page size, Orientation and Margin set the page, and Output chooses One PDF or One PDF per image, which with more than one image arrives as a ZIP. Left alone: US Letter, portrait, a 0.5 in margin, one PDF.",
    },
    {
      title: "Press Create PDF",
      body: "The button reads Creating PDF… while your browser builds one page per image in the order shown. An image that cannot be decoded halts the whole run, and the error names that file; remove it and press Create PDF again.",
    },
    {
      title: "Save the PDF",
      body: "The PNG PDF created panel shows the image count and file size. Download PDF names the file after your first image, so chart.png becomes chart-pdf.pdf. With One PDF per image and more than one image, Download ZIP saves one PDF per image instead, chart.png becoming chart.pdf.",
    },
  ],
  faqs: [
    {
      q: "What happens to the transparent parts of my PNG?",
      a: "Each image is drawn over a white page, so see-through areas look white on screen and in print. The alpha channel is kept as a soft mask in the PDF, so partly transparent edges blend smoothly into the white. A PNG with no transparent pixels at all is stored without a mask.",
    },
    {
      q: "Will my screenshots lose quality?",
      a: "No PNG pixel is re-saved as JPEG, so edges and on-screen text survive intact, even when a large image is shown scaled down on the page. Two caveats. A sixteen-bit PNG is reduced to eight bits per channel. And every image is stored as eight-bit RGB without PNG's own row filtering, so a palette or greyscale PNG is expanded to full colour and can make a PDF far heavier than the file you added. A WebP, GIF or BMP without transparency is the one kind stored as JPEG, at high quality, because it has to be saved again either way.",
    },
    {
      q: "Can I put PNG and JPG images in the same PDF?",
      a: "Yes. This page also takes JPG and JPEG photos, so screenshots and photos can go into one PDF in a single pass, each on its own page in the order you set. PNGs are stored losslessly. A JPG keeps its original JPEG data and is not compressed again; only a rotation recorded in its EXIF data is applied, so a phone photo stands upright.",
    },
    {
      q: "Why did Create PDF fail on a file it accepted?",
      a: 'Adding a file checks its name, its size and the first bytes of its contents, so a file whose contents are not a PNG, JPG, WebP, GIF or BMP is turned away as you add it, even when it is named .png, and a JPEG or WebP saved with a .png name is accepted and placed as what it really is. What that check cannot see is an animated PNG with more than one frame, or a damaged image whose first bytes look right: it gets into the list and then fails with "could not be decoded as a PNG image" (or "as a JPG image"), which stops the whole PDF. Remove the file the message names and run it again.',
    },
    {
      q: "Can a page be exactly the size of my screenshot?",
      a: "Yes. Choose Fit to image under Page size: each page becomes the size of its PNG, one point per pixel, plus the margin you pick (None gives no border at all). Orientation is not needed then, since the page already has the image's shape.",
    },
    {
      q: "Are my images uploaded anywhere?",
      a: "No. Your images are read, ordered and turned into a PDF by code running in this tab on your own device, and the finished file goes straight from the tab to your downloads. If you arrived from the workspace with images already picked, they were handed to this page inside your browser, not through a server.",
    },
  ],
  relatedGuides: [],
};

export default content;
