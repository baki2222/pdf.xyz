import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { MAX_TOOL_NOTE_CHARS, MAX_TOOL_NOTES } from "@/lib/jobs/tool-notes";
import { WORKER_FILE_CEILING } from "@/lib/tools/file-ceilings";
import {
  MAX_DIAGNOSTIC_CHARS,
  MAX_DIAGNOSTIC_LINES,
} from "@/lib/workers/native-diagnostics";
import { PDF_A_STANDARD } from "@/lib/workers/pdf-archive/engine";
import {
  PDFA_EXPECTED_CONFORMANCE,
  PDFA_EXPECTED_PART,
  PDFA_OUTPUT_INTENT_SUBTYPE,
} from "@/lib/workers/pdf-archive/pdfa-markers";
import { pdfaOutputName } from "@/lib/workers/processor/pdf-archive";

/**
 * The prose below explains conformance level "b" of PDF/A-2 (ISO 19005-2) and
 * says the engine runs with its PDF/A-2 setting. Interpolating the constant
 * alone would leave those sentences true of the old target and false of the
 * new one, so a change of target stops the build here instead of shipping them.
 */
if (PDF_A_STANDARD !== "PDF/A-2b") {
  throw new Error(
    `pdf-to-pdfa content is written for PDF/A-2b; the engine now targets ${String(PDF_A_STANDARD)}. Rewrite the page.`,
  );
}

/**
 * The worker-tier upload ceiling (`JOB_LIMITS.maxFileBytes`, the constant the
 * upload API and the worker store refuse above), converted the way
 * `toolFileCeilingMb` converts it, so this page and the panel quote one number.
 * Ghostscript's own input cap (`PDFXYZ_PDF_ARCHIVE_MAX_INPUT_BYTES`) defaults
 * higher, so the upload ceiling is the one a visitor meets.
 */
const CEILING_MB = Math.round(WORKER_FILE_CEILING / (1024 * 1024));
const LINK_MINUTES = DEFAULT_RETENTION.outputTtlMinutes;

/**
 * The notes pass TWO bounds in series (worker `sanitizeNativeDiagnostics`, then
 * persistence `boundToolNotes`), so what a reader can see is the tighter of the
 * two. Quoting only MAX_TOOL_NOTES would go stale the day the worker bound
 * shrinks.
 */
const NOTE_LINES = Math.min(MAX_DIAGNOSTIC_LINES, MAX_TOOL_NOTES);
const NOTE_CHARS = Math.min(MAX_DIAGNOSTIC_CHARS, MAX_TOOL_NOTE_CHARS);

/** The real output-name function, not a typed example of it. */
const EXAMPLE_IN = "report.pdf";
const EXAMPLE_OUT = pdfaOutputName(EXAMPLE_IN);

/*
 * Behaviour claims below were read from the code on 2026-09-27:
 *  - panel: src/components/tools/pdf-archive-worker-panel.tsx — status badge
 *    ("Secure worker" when ready), no uploader at all when the worker is not
 *    ready, one PDF via a drop zone titled "Add a PDF, or" + browse, a
 *    "Remove" link, the "Convert to PDF/A" button (labelled through
 *    jobBusyLabel: "Uploading your file…", "Waiting for the worker…",
 *    "Converting to PDF/A…", "Downloading the result…"; until 2026-10-07 the
 *    step said "Converting to PDF/A…" covered the upload), "Your PDF/A file
 *    is ready." and "Download <name>". No
 *    options: no level picker, no password field. The panel itself says the
 *    result is not validated against the PDF/A specification.
 *  - notes: src/components/tools/pdfa-notes.tsx ("What PDF/A could not keep:"
 *    shown ABOVE the download, rendered whenever gs said ANYTHING, not only on
 *    a removal), bounded twice: the worker's sanitizeNativeDiagnostics (dedupes
 *    repeats, withholds path-bearing lines, MAX_DIAGNOSTIC_LINES /
 *    MAX_DIAGNOSTIC_CHARS + a count line) and src/lib/jobs/tool-notes.ts
 *    (MAX_TOOL_NOTES / MAX_TOOL_NOTE_CHARS, then "N further message(s) not
 *    shown."). The page promises only that a closing line appears, NOT an
 *    exact count: when the worker already kept its full quota, its count line
 *    is the one persistence withholds, so the user can read "1 further
 *    message(s)" for a larger number.
 *  - "no validator": nothing checks PDF/A conformance. The output does pass
 *    checks, so the page names them rather than "no check at all": the native
 *    runner refuses an empty or over-size file and one failing `looksLikePdf`
 *    (header in the first 1 KiB, `%%EOF` in the last 2 KiB), the engine runs
 *    `deps.validate ?? looksLikePdf` on it again, and then
 *    `deps.inspectOutput ?? inspectPdfAMarkers` (pdfa-markers.ts): a
 *    /GTS_PDFA1 output intent with an embedded profile and XMP part 2 /
 *    conformance B, or the job fails `not_pdfa` with no file.
 *    `nativePdfArchiveDeps` sets neither hook, so the defaults run. Until
 *    2026-10-07 the FAQ said "the only checks" were not-empty and PDF-shaped.
 *    The marker check is a DECLARATION check, not a validator; if a real
 *    PDF/A validator is ever wired, the meta description and the first FAQ
 *    go stale.
 *  - input check: the SAME `looksLikePdf` runs on the input before gs, so a
 *    file whose `%%EOF` is missing (a truncated download) is refused as "could
 *    not be read as a PDF" even though it is a PDF.
 *  - fonts: the only evidence is the corpus line in
 *    src/lib/workers/native-diagnostics.corpus.ts ("Loading font Helvetica (or
 *    substitute) from …NimbusSans-Regular", gs 10.00.0, production). Font
 *    fidelity of a real job has NOT been checked, so the page says only that
 *    a substitute was seen and tells the reader to compare pages; it does not
 *    promise embedding. The notes will NOT name the swap, for two independent
 *    reasons: -dQUIET suppresses that stdout line (measured, native.ts), and
 *    even if emitted it holds a path and is withheld (corpus verdict "drop").
 *  - not run on a real job, so deliberately NOT claimed: whether transparency
 *    or layers survive -dPDFA=2 (the standard allows them; gs was not
 *    checked), how gs fails on a user-password file (the page says only that
 *    Ghostscript is never given a password), and whether an OCR text layer
 *    survives (the page tells the reader to search the copy).
 *  - engine: src/lib/workers/pdf-archive/{engine,native}.ts — Ghostscript
 *    pdfwrite with -dPDFA=2 and -dPDFACompatibilityPolicy=1 (drop what PDF/A
 *    cannot hold and continue), no encryption arguments; standard constant is
 *    "PDF/A-2b" (asserted at the top of this file). The notices name "PDF/A1"
 *    even under -dPDFA=2 (recorded, unresolved, in native.ts).
 *  - input: processor/pdf-archive.ts — exactly one PDF per job; a non-PDF is
 *    refused with "The input could not be read as a PDF."; output name is
 *    `pdfaOutputName` (called above for the example).
 *  - retention: DEFAULT_RETENTION + /privacy (input deleted at job end, kept
 *    for a retry after a temporary error; link stops after outputTtlMinutes;
 *    stored copy erased by a daily storage rule). The gs temp dir is removed in
 *    a `finally` in native.ts; that rm's own failure is swallowed, so the page
 *    says a cleanup step RUNS, not that removal is guaranteed.
 */
const content: ToolContent = {
  slug: "pdf-to-pdfa",

  seoTitle: `PDF to PDF/A Converter Online — ${PDF_A_STANDARD} Output`,

  metaDescription: `Convert a PDF to ${PDF_A_STANDARD} for archiving with Ghostscript and read what it reported dropping before you download. No PDF/A validator checks the result.`,

  intro: [
    `PDF to PDF/A, an online converter, rewrites an ordinary PDF as ${PDF_A_STANDARD}: conformance level b of PDF/A-2 (ISO 19005-2), the archiving format meant for documents that must still open and look the same years from now. Ghostscript's pdfwrite device rebuilds the file with its PDF/A-2 setting switched on. Level b (basic) is about visual appearance; the tagged structure that level a requires is not added.`,
    `Some of what a PDF can carry has no place in PDF/A, and the converter is told to drop it and keep going rather than abandon the job. What Ghostscript reports while doing so appears above your download in its own words: at most ${NOTE_LINES} distinct lines, each cut to ${NOTE_CHARS} characters, with any line naming a file path held back and a closing line saying further messages were not shown. The line you are most likely to meet ends in "discarding DOCINFO", because most PDFs carry producer or creator text. Nothing checks the output against the PDF/A specification afterwards, so treat it as a best-effort conversion, not a certificate.`,
    `The conversion happens where Ghostscript is installed, on pdf.xyz's secure server, so your PDF (one per job, ${CEILING_MB} MB at most) travels there over TLS. Once the job is over our server deletes your original. You then have ${LINK_MINUTES} minutes to download the archive version, and whatever is still in storage after that is wiped by the next daily sweep.`,
  ],

  useCases: [
    {
      title: "Depositing a thesis in a university repository",
      body: `Some repositories ask for PDF/A at deposit. Convert the final version here, then run the repository's own checker, or an independent validator such as veraPDF, before you submit: this tool checks only that its output is a PDF that declares ${PDF_A_STANDARD} and carries a colour profile, not that it conforms.`,
    },
    {
      title: "Records you must keep for years",
      body: "Board minutes and annual statements outlive the software that made them, and PDF/A requires every font to be embedded. Where your original only names a font without carrying it, Ghostscript uses one from its own set instead; on our secure server, NimbusSans was seen standing in for Helvetica. The notes do not report that swap, so compare the archive copy with the original page by page.",
    },
    {
      title: "An upload portal that insists on PDF/A",
      body: `When a submission system rejects a file for not being PDF/A, a pass through here is worth trying. If the portal names a different level, such as PDF/A-1b or PDF/A-3b, this tool will not match it, because every job targets ${PDF_A_STANDARD}.`,
    },
    {
      title: "Seeing what an archive copy would lose",
      body: "Read the notes before you replace an original. They hold only what Ghostscript chose to report, so if they name something you rely on, keep the source file next to the PDF/A copy.",
    },
  ],

  steps: [
    {
      title: "Check our server badge",
      body: "The badge at the top reads Secure server when conversion is available. Otherwise the panel says why and its Convert button stays off, so nothing is sent.",
    },
    {
      title: "Add one PDF",
      body: 'Drop it on the area reading "Add a PDF, or", or click browse. Its name replaces the drop area, with Remove beside it to swap files.',
    },
    {
      title: "Press Convert to PDF/A",
      body: "The button reads Uploading your file… while the PDF travels to our secure server, Waiting for our server… while the job is queued, Converting to PDF/A… while Ghostscript rewrites it, and Downloading the result… as the copy comes back. Our server first looks for a PDF header at the start and a %%EOF marker near the end; a file missing either, such as a download that stopped partway, is refused and nothing is produced.",
    },
    {
      title: "Read the notes, then download",
      body: `If Ghostscript reported anything, "What PDF/A could not keep" lists it above "Your PDF/A file is ready." The download button then names the copy: ${EXAMPLE_IN} comes back as ${EXAMPLE_OUT}.`,
    },
  ],

  faqs: [
    {
      q: "Will the converted file pass a PDF/A validator?",
      a: `It targets ${PDF_A_STANDARD}, but pdf.xyz runs no PDF/A validator. Before your file is returned, our server checks that it is not empty, that it has a PDF header and end-of-file marker, and that it declares ${PDF_A_STANDARD}: PDF/A identification part ${PDFA_EXPECTED_PART}, conformance ${PDFA_EXPECTED_CONFORMANCE} in its XMP metadata, plus an embedded colour profile (a ${PDFA_OUTPUT_INTENT_SUBTYPE} output intent). If either declaration is missing, no file is returned. A declaration is not proof of conformance, so the file carries no compliance guarantee; check it with the validator your archive uses. One oddity: Ghostscript's metadata notices say "PDF/A1" even though it runs with its PDF/A-2 setting. The notes show that wording unchanged, and we have not established why Ghostscript uses it.`,
    },
    {
      q: "Can I convert to PDF/A-1b, PDF/A-2u or PDF/A-3?",
      a: `No. The panel has no level picker and every conversion targets ${PDF_A_STANDARD}, so for any other level you need software that lets you choose it.`,
    },
    {
      q: 'What does "discarding DOCINFO" mean for my title or author?',
      a: "DOCINFO is the older dictionary where a PDF keeps its title, author, producer and similar fields. The notice means Ghostscript found a text string there that it cannot represent in PDF/A's XMP metadata, and that it discarded DOCINFO. It does not list which fields went, so if the title or author matters, open the copy's document properties and check.",
    },
    {
      q: "Does converting a scan to PDF/A make its text searchable?",
      a: "No. A scanned page stays a picture of text. Run it through OCR PDF first, which adds a searchable text layer, then convert that file and search the PDF/A copy to confirm the words survived. OCR also runs on our secure server, so the scan is uploaded for that step too.",
    },
    {
      q: "What about a PDF that asks for a password when opened?",
      a: "This panel has no field for a password, so Ghostscript is never given one. Remove the password first with Unlock PDF, which asks for the password that opens the file, then convert the unlocked copy. The PDF/A copy is written without encryption, which PDF/A does not allow in any case.",
    },
    {
      q: "How long is my PDF kept?",
      a: `Ghostscript works in a temporary folder on our secure server, and a cleanup step deletes that folder whether or not the conversion worked. The stored upload is deleted once the job ends, or held for a retry if the job hit a temporary error. Your PDF/A result can be fetched for ${LINK_MINUTES} minutes. After that its link returns an error, and the stored bytes go when the storage rule next runs on its daily cycle.`,
    },
  ],

  relatedGuides: ["how-to-make-a-scanned-pdf-searchable"],
};

export default content;
