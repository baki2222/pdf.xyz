import type { ToolContent } from "./types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import { MAX_HISTORY } from "@/components/tools/runner/organize-history";

/**
 * The per-file cap the Organize Pages runner refuses above, read from the
 * same table the sibling content files use. `file-ceilings.test.ts` checks
 * that `RUNNER_FILE_CEILINGS.organize` names the constant the runner's own
 * gate (`validatePdfFile` in `useSinglePdf`) compares against.
 *
 * What the export keeps (2026-10-06): organizePages saves a plan that keeps
 * every page once, in order, IN PLACE; any other plan goes through the page
 * assembler's subset state (page-copy.ts), which carries title/author, page
 * labels, /Lang, the bookmarks that open a kept page and the kept pages'
 * fields, but not attachments or the tag tree. The intro said the bookmark
 * tree and the form dictionary stayed behind until then;
 * tool-page-substance.test.ts runs both plans and reads the served page.
 * The in-place save still goes through stamp(), so Producer and Creator
 * become pdf.xyz and ModDate the save time (probed 2026-10-08); the intro
 * said "with everything in it" until then, and the same test now runs the
 * in-place plan and holds every in-place sentence to the entries it rewrote.
 *
 * Blank pages (2026-10-24): a `blank` plan item is appended to the parsed
 * source and planned like a kept page, with an unlabelled page-label range,
 * so the pages around it keep their labels (organize-blank.test.ts reads
 * the page count, the blank's size, its empty content and the labels back
 * through pdf.js). Its size is the neighbour tile's as displayed
 * (organize-history.ts `blankSizeLike`; runner-flows.test.tsx downloads it).
 * A plan with a blank always takes the rebuild path.
 */
const MAX_MB = Math.round(RUNNER_FILE_CEILINGS.organize / (1024 * 1024));

const content: ToolContent = {
  slug: "organize-pages",

  seoTitle: "Organize PDF Pages — Reorder, Rotate, Delete",

  metaDescription: `Drag PDF page thumbnails into a new order, turn, copy or remove pages, and undo up to ${MAX_HISTORY} edits. The rebuild runs in this browser tab, with no upload.`,

  intro: [
    "Organize Pages opens one PDF and lays every page out as a thumbnail tile on a board. Drag a tile to a new slot or nudge it one place with its arrow buttons; other buttons on the tile turn the page a quarter turn clockwise, drop a copy right after it, remove it, or insert an empty page just before or after it, the same size as that page as you see it. Above the board, Reverse flips the whole order and Reset restores the order and rotation the file arrived with.",
    `The work happens in your browser tab: the file is read and rebuilt there with pdf-lib and is not uploaded, which suits contracts and statements you would rather keep on your own machine. It opens one PDF at a time, up to ${MAX_MB} MB. Each tile carries two numbers, a corner badge for its new position and a label for its original page, so you can see at a glance what moved. Undo walks back up to ${MAX_HISTORY} edits.`,
    "Export writes a new PDF from the pages in board order. Each page is copied across rather than re-rendered, so its content is untouched and selectable text stays selectable. Bookmarks that open a kept page, the kept pages' form fields and the document's title, author, page labels and language come along. Attached files and a tagged PDF's accessibility tags are left out of a rebuilt export; if you only turned pages, the file is saved in place with everything in it, except that its Producer and Creator entries now name pdf.xyz and its modification date is updated.",
  ],

  useCases: [
    {
      title: "Repair a scan that came out of order",
      body: "A duplex scan that delivered every front, then every back, can be dragged back into sequence. A stack the scanner read last page first needs only the Reverse button.",
    },
    {
      title: "Turn sideways pages upright",
      body: "Every tile has its own rotate button, and pages already rotated in the source show at their current angle, so you correct from what you see. A page that needs a quarter turn to the left takes three presses.",
    },
    {
      title: "Finish a document after merging",
      body: "Combine files with Merge PDF, download the result, then open it here to move an appendix, interleave two reports page by page, or drop a cover page that no longer belongs.",
    },
    {
      title: "Repeat a page where it is needed",
      body: "Duplicate a divider, a blank notes page or a signature page and drag each copy to the section that needs it.",
    },
    {
      title: "Add a blank page for notes or two-sided printing",
      body: "Insert a blank page after a section so it can be written on, or so the next chapter starts on a right-hand page when printed on both sides. The blank takes the size and orientation of the tile you insert it beside.",
    },
    {
      title: "Trim pages before you send",
      body: "Remove blank pages and internal notes while you reorder. If deleting is all you need, Delete Pages lets you type a range such as 1-3, 5 instead of clicking tiles.",
    },
  ],

  steps: [
    {
      title: "Add your PDF",
      body: "Drag a PDF onto the dashed drop box; clicking anywhere in that box opens your file picker instead. If several files land at once, only the first is opened. The board then shows one tile per page.",
    },
    {
      title: "Arrange the pages",
      body: "Drag a tile to its new place or use its left and right arrow buttons. By keyboard, focus a tile's handle, press Enter or Space to grab it, move it with the arrow keys, Home or End, then press Enter or Space again to drop it. Escape also lets go, but each step already taken stays in place; Undo takes those back one at a time.",
    },
    {
      title: "Rotate, duplicate, delete or add blank pages",
      body: "Use the buttons on each tile, including Insert blank page before and Insert blank page after; an inserted page shows as a plain white tile labelled Blank page. The bin is disabled on the last page left from your PDF, since the export needs at least one; inserted blank pages do not count towards that. Undo and Redo (Ctrl/⌘+Z, Ctrl/⌘+Shift+Z) step through your edits.",
    },
    {
      title: "Apply & export, then download",
      body: "Apply & export unlocks once something has changed. A “Pages organized” panel reports the page count and file size, and Download organized PDF saves it with -organized appended, so report.pdf becomes report-organized.pdf.",
    },
  ],

  faqs: [
    {
      q: "Does rearranging pages send my PDF to a server?",
      a: "No. The reordered copy is assembled inside the browser tab you are using, so no copy of the document leaves your device for pdf.xyz or anyone else. Closing the tab before downloading discards the edit.",
    },
    {
      q: "How do I rotate only one page of a PDF?",
      a: "Press the rotate button on that page's tile. Each press turns it 90° clockwise, so four presses bring it back. The angle is saved as the page's rotation setting, so text and images are not redrawn or degraded.",
    },
    {
      q: "Is there a limit on file size or page count?",
      a: `Each PDF can be up to ${MAX_MB} MB; a larger file is refused before any work starts. No page cap is written into the tool, so the practical ceiling on a very long document is your device's memory. On such a file only the first batch of thumbnails renders up front, and the rest fill in as you scroll to them.`,
    },
    {
      q: "Why does my PDF fail to open here?",
      a: "Any encrypted PDF stops at the drop box, and the message says which lock it has. One that needs a password to open is called password-protected. One that anyone can open but whose printing or editing is locked is told it has editing restrictions instead. With the password that opens it, or for a restricted file its owner (permissions) password, Unlock PDF can remove the lock, though that step is not local: the PDF is uploaded over TLS to pdf.xyz's server. A file too damaged to parse, or one that only carries a .pdf name, gets a could-not-be-read error; Repair PDF, also a server tool, may rebuild a damaged one before you return here.",
    },
  ],

  relatedGuides: ["how-to-reorder-pages-in-a-pdf", "how-to-merge-pdf-files"],
};

export default content;
