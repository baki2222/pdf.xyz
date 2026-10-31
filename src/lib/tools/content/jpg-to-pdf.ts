import type { ToolContent } from "./types";
import { MAX_IMAGE_MB } from "@/lib/tools/limits";
import {
  IMAGE_MARGINS,
  IMAGE_ORIENTATIONS,
  IMAGE_PAGE_SIZES,
} from "@/lib/pdf/image-page-layout";
import { inches } from "@/lib/pdf/page-geometry";
import {
  MAX_SIZE_LABELS,
  LIMIT_EXAMPLE,
  MAX_SIZE_PRESETS,
  limitOutcome,
} from "@/lib/pdf/image-size-limit";

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
 * Written against src/lib/pdf/image-to-pdf.ts and
 * src/components/tools/runner/image-to-pdf-runner.tsx, re-read 2026-10-06:
 * fixed US Letter portrait pages, filled white, fixed margin, images centred
 * and only ever scaled DOWN. JPEG data is embedded without re-encoding
 * (pdf-lib embedJpg → DCTDecode, so EXIF — including any GPS block — travels
 * with it). The EXIF rotation IS applied: `embedRasterImage` reads the tag
 * (`uprightJpeg`, src/lib/pdf/jpeg-orientation.ts), resets it to 1 on a copy
 * (a two-byte patch) and `drawRasterImage` draws the photo through the turn
 * into a box of its displayed shape (`rasterDisplaySize`). PNG is accepted
 * here too: `isImageAllowedForKind` ignores the tool, `imagePickerAccept`
 * lists both, and the runner sniffs each file's bytes when it is ADDED
 * (`sniffRasterFormat`), so a PNG named .jpg goes in as a PNG and a WebP named
 * .jpg is refused at once with `unsupportedImageMessage`. The catalogue's
 * `accept` lists PNG too since 2026-10-08, so the page's "In:" row reads
 * "JPG, JPEG, PNG"; until then it said "JPG, JPEG" beside steps and an FAQ
 * saying PNG works (image-to-pdf-accept.test.ts). Only an image whose
 * signature is valid but whose data pdf-lib cannot parse fails at Create PDF
 * ('"x" could not be decoded as a JPG image.').
 *
 * PAGE SETUP, since 2026-10-24 (src/lib/pdf/image-page-layout.ts): the runner
 * shows Page size, Orientation, Margin and Output chips, built from the same
 * tables the lists below are built from. The DEFAULTS are the old fixed
 * layout — US Letter, portrait, 0.5 in margin, one PDF — so this file said
 * "no page-size, orientation or margin settings" until then, truthfully.
 * Every image is still only ever scaled DOWN, on every page size. Orientation
 * is disabled on Fit to image. "One PDF per image" with a single image still
 * delivers one PDF; with more than one it is a ZIP of one-page PDFs named
 * after the images (`imagesToPdfs`).
 *
 * Checked by a real run of `imagesToPdf("jpg", …)` on 2026-09-27: an APP1
 * segment planted in each of three JPEGs appeared three times in the output
 * PDF, and `imagePdfOutputName("jpg", "holiday.jpg")` returned
 * "holiday-pdf.pdf". A second tsx run the same day gave a PDF x1.0002 the
 * size of three sharp-encoded JPEGs. That run also wrote no turn for an
 * orientation-6 photo and failed PNG bytes named fake.jpg; both behaviours
 * have since been replaced (above), and the page no longer describes them.
 *
 * The option lists are derived from the chip tables; the default ("US
 * Letter", "portrait", "0.5 in") is written out, and
 * claims-vs-capability.test.ts holds every paper and margin this page names
 * to the runner's offer and to the page the engine draws.
 *
 * WEBP, GIF AND BMP, since 2026-10-30 (src/lib/pdf/image-transcode.ts): the
 * runner sniffs them (`sniffImageFormat`) and the engine has the BROWSER
 * decode each (`createImageBitmap`, which yields a GIF's first frame) and
 * re-encodes the pixels on a canvas, JPEG at quality 0.92 when every pixel is
 * opaque and PNG otherwise. src/lib/pdf/image-formats.test.ts reads the saved
 * PDF's image XObjects back: pixel size, filter, soft mask, the GIF's colour.
 * The FAQ said "HEIC and WebP are not supported" until then; the refusal
 * example in the steps names an AVIF, which is still refused by name.
 *
 * MAX FILE SIZE, since 2026-10-31 (src/lib/pdf/image-size-limit.ts,
 * image-size-fit.ts, image-reencode.ts): with a limit set, the PDF is first
 * made exactly as with No limit and kept as it is when it fits. Only when it
 * is over is every image decoded by the browser and saved again as a JPEG
 * (lower quality and pixel size, rung by rung, each real PDF measured); a
 * canvas carries no EXIF, so camera details and GPS are dropped from the
 * re-encoded images, and transparency is composited onto white (the page
 * colour). So "copied as it is", "no second round of compression" and "the
 * metadata travels" below are each qualified by the limit; until this date
 * they were unconditional, and the "An application that wants one file" use
 * case told readers this step could not shrink anything.
 *
 * Deliberately NOT described:
 *  - "Start over". The runner passes `clearItems` as the result panel's
 *    `onReset`, which empties the list but never calls `useAsyncRun().reset`,
 *    so the result panel stays up (now reading "0 images") and Download PDF
 *    still serves the old PDF. Describe it once that is fixed.
 *  - relatedGuides is empty on purpose: the only JPG guide
 *    ("how-to-convert-jpg-to-pdf" in src/lib/guides/catalog.ts) tells readers
 *    to set page size, orientation and margins and says the tool is built on
 *    WebAssembly. None of that exists. Link it again once it is corrected.
 */
const content: ToolContent = {
  slug: "jpg-to-pdf",
  seoTitle: "JPG to PDF — Combine Photos in Your Browser",
  metaDescription: `Combine JPG and JPEG photos into a single PDF, a page per photo, arranged as you like. Built in your browser, not uploaded. Up to ${MAX_IMAGE_MB} MB a photo.`,
  intro: [
    "JPG to PDF takes a batch of JPG or JPEG photos and builds a single PDF with one image on each page. You add the pictures, put them in the order you want, and press Create PDF. The assembly happens inside this browser tab: your photos are read from your device, laid onto pages there, and the finished PDF is saved when you press Download PDF. The images are not uploaded to pdf.xyz.",
    `Unless you change the page setup, each photo goes on a white, portrait US Letter page, centred inside a 0.5 in margin. Before you create the PDF you can pick the page size (${SIZES}), the orientation (${ORIENTATIONS}) and the margin (${MARGINS}). Auto turns the page sideways for a photo that is wider than it is tall, and Fit to image makes each page exactly the size of its photo plus the margin. On every page size a photo is shrunk only if it is too big to fit; one that already fits is never enlarged, so a low-resolution picture can look small in the middle of an A4 page.`,
    `With ${LIMIT} left at ${NO_LIMIT}, the JPEG data is copied into the PDF as it is rather than re-encoded, so there is no second round of compression and the PDF ends up close to the combined size of your photos. If an upload form caps the size, choose ${LIMIT} (${LIMIT_PRESETS}, or a number of KB of your own): when the PDF comes out bigger, your browser saves the photos again at a lower quality and pixel size until it fits, and tells you the size it reached. A single photo may be as large as ${MAX_IMAGE_MB} MB. PNG images, transparent ones included, can go into the same PDF, and any transparent areas come out white. WebP, GIF and BMP images can go in too: your browser decodes each one and it is saved into the PDF again, as a high-quality JPEG when it has no transparency and as a PNG when it does, so unlike a JPEG it is re-encoded. A GIF contributes its first frame only.`,
  ],
  useCases: [
    {
      title: "Receipts for an expense claim",
      body: "Photograph a week of paper receipts and arrange them by date, so the finance team gets one file in order instead of a string of loose attachments.",
    },
    {
      title: "A paper document shot page by page",
      body: "A signed lease or a completed paper form photographed one sheet at a time becomes a single PDF with its pages in sequence. If you need the text to be searchable, OCR PDF can add a text layer afterwards; unlike this tool, that step uploads the file to pdf.xyz's server.",
    },
    {
      title: "An application that wants one file",
      body: `Visa, exam, job and claims portals often ask for supporting photos as a single PDF under a size such as 100 KB. Choose that size under ${LIMIT} and the PDF is made to fit, on your device, by saving the photos again at a lower quality; the panel then says, for example, “${LIMIT_MET}”`,
    },
    {
      title: "Photos to print on A4 or Letter paper",
      body: "Pick the paper your printer holds under Page size, and Auto orientation for a mix of landscape and portrait shots. Each image is scaled to sit inside the margin and is never cropped, so no photo runs off the edge of the sheet.",
    },
    {
      title: "One PDF for every photo",
      body: "Some upload forms want each document as its own file. Choose One PDF per image (ZIP) under Output and, with more than one photo, you get a ZIP holding a one-page PDF for each, named after the photo.",
    },
  ],
  steps: [
    {
      title: "Add your JPG images",
      body: `Drop JPG or JPEG files (PNG works too) onto the box that reads "Drop JPG images here, or browse", or click it to pick them. The box stays on the page, so you can add more in several goes. WebP, GIF and BMP files are taken as well. An alert below the box names each file it turns away: "Choose PNG, JPG, WebP, GIF or BMP images." for another type, "File is empty." for a zero-byte file, "Max ${MAX_IMAGE_MB} MB per image." for one that is too big, "Could not read this file — pick it again." when the file cannot be read, and a note naming the real format, such as "photo.jpg" is an AVIF image., when a file's contents are none of those.`,
    },
    {
      title: "Set the page order",
      body: "Under Image order, each thumbnail is labelled with the page it will become. The up and down arrows on a thumbnail (Move up, Move down) shift a photo one place, the cross (Remove) takes it out, and Clear below the list empties it.",
    },
    {
      title: "Choose the page setup",
      body: `Below the list, Page size, Orientation and Margin set how each page is laid out, ${LIMIT} caps the size of the PDF, and Output chooses One PDF or One PDF per image, which with more than one image arrives as a ZIP. Left alone they give the usual layout: US Letter, portrait, a 0.5 in margin, ${NO_LIMIT.toLowerCase()} on size, one PDF. Orientation does not apply to Fit to image, whose pages already take each photo's shape. With One PDF per image, a ${LIMIT} applies to each PDF on its own.`,
    },
    {
      title: "Press Create PDF",
      body: 'The button changes to Creating PDF… while the pages are built on your device. Each file\'s contents were already checked when you added it, so a PNG saved with a .jpg name simply goes in as a PNG. A file whose image data cannot be read stops the run with a message naming it, such as "photo.jpg" could not be decoded as a JPG image.',
    },
    {
      title: "Download the PDF",
      body: "When JPG PDF created appears with the image count and file size, press Download PDF. The file takes its name from your first image, so holiday.jpg becomes holiday-pdf.pdf. With One PDF per image and more than one photo, the panel offers Download ZIP instead: one PDF per photo, holiday.jpg becoming holiday.pdf, in a ZIP named holiday-pdfs.zip.",
    },
  ],
  faqs: [
    {
      q: "Why is one of my phone photos sideways in the PDF?",
      a: "It should not be. Phones often store a portrait photo as landscape pixels plus an EXIF orientation tag that tells viewers how to turn it. JPG to PDF reads that tag and turns the photo on the page the way your browser shows it, sized to its upright shape, without re-encoding the JPEG. If a page is still sideways, the camera saved the wrong tag (or none): open the PDF in Rotate PDF, which also runs in your browser, and turn just that page.",
    },
    {
      q: "Does converting JPG to PDF reduce photo quality?",
      a: `Not with ${LIMIT} at ${NO_LIMIT}. Then each JPEG goes in as it is, not decompressed and saved again (a turned phone photo only has its rotation tag reset to upright), so every pixel of the original is still there even when the photo is displayed smaller to fit the page, and the PDF is as heavy as the photos. With a ${LIMIT} that the PDF is over, yes, on purpose: the photos are saved again with fewer pixels and stronger compression until the PDF fits, and the panel says the images were saved again.`,
    },
    {
      q: "Does the PDF keep my photos' metadata, such as location?",
      a: `With ${LIMIT} at ${NO_LIMIT}, yes. Because each JPEG goes into the PDF as it is, apart from a rotation tag reset to upright, any metadata stored inside it travels too, including camera details and GPS coordinates if your camera recorded them. Strip it from the photos first if the PDF will be shared widely. A photo saved again to fit a ${LIMIT} keeps only its pixels: its camera details and location are not in the PDF.`,
    },
    {
      q: "Can I add PNG, WebP, GIF or BMP images?",
      a: 'Yes, all four, mixed with JPGs in the same PDF, each on its own page. A PNG goes in as it is, and any transparent areas come out white. A WebP, GIF or BMP is decoded by your browser and saved again: as a high-quality JPEG when the picture has no transparency, as a PNG when it does. That is a re-encode, so a WebP photo can come out slightly larger or softer than the file you had, and an animated GIF gives only its first frame. Each file is judged by its contents, not its name, so a WebP saved as .jpg still goes in. A file of any other kind is turned away when you add it with "Choose PNG, JPG, WebP, GIF or BMP images."',
    },
    {
      q: "Can I make the PDF smaller than 100 KB or 200 KB?",
      a: `Yes, with ${LIMIT}: choose ${LIMIT_PRESETS}, or Custom and a whole number of KB. The PDF is made as usual first and kept as it is if it already fits. If it is bigger, your browser saves the images again as JPEGs, step by step at a lower quality and pixel size, measures each PDF, and keeps the sharpest one that fits. If none fits, you get the smallest it made and a line saying it is above your limit. Here 1 KB is 1,024 bytes; a portal that counts 1,000 needs a slightly lower number. A transparent PNG saved again this way has its see-through areas filled with white, the colour of the page.`,
    },
    {
      q: "How many images can I combine into one PDF?",
      a: `The tool sets no count of its own, only the ${MAX_IMAGE_MB} MB ceiling per image. Every photo you add is held in the tab's memory until the PDF is built, so a very large batch is bounded by what your device can hold.`,
    },
  ],
  relatedGuides: [],
};

export default content;
