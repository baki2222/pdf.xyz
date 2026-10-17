import type { ToolContent } from "./types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import { toolFacts } from "@/lib/tools/tool-facts";
import {
  DEFAULT_PAGE_NUMBER_FORMAT,
  numberedOutputName,
  previewPageNumber,
} from "@/lib/pdf/page-numbers";
import { STAMP_POSITIONS } from "@/lib/pdf/stamp";
import { SUPPORTED_SCRIPTS, UNSUPPORTED_SCRIPTS } from "@/lib/pdf/font-packs";

/**
 * Every figure and list on this page is read from the code that enforces it:
 *
 *  - The size cap is the "page-numbers" runner's own gate (`useSinglePdf` ->
 *    `validatePdfFile` -> MAX_PDF_BYTES), read through RUNNER_FILE_CEILINGS and
 *    rounded the way `toolFileCeilingMb` rounds it.
 *  - The default template is DEFAULT_PAGE_NUMBER_FORMAT, the value the engine
 *    and the runner's first render both start from.
 *  - The number of placement cells is STAMP_POSITIONS.length, the list the
 *    runner's PositionPicker maps over.
 *  - The scripts named are SUPPORTED_SCRIPTS, the list `embedStampFont` can
 *    draw; the right-to-left names are the UNSUPPORTED_SCRIPTS rows whose
 *    stated reason is direction, so a new RTL face (or a dropped one) moves
 *    this sentence with it.
 *
 *  - The preset labels are read from the "Formats" entry of `toolFacts`, the
 *    one string `page-numbers-formats.test.ts` pins, as a set, to the runner's
 *    FORMAT_PRESETS. FORMAT_PRESETS itself lives in a "use client" module and
 *    cannot be imported into server-rendered copy as a value, so the chain is
 *    FORMAT_PRESETS -> (test) -> fact -> (this file). The fact spells the
 *    last one with en dashes; they are normalised to the hyphens the button
 *    shows. Fewer than two extracted labels throws: a regex that stopped
 *    matching must not quietly print an empty list.
 *  - The example output name is `numberedOutputName` applied to a sample name,
 *    and the {total} example is `previewPageNumber` over the default template.
 *
 * Control labels ("Start on page", "First number", "Font size", "Add page
 * numbers", "Download numbered PDF", "Back to adjust", "Start over", "Bottom
 * center") are quoted from `page-numbers-runner.tsx`, `runner-kit.tsx` and
 * `stamp-controls.tsx`. Back to adjust clears the result and nothing else
 * (`onAdjust` = the run's `reset`), so the options and the file survive it;
 * until it existed this step said a changed setting meant picking the
 * original again (unbacked-claims rule 6 holds that sentence).
 * The presets are never counted in prose: a spelled count ("Three numbering
 * formats") is the defect `page-numbers-formats.test.ts` exists for.
 *
 * Checked with a real job on 2026-09-27 (tsx, pdf-lib 1.17.1, scratch script
 * calling `addPageNumbers`, content streams inflated and read back): a 10-page
 * fixture with an outline, a URI link annotation, a filled text field and a
 * /Rotate 90 page kept all four; Title and Author survived while Producer and
 * Creator came back as "pdf.xyz" (stampProducer). With Start on page 3 and
 * First number 1 the drawn labels were exactly "Page 1 of 8" .. "Page 8 of 8"
 * and pages 1-2 carried none. "X-{n}" from 7 drew "X-7" .. "X-16" (no zero
 * padding). A Hebrew label was refused naming its characters; a Bengali +
 * Korean label was refused naming both scripts. Re-run independently the same
 * day with the same results; note the read-back must use
 * `PDFDocument.load(bytes, { updateMetadata: false })`, or pdf-lib rewrites
 * Producer to "pdf-lib" on the READER's side and the check reports a defect
 * the file does not have.
 *
 * NOT tested: the digital-signature sentence. It follows from `doc.save()`
 * writing every object out afresh around new page content, so the bytes a
 * signature's ByteRange covered no longer exist; no signed fixture was run.
 *
 * relatedGuides is empty on purpose: no guide in `src/lib/guides/catalog.ts`
 * mentions page numbers, and the merge guide only shares a use case.
 */
const positionCount = STAMP_POSITIONS.length;
const ceilingMb = Math.round(
  RUNNER_FILE_CEILINGS["page-numbers"] / (1024 * 1024),
);

/** "a, b and c" — the list is derived, so its grammar has to be too. */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const scripts = listOf(SUPPORTED_SCRIPTS);
const rtlScripts = listOf(
  UNSUPPORTED_SCRIPTS.filter((entry) =>
    entry.reason.includes("right to left"),
  ).map((entry) => entry.name),
);
const rtlSentence = rtlScripts
  ? ` ${rtlScripts} labels are refused, because they would be laid out left to right and read backwards.`
  : "";

/** Preset labels, as the buttons show them, via the test-pinned facts line. */
const formatsFact =
  toolFacts("page-numbers").find((fact) => fact.label === "Formats")?.value ??
  "";
const presets = [...formatsFact.matchAll(/[“"]([^“”"]+)[”"]/g)].map((m) =>
  m[1]!.replace(/[–—]/g, "-"),
);
if (presets.length < 2) {
  throw new Error(
    `page-numbers content read ${presets.length} preset labels from the Formats fact; the fact or its quoting changed`,
  );
}
const presetList = `${presets.slice(0, -1).join(", ")} or ${presets[presets.length - 1]}`;

const sampleName = "report.pdf";
const sampleOutput = numberedOutputName(sampleName);

/** The {total} example: ten pages, numbering from page 3, First number 1. */
const examplePages = 10;
const exampleStartPage = 3;
const exampleFirst = 1;
const exampleTotal = exampleFirst + (examplePages - (exampleStartPage - 1)) - 1;
const exampleFirstLabel = previewPageNumber(
  DEFAULT_PAGE_NUMBER_FORMAT,
  exampleFirst,
  exampleTotal,
);
const exampleLastLabel = previewPageNumber(
  DEFAULT_PAGE_NUMBER_FORMAT,
  exampleTotal,
  exampleTotal,
);

const content: ToolContent = {
  slug: "page-numbers",

  seoTitle: "Add Page Numbers to PDF – In Your Browser",

  metaDescription: `Number PDF pages as ${presets[0]}, ${presets[1]} or your own template, skip a cover page, and pick one of ${positionCount} spots. Numbering happens on your device.`,

  intro: [
    `Add Page Numbers stamps a number onto every page of one PDF, or onto every page from a chosen page onward. The format starts as "${DEFAULT_PAGE_NUMBER_FORMAT}", and a row of presets switches it with one click. You can also type your own template, where {n} becomes the page's number and {total} the last number printed, so "Exhibit A – {n}" works as well as a bare figure. A Preview pill beside the Format heading shows the label the first numbered page will carry.`,
    `All of the numbering happens inside the open tab: your PDF is loaded from your device into memory, stamped with pdf-lib, and saved back to you, with no upload to pdf.xyz at any point. A file over ${ceilingMb} MB is refused as soon as you pick it, before any numbering starts. Plain Western labels use a built-in font; a label in another script the tool can draw pulls a matching Noto typeface down from the pdf.xyz site, and only the font travels, never your document.`,
    "Page content, bookmarks, links and filled-in form fields come through; each number is drawn into the page as text in a dark slate ink, at a fixed margin from the edge. Document properties keep their title and author, but the producer and creator fields now read pdf.xyz. Because the pages gain new content and the whole file is written out again, a digital signature already in it will no longer validate. On a page with a rotation flag, the number still lands at the edge you see and reads horizontally. A password-protected PDF is refused when you pick it and has to be unlocked first.",
  ],

  useCases: [
    {
      title: "Paginate a thesis or report after the front matter",
      body: "Set Start on page to the first chapter so the title page, abstract and contents stay clean, and keep First number at 1 so chapter one opens on page 1.",
    },
    {
      title: "Number a merged bundle before it goes out",
      body: 'After combining separate files with Merge PDF, one continuous sequence lets a reader say "see page 14" and mean the same page as everyone else on the call.',
    },
    {
      title: "Label exhibits or a document production",
      body: 'A custom template such as "ACME-{n}" with a First number that continues from the last batch gives every numbered page a unique, prefixed reference.',
    },
  ],

  steps: [
    {
      title: "Choose a PDF",
      body: "Drop a single PDF onto the dashed box or click browse. The settings then open under a bar giving that file's name, page count and size.",
    },
    {
      title: "Pick a format",
      body: `Click a preset (${presetList}) or type into the Custom format field using {n} and {total}. The Preview pill follows each keystroke.`,
    },
    {
      title: "Set placement",
      body: `The number sits at Bottom center unless you click another of the ${positionCount} cells in the position grid. Start on page skips leading pages, First number sets the opening value, and a slider sets Font size.`,
    },
    {
      title: "Add page numbers",
      body: "Press Add page numbers. When it finishes, a summary states how many pages received a number and the size of the new file.",
    },
    {
      title: "Download numbered PDF",
      body: `Save the result; ${sampleName} comes back as ${sampleOutput}. To try different settings, press Back to adjust: the options come back as you left them, with the same file still loaded, and the next run makes a fresh copy.`,
    },
  ],

  faqs: [
    {
      q: "How do I start page numbers on page 2 or 3?",
      a: "Set Start on page to the page that should carry the first number. Pages before it get no number, and numbering counts from First number on that page, so a document with a cover and a contents page can start at 1 on its third physical page.",
    },
    {
      q: "What does {total} count when I skip the first pages?",
      a: `It is the last number that will be printed, not the physical page count. With the default "${DEFAULT_PAGE_NUMBER_FORMAT}" template, a ${examplePages}-page file numbered from page ${exampleStartPage} with First number ${exampleFirst} reads "${exampleFirstLabel}" through "${exampleLastLabel}"; the Preview pill uses the same arithmetic.`,
    },
    {
      q: "Can I do Bates numbering with this?",
      a: 'For simple cases, yes: put a prefix in the custom template, such as "SMITH-{n}", and set First number to continue an earlier batch. Numbers are printed without leading zeros, though, so a fixed-width style like 000123 is not available.',
    },
    {
      q: "Will the numbers cover text already on the page?",
      a: `They can. The label is drawn over the page's existing content with no background box, so a page that already has a footer or a scanned image reaching the margin may overlap. Pick another of the ${positionCount} positions or a smaller font size and number the original again, not the numbered copy, or pages will carry two numbers.`,
    },
    {
      q: "Which languages can a page-number label use?",
      a: `A label can be written in ${scripts}.${rtlSentence} If a character cannot be drawn, the tool stops with a message listing it instead of printing question marks or blanks. A label mixing two scripts that no single shipped font covers is refused as well, with a message naming both.`,
    },
  ],

  relatedGuides: [],
};

export default content;
