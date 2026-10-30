import type { ToolContent } from "./types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import { MAX_SCAN_SIDE_PX } from "@/lib/pdf/scan-to-pdf";

// The per-photo byte ceiling the scan runner's gate refuses above, read from
// the map that runner uses.
const MAX_MB = Math.round(RUNNER_FILE_CEILINGS.scan / (1024 * 1024));
const LONG_SIDE = MAX_SCAN_SIDE_PX.toLocaleString("en-US");

const content: ToolContent = {
  slug: "scan-to-pdf",

  seoTitle: "Scan to PDF — Phone Camera Scanner, No Upload",

  metaDescription:
    "Photograph paper pages with your phone's camera and save them as one PDF, with a Document or Black & white clean-up. Runs in your browser; nothing uploads.",

  intro: [
    "Scan to PDF turns photos of paper into a PDF, one page per photo. On a phone, the Take photo button opens the rear camera directly: snap a page, then press the button again for the next one. On a computer the same button opens the file picker, and you can also drop photos you already have. There is no app to install: the page asks the browser for a photo the same way it asks for any file, and the phone's own camera takes it.",
    `Every step runs in your browser tab, so the photos are not uploaded to pdf.xyz. Each photo is turned upright using the orientation your camera recorded, then scaled so its long side is at most ${LONG_SIDE} pixels, which keeps an A4 page sharp enough to read and print while the file stays small. JPG and PNG photos are accepted, up to ${MAX_MB} MB each. The finished PDF holds the pictures; its text is not selectable or searchable until you run it through OCR.`,
    "The photo is used as you framed it. There is no automatic edge detection, cropping or perspective straightening, so lay the page flat, fill the frame with it and shoot from straight above. What the tool does do is clean up the light: Document makes the page high-contrast grayscale, and Black & white reduces it to pure black and white pixels, judged against each part of the page's own brightness so a shadow across the paper does not turn grey or black.",
  ],

  useCases: [
    {
      title: "A signed form you need to send back today",
      body: "Someone hands you a paper form, you sign it, and they want a PDF by email. Photograph each page with your phone, pick Black & white so the paper reads as white rather than grey, and send the file from the same phone.",
    },
    {
      title: "Receipts for an expense claim",
      body: "Lay each receipt on a dark table, take one photo per receipt, and save them as one PDF in the order you need. Document keeps faint thermal print readable without throwing away its gray tones.",
    },
    {
      title: "Notes and handouts from a lecture",
      body: "Capture handwritten notes or a printed handout page by page, rotate any shot that came out sideways, and keep the set as a single PDF next to the course's other files.",
    },
    {
      title: "Photos you already took",
      body: "If the pictures are already in your gallery or on your computer, drop them in instead of using the camera. They are cleaned up and laid out exactly as new shots are.",
    },
  ],

  steps: [
    {
      title: "Photograph or add the pages",
      body: `Press “Take photo” to open your phone's camera and take one page; press it again for each next page. On a computer, or for photos you already have, drop them on the box or browse for them. JPG and PNG photos up to ${MAX_MB} MB each are accepted.`,
    },
    {
      title: "Put the pages in order",
      body: "Each photo becomes a page in the Pages list, with a preview of how it will look. Use a page's buttons to rotate it a quarter turn, move it up or down, or remove it.",
    },
    {
      title: "Choose the clean-up and page size",
      body: "Under Clean-up pick Original, Document or Black & white; the previews change to match. Under Page size pick A4, US Letter or Fit to photo. On A4 and US Letter the photo fills the page, which turns landscape for a wide photo.",
    },
    {
      title: "Create and download the PDF",
      body: "Press “Create PDF”. Each page is prepared in turn on your device, then the result shows how many pages were saved and the file size. Press “Download PDF” to save it.",
    },
  ],

  faqs: [
    {
      q: "Are my photos uploaded anywhere?",
      a: "No. The photos are decoded, cleaned up and saved into the PDF inside your browser tab, and the download is made on your device. The page has to load from pdf.xyz first, but the pictures you take or pick are not sent to us.",
    },
    {
      q: "Does it find the edges of the page and straighten it?",
      a: "No. There is no automatic edge detection, cropping or perspective correction: each photo is used exactly as framed. Fill the frame with the page and hold the phone flat above it. To trim a margin afterwards, open the PDF in Crop PDF.",
    },
    {
      q: "What do Document and Black & white do?",
      a: "Document converts the photo to grayscale and stretches its contrast, so dim paper becomes white and text becomes dark; the page is stored as a single gray channel. Black & white turns every pixel pure black or pure white, comparing each one with the brightness of the area around it, and stores the page at one bit per pixel, which gives the smallest file. Original keeps the photo's colour.",
    },
    {
      q: "Why did my photo come out sideways?",
      a: "Phones record which way up a photo was taken, and the tool uses that to turn each page upright. Some apps strip that note when they save or share a picture. If a page still looks wrong in its preview, press its rotate button until it is the right way up before you create the PDF.",
    },
    {
      q: "Can I search or copy the text in the scanned PDF?",
      a: "Not on its own. Each page is a picture, so there is no text in the file to search or select. Run the PDF through OCR PDF to add a searchable text layer; that tool sends the file to pdf.xyz's secure server for processing.",
    },
    {
      q: "Can I use it on a computer without a camera?",
      a: "Yes. On a computer the camera button opens the ordinary file picker, and you can drop or browse for photos taken on any device. The clean-up and page options work the same way.",
    },
  ],

  relatedGuides: [],
};

export default content;
