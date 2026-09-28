import type { ToolContent } from "./types";
import { modeUploadsFiles } from "@/lib/tools/processing-split";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import {
  SUPPORTED_SCRIPTS,
  UNSUPPORTED_SCRIPTS,
  unsupportedScriptFor,
} from "@/lib/pdf/font-packs";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";

/*
 * Every behavioral claim below was read from, or probed against, the code:
 *  - runner: src/components/tools/runner/header-footer-runner.tsx — ONE text
 *    field per band ("Header text", "Footer text"), each with a Left / Center /
 *    Right alignment control (default Center) and {n} / {total} / {date} token
 *    buttons that append to the field; the footer starts as
 *    "Page {n} of {total}", the header starts empty; a preview chip beside each
 *    section heading shows page 1; "Add header & footer" is disabled until one
 *    field has text; result panel "Header & footer added" / "Download PDF";
 *    filename `<name>-header-footer.pdf` via outputName. The engine can fill
 *    left, center and right slots at once, but the runner sends ONE slot per
 *    band, so this page never claims three positions per band.
 *  - dropzone hint (SinglePdfRunner): "One PDF · header & footer applied
 *    locally in your browser"; FileHeader shows name, page count and size.
 *  - engine: addHeaderFooter() in src/lib/pdf/header-footer.ts loads the
 *    ORIGINAL document, draws text on every page with no background, sets
 *    Producer/Creator to pdf.xyz (stampProducer) and saves it. Font size,
 *    margin and ink are engine defaults the runner never sets, so the copy
 *    says "fixed" and types none of them. placeStamp() cancels a page's
 *    /Rotate so text lands at the visual top/bottom reading level.
 *    applyTokens() also accepts {page}/{pages}, case-insensitively.
 *  - font choice (embedDrawingFont): Helvetica only when EVERY drawn string is
 *    WinAnsi. Re-probed 2026-09-27 by the audit: "Größe" fetched nothing;
 *    "Łódź" fetched the Noto Sans (latin) pack — so the fetch trigger is
 *    "outside Windows-1252", NOT "non-Western script".
 *  - refusals re-probed 2026-09-27 (audit, addHeaderFooter against this
 *    worktree): Hebrew/Arabic (named, right-to-left reason), Thai/Tamil
 *    (named, "no ... face is shipped"), emoji (named), Japanese header over a
 *    Bengali footer ("This text mixes Chinese and Bengali and Japanese" when
 *    the header has kanji — names SCRIPTS, not characters), Japanese with
 *    Polish Ł (also "mixes"). A script missing from UNSUPPORTED_SCRIPTS
 *    (Mongolian) is refused WITHOUT a script name, listing the characters —
 *    so the page says "names the script, or lists the characters". A
 *    Bengali, Greek, Japanese, Korean or Chinese header over an ASCII
 *    "Page {n} of {total}" footer draws fine (one face covers both).
 *    Blank text ("Add header or footer text to stamp.") is engine only; the
 *    runner disables the button first, so the page does not describe it.
 *  - {date} by locale (Node ICU): fa-IR "۱۴۰۵/۷/۵" and ar-EG "٢٧/٩/٢٠٢٦" are
 *    REFUSED as Arabic even under an English header; bn-BD fetches the
 *    Bengali face; en-US, de-DE, hi-IN, ja-JP, ko-KR, zh-CN, th-TH stay in
 *    Helvetica. The fa-IR half is re-derived below at module load.
 *  - Form field value, title, author, a 90-degree /Rotate survived, and
 *    Producer/Creator read back as pdf.xyz — read with
 *    `updateMetadata: false`, because a plain PDFDocument.load() rewrites
 *    Producer to "pdf-lib" on the READER's side and made the first probe of
 *    this report lie. Bookmarks were not tested and are not claimed.
 *  - {date} is `new Date().toLocaleDateString()` in the visitor's browser,
 *    computed once per run: fixed text, the viewer's locale format.
 *  - loadPdf() refuses encrypted input with "Unlock it first" when the file is
 *    opened (useSinglePdf -> getPageRotations); Unlock PDF is processing
 *    "server" in the catalogue, asserted below.
 *  - fonts come from pdf.xyz's own origin (fontPackUrl: /fonts/...); the
 *    document is not sent anywhere.
 */
const tool = getToolBySlug("header-footer");
if (!tool || modeUploadsFiles(tool.processing)) {
  throw new Error(
    "header-footer content says 'in your browser' but the tool is not client-side",
  );
}
const unlock = getToolBySlug("unlock-pdf");
if (!unlock || capabilityForMode(unlock.processing) !== "secure-worker") {
  throw new Error(
    "header-footer content says Unlock PDF uploads the file; the catalogue no longer marks it server-side",
  );
}
const ceilingMb = toolFileCeilingMb(tool);
if (ceilingMb === null) {
  throw new Error("header-footer content states a file ceiling it cannot find");
}
const unsupportedNames = UNSUPPORTED_SCRIPTS.map((s) => s.name);
const rtlRefused = ["Arabic", "Hebrew"].filter((name) =>
  unsupportedNames.includes(name),
);
if (rtlRefused.length !== 2) {
  throw new Error(
    "header-footer content says Arabic and Hebrew are refused; font-packs no longer lists both",
  );
}
const noFaceExamples = ["Thai", "Tamil"].filter((name) =>
  unsupportedNames.includes(name),
);
if (noFaceExamples.length !== 2 || !unsupportedNames.includes("emoji")) {
  throw new Error(
    "header-footer content names Thai, Tamil and emoji as refused; font-packs no longer lists them",
  );
}
if (
  !["Bengali", "Greek", "Hiragana", "Hangul"].every((s) =>
    SUPPORTED_SCRIPTS.includes(s),
  )
) {
  throw new Error(
    "header-footer content names Bengali, Greek, Japanese and Korean as drawable; font-packs disagrees",
  );
}
// The FAQ says a browser writing dates in Persian digits gets {date} refused as
// Arabic. Derived, not typed: if ICU or the refusal table changes, this throws.
const persianDate = new Date(Date.UTC(2026, 8, 27, 12)).toLocaleDateString(
  "fa-IR",
);
if (
  ![...persianDate].some(
    (ch) => unsupportedScriptFor(ch.codePointAt(0) ?? 0)?.name === "Arabic",
  )
) {
  throw new Error(
    "header-footer content says a Persian-locale {date} is refused as Arabic; it no longer is",
  );
}
const linkMinutes = DEFAULT_RETENTION.outputTtlMinutes;
const scriptsList = new Intl.ListFormat("en", { type: "conjunction" }).format(
  SUPPORTED_SCRIPTS,
);

const content: ToolContent = {
  slug: "header-footer",

  seoTitle: "Add Header & Footer to PDF — Runs in Your Browser",

  metaDescription:
    "Put a running header and footer on every PDF page, with {n}, {total} and {date} fields and Left, Center or Right alignment. Stamped in-browser, not uploaded.",

  intro: [
    'Header & Footer writes one line of text at the top of every page, one at the bottom, or both: a company name and "Confidential" above, "Page 3 of 12" below, or a draft date worked into either line. Use it to make a stack of exported pages read as one finished document before it goes to a client, a clerk or a printer.',
    `Each band gets its own text and its own Left, Center or Right alignment. Fields fill themselves in page by page: {n} becomes the page number, {total} the file's page count, and {date} today's date in your browser's date format. The footer starts out as "Page {n} of {total}", and a preview beside each heading shows how page 1 will read. Pages stored sideways still get their header at the top as you see it, reading level.`,
    `The PDF, up to ${ceilingMb} MB, is read and rewritten in your browser and is not uploaded. Text is added on top of the existing pages rather than rebuilding them, so form fields and their values, the title and author, and page rotation came through intact in our test; the Producer and Creator entries are set to pdf.xyz. Nothing is shifted to make room, so check pages that already print close to the edge.`,
  ],

  useCases: [
    {
      title: "Page X of Y across a combined report",
      body: "Keep the ready-made footer and the count runs across the whole file, even when its pages came from different programs.",
    },
    {
      title: "Marking a document confidential or draft",
      body: 'A header such as "Acme Ltd — Confidential" shows the status on every printed sheet, not only the cover.',
    },
    {
      title: "Dating a version before you send it",
      body: "Add {date} so readers can tell which copy they hold. It is written as plain text and does not change when the file is reopened later.",
    },
    {
      title: "Labelling exhibits and appendices",
      body: 'Right-align "Exhibit B" in the header and number the footer, so loose pages can be put back in order.',
    },
    {
      title: "Headers in Bengali, Greek, Japanese or Korean",
      body: `Letters outside the Western European set are drawn with an embedded Noto typeface, and an English "Page {n} of {total}" footer can sit under it in the same file. Scripts this tool can draw: ${scriptsList}.`,
    },
  ],

  steps: [
    {
      title: "Choose one PDF",
      body: 'Drag the file onto "Drop your PDF here" or pick it with the browse link; the box takes a single PDF. Once it is read, a bar above the editor shows its name, page total and size.',
    },
    {
      title: "Write the header and footer",
      body: "Type into Header text and Footer text. The {n}, {total} and {date} buttons add that field to the end of the line, and the chip by each heading previews page 1. Leave a field empty to skip that band.",
    },
    {
      title: "Pick an alignment for each band",
      body: "Choose Left, Center or Right under each field; both start centred. Each band holds one line in the position you pick.",
    },
    {
      title: "Add and download",
      body: "Press Add header & footer, active once either field has text. When the panel reads Header & footer added, press Download PDF; the saved name adds -header-footer before .pdf.",
    },
  ],

  faqs: [
    {
      q: 'How do I add "Page 1 of 10" numbering in a footer?',
      a: 'It is the default. The footer opens as "Page {n} of {total}", with the total taken from the file\'s own page count. Reword it freely, for example "{n} / {total}"; typing {page} and {pages} works too.',
    },
    {
      q: "Can I leave the header off the cover page?",
      a: "Not here; every page gets the text. For numbers alone, Add Page Numbers has Start on page and First number settings. Otherwise split off the cover with Split PDF, stamp the rest and rejoin with Merge PDF; {n} and {total} then count only the stamped pages.",
    },
    {
      q: "Can I change the font, size, colour or margin?",
      a: "No: the small size, slate-grey ink and distance from the edge are fixed. You choose the wording, the fields and each band's alignment. The typeface follows the characters: while everything in both bands fits the Western Windows-1252 set, German and French accents included, both are set in Helvetica; one character outside it, such as Polish ł, moves both bands to a Noto face.",
    },
    {
      q: "Will it cover or remove an existing header?",
      a: "It never removes anything. The line is drawn over the page with no background, so text already in that spot will overlap it, and running the tool twice gives two headers. Try another alignment if the edge is busy.",
    },
    {
      q: "Why was my file or my header text refused?",
      a: `Encryption is checked the moment the file is read, and an encrypted PDF gets "Unlock it first" instead of the editor. Unlock PDF removes it with a password you know, but it runs on pdf.xyz's secure worker: the file travels there over TLS and the unlocked copy's link lasts ${linkMinutes} minutes. Header or footer text is refused when it is ${rtlRefused.join(" or ")} (lines are laid out left to right and would come out reversed), when it needs a script no shipped font draws, such as ${noFaceExamples.join(", ")} or colour emoji, or when the two bands together need two different faces, like a Japanese header over a Bengali footer. {date} counts too: a browser set to Persian writes the date in Persian digits, which are refused like Arabic, so type the date by hand there. The message names the script, or lists the characters when it cannot.`,
    },
    {
      q: "Does my PDF leave my device when I add a header?",
      a: `No. It is opened, stamped and saved in your browser tab, up to ${ceilingMb} MB. When your text or the {date} value has characters Helvetica cannot encode, the page also downloads a Noto font file from pdf.xyz's own site; that request carries no part of your document.`,
    },
  ],

  relatedGuides: [],
};

export default content;
