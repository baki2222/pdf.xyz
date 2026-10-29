import type { ToolContent } from "./types";
import { modeUploadsFiles } from "@/lib/tools/processing-split";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeiling, toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { outputName } from "@/lib/pdf/files";

/*
 * Every behavioural claim below was read from the code on 2026-09-27:
 *  - extractor: src/lib/pdf/extract-images.ts. walk() reads each page's
 *    /Resources /XObject and recurses into Form XObjects; /Pattern resources
 *    and annotation appearance streams are not walked. Content streams are
 *    scanned only for inline BI/ID/EI images (scanContent), each reported as
 *    skipped; no drawing operator is applied, so no clipping, rotation or
 *    flip the page applies reaches the saved file. Dedupe is by indirect-object
 *    tag, so a reused image is emitted once, on the first page it is met.
 *    handleImage: DCTDecode is copied verbatim whatever its colour space
 *    (jpegColorLabel labels CMYK JPEGs, it does not skip them) and the /Decode
 *    check sits BELOW the DCT branch, so a JPEG's /Decode is neither skipped
 *    nor applied; pixel images are extracted as 8-bit RGB/gray, 1-bit gray,
 *    or an Indexed palette over RGB/gray at 1/2/4/8 bits (expandPalette), and
 *    written by encodePng with IHDR/IDAT/IEND only — stored (uncompressed)
 *    DEFLATE, no iCCP. Transparency: readTransparency turns an /SMask, a
 *    colour-key /Mask array or a stencil /Mask stream into the PNG's alpha
 *    (rgba8/ga8); a masked JPEG, and a mask it cannot apply (/Matte, a size
 *    mismatch, an unread filter, a custom /Decode, an unread depth), comes
 *    out opaque with a noTransparency note the runner lists under "saved with
 *    a caveat". Skipped: JPXDecode, CCITTFaxDecode, JBIG2Decode, other
 *    filters, /ImageMask stencils, custom /Decode arrays on pixel images,
 *    CMYK, Lab, Separation, DeviceN and palettes over them, other bit depths,
 *    inline images, oversized or undecodable streams.
 *    History: on 2026-09-27 this bullet said "no alpha, /SMask never read"
 *    and listed Indexed and inline images as unscanned or skipped. That was
 *    true of the extractor it was read from and false from 8e398575 on, and
 *    the page kept saying it; tool-faq-substance now builds each case.
 *    Names are page-<p>-image-<n>.<ext>, both zero-padded to one width across
 *    the whole run, so they sort in page order. No literal example is quoted
 *    here: the pad width is a literal inside the extractor, not an exported
 *    constant, so a typed example could not follow it.
 *  - runner: src/components/tools/runner/extract-images-runner.tsx — Dropzone
 *    "Drop your PDF here, or browse", "Extract images" / "Scanning for
 *    images…", "Download ZIP (N images)" or "Download image", "Scan again"
 *    (returns to the Extract images screen with the file still loaded),
 *    "Start over", a download button per preview, a capped preview grid with
 *    a "Showing the first … previews" note, SkippedNote grouped by reason with
 *    a count and no page numbers, and the amber "No extractable images found"
 *    panel. The ZIP is built with DEFLATE; the summary's size total is the sum
 *    of the extracted files, before zipping. ZIP name:
 *    outputName(file, "images", "zip").
 *  - loader: use-single-pdf.ts validatePdfFile (the runner's ceiling, read
 *    here through toolFileCeiling so the registry decides which one; its
 *    refusal says "too large for in-browser processing") and
 *    getPageRotations -> loadPdf, which refuses any file with an /Encrypt
 *    entry (pdf-lib throws without ignoreEncryption) with "This PDF is
 *    password-protected. Unlock it first, then try again."
 *  - unlock-pdf is processing "server" in the catalogue, and its panel sends
 *    the password to the worker with the file; both are asserted below.
 *  - relatedGuides was empty until 2026-10-29: no guide mentioned
 *    extracting images before how-to-extract-images-from-a-pdf.
 */
const tool = getToolBySlug("extract-images");
if (!tool || modeUploadsFiles(tool.processing)) {
  throw new Error(
    "extract-images content says the file is not uploaded, but the tool is not processing 'client'",
  );
}
const ceiling = toolFileCeiling(tool);
const maxMb = toolFileCeilingMb(tool);
if (ceiling.tier !== "in-browser" || maxMb === null) {
  throw new Error(
    "extract-images content says the file stays in the browser, but no in-browser ceiling was found",
  );
}
const unlockTool = getToolBySlug("unlock-pdf");
if (
  !unlockTool ||
  capabilityForMode(unlockTool.processing) !== "secure-worker"
) {
  throw new Error(
    "extract-images content says Unlock PDF uploads the file, but unlock-pdf is not processing 'server'",
  );
}
const zipExample = outputName("catalogue.pdf", "images", "zip");

const content: ToolContent = {
  slug: "extract-images",

  seoTitle: "Extract Images from PDF at Original Resolution",

  metaDescription:
    "Pull the embedded images out of a PDF at native resolution: JPEGs saved byte-for-byte, RGB and grayscale images as lossless PNGs. Runs in your browser.",

  intro: [
    "A picture inside a PDF is usually stored as its own image object, at whatever resolution it had when the document was made. This tool reads those objects directly instead of photographing the page, so a product shot, a scanned photo or a chart that was placed as a picture comes back at its real pixel dimensions, with no surrounding text, margins or page background. It runs in your browser: the PDF is read on your device and is not uploaded.",
    "What you get depends on how each image was stored. JPEG images, CMYK JPEGs included, are written out byte-for-byte as .jpg files. Raw RGB or grayscale pixels at 8 bits per channel, or 1-bit black and white, are rebuilt as lossless PNGs at native size, and so are palette (indexed) images over RGB or gray, expanded from their palette. Nested form objects are searched too, and a picture reused on several pages is saved once, under the first page it appears on.",
    `Several kinds of image are not recovered yet: JPEG 2000, CCITT and JBIG2 fax-style bitmaps, CMYK pixel images, spot-colour and Lab images (including palette, or indexed, images built on them), other bit depths, stencil masks painted on their own, pixel images with a custom decode array, and images written inline in a page's drawing instructions. Each one is counted as skipped under its reason rather than guessed at. Files up to ${maxMb} MB are accepted, and encrypted PDFs are refused until they are unlocked.`,
  ],

  useCases: [
    {
      title: "Reuse photos from a brochure or catalogue",
      body: "Take the product or location photos out of a marketing PDF for a website or slide, without cropping screenshots.",
    },
    {
      title: "Recover figures from a report or paper",
      body: "Save charts, micrographs or diagrams that were placed as raster images, each as a separate file whose name gives its page and its order on that page, zero-padded so the files list in page order.",
    },
    {
      title: "Spot the oversized photos before compressing",
      body: "Each preview is labelled with its pixel width and height, which you can set against the size the photo is printed at to find the ones carrying far more pixels than they need. The size total adds up the extracted files before zipping, and PNGs are written uncompressed, so it can exceed the PDF itself.",
    },
    {
      title: "Pull photos out of a photo-book or portfolio export",
      body: "If a design app exported the gallery with JPEG images, those JPEGs come back exactly as the export wrote them, so nothing is compressed a second time.",
    },
  ],

  steps: [
    {
      title: "Pick the PDF to scan",
      body: `Drop one PDF where it says Drop your PDF here, or click browse to choose it. It must be ${maxMb} MB or smaller. Once it is read, its name, page count and size appear at the top.`,
    },
    {
      title: "Click Extract images",
      body: "The button changes to Scanning for images… while each page's image objects are read in your browser. No page is rendered and the PDF does not leave your device.",
    },
    {
      title: "Review the previews and the skipped list",
      body: "A grid shows each image's width, height and format; a long result draws only the first previews, with a note that the ZIP of several images holds them all. A skipped box lists each reason with a count. If nothing could be extracted, you see No extractable images found instead.",
    },
    {
      title: "Download what you need",
      body: `When more than one image was found, use Download ZIP for all of them in one archive, named like ${zipExample}; Download image appears when only one was found. Each preview also has its own download button. Scan again returns to the Extract images button with the same file, and Start over lets you pick a different PDF.`,
    },
  ],

  faqs: [
    {
      q: "What is the difference between Extract Images and PDF to JPG?",
      a: "Extract Images saves the pictures embedded in the PDF as they were stored, at their own resolution, with no page around them. PDF to JPG and PDF to PNG render whole pages, text and all, as images. Use those when you need a picture of the page, or when this tool reports an image as skipped.",
    },
    {
      q: "Will the images keep their original quality?",
      a: "The pixels do. Embedded JPEGs are copied byte-for-byte, and RGB or grayscale pixel images become lossless PNGs at native size. A colour profile the PDF assigns to an image is not written into the saved file (a JPEG keeps only what its own bytes contain), so colours can look different in profile-aware apps. The page's drawing instructions are not applied either: an image the page crops, rotates or flips is saved whole, in the orientation it was stored. If the author shrank an image before making the PDF, that smaller version is all the file holds.",
    },
    {
      q: "Why were no images found at all?",
      a: "The pages may hold only text and vector drawings. Images used as fill patterns or inside annotations such as stamps are not scanned and are not listed. Images written inline in a page's drawing instructions are found but not extracted yet: they appear in the skipped list with that reason.",
    },
    {
      q: "Is transparency kept on logos and cut-out images?",
      a: "For PNGs, yes. When a PDF stores transparency as a separate mask beside a pixel image (a soft mask, a colour-key mask or a stencil mask), that mask becomes the PNG's alpha channel, so a cut-out logo comes out cut out. A JPEG is saved byte-for-byte and cannot carry a mask, so a masked JPEG comes out on a solid background. A few masks also cannot be applied, such as a pre-blended one or one of a different size. The results list every image saved without its transparency and say why.",
    },
    {
      q: "Does my PDF get uploaded?",
      a: `No. The file is read, the images are rebuilt and, when there is more than one, the ZIP is assembled in your browser. The whole PDF is held in your browser's memory while you work, and a file over ${maxMb} MB is turned away as too large for in-browser processing.`,
    },
    {
      q: "Can I extract images from a password-protected PDF?",
      a: "Not while it is encrypted. Any encryption at all makes the file fail to open here, even when it needs no password to view and only limits printing or copying. Unlock PDF can take the encryption off with a password you know; it runs on pdf.xyz's worker, so there the file and that password are uploaded.",
    },
  ],

  relatedGuides: ["how-to-extract-images-from-a-pdf"],
};

export default content;
