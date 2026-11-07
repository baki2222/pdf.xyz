import type { ToolContent } from "./types";
import { MAX_IMAGE_MB } from "@/lib/tools/limits";
import {
  DEFAULT_IMAGE_PAGE_OPTIONS,
  IMAGE_MARGINS,
  IMAGE_ORIENTATIONS,
  IMAGE_PAGE_SIZES,
  imageMarginPoints,
  imagePageSizeById,
} from "@/lib/pdf/image-page-layout";
import {
  LETTER_REGION_PAGE_SIZE,
  WORLD_PAGE_SIZE,
} from "@/lib/pdf/image-page-defaults";
import { imageDefaultPaperCopy } from "@/lib/tools/tool-facts";
import { inches } from "@/lib/pdf/page-geometry";
import { IMAGE_ROTATION_LABELS } from "@/lib/pdf/image-rotation";
import { A4_SCAN_SETUP_COPY, IGNORED_DPI_COPY } from "@/lib/pdf/image-density";
import { undecodableImageMessage } from "@/lib/pdf/image-intake";
import {
  CUSTOM_PAGE_COPY,
  CUSTOM_PAGE_LABELS,
} from "@/lib/pdf/image-page-custom";
import {
  IMAGE_BOOKMARKS_CHOICES,
  IMAGE_BOOKMARKS_LABELS,
  IMAGE_ORDER_LABELS,
  MIN_BOOKMARKED_IMAGES,
} from "@/lib/pdf/image-bookmarks";
import {
  SMALL_IMAGES_CHOICES,
  SMALL_IMAGES_LABELS,
} from "@/lib/pdf/image-enlarge";

/** The card button that turns one image (audit png-to-pdf#2). */
const ROTATE = IMAGE_ROTATION_LABELS.button;

/** The add-time refusal of an undecodable image (audit png-to-pdf#8). */
const UNDECODABLE_PNG = undecodableImageMessage("chart.png", "png");

/** Small images and its two chips (audit png-to-pdf#4), as the runner says. */
const SMALL = SMALL_IMAGES_LABELS.heading;
const [KEEP_SIZE, ENLARGE] = SMALL_IMAGES_CHOICES.map((c) => c.label);

/** Sort by name and Bookmarks (audit png-to-pdf#6), as the runner says. */
const SORT = IMAGE_ORDER_LABELS.sortByName;
const BOOKMARKS = IMAGE_BOOKMARKS_LABELS.heading;
const [NO_BOOKMARKS, PER_IMAGE_BOOKMARK] = IMAGE_BOOKMARKS_CHOICES.map(
  (c) => c.label,
);
const BOOKMARK_MIN =
  MIN_BOOKMARKED_IMAGES === 2 ? "two" : String(MIN_BOOKMARKED_IMAGES);
import { tiffRefusal } from "@/lib/pdf/tiff-limits";
import {
  MAX_SIZE_LABELS,
  LIMIT_EXAMPLE,
  MAX_SIZE_PRESETS,
  limitOutcome,
} from "@/lib/pdf/image-size-limit";

/** The TIFF reader's pick-time refusal by example, in its own words. */
const TIFF_TOO_LARGE = tiffRefusal.tooLarge("scan.tif", 3, 12_000, 9_000);

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
 * The page the runner starts on (audit jpg-to-pdf#1, 2026-11-07): A4, or US
 * Letter for a browser set to a Letter country, from the runner's own
 * tables. image-page-default-copy.test.ts holds this page to it.
 */
const DEFAULT_PAPER = imageDefaultPaperCopy();
const WORLD_SIZE = imagePageSizeById(WORLD_PAGE_SIZE).label;
const LETTER_SIZE = imagePageSizeById(LETTER_REGION_PAGE_SIZE).label;
const DEFAULT_MARGIN = `${inches(imageMarginPoints(DEFAULT_IMAGE_PAGE_OPTIONS.margin))} in`;

/**
 * Max file size (2026-10-31), every word from the panel's own constants:
 * the heading, the No limit chip, the presets, and the panel's own met
 * sentence (`limitOutcome`) — so a rename in the panel moves this page with
 * it. The FAQ answers describe the panel's other lines without quoting them:
 * tool-page-substance.test.ts holds every quoted label to the runner file.
 */
const LIMIT = MAX_SIZE_LABELS.heading;
const NO_LIMIT = MAX_SIZE_LABELS.none;
const LIMIT_PRESETS = or(MAX_SIZE_PRESETS.map((p) => p.label));
const LIMIT_MET = limitOutcome({
  ...LIMIT_EXAMPLE,
  reencoded: false,
  flattened: false,
  images: 1,
}).text;

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
 *    (src/lib/pdf/image-page-layout.ts), defaulting to the old fixed layout
 *    except the page size, which since 2026-11-07 starts on A4, or US Letter
 *    for a browser set to a Letter country (audit jpg-to-pdf#1);
 *    "One PDF per image (ZIP)" gives Download ZIP for more than one image.
 *  - The result panel's "Start over" is not described. HISTORY: its onReset
 *    (`clearItems`) once emptied the list without clearing the run's
 *    `result`, so the panel stayed up reading "0 images"; a2333ae7 fixed it
 *    on 2026-09-27 and `runner-flows.test.tsx` drives it.
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
 *    SUPERSEDED 2026-11-06 (audit #10), history kept above: pdf-lib's PNG
 *    path is no longer used. src/lib/pdf/png-embed.ts embeds each PNG as it
 *    is stored — greyscale as DeviceGray, a palette as Indexed, its own bit
 *    depth (16 included), PNG's row filters kept as /Predictor 15 (the IDAT
 *    passed through unchanged when there is no alpha and no interlacing),
 *    alpha split into an SMask only when some pixel is not opaque, and an
 *    iCCP profile kept as ICCBased. A 1200×800 RGB gradient that became a
 *    ~460 KB PDF now comes out within a few KB of its PNG; a 2-frame APNG
 *    and a cut-off PNG are still refused. src/lib/pdf/png-embed.test.ts
 *    renders every case through pdf.js, its fixtures checked by Skia. The
 *    FAQ's "two caveats" sentence was rewritten to match.
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
 *    still refused by name; the steps' example names an AVIF. SUPERSEDED
 *    for TIFF 2026-11-04: src/lib/pdf/tiff.ts reads it in the browser, every
 *    page of a multi-page TIFF a PDF page in order (CCITT G3/G4, LZW,
 *    PackBits, Deflate, JPEG, uncompressed), embedded LOSSLESSLY at its own
 *    depth (a fax page stays a 1-bit DeviceGray image, not 8-bit RGB) and
 *    laid out at its size on paper from XResolution/YResolution. PNG's DPI
 *    is still not read, so the "one point per pixel" sentence now names PNG
 *    and TIFF apart. SUPERSEDED 2026-11-08 (audit png-to-pdf#4), history
 *    kept: under Fit to image a PNG's pHYs sets its page size when it is
 *    plausible (src/lib/pdf/image-density.ts; image-density.test.ts reads
 *    an A4 page back from a 300 dpi PNG scan). src/lib/pdf/tiff.test.ts renders the saved PDFs through
 *    pdf.js. HEIC and AVIF are still refused by name. What still reaches Create PDF and fails
 *    is a file with a valid signature pdf-lib cannot parse (a 2-frame APNG,
 *    a damaged image). tool-page-substance.test.ts holds the steps to every
 *    refusal the runner gives, in its words. SUPERSEDED 2026-11-06 (audit
 *    #10), history kept: for a PNG the parser is src/lib/pdf/png-embed.ts,
 *    not pdf-lib; it refuses the same two cases (a 2-frame APNG, a cut-off
 *    or damaged PNG) with the same "could not be decoded" message.
 *    SUPERSEDED 2026-11-08 (audit png-to-pdf#8), history kept: the runner
 *    now embeds each PNG and JPG into a throwaway document AS IT IS ADDED
 *    (src/lib/pdf/image-intake.ts), so those two are refused at pick time
 *    in the engine's words; the FAQ "Why did Create PDF fail on a file it
 *    accepted?" became "Why was a PNG I added turned away?".
 *  - The option lists are derived from the chip tables; the default page
 *    words are held to the engine by claims-vs-capability.test.ts.
 *  - MAX FILE SIZE, since 2026-10-31 (src/lib/pdf/image-size-limit.ts): with
 *    a limit the PDF is over, every image IS saved again as a JPEG, PNGs
 *    included, transparency composited onto white (the page colour) and
 *    the soft mask gone. "A PNG is never turned into JPEG" and "No PNG pixel
 *    is re-saved as JPEG" were unconditional until then; both now name the
 *    exception, and the transparency FAQ says what a limit changes.
 *  - relatedGuides is empty, and that hides nothing: it only ORDERS the
 *    Guides band (`pageGuides` in src/lib/tools/page-copy.ts), which is
 *    discovered from each guide's own `tools` field. HISTORY: this note once
 *    said the JPG guide (which lists png-to-pdf) promised page controls that
 *    did not exist; they shipped 2026-10-24 and the guide states them.
 */
const content: ToolContent = {
  slug: "png-to-pdf",
  seoTitle: "PNG to PDF — Screenshots & Logos, No Upload",
  metaDescription: `Combine PNG screenshots, diagrams and logos into a single PDF in your browser. Pixels are kept without JPEG blur, up to ${MAX_IMAGE_MB} MB a file, and nothing is uploaded.`,
  intro: [
    `PNG to PDF places every PNG you add on a page of its own and saves the set as a single PDF. It suits what people keep as PNG in the first place — screenshots, diagrams, line art, logos on a transparent background — where crisp edges matter more than a small file. With ${LIMIT} left at ${NO_LIMIT}, a PNG is never turned into JPEG on the way: its pixels are stored with lossless Flate compression, so small interface text is not smudged by block artefacts. Each PNG keeps its own depth too, sixteen bits per channel included. WebP, GIF and BMP images are taken too: your browser decodes each one and it is saved again, as a PNG when it has transparency and as a high-quality JPEG when it has none, and an animated GIF gives its first frame only. If an upload form caps the size, choose ${LIMIT} (${LIMIT_PRESETS}, or Custom): when the PDF comes out bigger, your browser saves the images again as JPEGs, softer and with any transparent areas turned white, until it fits.`,
    `Unless you change the page setup, every page is a portrait sheet with a white background and a ${DEFAULT_MARGIN} margin, and its size is ${DEFAULT_PAPER}. You can pick the page size (${SIZES}), the orientation (${ORIENTATIONS}) and the margin (${MARGINS}) first. ${CUSTOM_PAGE_COPY} Fit to image makes each page the size of its PNG plus the margin, which suits screenshots. A PNG bigger than the space is scaled down to fit and centred. A smaller one keeps its size, drawn at one PDF point per pixel, so a tiny icon stays tiny, unless you choose ${ENLARGE} under ${SMALL}: then it is scaled up until it meets the margin, softer the more it grows because no pixels are added. Under Fit to image, a resolution saved in the PNG sets the page's size on paper instead: ${A4_SCAN_SETUP_COPY}, a 300 dpi scan of an A4 sheet saved as a PNG becomes an A4 page; a stated ${IGNORED_DPI_COPY}, counts as none.`,
    "TIFF images are taken as well, multi-page TIFFs from scanners and fax software included: every page of the TIFF becomes a page of the PDF, in order, black-and-white fax pages (CCITT Group 4) among them. A TIFF page is laid out at the size it had on paper, read from the resolution saved in the file, on every page size and not only under Fit to image. Its pixels are stored without loss, a black-and-white page as one bit per pixel.",
    `The work happens in this browser tab: your PNGs are read from your device, laid out there, and handed back as a download, and none of them is uploaded to pdf.xyz. Each file may be up to ${MAX_IMAGE_MB} MB.`,
  ],
  useCases: [
    {
      title: "A step-by-step screenshot trail",
      body: `Bug reports and how-to notes often start as a folder of numbered screenshots. ${SORT} puts them in sequence, with ${PER_IMAGE_BOOKMARK} chosen under ${BOOKMARKS}, a reader can jump to any of them from the bookmark panel, and the interface text stays sharp.`,
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
      body: `When a form or receipt was saved as PNG and the upload form insists on PDF, this converts it without sending the image to anyone's server first. If the form also caps the size, choose it under ${LIMIT}; the panel then says, for example, “${LIMIT_MET}”`,
    },
  ],
  steps: [
    {
      title: "Add your PNG files",
      body: `Drag PNGs onto the box reading "Drop PNG images here, or browse", or click anywhere in it to open your file picker; JPG photos are accepted too, and so are WebP, GIF, BMP and TIFF images; a multi-page TIFF fills one page per TIFF page. Files added later join the end of the list. A file that is left out gets a note naming it and the reason: "Choose PNG, JPG, WebP, GIF, BMP or TIFF images." for another type, "File is empty." for a zero-byte file, "Max ${MAX_IMAGE_MB} MB per image." for one that is too big, "Could not read this file — pick it again." when the file cannot be read, and a note naming the real format, such as "chart.png" is an AVIF image., when its contents are none of those. A PNG or JPG is also tried the way Create PDF will use it, so a PNG that is cut off, damaged or animated (more than one frame) is turned away with a note naming it, such as ${UNDECODABLE_PNG} A TIFF can also be turned away by page, with a note naming it, such as ${TIFF_TOO_LARGE}`,
    },
    {
      title: "Arrange the image order",
      body: `Under Image order, each card shows a thumbnail, the file name and the page it will become. The up and down arrows on a card (Move up, Move down) shift it one place; the turning arrow (${ROTATE}) turns a sideways screenshot or scan a quarter turn clockwise with each press, and the card then shows the angle, such as 90°; the cross (Remove) drops it, and Clear empties the list. The pixels are not saved again: the turn is applied as the image is placed, and its page takes the turned shape. To move a card further in one go, drag it onto the place you want. ${SORT}, beside the heading, puts every card in order of its file name, numbers counted as numbers (shot 2 before shot 10), cards added later included.`,
    },
    {
      title: "Choose the page setup",
      body: `Below the list, Page size, Orientation and Margin set the page (Page size and Margin each end in ${CUSTOM_PAGE_LABELS.chip}, for a length typed in mm or inches), ${SMALL} chooses ${KEEP_SIZE} or ${ENLARGE} for an image smaller than the paper, ${BOOKMARKS} chooses ${NO_BOOKMARKS} or ${PER_IMAGE_BOOKMARK} (a bookmark named after each image's file that opens its page, in One PDF of ${BOOKMARK_MIN} or more images), ${LIMIT} caps the size of the PDF, and Output chooses One PDF or One PDF per image, which with more than one image arrives as a ZIP. Left alone: ${WORLD_SIZE} (${LETTER_SIZE} in a country that uses Letter paper), portrait, a ${DEFAULT_MARGIN} margin, small images kept at their size, no bookmarks, ${NO_LIMIT.toLowerCase()} on size, one PDF. With One PDF per image, a ${LIMIT} applies to each PDF on its own.`,
    },
    {
      title: "Press Create PDF",
      body: "The button reads Creating PDF… while your browser builds one page per image in the order shown. A PNG or JPG that cannot be decoded was already turned away when you added it. A damaged TIFF page, or a WebP, GIF or BMP your browser cannot decode, still halts the whole run, and the error names that file; remove it and press Create PDF again.",
    },
    {
      title: "Save the PDF",
      body: "The PNG PDF created panel shows the image count and file size. Download PDF names the file after your first image, so chart.png becomes chart-pdf.pdf. With One PDF per image and more than one image, Download ZIP saves one PDF per image instead, chart.png becoming chart.pdf.",
    },
  ],
  faqs: [
    {
      q: "What happens to the transparent parts of my PNG?",
      a: `Each image is drawn over a white page, so see-through areas look white on screen and in print. With ${LIMIT} at ${NO_LIMIT}, the alpha channel is kept as a soft mask in the PDF, so partly transparent edges blend smoothly into the white; a PNG with no transparent pixels at all is stored without a mask. A PNG saved again to fit a ${LIMIT} becomes a JPEG, which has no transparency, so its see-through areas are filled with white first — the same colour as the page — and the line under the result says so.`,
    },
    {
      q: "Will my screenshots lose quality?",
      a: `With ${LIMIT} at ${NO_LIMIT}, no PNG pixel is re-saved as JPEG, so edges and on-screen text survive intact, even when a large image is shown scaled down on the page. Each PNG also keeps its own encoding inside the PDF: greyscale stays greyscale, a palette PNG keeps its list of colours, sixteen bits per channel stay sixteen, and a colour profile, such as the Display P3 one a Mac screenshot carries, is kept, so colours match the PNG and the PDF stays close to the size of the files you added. A WebP, GIF or BMP without transparency is the one kind stored as JPEG, at high quality, because it has to be saved again either way. A TIFF page keeps its own depth too: a black-and-white scan stays one bit per pixel, so it stays small. A ${LIMIT} the PDF is over is the exception you choose: then every image is saved again as a JPEG, with fewer pixels, until the PDF fits, and on-screen text can blur.`,
    },
    {
      q: "Can I make the PDF smaller than 100 KB or 200 KB?",
      a: `Yes, with ${LIMIT}: choose ${LIMIT_PRESETS}, or Custom and a whole number of KB. The PDF is made as usual first and kept as it is if it already fits. If it is bigger, your browser saves the images again as JPEGs, step by step at a lower quality and pixel size, measures each PDF, and keeps the sharpest one that fits; if none fits, you get the smallest it made and a line saying it is above your limit. Screenshots full of small text suffer most, so try the largest limit the form allows. A TIFF page is saved as a JPEG only where that comes out smaller than the page kept without loss, so a black-and-white scan page usually stays as it is. Here 1 KB is 1,024 bytes.`,
    },
    {
      q: "Can I put PNG and JPG images in the same PDF?",
      a: "Yes. This page also takes JPG and JPEG photos, so screenshots and photos can go into one PDF in a single pass, each on its own page in the order you set. PNGs are stored losslessly. A JPG keeps its original JPEG data and is not compressed again; only a rotation recorded in its EXIF data is applied, so a phone photo stands upright.",
    },
    {
      q: "Why was a PNG I added turned away?",
      a: `Adding a file checks its name, its size and the first bytes of its contents, so a file whose contents are not a PNG, JPG, WebP, GIF, BMP or TIFF is turned away as you add it, even when it is named .png, and a JPEG or WebP saved with a .png name is accepted and placed as what it really is. A PNG or JPG is then embedded once, into a throwaway copy, exactly as Create PDF will embed it: an animated PNG with more than one frame, or a damaged or cut-off image whose first bytes look right, fails there and is turned away with a note such as ${UNDECODABLE_PNG} The rest of your images stay in the list. A TIFF is checked further when you add it, page by page, for its size and the way it is stored; a damaged TIFF page still stops Create PDF with a note naming the page.`,
    },
    {
      q: "Are my images uploaded anywhere?",
      a: "No. Your images are read, ordered and turned into a PDF by code running in this tab on your own device, and the finished file goes straight from the tab to your downloads. If you arrived from the workspace with images already picked, they were handed to this page inside your browser, not through a server.",
    },
  ],
  relatedGuides: [],
};

export default content;
