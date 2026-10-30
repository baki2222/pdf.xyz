import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeiling } from "@/lib/tools/file-ceilings";
import { modeUploadsFiles } from "@/lib/tools/processing-split";
import { getToolCapability } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";

/*
 * The size cap is read through the chain the tool page itself dispatches on
 * (catalogue slug -> registry runner kind -> that runner's file-gate constant),
 * not through a runner key typed here. Every "stays on your device" sentence
 * below is only true while extract-pages is an in-browser runner, so the module
 * refuses to load if that stops being so. Both questions are asked of the
 * chains that own them (modeUploadsFiles, toolFileCeiling), never answered by
 * comparing a processing string here.
 */
const tool = getToolBySlug("extract-pages");
const ceiling = tool ? toolFileCeiling(tool) : null;
if (
  !tool ||
  modeUploadsFiles(tool.processing) ||
  !ceiling ||
  ceiling.tier !== "in-browser" ||
  ceiling.bytes === null
) {
  throw new Error("extract-pages content describes an in-browser runner");
}
const MAX_MB = Math.round(ceiling.bytes / (1024 * 1024));

/*
 * The encrypted-file FAQ describes Unlock PDF as a secure-worker upload with
 * the worker's retention; that is only true while its capability says so.
 */
if (getToolCapability("unlock-pdf") !== "secure-worker") {
  throw new Error("extract-pages content describes Unlock PDF as an upload");
}
const LINK_MINUTES = DEFAULT_RETENTION.outputTtlMinutes;

/*
 * Behaviour checked on 2026-09-27 by running `extractPages`
 * (src/lib/pdf/engine.ts) itself on a 5-page pdf-lib document whose page 1
 * links to page 3 and page 3 links to page 5, page 4 rotated 90:
 *  - selection [0,1]: page tree = pages 1,2; page objects in the file = 1,2,3,5.
 *    The leak is TRANSITIVE: page 5 arrives through page 3's own link.
 *  - selection [1,3] and [3,1]: page tree = 2,4 in both; page 4 keeps /Rotate 90.
 *  - Title and Author undefined; catalog has no /Outlines.
 * SUPERSEDED 2026-10-06 (kept as history): the page assembler (page-copy.ts,
 *    subset state) carries title/author, page labels, /Lang, the bookmarks
 *    that open a kept page and the kept pages' fields as a fillable
 *    /AcroForm (probed through extractPages on makeStructuredPdf(3));
 *    tool-page-substance.test.ts holds the page.
 * The leak follows explicit destinations (a /Dest or GoTo /D array holding a
 * page reference, which pdf-lib's PDFObjectCopier walks). A NAMED destination
 * resolves through the catalog's name tree, which copyPages does not copy, so
 * the copy says "can", not "does".
 *
 * SUPERSEDED the same day: `copyChosenPages` in src/lib/pdf/engine.ts now
 * detaches every page reference during the copy and re-aims links at the
 * kept pages' new copies, so neither the leak nor the orphan copy survives.
 * `engine.test.ts` counts the page objects in each output to hold that.
 * An image drawn only on a page left out still ships when the pages SHARE
 * one /Resources dictionary (page-copy.ts does not prune it; probed
 * 2026-10-08), so "Can pages I did not select end up inside?" no longer opens
 * with a bare "No." — tool-page-substance.test.ts runs the engine on a
 * shared-resources file and holds the served answer to what ships.
 * The page's range box is an <input type="text">: it cannot hold a newline,
 * so the FAQ does not offer newline-separated lists even though parsePageList
 * accepts them.
 */

const content: ToolContent = {
  slug: "extract-pages",

  seoTitle: "Extract Pages from PDF — In-Browser, No Upload",

  metaDescription: `Click thumbnails or type a range like 1-3, 5 to save chosen pages as a new PDF. It works inside your browser and the PDF is not uploaded. Up to ${MAX_MB} MB.`,

  intro: [
    "Extract Pages builds a new PDF out of only the pages you pick. Load one document, click the page thumbnails you want or type a list such as 1-3, 5, 12-, and the tool copies exactly those pages into a fresh file. The download is named after your original with -extracted added, and the source PDF itself is left untouched.",
    `The document stays on your device, with no upload: your browser opens the PDF locally, assembles the new file on the spot, and pdf.xyz never receives a copy. Pages are copied object by object rather than re-rendered, so text stays selectable, images are not recompressed or downscaled, and each page keeps its rotation. Files up to ${MAX_MB} MB are accepted.`,
    "Three behaviours are worth knowing. The new PDF always follows the original page order, so picking page 9 before page 2 still gives you 2 then 9. The document's title and author, page labels and language come across, and so do the bookmarks and form fields that belong to the pages you keep, with the fields still fillable. And links between pages are handled with care: a link from one kept page to another still opens it in the new file, while a link to a page you left out is switched off, so the pages you skipped do not travel inside the new file.",
  ],

  useCases: [
    {
      title: "Send one section, not the whole report",
      body: "Share just the summary and the appendix someone asked for, not the whole report.",
    },
    {
      title: "Save the schedules of a contract pack",
      body: "Keep the fee schedule and annexes of a bundled agreement as their own short file.",
    },
    {
      title: "Trim a statement to what an application asks for",
      body: "Send only the months an application asks for; the months you leave out are not carried along inside the file, even when the statement's contents page links to them.",
    },
    {
      title: "Keep everything except a few pages",
      body: "Click the separator sheets and blank backs you do NOT want, then press Invert so the rest of the document is selected instead, and extract that.",
    },
  ],

  steps: [
    {
      title: "Add your PDF",
      body: "Bring in one document: drag it over the dashed drop area, or click that area for the file picker. Once it is read, a strip across the top lists the file name, its page count and its size, and a grid of page thumbnails fills in underneath.",
    },
    {
      title: "Select the pages to keep",
      body: "Click a thumbnail to add or remove that page; Shift-click adds every page between the last one you clicked and this one. To pick by number instead, fill in the field whose placeholder reads “e.g. 1-3, 5”, then click the Select chip beside it or hit Enter. The Select all, Clear and Invert buttons change the whole set at once.",
    },
    {
      title: "Run the extraction",
      body: "The button counts your selection — Extract 4 pages when four are chosen — and stays disabled until at least one is. Press it and the new file is built on your device.",
    },
    {
      title: "Download the new PDF",
      body: "The “Pages extracted” panel reports how many pages went into the new PDF and its file size. Press Download PDF to save it, or Start over to load a different document.",
    },
  ],

  faqs: [
    {
      q: "Does Extract Pages send my document anywhere?",
      a: "No. Reading the file and writing the new PDF both happen on your own device, and the document is never sent to pdf.xyz. The page and its PDF engine still load over the network, so it is not an offline app.",
    },
    {
      q: "Which page-number formats does the range field accept?",
      a: "Single pages (5), inclusive ranges (1-3), and open ranges that run to the last page (8-) or from the first (-4), with a comma between entries; a space on its own does not separate two pages. Overlaps are merged, so 1-3, 2 selects three pages. A page past the end, a 0, or a backwards range like 7-3 is refused, and the note under the box quotes the entry it could not use. Applying a range replaces the current selection, which you can then fine-tune by clicking thumbnails.",
    },
    {
      q: "How do I save each page as its own PDF?",
      a: "Extract Pages always produces one combined file. If you want every page, or several ranges, as separate PDFs, use Split PDF instead: its Custom ranges, Every N pages and Each page modes cut the document into pieces, and more than one piece downloads as a single ZIP.",
    },
    {
      q: "Can pages I did not select end up inside the new file?",
      a: "Not as pages. A clickable link on a kept page that points at a page you left out, such as a contents entry, is switched off during extraction rather than followed, so the page it pointed at is not copied. Links between two pages you kept are re-aimed at the new copies and still work. Two things can still come along. When a file's pages share one resource list, as some programs write them, that list is copied whole, so an image drawn only on a page you left out can still be inside the new file although no page shows it. And text you can see on a kept page is copied as it is, so a contents page still lists the titles of sections you did not extract. If an image must not travel, black it out with Redact PDF first.",
    },
    {
      q: "Why won't my PDF open in Extract Pages?",
      a: `The message on screen names the cause. A file over ${MAX_MB} MB is too large for in-browser processing. Any encrypted PDF is stopped with a request to unlock it first, even one whose only protection is a printing or copying restriction. Knowing the password lets Unlock PDF produce a decrypted copy you can bring back here. Unlock PDF, unlike extracting, works off your device: the encrypted PDF and the password you type travel over TLS to pdf.xyz's secure server, which deletes that input once the job ends; the decrypted file's download link stops working after ${LINK_MINUTES} minutes, and a daily storage rule erases our server's copy after that. A file with neither a .pdf name nor the PDF file type is turned away, an empty file is refused, and a damaged PDF that cannot be parsed is reported as unreadable.`,
    },
  ],

  relatedGuides: ["how-to-split-a-pdf"],
};

export default content;
