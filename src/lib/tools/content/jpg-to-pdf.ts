import type { ToolContent } from "./types";
import { MAX_IMAGE_MB } from "@/lib/tools/limits";

/**
 * Written against src/lib/pdf/image-to-pdf.ts and
 * src/components/tools/runner/image-to-pdf-runner.tsx as of 2026-09-27:
 * fixed US Letter portrait pages, fixed margin, images centred and only ever
 * scaled DOWN, JPEG bytes embedded unchanged (pdf-lib embedJpg → DCTDecode, so
 * EXIF — including any GPS block — travels with them and the EXIF rotation tag
 * is not applied). There are NO page-size, orientation or margin controls; if
 * the runner gains them, this file must change with it.
 *
 * Checked by a real run of `imagesToPdf("jpg", …)` on 2026-09-27: an APP1
 * segment planted in each of three JPEGs appeared three times in the output
 * PDF, and `imagePdfOutputName("jpg", "holiday.jpg")` returned
 * "holiday-pdf.pdf". A second tsx run the same day (sharp-encoded JPEGs of
 * 4000x3000, 1200x1600 and 300x200, 8,314,815 bytes together) gave a
 * 8,316,557-byte PDF (x1.0002), kept the one planted Exif block, wrote no
 * /Rotate for an orientation-6 photo, and PNG bytes named fake.jpg failed
 * with '"fake.jpg" could not be decoded as a JPG image.' Neither run was in a
 * browser: the sideways-photo FAQ is an inference from the PDF (no /Rotate,
 * DCTDecode ignores EXIF), not an observed screen.
 *
 * NOT DERIVED, and nothing will catch it going stale: "US Letter", "portrait"
 * and "fixed margin" restate PAGE_WIDTH=612, PAGE_HEIGHT=792 and MARGIN=36,
 * which are module-private in image-to-pdf.ts, so this file cannot import
 * them. Export them (or a page-shape fact) and derive these words.
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
    "Every page comes out the same shape: a white, portrait US Letter page. Each photo is centred inside a fixed margin and shrunk only if it is too big to fit inside that margin. A photo that already fits is never enlarged, so a low-resolution picture can look small in the middle of the page, and a large landscape shot spans the width between the margins with white space above and below it. The tool has no page-size, orientation or margin settings today.",
    `The JPEG data is copied into the PDF as it is rather than re-encoded, so there is no second round of compression and the PDF ends up close to the combined size of your photos. A single photo may be as large as ${MAX_IMAGE_MB} MB. For PNG files, transparent ones included, use PNG to PDF instead.`,
  ],
  useCases: [
    {
      title: "Receipts for an expense claim",
      body: "Photograph a week of paper receipts and arrange them by date, so the finance team gets one file in order instead of a string of loose attachments.",
    },
    {
      title: "A paper document shot page by page",
      body: "A signed lease or a completed paper form photographed one sheet at a time becomes a single PDF with its pages in sequence. If you need the text to be searchable, OCR PDF can add a text layer afterwards; unlike this tool, that step uploads the file to pdf.xyz's worker.",
    },
    {
      title: "An application that wants one file",
      body: "Visa, rental and claims forms often ask for supporting photos as a single PDF. Because nothing is recompressed, the PDF weighs about as much as the photos together, so if the form caps the upload size, send smaller photos in rather than expecting this step to shrink them.",
    },
    {
      title: "Photos to print on Letter paper",
      body: "Each image is scaled to sit inside the page margin and is never cropped, so no photo runs off the edge of a Letter sheet. On a printer loaded with a different paper size, use the print dialog's scale-to-fit setting, whatever that app calls it, so the taller Letter page is shrunk onto the sheet.",
    },
  ],
  steps: [
    {
      title: "Add your JPG images",
      body: `Drop JPG or JPEG files onto the box that reads "Drop JPG images here, or browse", or click it to pick them. The box stays on the page, so you can add more in several goes. Anything turned away is listed by name in an alert below the box: "Choose JPG images only." for another type, "File is empty." for a zero-byte file, and "Max ${MAX_IMAGE_MB} MB per image." for one that is too big.`,
    },
    {
      title: "Set the page order",
      body: "Under Image order, each thumbnail is labelled with the page it will become. The Move up and Move down arrows shift a photo one place, Remove takes it out, and Clear below the list empties it.",
    },
    {
      title: "Press Create PDF",
      body: "The button changes to Creating PDF… while the pages are built on your device. A file that cannot be decoded as a JPEG stops the run with a message naming it; that includes a PNG that was only renamed to .jpg, since adding a file only looks at its type and name, not its contents.",
    },
    {
      title: "Download the PDF",
      body: "When JPG PDF created appears with the image count and file size, press Download PDF. The file takes its name from your first image, so holiday.jpg becomes holiday-pdf.pdf.",
    },
  ],
  faqs: [
    {
      q: "Why is one of my phone photos sideways in the PDF?",
      a: "Many phones store the pixels in one orientation plus a tag telling viewers to rotate them. Your browser's thumbnail honours that tag, but this tool places the stored pixels as they are and does not read it. Open the PDF in Rotate PDF, which also runs in your browser, and turn just the affected pages.",
    },
    {
      q: "Does converting JPG to PDF reduce photo quality?",
      a: "No. Each JPEG is embedded byte for byte, not decompressed and saved again, so every pixel of the original is still there even when the photo is displayed smaller to fit the page. The flip side is that the PDF is as heavy as the photos. Compress PDF's in-browser repack cannot shrink photo data; its Deep image compression step can, when a secure worker is available, but that step uploads the PDF to pdf.xyz's worker.",
    },
    {
      q: "Does the PDF keep my photos' metadata, such as location?",
      a: "Yes. Because the original JPEG bytes go into the PDF unchanged, any metadata stored inside them travels too, including camera details and GPS coordinates if your camera recorded them. Strip it from the photos first if the PDF will be shared widely.",
    },
    {
      q: "Can I add PNG, HEIC or WebP images?",
      a: "No. A file is refused unless its type or its .jpg/.jpeg name marks it as a JPEG, so convert HEIC or WebP pictures to JPG first. PNGs belong in PNG to PDF; for a document that mixes photos and PNGs, build the two halves separately and combine the pair in Merge PDF.",
    },
    {
      q: "How many images can I combine into one PDF?",
      a: `The tool sets no count of its own, only the ${MAX_IMAGE_MB} MB ceiling per image. Every photo you add is held in the tab's memory until the PDF is built, so a very large batch is bounded by what your device can hold.`,
    },
  ],
  relatedGuides: [],
};

export default content;
