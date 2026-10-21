import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { WORKER_FILE_CEILING } from "@/lib/tools/file-ceilings";
import {
  MAX_BILEVEL_PICTURE_SIDE,
  MAX_LAYERS_PER_PAGE,
  MAX_PICTURE_SIDE,
} from "@/lib/workers/pdf-office-export/picture-limits";

/*
 * Behaviour claims below were read from the implementation on 2026-10-10
 * (they were first read on 2026-09-27; what changed is marked):
 *  - src/components/tools/pdf-office-export-worker-panel.tsx — the run area
 *    renders at once and its Export works only while the status badge reads
 *    "Secure worker" (otherwise it reads "Not enabled" or "Status unknown"
 *    and Export stays off; WP-10); the
 *    drop zone titled "Add your PDF, or" + runner-kit's "browse" (the whole
 *    box is a <label>, so clicking anywhere opens the picker), single-file
 *    only with a "Remove" button once a file is chosen, the "Export PPTX"
 *    button (busy label jobBusyLabel(phase, "Exporting PPTX…"): "Uploading
 *    your file…", "Waiting for the worker…", "Exporting PPTX…", "Downloading
 *    the result…"; until 2026-10-07 the step said "Exporting PPTX…" covered
 *    the upload and the fetch-back), "Your PPTX file is ready." and a
 *    button labelled "Download <output filename>". pdf-security-client.ts
 *    step 5 has ALREADY fetched the .pptx bytes before that button appears,
 *    and the button saves them from tab memory, so it keeps working past the
 *    worker link's TTL until the tab is closed. The copy therefore puts the
 *    TTL on the worker's copy, never on the button;
 *  - CHANGED 2026-10-10. Until then engine.ts pptx() wrote one slide per
 *    extracted page, ONE text shape per slide, one paragraph per non-empty
 *    `pdftotext -layout` line, on a fixed 16:9 slide, and nothing else (no
 *    images, fonts, colours or positions); a PDF with no text in ANY page was
 *    refused as `no_text`. The owner reported the missing pictures on that
 *    day, with a competitor's deck that had them. Now
 *    src/lib/workers/pdf-office-export/page-scan.ts reads every page with
 *    pdf.js, and deck-from-scan.ts + pptx-package.ts write it:
 *      · the slide size is the first page's, as displayed; other pages are
 *        fitted inside it, centred, aspect kept;
 *      · each raster picture is its own picture at its place and size (a
 *        plain JPEG of at most MAX_PICTURE_SIDE px on its longer side copied
 *        byte for byte, others re-encoded, the long side capped at that);
 *        CHANGED 2026-10-11: a picture shown through a clip that is not an
 *        upright rectangle is cut to the clip's shape (what the clip hides
 *        is transparent, and not in the file); a stencil mask or a repeated
 *        image is drawn into the drawing pictures, not placed on its own;
 *        a picture too large for the worker's memory budget, or one pdf.js
 *        cannot decode, is left out and COUNTED (`picturesNotCarried`), and
 *        the panel names its page. Until 2026-10-11 such a picture vanished
 *        and its page was called empty;
 *      · each line of selectable text is its own text box at its place, its
 *        size, bold/italic and colour from the PDF, its font MAPPED
 *        (deck-from-scan.ts, OFFICE_FAMILIES: a family Office or Windows
 *        ships keeps its name; a free metric clone of one — Liberation,
 *        Carlito, Caladea — becomes the family it clones; any other becomes
 *        Arial, Times New Roman or Courier New by class; until 2026-10-11
 *        the clones and DejaVu/Noto kept their own names); invisible text
 *        (an OCR layer) stays invisible;
 *      · CHANGED 2026-10-11: a page whose drawing would need more than
 *        MAX_LAYERS_PER_PAGE layers to keep paint order is ONE picture of
 *        the page with its text in invisible boxes, and the panel says so.
 *        Until the second review the page did NOT say so: intro[0],
 *        useCases[1] ("not flattened into one image of the page"), the
 *        design FAQ and tool-facts' "What goes on each slide?" promised
 *        separate pictures and visible, styled text of every page — false
 *        of a 33-cell table that paints each cell's text before its border.
 *        Each now carries the exception, its number from the constant;
 *      · CHANGED 2026-10-11 (the second review): on a page whose content
 *        the reader cannot read ahead — every page of an encrypted file,
 *        whose streams pdf-lib cannot decrypt, or of a damaged one — a
 *        picture over MAX_DECODED_IMAGE_PIXELS can be removed by pdf.js
 *        and nothing can count it, so the note cannot name its page. Every
 *        sentence promising the note says so;
 *      · CHANGED again the same day (the second re-review): the reader now
 *        reads an encrypted page (`standard-security.ts`), so "an
 *        encrypted … PDF" is no longer an exception, and the size is gone:
 *        it was the floor of a ceiling with no bound under it (one locked
 *        page decoded 2.2 GB), and an unreadable page is now held to the
 *        page budget, which promises no size. What is left is a page the
 *        worker cannot read before it is drawn, as in a damaged PDF;
 *      · CHANGED again the same day: a PDF the reader cannot read ahead at
 *        all (pdf-lib cannot load it, or pdf.js finds a page its page tree
 *        does not hold) was scanned with no decode bound. It is now rebuilt
 *        first with the worker's Repair PDF engine and converted from the
 *        rebuilt copy, with a note saying so, or — when it cannot be rebuilt
 *        into a file the reader can read — not converted, with a message
 *        that names Repair PDF. The FAQ "Can I convert a password-protected
 *        or damaged PDF?" says both (one entry: the page holds 4–6 FAQs); claims-vs-capability.test.ts holds it to engine runs;
 *      · everything else drawn (lines, boxes, arrows, fills, backgrounds) is
 *        rendered into transparent pictures, in paint order with the rest;
 *      · a page with no text is NOT refused: it is a slide of pictures, and
 *        the job result names those pages (`picturePageCount`), which the
 *        panel shows. Word and Excel still refuse a PDF with no text;
 *      · links and form-field interactivity are not carried: a link
 *        annotation has no appearance to draw, and a field is drawn as it
 *        looks.
 *  - src/lib/workers/pdf-text/native.ts — pdftotext still OPENS the file
 *    first, with no `-upw`, so a PDF that needs a password to open is
 *    refused by poppler, the runner throws PdfTextOpenError("needs-password"),
 *    and engine.ts classifyFailure returns `password_protected` ("This PDF is
 *    password-protected. Unlock it with Unlock PDF…", non-retryable); the
 *    panel links Unlock PDF by error code. Until 2026-10-07 this docblock and
 *    the FAQ said it failed as the generic `failed` kind and never mentioned
 *    a password;
 *  - src/lib/workers/processor/pdf-office-export.ts — exactly one input,
 *    output named after the upload's (sanitised, possibly truncated) stem
 *    with a .pptx extension.
 *
 * ── DOES IT OPEN IN POWERPOINT? What the copy may say, and why ──────────────
 *
 * HISTORY (kept). Measured 2026-09-27, not inferred, twice independently: the
 * engine's output of that day (runPdfOfficeExport + parseLayoutText, 3-page
 * and 1-page documents, then a 3-page document whose middle page is empty)
 * was opened through PowerPoint's COM `Presentations.Open` (PowerPoint 16.0,
 * Windows desktop) and refused with "The file or directory is corrupted and
 * unreadable" (0x80070570), while a deck PowerPoint saved itself reopened in
 * the same run. That pptx() wrote no slideMaster, slideLayout or theme parts,
 * no <p:sldSz>/<p:notesSz>, and empty nvSpPr/nvGrpSpPr. From then until
 * 2026-10-09 this page said PowerPoint refuses the file, in six places (the
 * meta description, intro[1], both of the first two use cases, step 4 and the
 * first FAQ answer), and that was true of every worker image production ran.
 *
 * 8920ee1b (reached main with #167) packs through pptx-package.ts, which
 * writes the master, layout and theme chain and <p:sldSz>; since a85ba73e the
 * engine runs pptx-inspect.ts over its own package and refuses to deliver one
 * that fails. On 2026-10-09 `pnpm prove:pptx-opens` ran a real job through the
 * worker's processor and PowerPoint 16.0 build 20430 opened the result through
 * COM, READ-ONLY with alerts off, with 3 slides and 1 master, and read every
 * page's text back.
 *
 * 2026-10-10, the deck of pictures and positioned text boxes. Two measurements,
 * both through COM, both read-only with PowerPoint's alerts off, on PowerPoint
 * 16.0 build 20430 (the Windows desktop app):
 *   - `pnpm prove:pptx-opens` on the new engine: the real job's deck (7,706
 *     bytes, a three-page PDF, the middle page blank) opened with 3 slides and
 *     1 master, and the text PowerPoint read back matched every page; the
 *     pre-2026-09-27 package was refused (0x80070570) in the same run;
 *   - `pnpm measure:pptx-fidelity --renderer powerpoint`: decks the engine made
 *     from the five committed fixture PDFs (src/tests/pptx-fidelity-fixtures.ts)
 *     and from a 33-page slide-style tutorial were opened and saved as PDF, and
 *     each page compared with its source (`fidelity.ts`): 0.000–0.011 a page on
 *     the fixtures, mean 0.034 on the tutorial, on a scale where a blank page
 *     scores 1 (the text-only deck scored 0.98–1.40 a page).
 * The copy states that, dated, and says what was not checked. It does not say
 * "editable": nobody has edited a slide.
 *
 * THE OWNER'S DOUBLE-CLICK (2026-10-10) WAS OF THE OLD DECK. Main recorded
 * that a production .pptx opened by double-click in PowerPoint for Windows
 * with no repair prompt (worker:prove-tools pdf-to-powerpoint, 10,539 bytes,
 * one text-only slide), and the copy said "opens" on that evidence. That file
 * was the text-only structure this branch replaces: pictures, media parts and
 * positioned boxes are new parts PowerPoint has not been seen to open on a
 * double-click. So the copy below states only the automation measurements
 * until the owner double-clicks a deck the new engine made in production.
 *
 * WHICH IMAGE IT IS TRUE OF. The measurements are of the engine on this branch,
 * and the copy says "this tool's export code", so it is true of a download only
 * while production runs an image carrying it; merging is not shipping (#167's
 * publish failed on 2026-10-09). The live answer is the heartbeat:
 * `pptxPresentationChain` (wired in scripts/worker-daemon.ts since 2026-10-09)
 * and `pptxPictures` (2026-10-10), which runs the probe PDF's picture through
 * the running image's engine. A static string cannot read either: the copy
 * dates its measurements and states what was not checked.
 *
 * WHAT HOLDS IT. capability-hedges.test.ts reads every entry on this page for a
 * DEFERRAL shape. claims-vs-capability.test.ts holds the page and its guides
 * to no "editable" claim, and holds the catalogue description to a two-way
 * rule: it may say the output is text only exactly when the engine's slides,
 * decoded, carry no pictures. worker-tool-answers.test.ts runs the engine and
 * holds the served answers to the deck it writes.
 *
 * EXIT CONDITION for an "opens in PowerPoint" claim — the PROPERTY, not the
 * mechanism: a file a user DOWNLOADS FROM PRODUCTION opens on a double-click
 * in PowerPoint for Windows with no repair prompt. That is the owner's check,
 * made in PowerPoint's own window, and it has to be made again for the deck
 * of 2026-10-10: it is a different file from the one before. None of these
 * licenses the claim: the inspector passing, either heartbeat key being true,
 * a COM `Presentations.Open` succeeding, a round trip scoring well. An
 * "editable" claim has its own exit, and opening is not it: that same
 * download, edited and saved in PowerPoint for Windows, reopens with no
 * repair prompt.
 *
 * The upload ceiling below is WORKER_FILE_CEILING (JOB_LIMITS.maxFileBytes).
 * The extractor has its own env-configurable cap
 * (PDFXYZ_PDF_TEXT_MAX_INPUT_BYTES), which defaults to the same figure but is
 * a second number; if the worker's env lowers it, the stated ceiling overstates.
 * Every number is interpolated from the constant that owns it.
 */

/** The per-file cap a worker-tier upload is refused above, in whole MB. */
const CEILING_MB = Math.round(WORKER_FILE_CEILING / (1024 * 1024));
const OUTPUT_TTL = DEFAULT_RETENTION.outputTtlMinutes;
const PICTURE_PX = MAX_PICTURE_SIDE.toLocaleString("en-US");
const BILEVEL_PX = MAX_BILEVEL_PICTURE_SIDE.toLocaleString("en-US");
/** Past this many drawing pictures a page is drawn as one. */
const LAYERS = MAX_LAYERS_PER_PAGE.toLocaleString("en-US");
/** Where the note can miss a picture: a page the reader cannot read ahead. */
const UNNOTED =
  "except on a page the worker cannot read before it is drawn, as in a damaged PDF, where a picture can be left out with no note";

const content: ToolContent = {
  slug: "pdf-to-powerpoint",

  seoTitle: "PDF to PowerPoint: Slides with Pictures and Text",

  metaDescription:
    "Turn each PDF page into a slide the size of the page: pictures where the page shows them, each line of text in its own text box, other drawing kept as pictures.",

  intro: [
    `PDF to PowerPoint turns each page of a PDF into a slide of a .pptx file, in page order, and the slides take the size and shape of the first page. A photo or screenshot on a page lands on its slide as a picture of its own, where the page shows it and at the size it is shown, cut to the shape the page shows it through. Every line of selectable text becomes a text box at its place, in its size, weight and colour, set in a font matched to the PDF's: fonts are not copied, so a line can run a little longer or shorter than on the page. Lines, boxes, arrows, backgrounds, and stencilled or tiled images come across as pictures of the drawing, stacked in the order the page paints them, so a box drawn over a screenshot stays over it. A page whose drawing would take more than ${LAYERS} such pictures to stack in order, such as a table that draws each cell's border after its text, becomes one picture of the page instead, with its text in invisible text boxes over it: you can select and search that text, but not see or restyle it. A picture too large for the worker to handle, or one it cannot decode, is left out, and a note beside the download names its page, ${UNNOTED}.`,
    "What has been checked, and how. On 10 October 2026, decks this tool's export code made from five generated test PDFs and a 33-page slide-style tutorial were opened read-only by PowerPoint for Windows through its automation interface, with its alerts switched off, and saved as PDF; every page of that PDF was compared, pixel by pixel, with the page it came from, and they matched closely, pictures included. The same day the same route opened the deck of a three-page test document and read every page's text back. Whether a downloaded file opens on a double-click without PowerPoint offering to repair it has not been checked for this version, editing the slides has not been tested, and this page makes no claim about any other presentation app.",
    `A scanned page holds a picture of its words rather than text, so its slide carries the page as a picture, and those words are not editable text. Run OCR PDF on the scan first and convert the result: its slides then also carry the recognised words, in invisible text boxes over the picture, as the OCR'd PDF does. The reading is done on a server, not inside your browser: your PDF (one per run, ${CEILING_MB} MB at most) is uploaded over TLS to pdf.xyz's secure worker, where your input is deleted as each job finishes. The worker keeps the .pptx available for ${OUTPUT_TTL} minutes; after that its link fails, and a daily storage rule erases the stored copy.`,
  ],

  useCases: [
    {
      title: "Rebuild a deck when only the PDF survived",
      body: "Each page becomes a slide with its pictures, text and drawing where they were, so the deck starts out looking like the PDF rather than as a list of its words. Text is set in fonts matched to the PDF's and drawings arrive as pictures rather than shapes, and editing the slides has not been tested, so keep the PDF open beside you as the reference.",
    },
    {
      title: "Take the screenshots and photos out of a PDF",
      body: `Pictures arrive on their slides as separate pictures, except on a page whose drawing would take more than ${LAYERS} pictures to stack in order: that page arrives as one picture of the page, with its text in invisible text boxes over it. A plain JPEG photo up to ${PICTURE_PX} pixels on its longer side is carried into the .pptx byte for byte; a larger picture is scaled down to ${PICTURE_PX} pixels on that side (a black-and-white scan to ${BILEVEL_PX}), and one with transparency, or cut to a shape, is re-saved as a PNG.`,
    },
    {
      title: "Bring a scanned handout into a deck",
      body: "A scanned page comes through as a picture of the page on its slide. To have its words as text too, run OCR PDF first: the converted slides then carry the recognised words in invisible text boxes over each picture.",
    },
  ],

  steps: [
    {
      title: "Check what is text in your PDF",
      body: "Try highlighting a sentence in any PDF viewer. What highlights becomes text boxes on the slides; what does not, such as a scanned page or a photo of one, comes through as a picture. If you need a scan's words as text, run OCR PDF on the file first.",
    },
    {
      title: "Add your PDF",
      body: `The upload box takes a file as soon as the page loads, but the Export button works only while the panel's status badge reads Secure worker; if it says Not enabled or Status unknown, nothing can be sent yet. Drop one PDF on the box headed "Add your PDF, or browse"; clicking inside the dashed outline brings up the file chooser as well. Anything over ${CEILING_MB} MB is turned away at upload. If you picked the wrong file, press Remove beside its name and the box comes back for another.`,
    },
    {
      title: "Press Export PPTX",
      body: "The button follows the job: it reads Uploading your file… while your PDF goes over TLS to pdf.xyz's worker, Waiting for the worker… while the job is queued, Exporting PPTX… while the slides are assembled, and Downloading the result… while the finished file comes back to this tab. Once that job is over, the worker erases the PDF you sent it.",
    },
    {
      title: "Save the .pptx",
      body: `"Your PPTX file is ready." appears with a Download button labelled with the output's name: your PDF's name, ending in .pptx. If some pages had no selectable text, or a picture could not be put on its slide, a note beside it names those pages, ${UNNOTED}. The page has already pulled the file into the tab, so that button saves it from there; the worker's own copy becomes unreachable after ${OUTPUT_TTL} minutes.`,
    },
  ],

  faqs: [
    {
      q: "Will the .pptx open in PowerPoint?",
      a: "Only one route has been checked. On 10 October 2026, PowerPoint 16.0 for Windows opened decks this tool made from test PDFs through its automation interface and saved them as PDF, pages matching their sources, and read a three-page test deck's text back. That route switched PowerPoint's alerts off and opened the files read-only, so it would not have shown a repair prompt. No download has been opened with a double-click, and editing has not been tested, so pdf.xyz does not promise that PowerPoint opens the file without asking to repair it, or that the slides can be edited there. This page makes no claim about other presentation apps.",
    },
    {
      q: "Will the design, images and fonts of my PDF be kept?",
      a: `The layout and the images, yes; the fonts, approximately. Each slide is the shape of the first page, each picture sits where the page shows it, and each line of text is a text box at its place with its size, weight and colour, except on a page whose drawing would take more than ${LAYERS} pictures to stack in order, which comes as one picture of the page with its text in invisible text boxes over it. Fonts are matched rather than copied: a font that comes with Windows or Office, such as Calibri or Arial, keeps its name; a free look-alike of one of those, such as Liberation Sans or Carlito (common in PDFs made on Linux), becomes the font it copies; and any other becomes Arial, Times New Roman or Courier New by style, so a line can come out a little wider or narrower. Lines, boxes and backgrounds arrive as pictures, not as shapes, and links do not come across.`,
    },
    {
      q: "What happens to a scanned PDF?",
      a: "It is converted, as pictures. A scanned page has no selectable text, only a picture of its words, so its slide carries the page as a picture and those words are not editable text; the note beside the download names the pages it happened to. For text as well, run OCR PDF on the scan first and convert the OCR'd copy: its slides carry the recognised words in invisible text boxes over each picture. PDF to Excel, whose file would hold nothing, and PDF to Word, whose document would have nothing in it to edit, still stop at a PDF with no selectable text.",
    },
    {
      q: "Why is a paragraph split into separate text boxes?",
      a: "Each line of the PDF becomes its own text box, placed where that line sits, so a paragraph wrapped over five lines arrives as five boxes and a page set in two columns keeps its columns apart. A symbol drawn in a symbol font, such as an arrow, gets a box of its own so the words after it stay where the page has them.",
    },
    {
      q: "Can I convert a password-protected or damaged PDF?",
      a: "Not if the PDF asks for a password when you open it. The worker is given no password, so the job stops with a message saying the PDF is password-protected, and the page links you to Unlock PDF. If you know the password, remove it there (Unlock PDF cannot recover a password you lack), then convert the unlocked copy here. A damaged PDF is different. If its structure cannot be read, the worker first rebuilds the file the way Repair PDF does and converts the rebuilt copy, and the note beside the download says so. If it cannot be rebuilt into a file the worker can read, it is not converted, and the message suggests Repair PDF. A PDF whose structure reads but whose page content is damaged is converted, and on such a page a picture can be left out with no note.",
    },
    {
      q: "Is my PDF kept after the conversion?",
      a: `No. The worker reads its pages, builds the .pptx and deletes the uploaded PDF once the job ends. The .pptx can be fetched from the worker for ${OUTPUT_TTL} minutes. Beyond that the link no longer works, and a daily storage rule erases whatever copy is still stored. No account is involved.`,
    },
  ],

  relatedGuides: ["how-to-make-a-scanned-pdf-searchable"],
};

export default content;
