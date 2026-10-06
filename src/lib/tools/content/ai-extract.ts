import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { aiReadLimitFor } from "@/lib/jobs/ai-read-limit";
import {
  EXTRACTION_FIELD_TYPES,
  MAX_EXTRACTION_FIELDS,
  MAX_EXTRACTION_PROMPT_CHARS,
  MAX_FIELD_NAME_CHARS,
  extractionOutputName,
} from "@/lib/jobs/ai-extract";
import {
  AI_ALLOWANCE_CLAUSE,
  AI_PER_CALL_RUNS_PER_DAY_AT_LEAST,
  AI_PER_CALL_RUN_CEILING,
} from "@/lib/jobs/ai-allowance";
import { WORKER_FILE_CEILING } from "@/lib/tools/file-ceilings";

/*
 * Behaviour claims below were read from the implementation on 2026-09-27:
 *  - src/components/tools/ai-extract-worker-panel.tsx — the builder only mounts
 *    when the worker reports an AI provider; one PDF per run ("Add your PDF, or"
 *    + "browse" drop zone, "Remove"); the "Field schema" (default) / "Prompt"
 *    toggle; "Fields to extract" rows = name input + type select + a bin icon
 *    (aria-label "Remove field", a no-op on the last row) + "Add field"; the
 *    "What to extract" textarea; the "Extract data" button ("Extracting…" while
 *    busy), aria-disabled until a file AND, for the selected mode, a named field
 *    or prompt text exist; rows with a blank name are dropped.
 *    The result is fetched into the page BEFORE the "Download <file>" button
 *    appears (runSecurityJob downloads artifact.url, the button calls
 *    downloadBytes on those bytes) — so it is the worker's link that lapses,
 *    not the button. The UI has NO field-description input, even though the job
 *    contract accepts one, so none is described here.
 *  - src/lib/jobs/ai-extract.ts — field names must be unique ignoring case; this
 *    is checked by the worker's processor (parseExtractOptions), i.e. after the
 *    upload, not by the panel.
 *  - src/lib/workers/ai-extract/engine.ts — selectable text only (a text-less
 *    PDF is refused as `no_text`, pointing at OCR PDF); the system prompt TELLS
 *    the model to use the names verbatim as keys and to answer null when a value
 *    is absent (instructions, not guarantees, so the copy says "told"); prompt
 *    mode asks for "a flat JSON object with clear, descriptive keys"; the
 *    shipped extraction.json is the model's JSON parsed and re-serialised; input
 *    over the character cap is cut from the end; ZIP = extraction.json +
 *    extraction.md + manifest.json + README.txt. No CSV is written. extraction.md
 *    is a Field | Value table built from the keys the reply HAS (a key the model
 *    omitted is simply absent), null shown as "_(not found)_", or a numbered
 *    list for an array.
 *  - src/lib/workers/processor/ai-extract.ts + executor/executor.ts — a
 *    non-JSON reply is `internal_error`, retryable, and the executor REQUEUES a
 *    retryable failure while attempts remain; only the last attempt's failure
 *    reaches the page (job.error.message, "Retrying may succeed.").
 *  - src/lib/workers/ai/truncation.ts — userTruncationNotice names "pages 1–N"
 *    only when a whole page was read and the page table indexes the text;
 *    otherwise it says "the first part of this N-page document".
 *  - src/lib/workers/ai-extract/native.ts — the cap is AI_INPUT_LIMITS, applied
 *    to pdftotext -layout output (collapsed padding, newlines kept).
 *  - DELIBERATELY NOT QUOTED: a page range for the character cap.
 *    aiPagesAtDensest/aiPagesAtSparsest were measured through the browser's
 *    pdfjs extractor; the worker counts pdftotext -layout characters, which run
 *    higher on columned or widely spaced pages (see summarize-pdf.ts).
 *  - src/app/api/jobs/route.ts — every "ai" tool is charged the daily character
 *    allowance at job creation; the panel declares its document's characters
 *    (countDeclaredCharacters) and the route prices the run with
 *    aiReservationFor, never above one whole run. A PDF with no text has no
 *    count to declare, goes undeclared, and is charged a whole run before the
 *    worker refuses it — which the FAQ says. The spend-ceiling check runs
 *    first.
 *  - src/app/privacy/page.tsx §3 — text, not the PDF file, goes to a
 *    third-party AI provider; "We use providers under agreements that prohibit
 *    training on data sent through the API. We cannot control what a provider
 *    does beyond those terms". The training sentence cannot be checked from
 *    code; it is quoted from that page, not asserted independently.
 *  - src/lib/workers/table-extract/engine.ts — Extract Tables writes
 *    table-N.csv per table plus tables.xlsx.
 * Every number is interpolated from the constant that owns it.
 */

/** The per-file cap a worker-tier upload is refused above, in whole MB. */
const CEILING_MB = Math.round(WORKER_FILE_CEILING / (1024 * 1024));
const OUTPUT_TTL = DEFAULT_RETENTION.outputTtlMinutes;
/** What one run reads: the figure the FAQ and the panel's Limit row state too. */
const MAX_CHARS = aiReadLimitFor("ai-extract").toLocaleString("en-US");
const PROMPT_CHARS = MAX_EXTRACTION_PROMPT_CHARS.toLocaleString("en-US");
/** The field types exactly as the select lists them. */
const FIELD_TYPES = new Intl.ListFormat("en", { type: "disjunction" }).format(
  EXTRACTION_FIELD_TYPES,
);
/** What the download button is labelled for a file called invoice.pdf. */
const SAMPLE_ZIP = extractionOutputName("invoice.pdf");

/**
 * What one extraction can cost, stated only as far as it is true on EVERY worker
 * image (the ruling `aiAllowanceFactFor` records): never more than one whole
 * run, `AI_PER_CALL_RUN_CEILING` in the published unit, so at least
 * `AI_PER_CALL_RUNS_PER_DAY_AT_LEAST` fit in a day. A shorter document costs
 * less only on a worker that has proved its read cap (`aiReservationFor`), so
 * the page does not promise that.
 *
 * WAS a flat charge computed here with `deliveryCapFor({}, …)` ("each run is charged a flat 10,258 characters … 3 extractions a day"),
 * written before per-call pricing: the panel declares its document's
 * characters, and the route prices through `aiReservationFor`. True of an
 * unproven worker only. `tools/ai-allowance-per-tool.test.ts` now reads every
 * sentence the page SERVES for that claim, not only the fact line.
 */
const RUN_CEILING = AI_PER_CALL_RUN_CEILING.toLocaleString("en-US");
const EXTRACTIONS_PHRASE = `${AI_PER_CALL_RUNS_PER_DAY_AT_LEAST} ${AI_PER_CALL_RUNS_PER_DAY_AT_LEAST === 1 ? "extraction" : "extractions"}`;
const EXTRACTIONS_PHRASE_FIT =
  AI_PER_CALL_RUNS_PER_DAY_AT_LEAST === 1 ? "fits" : "fit";

const content: ToolContent = {
  slug: "ai-extract",

  seoTitle: "AI Data Extraction: PDF Fields to JSON",

  metaDescription: `Pull invoice numbers, dates, totals or any field you name out of a PDF's text into JSON. Up to ${MAX_EXTRACTION_FIELDS} typed fields, or a plain prompt.`,

  intro: [
    `AI Data Extraction asks an AI model for just the values you name in a PDF, such as an invoice number, a due date or a list of product codes, and hands them back as JSON. In a field schema you list up to ${MAX_EXTRACTION_FIELDS} named fields, each typed as ${FIELD_TYPES}, and the model is told to use each name, unchanged, as a key in its answer. Alternatively, write an instruction of up to ${PROMPT_CHARS} characters in your own words; the model is then asked for a flat JSON object and chooses descriptive key names itself.`,
    `Your browser sends the file over TLS to pdf.xyz's secure worker. The worker reads out its text layer and passes that text, with your field list or instruction, to a third-party AI provider. The provider gets text only, never the PDF. When the job ends the worker deletes the uploaded file; the extraction package stays downloadable for ${OUTPUT_TTL} minutes, and once that window closes a daily storage rule sweeps the stored copy away.`,
    `Per run the builder accepts one PDF, capped at ${CEILING_MB} MB. Of its text, the model sees no more than ${MAX_CHARS} characters, and that count includes the spaces and line breaks the worker's text reader keeps to mirror the page layout, so how many pages fit depends on how the pages are set; a long file's result states how far reading got. The model's instructions are to use only that text and to answer null for whatever it cannot find; pdf.xyz parses the reply and re-indents it without adding a value of its own. Instructions are not guarantees, so check any figure you will act on.`,
  ],

  useCases: [
    {
      title: "Key invoices into accounts payable",
      body: "A schema of invoice_number (string), invoice_date (date), vendor (string) and total (number) asks every supplier's invoice for the same four keys, one PDF per run, so a script or an import can read the results side by side.",
    },
    {
      title: "Pull a contract's commercial terms",
      body: "Switch to Prompt and ask for the parties, the effective date, the notice period for termination and the governing law.",
    },
    {
      title: "Check whether a clause is there at all",
      body: "A boolean field such as auto_renewal puts a yes-or-no question to the text. Because the model is told to use null when the text is silent, a null reads as not found in the pages it saw, which is weaker than a confirmed no.",
    },
    {
      title: "Collect a list from a long report",
      body: "Give a field the array type to gather every part number or attendee name into one list. For data that lives in rows and columns, Extract Tables is the better fit.",
    },
  ],

  steps: [
    {
      title: "Add one PDF",
      body: "Drop the file onto the box labelled Add your PDF, or click browse. It needs selectable text, and pressing Remove lets you pick a different file.",
    },
    {
      title: "Pick Field schema or Prompt",
      body: `Field schema is selected at first. Under Fields to extract, type a name of up to ${MAX_FIELD_NAME_CHARS} characters, set its type in the drop-down, and use Add field for more rows, up to ${MAX_EXTRACTION_FIELDS}; the bin icon deletes a row, except the last one left. Rows left blank are skipped. The page does not check for repeats, but the worker rejects the job when two names match, even if only their capital letters differ. Choose Prompt to type into the What to extract box instead.`,
    },
    {
      title: "Press Extract data",
      body: "The button stays inactive until a file is added and the selected mode has something to ask: at least one named field under Field schema, or some text under Prompt. Once pressed, it shows Extracting… while the PDF uploads, its text goes to the AI provider and the reply is packaged.",
    },
    {
      title: "Download the extraction package",
      body: `For invoice.pdf the button reads Download ${SAMPLE_ZIP}. When only part of a long document was read, a warning above it says so, naming the last page read in full when that can be worked out. The page has already fetched the file by then; the worker's own link to it lapses after ${OUTPUT_TTL} minutes.`,
    },
  ],

  faqs: [
    {
      q: "Can it extract data from a scanned PDF or an image?",
      a: "Not by itself. Only characters stored as text in the PDF are read, so a scan or a photo with no text layer ends in an error that suggests OCR PDF. Make the file searchable with OCR PDF, then run the extraction on that output.",
    },
    {
      q: "What is inside the ZIP I download, and can I get CSV or Excel?",
      a: "extraction.json is the model's JSON reply. extraction.md lays it out as a Field and Value table (or a numbered list, if the reply is a list), shows null values as not found, and leaves out any field the model dropped from its reply altogether. manifest.json records the provider, the model, your prompt or schema, the page and character counts and any cut; README.txt describes the package. There is no CSV or spreadsheet in it. For data laid out in rows and columns, Extract Tables writes one CSV per table plus an Excel workbook.",
    },
    {
      q: "Is my document sent to an AI company, and is it used for training?",
      a: "The provider receives the text the worker read from your PDF plus your field names or instruction, not the file. On training, pdf.xyz can speak only to its contracts, and the agreements it uses its AI providers under prohibit training on data sent through the API. Anything a provider does outside those terms is out of pdf.xyz's hands, so keep documents that cannot bear that risk away from the AI tools.",
    },
    {
      q: "How many extractions can I run a day?",
      a: `Every AI tool on pdf.xyz spends from one pool per connection, ${AI_ALLOWANCE_CLAUSE}. One extraction never costs more than ${RUN_CEILING} characters of that pool, whether the PDF is one page or hundreds, so at least ${EXTRACTIONS_PHRASE} ${EXTRACTIONS_PHRASE_FIT} in a day if no other AI job has used the pool. It is deducted at submission, once the upload is done and before the worker opens the file, so a scan that is turned away still costs a run. And when pdf.xyz's own daily spending cap for AI is reached, every AI tool pauses until the next day, however much of the free allowance is left.`,
    },
    {
      q: "What happens with a very long PDF?",
      a: `Text past the first ${MAX_CHARS} characters is dropped before the model sees it. The warning on the page, the manifest and extraction.md name the last page read in full whenever that can be worked out. A field reported as not found may still appear further on. Extract Pages can cut the file down to the pages that matter before you start.`,
    },
    {
      q: "Why did my extraction fail or come back with wrong values?",
      a: "When the model's reply is not valid JSON, the worker can put the job back in its queue for another attempt by itself. Once the attempts run out, the job fails with nothing to download and a message saying a retry may succeed. A wrong value comes from the model's reply or from the text it was given: an OCR layer with misread characters, or side-by-side columns read across as one line, can mislead it. Compare the value with the page, and when a page holds several similar figures, name the exact one you want in a prompt or in a descriptive field name.",
    },
  ],

  relatedGuides: ["how-to-make-a-scanned-pdf-searchable"],
};

export default content;
