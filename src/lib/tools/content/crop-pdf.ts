import type { ToolContent } from "./types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import { MIN_CROP_DIMENSION } from "@/lib/pdf/crop";
import { AUTO_CROP_PAD_PT } from "@/lib/pdf/auto-crop";

/**
 * The Crop runner's own input gate (`useSinglePdf` -> `validatePdfFile` ->
 * MAX_PDF_BYTES), read through the per-runner ceiling map and rounded the way
 * `validatePdfFile`'s refusal and `toolFileCeilingMb` round it, so this page
 * and the refusal quote one number.
 *
 * Behaviour claims below were checked against the code on 2026-09-27
 * (src/lib/pdf/crop.ts, src/lib/pdf/engine.ts `loadPdf`, crop-runner.tsx,
 * single-pdf-runner.tsx, use-single-pdf.ts, runner-kit.tsx, stamp-controls.tsx,
 * ranges.ts, pdf-lib 1.17.1). Visible labels: section titles "Crop margins",
 * "Pages", "Crop preview"; segmented buttons Uniform / Per side and All pages
 * / Selected pages ("Crop mode" and "Page scope" are aria-labels only, not
 * on screen, so the copy does not tell a reader to look for them).
 *
 * Real jobs run through `cropPdf` / `getPageRotations` the same day:
 *  - a /Rotate 90 page with Top = 40 rendered (poppler, -cropbox) 40 pt
 *    narrower, with the band that sat on the DISPLAYED RIGHT edge gone. TRUE
 *    THEN, FALSE SINCE 4844aad3: cropPdf now insets `visiblePageFrame(page)`
 *    by `toContentMargins(margins, rotation)`, so the same run removes the
 *    band on the DISPLAYED TOP edge, and `getPageSizes` (the preview's
 *    source) reports the page as displayed. The rotated-page FAQ kept the old
 *    answer ("Top trims what you see as the right-hand edge … move the slider
 *    for the matching stored edge") until 2026-10-07, and a use case pointed
 *    readers at it; displayed-frame-claims.test.ts now holds every page whose
 *    engine reads the displayed frame to copy that does not describe the
 *    stored one;
 *  - owner-password-only files (pypdf, RC4-40 and RC4-128, empty user
 *    password) were refused at open with "This PDF is password-protected.
 *    Unlock it first, then try again." AES was not exercised;
 *  - output size went both ways: a one-page file grew, a 200-page
 *    pypdf-written file shrank to a fraction of its size.
 *
 * Added 2026-10-24: units (length-units.ts; values stay points, a unit only
 * shows and reads them — crop-runner.test.tsx types 25.4 mm and reads 72 pt
 * off the download) and Auto (auto-crop.ts + auto-crop-render.ts). Auto is
 * proved by auto-crop.test.ts on a fixture with known margins, re-rendering
 * the SAVED file to see every mark survive, and by crop-runner.test.tsx
 * through the runner (the blank page named and left uncropped). Visible
 * labels: "Auto", "Find white margins", "Each page its own box", "Same box
 * on every page", "Previous page" / "Next page"; "Units" and "Apply
 * auto-crop" are aria-labels only.
 */
const ceilingMb = Math.round(RUNNER_FILE_CEILINGS.crop / (1024 * 1024));

/** The smallest a cropped page may become, as the engine enforces it. */
const minPt = MIN_CROP_DIMENSION;

/** The white Auto keeps outside the content, as `marginsForInk` pads it. */
const autoPadPt = AUTO_CROP_PAD_PT;

const content: ToolContent = {
  slug: "crop-pdf",

  seoTitle: "Crop PDF Online – Trim Margins in Your Browser",

  metaDescription:
    "Crop PDF margins evenly, edge by edge, or to the white space found around each page's content, on every page or the ones you list. Stays in your browser.",

  intro: [
    "Crop PDF trims the edges of a page so readers see less of it: wide white margins, a scanner's dark border, printer's marks around a proof. You set how much to cut in points (the unit PDF page sizes are measured in), millimetres or inches, either as one value for all four sides or separately for Top, Right, Bottom and Left. Or choose Auto: the tool looks at every page for marks and proposes a crop that keeps them with a small white border, page by page or as one box for every page, for you to check before anything is cropped. The crop can go on every page or only on the pages you type, such as 1-3, 5.",
    `It runs online, inside your browser tab: your browser reads the PDF from your device, rewrites the crop box in memory, and sends nothing to pdf.xyz. The size check comes first, so anything larger than ${ceilingMb} MB, the most this in-browser runner accepts, is refused without being read. Encrypted PDFs are refused when they are opened, including a file that shows its pages without any password but restricts printing or editing, so remove the protection first.`,
    `Under the hood the tool shrinks each page's crop box, the region a PDF viewer shows. The page content itself is left as it was: any text you could select before is still selectable, nothing is redrawn, and whatever sits outside the new edges is still in the file, just out of view. Margins are measured from the page's current visible area, so cropping an already-cropped file trims further, and no page is allowed to end up narrower or shorter than ${minPt} points.`,
  ],

  useCases: [
    {
      title: "Remove the dark frame from a scan",
      body: "Flatbed scans often pick up a grey or black band where the lid did not meet the glass. Trimming just the affected edges in Per side mode makes the page look like paper again.",
    },
    {
      title: "Make a book PDF readable on a small screen",
      body: "Generous print margins waste space on a phone or e-reader. Trimming them lets the viewer zoom the text block to fill the display.",
    },
    {
      title: "Cut printer's marks off a print-ready proof",
      body: "Press files carry crop marks and bleed around the finished page. Setting each margin to the width of that border gives a clean-looking copy to send for review. The marks are hidden rather than deleted, so keep the untouched original for the press.",
    },
    {
      title: "Crop just the landscape inserts",
      body: "Choose Selected pages and list only the wide chart pages, so the portrait pages around them keep their original size. Margins follow each page as your viewer displays it, so on a landscape insert Top trims the edge you see at the top, even when the insert is stored upright and only turned by a rotation setting.",
    },
  ],

  steps: [
    {
      title: "Open one PDF",
      body: "Drag the PDF into the drop area, or click it to pick the file from your device. When loading finishes, a strip above the margin controls gives the file name with its page total and size.",
    },
    {
      title: "Set the crop margins",
      body: "In the Crop margins section, Uniform gives a single All sides slider, while Per side gives separate Top, Right, Bottom and Left sliders. Pick pt, mm or in to set the unit; each slider shows its value in that unit as you drag, and the box beside it takes a typed value. Auto has a Find white margins button instead: it reads every page, then says how many pages it found content on and names any page that looks blank, which is left uncropped. With content on more than one page you can keep Each page its own box or choose Same box on every page.",
    },
    {
      title: "Choose the pages",
      body: 'In the Pages section, keep All pages, or pick Selected pages and type a list in the Pages box using commas and ranges, for example 2-4, 7. An open range such as "8-" runs to the last page.',
    },
    {
      title: "Check the preview and crop",
      body: "In Uniform and Per side, Crop preview is a blank outline in page 1's proportions with a dashed box marking what your margins keep; it does not show the page's content. In Auto it shows the page itself under the proposed box, with Previous page and Next page to check each one. Press Crop PDF, then Download cropped PDF, or Start over to go back to an empty picker.",
    },
  ],

  faqs: [
    {
      q: "Can I crop each side by a different amount?",
      a: "Yes. Under Crop margins, switch from Uniform to Per side and four sliders appear, one per edge. Setting only Bottom, for instance, removes a footer strip and leaves the other three edges alone.",
    },
    {
      q: "Why is the Crop PDF button greyed out, or why did it refuse my margins?",
      a: `The button stays disabled while every slider sits at 0, because there is nothing to crop, and in Auto until Find white margins has found content on at least one page. If the margins you set would leave a page narrower or shorter than ${minPt} points, the run stops and names the first page that failed so you can reduce them. A Pages entry that is empty, backwards or past the last page is also rejected with a message. Each slider stops at a fixed maximum; for a deeper cut, crop the downloaded copy again, since margins are measured from the visible area that is left.`,
    },
    {
      q: "Can Crop PDF find the margins for me?",
      a: `Yes, with Auto. Your browser renders each page at a low resolution, finds the area that holds anything darker than near-white (text, lines, images, a scanner's grey edge), and proposes margins that keep it with ${autoPadPt} points of white on every side. A page with nothing on it is named and left uncropped. Same box on every page uses, for each edge, the smallest margin any page needs, so no page loses content. A scan with a grey or speckled background has no white to find, so Auto may crop little or nothing there; set the margins yourself instead.`,
    },
    {
      q: "Does Crop PDF work on rotated pages?",
      a: "Yes. Margins are measured on the page as your viewer shows it, after any rotation setting in the file, so Top always trims the edge you see at the top, whether a page is stored upright and turned for display or stored turned. In Per side mode, move the slider named for the edge you can see. Crop preview draws page 1 in the same displayed proportions, so a portrait page turned a quarter-turn shows as a landscape outline, and its dashed box marks what the sliders keep.",
    },
    {
      q: "Will the cropped file be smaller?",
      a: "Not reliably. The hidden content stays in the file and pdf-lib writes the whole document out again in its own layout, which can pack a loosely written file tighter or add a little to an already lean one. The result screen shows the new size next to the number of pages cropped. To make a file smaller on purpose, use Compress PDF.",
    },
    {
      q: "Can I crop a digitally signed PDF?",
      a: "You can, but the signature will no longer verify. The crop edits the page settings and the whole file is written out again, so the bytes the signature covered no longer match. Crop a document before it is signed, not after.",
    },
  ],

  // Empty until 2026-10-29, when how-to-crop-a-pdf shipped.
  relatedGuides: ["how-to-crop-a-pdf"],
};

export default content;
