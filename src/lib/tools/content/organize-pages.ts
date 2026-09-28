import type { ToolContent } from "./types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import { MAX_HISTORY } from "@/components/tools/runner/organize-history";

/**
 * The per-file cap the Organize Pages runner refuses above, read from the
 * same table the sibling content files use. `file-ceilings.test.ts` checks
 * that `RUNNER_FILE_CEILINGS.organize` names the constant the runner's own
 * gate (`validatePdfFile` in `useSinglePdf`) compares against.
 */
const MAX_MB = Math.round(RUNNER_FILE_CEILINGS.organize / (1024 * 1024));

const content: ToolContent = {
  slug: "organize-pages",

  seoTitle: "Organize PDF Pages — Reorder, Rotate, Delete",

  metaDescription: `Drag PDF page thumbnails into a new order, turn, copy or remove pages, and undo up to ${MAX_HISTORY} edits. The rebuild runs in this browser tab, with no upload.`,

  intro: [
    "Organize Pages opens one PDF and lays every page out as a thumbnail tile on a board. Drag a tile to a new slot or nudge it one place with its arrow buttons; other buttons on the tile turn the page a quarter turn clockwise, drop a copy right after it, or remove it. Above the board, Reverse flips the whole order and Reset restores the order and rotation the file arrived with.",
    `The work happens in your browser tab: the file is read and rebuilt there with pdf-lib and is not uploaded, which suits contracts and statements you would rather keep on your own machine. It opens one PDF at a time, up to ${MAX_MB} MB. Each tile carries two numbers, a corner badge for its new position and a label for its original page, so you can see at a glance what moved. Undo walks back up to ${MAX_HISTORY} edits.`,
    "Export writes a new PDF from the pages in board order. Each page is copied across rather than re-rendered, so its content is untouched and selectable text stays selectable. What belongs to the file as a whole stays behind, including the bookmark tree and the form dictionary that fillable fields depend on.",
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
      title: "Rotate, duplicate or delete",
      body: "Use the buttons on each tile; the bin is disabled on the last remaining page, since a PDF needs at least one. Undo and Redo (Ctrl/⌘+Z, Ctrl/⌘+Shift+Z) step through your edits.",
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
      a: "Any encrypted PDF stops at the drop box with a message saying it is password-protected, including one that anyone can open but whose printing or editing is locked. With the password in hand, Unlock PDF can remove it, though that step is not local: the PDF is uploaded over TLS to pdf.xyz's worker. A file too damaged to parse, or one that only carries a .pdf name, gets a could-not-be-read error; Repair PDF, also a worker tool, may rebuild a damaged one before you return here.",
    },
  ],

  relatedGuides: ["how-to-merge-pdf-files"],
};

export default content;
