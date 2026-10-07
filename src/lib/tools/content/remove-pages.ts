import type { ToolContent } from "./types";
import { modeUploadsFiles } from "@/lib/tools/processing-split";
import { getToolCapability } from "@/lib/jobs/capabilities";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeiling } from "@/lib/tools/file-ceilings";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";

/*
 * Where the file goes and how big it may be are both read through the same
 * chain the tool page dispatches on (catalogue -> registry runner kind ->
 * that runner's own file-gate constant), not through a runner key typed here.
 * If remove-pages ever stops being an in-browser runner, every "runs in your
 * browser" sentence below becomes false, so the module refuses to load.
 */
const tool = getToolBySlug("remove-pages");
const ceiling = tool ? toolFileCeiling(tool) : null;
if (
  !tool ||
  modeUploadsFiles(tool.processing) ||
  !ceiling ||
  ceiling.tier !== "in-browser" ||
  ceiling.bytes === null
) {
  throw new Error("remove-pages content describes an in-browser runner");
}
const ceilingMb = Math.round(ceiling.bytes / (1024 * 1024));

/*
 * The password FAQ describes Unlock PDF as an upload; that is only true while
 * the catalogue says it runs on the worker.
 */
if (getToolCapability("unlock-pdf") !== "secure-worker") {
  throw new Error("remove-pages content describes Unlock PDF as an upload");
}
const linkMinutes = DEFAULT_RETENTION.outputTtlMinutes;

/*
 * What the output keeps and drops was checked on 2026-09-27 against pdf-lib's
 * copyPages exactly as `deletePages` (src/lib/pdf/engine.ts) calls it:
 *  - output catalog keys are only /Type and /Pages: no outlines, AcroForm,
 *    page labels or name tree; Title/Author absent; Producer and Creator
 *    "pdf.xyz"; CreationDate is the time of the run; /Rotate 90 kept.
 * SUPERSEDED 2026-10-06 (kept as history): deletePages now goes through the page
 *    assembler (page-copy.ts, subset state), which carries title/author,
 *    page labels, /Lang, the bookmarks that open a kept page and the kept
 *    pages' fields as a fillable /AcroForm (probed through deletePages on
 *    makeStructuredPdf(3)); tool-page-substance.test.ts holds the page.
 *  - 4-page source, pages 3-4 deleted: no link -> 2 page objects in the
 *    output; page 1 linking to page 3 -> 3; plus page 3 linking to page 4
 *    -> 4. A deleted page reached through a chain of links comes along too.
 *
 * SUPERSEDED the same day: `copyChosenPages` in src/lib/pdf/engine.ts now
 * detaches every page reference during the copy and re-aims links at the
 * kept pages' new copies, so neither the leak nor the orphan copy survives.
 * `engine.test.ts` counts the page objects in each output to hold that.
 *
 * What still survives (probed 2026-10-08): the assembler does not prune a
 * /Resources dictionary kept and deleted pages SHARE (page-copy.ts says so),
 * so an image drawn only on a deleted page ships when its resources are
 * shared. The "completely gone?" answer said "Yes … the deleted page's text
 * and images are not copied in behind the scenes" until then;
 * tool-page-substance.test.ts runs each page engine on a shared-resources
 * file and holds every page tool's served copy to what ships.
 */

const content: ToolContent = {
  slug: "remove-pages",

  seoTitle: "Delete PDF Pages – Remove Pages from PDF",

  metaDescription: `Remove pages from a PDF by clicking thumbnails or typing a list like 2-4, 9. Processed on your device; the file is not uploaded. Up to ${ceilingMb} MB.`,

  intro: [
    "Delete Pages takes one PDF, drops the pages you pick, and hands back a new file with every remaining page in its original order. You can choose pages by clicking their thumbnails, Shift-clicking to grab a whole run, or entering 1-3, 7, 12- in the range box. When you only want to keep a handful of pages, select those and press Invert: everything else becomes the selection.",
    `All of the deleting happens in your browser, where the chosen PDF is loaded into the tab's memory, the shortened copy is assembled there, and the file is not uploaded. The in-browser loader stops at ${ceilingMb} MB, so a bigger file is refused by its size alone, before any of it is read. On long documents the first thumbnails render up front and the rest fill in as you scroll down the page board.`,
    "Kept pages are copied as they are, so their text stays selectable and their rotation, images and annotations come through. So do the bookmarks that open a kept page, the kept pages' form fields, still fillable, and the document's title and author, page labels and language. Any encrypted PDF is refused until it has been unlocked, including a file your viewer shows with no password prompt.",
  ],

  useCases: [
    {
      title: "Drop blank sides from a duplex scan",
      body: "Scanners set to two-sided mode pick up the empty backs of single-sided sheets. Click each blank thumbnail as you pass it, then delete them all in one pass.",
    },
    {
      title: "Strip a cover sheet or fax cover page",
      body: "Remove the transmittal page, printed routing slip or cover letter that sits in front of the document someone actually needs to read.",
    },
    {
      title: "Cut a report down to the part that matters",
      body: "Take out the appendices, index or boilerplate terms at the end by typing an open-ended range like 40- instead of clicking every page.",
    },
    {
      title: "Remove a page that was scanned twice",
      body: "A sheet that jams and gets fed through again lands in a batch scan twice. The thumbnail board makes the repeat easy to spot.",
    },
  ],

  steps: [
    {
      title: "Load the document",
      body: "Drag your document onto the dashed drop box, or press anywhere inside that box for the file picker; if several files are dropped, only the first is read. A header line then shows the file's name with its page total and file size, and the board below holds one tile per page, labelled Page 1, Page 2 and so on.",
    },
    {
      title: "Select the pages to remove",
      body: "Click thumbnails, Shift-click for a run, or fill in the field whose placeholder reads e.g. 1-3, 5, then press Select or Enter. Select all, Clear and Invert adjust the selection.",
    },
    {
      title: "Delete them",
      body: "The run button carries the count in its label, for example Delete 3 pages. It stays disabled while nothing is selected, and also when every page is.",
    },
    {
      title: "Download PDF",
      body: "The Pages removed panel shows how many pages went, how many remain and the new file size. Download PDF saves it with -pages-removed added to the name; Start over discards this result and brings the file picker back.",
    },
  ],

  faqs: [
    {
      q: "What can I enter in the page box?",
      a: "Comma-separated entries: 6 marks one page, 4-9 marks a span, 12- marks page 12 through the end, and -3 marks pages 1 to 3; nothing is removed until you press the Delete button. A backwards range, page 0, or a page beyond the end is rejected with a message naming the entry. Applying a list replaces whatever was selected before.",
    },
    {
      q: "Can I delete every page in the PDF?",
      a: "No. The tool always leaves at least one page behind: with every page selected the delete button switches off and a note asks you to deselect one. If what you really want is a short file made of a few pages, Extract Pages builds one from just those.",
    },
    {
      q: "Are the deleted pages completely gone from the file?",
      a: "Almost always. The new file is built from the pages you keep: a deleted page's own text and drawing are not copied, and a link on a kept page that pointed at a deleted page is switched off rather than followed. Links between pages you kept still work. The exception is a file whose pages share one resource list, as some programs write them: that list comes across whole, so an image drawn only on a deleted page can still be inside the new file although no page shows it. What is printed on a kept page stays, so a contents page will still list a chapter you removed. If an image must not be recoverable, black it out with Redact PDF, which rebuilds every page as a picture and copies nothing else from the file, before you delete its page.",
    },
    {
      q: "Why is my password-protected PDF refused?",
      a: `Delete Pages will not open any file that carries encryption, including one with only printing or editing restrictions, and the error it shows says to unlock the file first. Unlock PDF takes the encryption off when you enter its password, and it cannot get around one you do not know; since an empty password is refused, a restrictions-only file needs its owner password. Unlock PDF runs on the server rather than here: the PDF and password are uploaded over TLS to pdf.xyz's secure worker, the input is deleted when the job finishes, the download link expires after ${linkMinutes} minutes, and a daily storage rule erases the stored copy after that.`,
    },
    {
      q: "Does deleting pages change my original file?",
      a: "No. The tool only reads the file you choose and never writes back to it. The result is a separate download, so if you removed the wrong page you can press Start over and load the untouched original again.",
    },
  ],

  relatedGuides: [],
};

export default content;
