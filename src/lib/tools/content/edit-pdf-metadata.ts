import type { ToolContent } from "./types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";

// The byte ceiling the metadata runner's file gate refuses above.
const MAX_MB = Math.round(RUNNER_FILE_CEILINGS.metadata / (1024 * 1024));

const content: ToolContent = {
  slug: "edit-pdf-metadata",

  seoTitle: "Edit PDF Metadata — Title, Author, No Upload",

  metaDescription:
    "See and change a PDF's title, author, subject, keywords, creator, producer and dates, or strip them all, XMP included. Runs in your browser, no upload.",

  intro: [
    "Every PDF can carry a small block of document information: a title, an author, a subject, keywords, the app that created it (Creator), the library that wrote it (Producer), and when it was created and last modified. Readers show the title in the window or tab instead of the file name, search tools index it, and anyone who opens Document Properties can read the author. Edit PDF Metadata shows all eight values and lets you change or clear any of them, or remove the lot.",
    `It runs in your browser with pdf-lib: the PDF is read and the new copy saved on your device, and nothing is uploaded. The file gate refuses PDFs over ${MAX_MB} MB, and encrypted PDFs are turned away with a note to unlock them first. The pages themselves are not touched. The file is read without letting the library stamp its own name or the current time over the values, so what you see is what the file holds, and what you save is exactly what you typed.`,
    "Many PDFs keep a second copy of the same information as XMP, an XML packet that Acrobat and other readers prefer when it is there. A copy that changed only the first set would keep showing the old title in those readers. So when the file has XMP, saving replaces it with a fresh packet holding the same values as the fields; anything else the old packet carried is not kept. Remove all metadata deletes the document information and the XMP packet both.",
  ],

  useCases: [
    {
      title: "A proper title in the browser tab",
      body: "A report exported from Word often carries a leftover title such as Microsoft Word - draft_v7_final, and every reader's tab and search result shows it. Set a real title before you publish or send it.",
    },
    {
      title: "Removing your name before sharing",
      body: "Office apps fill in Author with the name they know you by. Clear it, or remove all metadata, before a file goes to a client, a tender portal or a public website.",
    },
    {
      title: "Keywords and subject for a document library",
      body: "Give a set of PDFs consistent keywords and a subject line so a document management system or desktop search can find them.",
    },
    {
      title: "Correcting a wrong date",
      body: "A scanned or converted file often carries the date it was converted, not the date of the document. Set Created to the real date so sorting by date makes sense.",
    },
  ],

  steps: [
    {
      title: "Open the PDF",
      body: `Drop the PDF on the box or browse for it; it holds one file at a time, up to ${MAX_MB} MB. Its current title, author, subject, keywords, creator, producer and both dates load into the Document properties fields.`,
    },
    {
      title: "Change the values",
      body: "Type over any field, or empty it to remove that entry. Created and Modified use your device's date, time and time zone. A note beside the heading tells you when the file also carries XMP metadata.",
    },
    {
      title: "Or remove everything",
      body: "Choose “Remove all metadata” instead of “Edit values” to drop every one of those entries, and the XMP packet, from the copy.",
    },
    {
      title: "Save and download",
      body: "Press “Save metadata”, or “Remove metadata” when removing. The result lists the values the saved copy holds, read back from it. Press “Download PDF” to save the copy with -metadata added to its name.",
    },
  ],

  faqs: [
    {
      q: "Is my PDF uploaded to change its metadata?",
      a: "No. The file is opened, changed and saved in your browser tab. The page loads from pdf.xyz, but the PDF you pick is not sent to us.",
    },
    {
      q: "Why does my PDF reader still show the old title?",
      a: "Some readers show the file name rather than the title unless the PDF asks them to display the title, and a reader may cache what it showed last time. Close the file and open the downloaded copy, not the original. When the source had XMP metadata, the copy's XMP is rewritten too, so a reader that prefers XMP sees the new title as well.",
    },
    {
      q: "What does Remove all metadata take out?",
      a: "The document information entries (title, author, subject, keywords, creator, producer, created and modified dates) and the document's XMP metadata packet. It does not remove text on the pages, comments, form fields, bookmarks or metadata embedded inside images; use Redact PDF for content on the pages.",
    },
    {
      q: "Does editing metadata change the pages?",
      a: "No. The pages, their text and images are written back as they were. The file is saved as a new copy, so its size can differ slightly, and a digital signature in it will no longer verify after any change.",
    },
    {
      q: "Can I type titles in any language?",
      a: "Yes. Values are stored as Unicode, so Bengali, Chinese, Arabic or any other script is saved exactly as typed and read back by other PDF readers.",
    },
  ],

  relatedGuides: [],
};

export default content;
