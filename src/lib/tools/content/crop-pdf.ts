import type { ToolContent } from "./types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import { MIN_CROP_DIMENSION } from "@/lib/pdf/crop";

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
 *    narrower, with the band that sat on the DISPLAYED RIGHT edge gone;
 *  - owner-password-only files (pypdf, RC4-40 and RC4-128, empty user
 *    password) were refused at open with "This PDF is password-protected.
 *    Unlock it first, then try again." AES was not exercised;
 *  - output size went both ways: a one-page file grew, a 200-page
 *    pypdf-written file shrank to a fraction of its size.
 */
const ceilingMb = Math.round(RUNNER_FILE_CEILINGS.crop / (1024 * 1024));

/** The smallest a cropped page may become, as the engine enforces it. */
const minPt = MIN_CROP_DIMENSION;

const content: ToolContent = {
  slug: "crop-pdf",

  seoTitle: "Crop PDF Online – Trim Margins in Your Browser",

  metaDescription:
    "Crop PDF pages by trimming margins with sliders, evenly or edge by edge, on every page or only the ones you list. The file stays in your browser tab.",

  intro: [
    "Crop PDF trims the edges of a page so readers see less of it: wide white margins, a scanner's dark border, printer's marks around a proof. You set how much to cut in points, the unit PDF page sizes are measured in, either as one value for all four sides or separately for Top, Right, Bottom and Left. The crop can go on every page or only on the pages you type, such as 1-3, 5.",
    `It runs inside your browser tab: your browser reads the PDF from your device, rewrites the crop box in memory, and sends nothing to pdf.xyz. The size check comes first, so anything larger than ${ceilingMb} MB, the most this in-browser runner accepts, is refused without being read. Encrypted PDFs are refused when they are opened, including a file that shows its pages without any password but restricts printing or editing, so remove the protection first.`,
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
      body: "Choose Selected pages and list only the wide chart pages, so the portrait pages around them keep their original size. If those inserts are stored upright and only turned by a rotation setting, read the FAQ on rotated pages before choosing which edge to trim.",
    },
  ],

  steps: [
    {
      title: "Open one PDF",
      body: "Drag the PDF into the drop area, or click it to pick the file from your device. When loading finishes, a strip above the margin controls gives the file name with its page total and size.",
    },
    {
      title: "Set the crop margins",
      body: "In the Crop margins section, Uniform gives a single All sides slider, while Per side gives separate Top, Right, Bottom and Left sliders. Each shows its value in pt as you drag.",
    },
    {
      title: "Choose the pages",
      body: 'In the Pages section, keep All pages, or pick Selected pages and type a list in the Pages box using commas and ranges, for example 2-4, 7. An open range such as "8-" runs to the last page.',
    },
    {
      title: "Check the preview and crop",
      body: "Crop preview is a blank outline in page 1's proportions with a dashed box marking what your margins keep; it does not show the page's content. Press Crop PDF, then Download cropped PDF, or Start over to go back to an empty picker.",
    },
  ],

  faqs: [
    {
      q: "Does cropping delete what is outside the margins?",
      a: "No. The tool changes the crop box, which controls what a viewer displays, and leaves the page content itself untouched. Anyone with an editor that resets or inspects page boxes can bring the hidden area back. To remove sensitive material for good, use Redact PDF, which rebuilds every page as a picture with solid fill painted over the areas you mark.",
    },
    {
      q: "Can I crop each side by a different amount?",
      a: "Yes. Under Crop margins, switch from Uniform to Per side and four sliders appear, one per edge. Setting only Bottom, for instance, removes a footer strip and leaves the other three edges alone.",
    },
    {
      q: "Why is the Crop PDF button greyed out, or why did it refuse my margins?",
      a: `The button stays disabled while every slider sits at 0, because there is nothing to crop. If the margins you set would leave a page narrower or shorter than ${minPt} points, the run stops and names the first page that failed so you can reduce them. A Pages entry that is empty, backwards or past the last page is also rejected with a message. Each slider stops at a fixed maximum; for a deeper cut, crop the downloaded copy again, since margins are measured from the visible area that is left.`,
    },
    {
      q: "My page is rotated and the wrong edge was trimmed. Why?",
      a: "Margins are applied to the page as it is stored in the file, before any rotation setting a viewer applies. On a page stored upright and displayed turned a quarter-turn clockwise, Top trims what you see as the right-hand edge. In Per side mode, move the slider for the matching stored edge. Crop preview draws page 1 unrotated, as stored, so on a rotated page 1 the outline looks turned compared with your viewer, but its dashed edges line up with the sliders that move them.",
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

  // No guide in @/lib/guides covers cropping, so none is linked.
  relatedGuides: [],
};

export default content;
