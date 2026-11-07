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
import {
  DEFAULT_HEADER_FOOTER_SIZE,
  HEADER_FOOTER_MARGIN_LABELS,
  HEADER_FOOTER_MARGINS,
  HEADER_FOOTER_SIZES,
  stampDateCandidates,
  type HeaderFooterMargin,
} from "@/lib/pdf/header-footer";
import { STAMP_FONT_LABELS } from "@/lib/pdf/stamp";

/*
 * Every behavioral claim below was read from, or probed against, the code:
 *  - runner: src/components/tools/runner/header-footer-runner.tsx — THREE
 *    boxes per band, named from ALIGN_OPTIONS ("Header left", "Header
 *    center", "Header right", and the same for Footer), all sent to the
 *    engine at once (audit header-footer#3, 2026-11-07; until then ONE text
 *    field per band with a Left / Center / Right picker, and this comment
 *    forbade claiming three positions). Each band's {n} / {total} / {date}
 *    buttons append to the box last focused in that band (center at first),
 *    which the Insert line names; the footer starts as "Page {n} of {total}"
 *    in the center box (or the box a one-box footer last used, option
 *    memory), the header starts empty; a preview chip beside each section
 *    heading joins the band's boxes; "Add header & footer" is disabled until
 *    one box has text; two boxes of a band that would overlap are refused by
 *    the engine; result panel "Header & footer added" / "Download PDF";
 *    filename `<name>-header-footer.pdf` via outputName. A "Pages"
 *    disclosure (audit header-footer#2, 2026-11-07) holds Start on page,
 *    First number, "Leave the cover page blank" and Skip last pages, which
 *    the engine resolves through numberingPlan (src/lib/pdf/page-plan.ts),
 *    the same arithmetic as Add Page Numbers; the chip previews the FIRST
 *    page that gets the bands.
 *  - dropzone hint (SinglePdfRunner): "One PDF · header & footer applied
 *    locally in your browser"; FileHeader shows name, page count and size.
 *  - engine: addHeaderFooter() in src/lib/pdf/header-footer.ts loads the
 *    ORIGINAL document, draws text on the planned pages with no background, sets
 *    Producer/Creator to pdf.xyz (stampProducer) and saves it. Font size,
 *    margin, family and ink are set under "Size, margin, font and color"
 *    (audit header-footer#4, 2026-11-07; until then engine defaults the
 *    runner never set, and the FAQ said "fixed"); every number and name the
 *    copy gives is read from HEADER_FOOTER_SIZES / _MARGINS / _MARGIN_LABELS
 *    and STAMP_FONT_LABELS below. placeStamp() cancels a page's
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
 *  - {date} by locale (Node ICU): fa-IR "۱۴۰۵/۷/۵" and ar-EG "٢٧/٩/٢٠٢٦" were
 *    REFUSED as Arabic even under an English header; bn-BD fetches the
 *    Bengali face; en-US, de-DE, hi-IN, ja-JP, ko-KR, zh-CN, th-TH stay in
 *    Helvetica. SUPERSEDED (history kept): since L13 (0a1f815) the runner's
 *    preview and Run both stamp resolveStampDate(...), the first of
 *    stampDateCandidates that canDrawInOneFace accepts beside the user's
 *    text: the locale form, then the same order in Latin digits on the
 *    Gregorian calendar (fa-IR "2026/9/27"), then local YYYY-MM-DD. The FAQ
 *    said a Persian {date} was refused for weeks after that, and the
 *    module-load check below asserted the MECHANISM (Persian digits are
 *    Arabic script), which stayed true, so it licensed the stale sentence.
 *  - Form field value, title, author, a 90-degree /Rotate survived, and
 *    Producer/Creator read back as pdf.xyz — read with
 *    `updateMetadata: false`, because a plain PDFDocument.load() rewrites
 *    Producer to "pdf-lib" on the READER's side and made the first probe of
 *    this report lie. Bookmarks were not tested and are not claimed.
 *  - {date} is resolved in the visitor's browser once per run (see above):
 *    fixed text, the viewer's locale format when a shipped face can draw it.
 *  - loadPdf() refuses encrypted input when the file is opened (useSinglePdf
 *    -> getPageRotations), in the words of the pdf.js probe's verdict
 *    (src/lib/pdf/encryption.ts; AMENDED 2026-10-06, the FAQ quoted the
 *    retired "Unlock it first" until then); Unlock PDF is processing
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
// INVERTED (history kept). This used to throw unless a Persian-locale date
// held Arabic-script digits, and the FAQ said such a {date} was refused. The
// digits stayed Arabic script; the refusal went away when the runner began
// switching to the next of stampDateCandidates. The FAQ now says the date is
// switched, and quotes the switched form, so both halves are derived here: the
// locale's own form still needs switching (Arabic script), and the next
// candidate is Latin digits. tool-faq-substance runs resolveStampDate on it.
const persianDay = new Date(2026, 8, 27, 12);
const [persianOwn, persianLatin] = stampDateCandidates(persianDay, "fa-IR");
if (
  !persianOwn ||
  ![...persianOwn].some(
    (ch) => unsupportedScriptFor(ch.codePointAt(0) ?? 0)?.name === "Arabic",
  ) ||
  !persianLatin ||
  !/^[0-9][0-9/.-]*[0-9]$/.test(persianLatin)
) {
  throw new Error(
    "header-footer content says a Persian-locale {date} is switched to Latin digits; stampDateCandidates disagrees",
  );
}
const linkMinutes = DEFAULT_RETENTION.outputTtlMinutes;
const orList = (items: readonly string[]) =>
  new Intl.ListFormat("en", { type: "disjunction" }).format(items);
const marginChoices = orList(
  (Object.keys(HEADER_FOOTER_MARGINS) as HeaderFooterMargin[]).map(
    (key) =>
      `${HEADER_FOOTER_MARGIN_LABELS[key]} (${HEADER_FOOTER_MARGINS[key]} pt)`,
  ),
);
const fontChoices = orList(Object.values(STAMP_FONT_LABELS));
const sizeRange = `${HEADER_FOOTER_SIZES.min} to ${HEADER_FOOTER_SIZES.max} pt, starting at ${DEFAULT_HEADER_FOOTER_SIZE}`;
const scriptsList = new Intl.ListFormat("en", { type: "conjunction" }).format(
  SUPPORTED_SCRIPTS,
);

const content: ToolContent = {
  slug: "header-footer",

  seoTitle: "Add Header & Footer to PDF — Runs in Your Browser",

  metaDescription:
    "Put a running header and footer on PDF pages: text at the Left, Center and Right of each, with {n}, {total} and {date} fields. Stamped in-browser, not uploaded.",

  intro: [
    'Header & Footer writes one line of text at the top of every page, one at the bottom, or both: a company name and "Confidential" above, "Page 3 of 12" below, or a draft date worked into either line. Use it to make a stack of exported pages read as one finished document before it goes to a client, a clerk or a printer.',
    `Each band has three boxes, Left, Center and Right, so a company name can sit at the left of the header with the date at its right. Fields fill themselves in page by page: {n} becomes the page number, {total} the file's page count, and {date} today's date in your browser's date format. The footer starts out as "Page {n} of {total}", and a preview beside each heading shows how the first stamped page will read. Open Pages to leave the cover page blank, start on a later page, count {n} from another first number, or leave the last pages bare. Pages stored sideways still get their header at the top as you see it, reading level.`,
    `The PDF, up to ${ceilingMb} MB, is read and rewritten in your browser and is not uploaded. Text is added on top of the existing pages rather than rebuilding them, so form fields and their values, the title and author, and page rotation came through intact in our test; the Producer and Creator entries are set to pdf.xyz. Nothing is shifted to make room, so check pages that already print close to the edge; the Margin setting moves the lines nearer to it or further in.`,
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
      body: `Letters outside the Western European set are drawn with an embedded typeface that covers them, and an English "Page {n} of {total}" footer can sit under it in the same file. Scripts this tool can draw: ${scriptsList}.`,
    },
  ],

  steps: [
    {
      title: "Choose one PDF",
      body: 'Drag the file onto "Drop your PDF here" or pick it with the browse link; the box takes a single PDF. Once it is read, a bar above the editor shows its name, page total and size.',
    },
    {
      title: "Write the header and footer",
      body: "Type into any of the boxes: Header left, Header center and Header right across the top, the same three for the footer. The {n}, {total} and {date} buttons add that field to the end of the box you last used in that band, and the chip by each heading previews the band. Leave a band's boxes empty to skip it.",
    },
    {
      title: "Put each line where it belongs",
      body: "The Left box is set against the left margin, Center in the middle and Right against the right margin, and a band can use all three. The footer's Page {n} of {total} starts in the Center box; after you run a footer that uses one box, it starts in that box next time. Two boxes whose lines would run into each other are refused, with a message naming both.",
    },
    {
      title: "Choose the pages, if not all",
      body: "Every page gets the lines unless you open Pages. Tick Leave the cover page blank to skip page 1 while still counting it, set Start on page and First number to begin later or count from another number, or set Skip last pages to leave an appendix bare. {total} becomes the last number printed.",
    },
    {
      title: "Add and download",
      body: "Press Add header & footer, active once any box has text. When the panel reads Header & footer added, press Download PDF; the saved name adds -header-footer before .pdf.",
    },
  ],

  faqs: [
    {
      q: 'How do I add "Page 1 of 10" numbering in a footer?',
      a: 'It is the default. The footer opens as "Page {n} of {total}", with the total taken from the file\'s own page count. Reword it freely, for example "{n} / {total}"; typing {page} and {pages} works too.',
    },
    {
      q: "Can I leave the header off the cover page?",
      a: "Yes. Open Pages and tick Leave the cover page blank: page 1 gets no header or footer but is still counted, so with the default footer on a twelve-page file, page 2 reads Page 2 of 12. To leave several opening pages bare and count from the first stamped one, set Start on page instead, with First number as the {n} that page shows; Skip last pages does the same for the end of the file. {total} is always the last number printed.",
    },
    {
      q: "Can I change the font, size, colour or margin?",
      a: `Yes, under Size, margin, font and color, and the choices apply to both bands. Font size runs from ${sizeRange}; the margin from the page edge is ${marginChoices}, starting at ${HEADER_FOOTER_MARGIN_LABELS.medium}; the font is ${fontChoices}; and Color picks the ink, slate grey until you change it. The font you pick is used while everything in both bands fits the Western Windows-1252 set, German and French accents included; one character outside it, such as Polish ł, moves both bands to a matching typeface. A line wider than the page between its margins is refused before anything is written, with how many of its characters fit, rather than running off the edge; a smaller size or margin makes room.`,
    },
    {
      q: "Will it cover or remove an existing header?",
      a: "It never removes anything. The line is drawn over the page with no background, so text already in that spot will overlap it, and running the tool twice gives two headers. Try another box if one part of the edge is busy.",
    },
    {
      q: "Why was my file or my header text refused?",
      a: `Encryption is checked the moment the file is read, and an encrypted PDF gets a message naming its lock, with a link to Unlock PDF, instead of the editor: it is called password-protected only when it needs a password to open. Unlock PDF removes the lock with a password you know (for a file that opens freely, its owner password), but it runs on pdf.xyz's secure server: the file travels there over TLS and the unlocked copy's link lasts ${linkMinutes} minutes. Header or footer text is refused when it is ${rtlRefused.join(" or ")} (lines are laid out left to right and would come out reversed), when it needs a script no shipped font draws, such as ${noFaceExamples.join(", ")} or colour emoji, or when the two bands together need two different faces, like a Japanese header over a Bengali footer. {date} is switched, not refused: when your browser writes dates in digits no shipped font can draw beside your text, such as the Persian or Arabic-Indic digits of a Persian or Egyptian Arabic browser, the same day is stamped in Latin digits on the Gregorian calendar in your locale's order (a Persian browser writes 27 September 2026 as ${persianLatin}), or as YYYY-MM-DD if that still will not fit, and the preview by each heading shows exactly what will be printed. The message names the script, or lists the characters when it cannot.`,
    },
    {
      q: "Does my PDF leave my device when I add a header?",
      a: `No. It is opened, stamped and saved in your browser tab, up to ${ceilingMb} MB. When your text or the {date} value has characters the font you picked cannot encode, the page also downloads a matching font file from pdf.xyz's own site; that request carries no part of your document.`,
    },
  ],

  relatedGuides: [],
};

export default content;
