import type { ToolContent } from "./types";
import {
  BOOKMARK_EDIT_MAX,
  BOOKMARK_TITLE_MAX,
} from "@/lib/pdf/bookmark-labels";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import { getRunnerKind } from "@/lib/pdf/registry";

// The byte ceiling of the runner kind this tool mounts (`metadata`), read
// through the registry, so a move to another kind moves the number.
const MAX_MB = Math.round(
  RUNNER_FILE_CEILINGS[getRunnerKind("edit-pdf-bookmarks")!] / (1024 * 1024),
);
const MAX = BOOKMARK_EDIT_MAX.toLocaleString("en-US");
// The control labels quoted below are written BY HAND: what holds them to
// the panel (`bookmarks-editor.tsx`) is `tool-page-substance.test.ts`, which
// fails when a quoted label is not a string the panel draws.

const content: ToolContent = {
  slug: "edit-pdf-bookmarks",

  seoTitle: "Edit PDF Bookmarks — Add, Nest, Reorder, No Upload",

  metaDescription:
    "Add, rename, delete, reorder and nest a PDF's bookmarks, point each at a page, or add one every few pages. Deleted ones leave no title behind. No upload.",

  intro: [
    `Bookmarks are the clickable outline a PDF reader shows in its side panel: chapter titles, sections under them, each opening a page. Edit PDF Bookmarks reads the outline a PDF already has and shows it as a list, nested the way the reader nests it. Rename a bookmark, change the page it opens, delete it, move it up or down, indent it under the one above or move it back out, and add new ones anywhere. A file with no bookmarks starts empty, and you can add one bookmark every few pages in a single step.`,
    `It runs in your browser with pdf-lib, so the PDF you pick is not uploaded. The file gate refuses PDFs over ${MAX_MB} MB, and encrypted PDFs are turned away with a note to unlock them first. The pages, links, form fields and everything else in the file stay as they are; only the outline is rewritten. A bookmark you delete is removed from the file with its title, not just hidden, and so is the old title of one you rename. The copy is a rewritten file, so a digital signature in the original no longer verifies in it.`,
    `A bookmark that runs a script, launches a program or jumps into another file is kept as a heading, without that action, and the page tells you how many such actions there were before you save. A bookmark to a web address or a viewer action such as Next page keeps what it does unless you give it a page. The list takes up to ${MAX} bookmarks; a PDF with more is refused rather than cut short, and a title you type can be up to ${BOOKMARK_TITLE_MAX} characters.`,
  ],

  useCases: [
    {
      title: "A navigable outline for a long report",
      body: "A report exported without bookmarks is a long scroll. Add a bookmark per chapter, nest the sections under them, and readers can jump straight to the part they need.",
    },
    {
      title: "Fixing bookmarks after merging files",
      body: "Merge PDF can add a bookmark for each file, named after the file. Rename them to real chapter titles, reorder them and remove the ones nobody needs.",
    },
    {
      title: "Bookmarks before splitting by chapter",
      body: "Split PDF's By bookmarks option starts a new file at each top-level bookmark. Add or tidy the top-level bookmarks here first, then split.",
    },
    {
      title: "Taking out a section's name before sharing",
      body: "A bookmark can name a draft section, a client or a project you removed from the pages. Delete it, and its title is gone from the saved file, not only from the panel.",
    },
  ],

  steps: [
    {
      title: "Open the PDF",
      body: `Drop the PDF on the box or browse for it; it takes one file at a time, up to ${MAX_MB} MB. Its bookmarks are read on your device and listed, each with its title and the page it opens.`,
    },
    {
      title: "Edit the list",
      body: `Type over a title or a page number; leave the page empty for a heading that opens no page. Press “Add bookmark” for a new one at the end, or “More actions” on a row to move it up or down, indent or outdent it, add one below or inside it, or delete it with what is inside it. Press “Add page bookmarks” to add one every few pages. Undo takes back any change.`,
    },
    {
      title: "Save and download",
      body: `Keep “Open with the bookmarks panel showing” ticked to have readers show the outline when the file opens, then press “Save bookmarks”. The result, titled “Bookmarks saved”, is read back from the saved copy. Press “Download PDF” to save it with -bookmarks added to its name.`,
    },
  ],

  faqs: [
    {
      q: "Is my PDF uploaded?",
      a: "No. The file is read, changed and saved in your browser tab. The page loads from pdf.xyz, but the PDF you pick is not sent to us.",
    },
    {
      q: "When I delete a bookmark, is its title really gone?",
      a: "Yes. The old outline is removed from the saved file, not left behind with nothing pointing at it, so a deleted bookmark's title is not in the copy, and neither is the old title of a bookmark you renamed. That holds even when something else in the file still referred to the old bookmark.",
    },
    {
      q: "Does it change anything else in the file?",
      a: "It rewrites the outline and, if you ask, sets the file to open with the bookmarks panel showing. Pages, links, form fields and attachments are kept. Objects nothing in the file used any more are left out of the copy, and bookmark actions that run scripts, launch programs or open other files are dropped, as the page says before you save.",
    },
    {
      q: "Can it build the outline from the headings in my PDF?",
      a: `Not yet. It can add one bookmark every few pages, named after the page it opens, and you can rename them. Bookmarks are otherwise added and titled by hand, up to ${MAX} in one file.`,
    },
  ],

  relatedGuides: [],
};

export default content;
