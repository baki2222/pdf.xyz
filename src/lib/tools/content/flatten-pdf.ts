import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";

// The byte ceiling the flatten runner's file gate (validatePdfFile) refuses
// above, read from the map that runner uses.
const MAX_MB = Math.round(RUNNER_FILE_CEILINGS.flatten / (1024 * 1024));
// Protect PDF (a worker tool) is mentioned in one answer; its download-link
// lifetime comes from the retention policy the worker applies.
const PROTECT_LINK_MINUTES = DEFAULT_RETENTION.outputTtlMinutes;

const content: ToolContent = {
  slug: "flatten-pdf",

  seoTitle: "Flatten PDF Forms — Lock Field Values, No Upload",

  metaDescription:
    "Flatten fillable PDF form fields so typed answers and ticked boxes become fixed page content. Runs in your browser; the PDF is not uploaded.",

  intro: [
    "Flatten PDF turns a fillable form's fields into ordinary page content. Text boxes, checkboxes, radio buttons, dropdowns and list boxes stop being interactive, so a recipient can no longer retype, clear or untick an answer in their PDF reader; push buttons and signature fields are flattened in the same pass. What gets drawn is the appearance each field already has saved in the file, not a fresh rendering of its value: if the app that filled the form left an appearance out of date, that is what is locked in, so open the download and check it. A field with no saved appearance gets a plain one generated, with any text set in Helvetica.",
    `It runs in your browser with pdf-lib, with no upload: the PDF you pick is not sent to pdf.xyz. The file gate refuses anything over ${MAX_MB} MB, and the copy downloads with "-flattened" added to its name. Pages are not turned into images: existing content is left alone, and each field's appearance is placed on top at the field's position as a PDF drawing object. If a field cannot be placed, for example a signature field with no saved appearance, the whole job stops with an error rather than handing you a half-flattened file.`,
    "Only AcroForm fields are flattened; comments, highlights, ink and optional-content layers stay as they are. pdf-lib cannot read Adobe XFA data and drops it from the saved copy, so a form built only in XFA has nothing here to flatten. Every text-field answer is also checked against the WinAnsi (Western European) character set first; a single character outside it, such as Bengali or Chinese, stops the job, names up to eight of the offending characters, and produces no file. Do not flatten a digitally signed PDF that must stay verifiable: its signature field is removed with the others and the whole file is rewritten.",
  ],

  useCases: [
    {
      title: "Sending back a completed application",
      body: "A filled-in visa, rental or enrolment form still has live fields when you email it. Flattened, it arrives with your answers fixed. Keep the fillable original in case you need to correct and resend it.",
    },
    {
      title: "Locking the answers before you sign",
      body: "Sign PDF draws your signature onto the page and leaves form fields alone, so the form's answers stay editable in a PDF reader. Flatten the completed form first, then sign the flattened copy: the signature is drawn last, on top, and no field appearance can end up covering it.",
    },
    {
      title: "Before merging filled copies of a form",
      body: "Merge PDF copies each file's pages but not its form, so how leftover fields behave in the merged file is up to the reader. Flatten each filled copy first and the answers travel as page content.",
    },
  ],

  steps: [
    {
      title: "Add the filled-in form",
      body: `Release the completed form over the box marked "Drop your PDF here, or browse"; clicking anywhere inside that box opens your file picker. It holds one form at a time, and the ceiling is ${MAX_MB} MB. Encrypted PDFs are turned away, even one that opens freely but restricts editing, with an error note telling you to unlock it first.`,
    },
    {
      title: "Check the detected fields",
      body: 'The "Detected form fields" panel reports how many fillable fields the document has, and warns you before you run anything if it finds none.',
    },
    {
      title: "Flatten the fields",
      body: 'Press "Flatten form fields". The button reads "Flattening…" while pdf-lib draws each field onto its page and removes it from the form.',
    },
    {
      title: "Download the locked copy",
      body: 'The result, titled "Form fields flattened", shows how many fields were flattened and the new file size. Press "Download flattened PDF" to save it. If the file had no fields, the result is titled "PDF re-saved" instead, though the button and the "-flattened" file name stay the same.',
    },
  ],

  faqs: [
    {
      q: "Is my PDF uploaded when I flatten it?",
      a: "No. Reading the form, flattening it and saving the new file all happen in your browser tab. The page has to load from pdf.xyz first, but the document you choose stays on your device.",
    },
    {
      q: "Can someone still change the answers after flattening?",
      a: `Not through the form: there are no fields left to click into. It is not a lock on the file, though, and a full PDF editor can still alter page content. To make the copy open only with a password, use Protect PDF next. Unlike this tool it does not stay in your browser: Protect PDF encrypts on pdf.xyz's secure worker, reached over TLS, which deletes the uploaded input when the job finishes; the protected copy's link lasts ${PROTECT_LINK_MINUTES} minutes.`,
    },
    {
      q: "Does it flatten comments, annotations and layers too?",
      a: "No. Only fillable AcroForm fields are flattened: their widgets are removed from each page and their appearances drawn in. Sticky notes, highlights, ink markup and optional-content layers stay in the file as annotations and layers.",
    },
    {
      q: 'Why does it say "No fillable AcroForm fields were detected"?',
      a: "The form may only look fillable: lines and boxes printed on the page, or a scan, have no fields behind them. An XFA-only form has no AcroForm fields either, and re-saving it here strips the XFA data. Running the tool anyway just re-saves the file; Edit PDF can place your answers as text on such a page instead.",
    },
    {
      q: "Why was a form with answers in Bengali, Chinese or Arabic refused?",
      a: "Text-field answers must fit the WinAnsi character set, which covers English and other Western European languages; any character outside it stops the job, and the message lists the first eight with a count of any others. The check is cautious and refuses even when the file already holds a correct picture of that answer. Labels printed on the page are never checked. Dropdown and list-box choices are not checked either; one outside the set that has no saved appearance fails at the flattening step with a general error instead.",
    },
    {
      q: "Can I fill in the form and flatten it in one go?",
      a: 'Yes, if you fill it on pdf.xyz: Fill Forms has a "Flatten after filling" checkbox. If a form cannot be flattened there, you get the filled copy with live fields, and its summary does not say "flattened". Use Flatten PDF for a form completed in another app.',
    },
  ],

  relatedGuides: ["how-to-fill-out-a-pdf-form"],
};

export default content;
