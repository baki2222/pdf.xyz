import type { ToolContent } from "./types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import { MAX_RESIZE_SIDE_PT, MIN_RESIZE_SIDE_PT } from "@/lib/pdf/resize";
import { PT_PER_INCH } from "@/lib/pdf/page-geometry";

// The byte ceiling the resize runner's file gate refuses above.
const MAX_MB = Math.round(RUNNER_FILE_CEILINGS.resize / (1024 * 1024));
const MIN_IN = MIN_RESIZE_SIDE_PT / PT_PER_INCH;
const MAX_IN = MAX_RESIZE_SIDE_PT / PT_PER_INCH;

const content: ToolContent = {
  slug: "resize-pdf",

  seoTitle: "Resize PDF Pages to A4 or Letter — No Upload",

  metaDescription:
    "Change a PDF's page size to A4, US Letter, Legal, A3, A5 or a custom size, scaling the content to fit or changing only the canvas. Runs in your browser.",

  intro: [
    "Resize PDF changes the size of a PDF's pages. The common case is paper: a document laid out on US Letter has to print on A4 in Europe, or the other way round, without its edges being cut off. Pick A4, US Letter, US Legal, A3 or A5, or type a custom width and height in millimetres, inches or points, then choose whether every page changes or only the pages you list.",
    `There are two ways to resize. Scale content to fit gives the page the new size and scales what is on it, up or down, to fit inside it, centred and with its proportions kept, so nothing is cut off and nothing is stretched. Links, comments and form fields are moved and scaled along with the content, so they stay on the words they belong to. Change canvas only keeps the content at its size and grows or shrinks the page around it, centred: a bigger page gains blank margin, and on a smaller one whatever falls outside is hidden, though still in the file, much as Crop PDF hides it. Each side must be between ${MIN_IN} and ${MAX_IN} inches.`,
    `It runs in your browser with pdf-lib, with no upload: the PDF is not sent anywhere. The file gate refuses PDFs over ${MAX_MB} MB. Text stays text and images are not re-compressed: the page's own drawing is kept and only placed differently. A page that a reader shows turned (one with a rotation set, as Rotate PDF writes) gets the new size the way it is displayed, so a landscape page becomes a landscape A4 page.`,
  ],

  useCases: [
    {
      title: "Letter to A4, or A4 to Letter",
      body: "A US contract has to print on A4 in another office. Scaled to fit, every line stays on the page and the margins shrink a little rather than the text running off the edge.",
    },
    {
      title: "Making mixed page sizes match",
      body: "A file assembled from scans, slides and exported pages has pages of every size. Resize them all to one size so the document prints and reads as a set.",
    },
    {
      title: "Adding room for binding or notes",
      body: "Change canvas only with a bigger size leaves the content at its size and adds a blank border around it, for hole punching, a stamp or handwritten notes.",
    },
    {
      title: "A5 handouts from A4 pages",
      body: "Scale A4 pages down to A5 to print small booklets or handouts; the content shrinks with the page and keeps its layout.",
    },
  ],

  steps: [
    {
      title: "Open the PDF",
      body: `Drop the PDF on the box or browse for it; it takes one file, up to ${MAX_MB} MB.`,
    },
    {
      title: "Pick the new page size",
      body: "Choose A4, US Letter, US Legal, A3 or A5 under New page size, or “Custom” to type a width and height in mm, in or pt. Under Orientation, Match each page keeps each page's own portrait or landscape shape; Portrait or Landscape makes them all one.",
    },
    {
      title: "Choose how to resize",
      body: "Under How to resize, pick Scale content to fit or Change canvas only. Under Pages, keep “All pages” or choose “Selected pages” and type a list such as 1-3, 5.",
    },
    {
      title: "Resize and download",
      body: "Press “Resize PDF”. The result says how many pages were resized and the new file size. Press “Download resized PDF” to save it with -resized added to its name.",
    },
  ],

  faqs: [
    {
      q: "Is my PDF uploaded when I resize it?",
      a: "No. The pages are resized in your browser tab and the copy is saved on your device; the PDF is not sent to pdf.xyz.",
    },
    {
      q: "Will resizing make the text blurry?",
      a: "No. The page's text and drawings stay as they are, vector content stays vector, and images are not re-encoded. Scaling changes how large everything is drawn, the way a printer's fit-to-page setting does, so very small text becomes smaller when you scale a page down.",
    },
    {
      q: "What is the difference between the two resize options?",
      a: "Scale content to fit makes the page the new size and shrinks or enlarges the content to fit inside it, centred, keeping its proportions; when the shapes differ there are blank bands at two edges. Change canvas only leaves the content at its size and moves the page edges, centred on it: a bigger size adds margin, a smaller size hides what falls outside the new edges without deleting it.",
    },
    {
      q: "Do links and form fields still work after resizing?",
      a: "Yes. With Scale content to fit, the clickable area of each link, comment and form field is moved and scaled with the content. With Change canvas only they do not move, because the content does not.",
    },
    {
      q: "Can I resize only some pages?",
      a: "Yes. Choose “Selected pages” and type the pages, such as 2, 4-6. The pages you leave out keep their size, so the copy can mix sizes.",
    },
  ],

  relatedGuides: [],
};

export default content;
