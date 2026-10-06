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
    "Flatten PDF turns a fillable form's fields into ordinary page content. Text boxes, checkboxes, radio buttons, dropdowns, list boxes and push buttons stop being interactive, so a recipient can no longer retype, clear or untick an answer in their PDF reader. Signature fields are never flattened: an empty one stays open for signing, and a signed one stays a signature field. What gets drawn is the appearance each field has saved in the file. If the form is flagged for readers to redraw its fields (NeedAppearances), text boxes, dropdowns and list boxes are redrawn from their values first. Otherwise an out-of-date saved appearance is what gets locked in, so open the download and check it. A field with no saved appearance gets a plain one generated, with any text set in Helvetica.",
    `It runs in your browser with pdf-lib, with no upload: the PDF you pick is not sent to pdf.xyz. The file gate refuses anything over ${MAX_MB} MB. Pages are not turned into images: existing content is left alone, and each field's appearance is placed on top at the field's position as a PDF drawing object. A field that cannot be drawn is left exactly as it was and stays interactive, while the rest of the form is still flattened. That covers a field whose box is on no page of the PDF, one with no appearance to draw, and one whose value cannot be redrawn. The result lists each such field by name with the reason, and no field is ever half drawn. The copy downloads with "-flattened" added to its name, or "-resaved" if nothing in it was flattened.`,
    "Only AcroForm fields are flattened; comments, highlights, ink and optional-content layers stay as they are. pdf-lib cannot read Adobe XFA data. A dynamic XFA form, whose content lives only in XFA, is refused before anything is saved. A form that also has AcroForm fields loses its XFA layer, and those fields are flattened. Any answer that has to be redrawn with the form's built-in font is checked against the WinAnsi (Western European) character set first. That means a field with no saved appearance, or a text box, dropdown or list box on a form flagged for redrawing. A single character outside the set, such as Bengali or Chinese, stops the job, names up to eight of the offending characters, and produces no file. Do not flatten a digitally signed PDF that must stay verifiable. Its signature field is kept, but the whole file is rewritten, so the signature will no longer verify.",
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
      body: 'Press "Flatten form fields". The button reads "Flattening…" while pdf-lib draws the fields onto their pages and removes them from the form. If no fillable fields were found, the button reads "Re-save PDF" instead.',
    },
    {
      title: "Download the locked copy",
      body: 'The result, titled "Form fields flattened", shows how many fields were flattened and the new file size. If some fields were left alone, it reads like "Flattened 3 of 4 form fields" and lists them under "Left as-is, still interactive" with the reason for each. Press "Download flattened PDF" to save it with "-flattened" in the name. If nothing was flattened, the result is titled "PDF re-saved", the button reads "Download PDF", and the copy is named with "-resaved" instead.',
    },
  ],

  faqs: [
    {
      q: "Is my PDF uploaded when I flatten it?",
      a: "No. Reading the form, flattening it and saving the new file all happen in your browser tab. The page has to load from pdf.xyz first, but the document you choose stays on your device.",
    },
    {
      q: "Can someone still change the answers after flattening?",
      a: `Not through the fields that were flattened: they are removed from the form. Signature fields are kept, and any field the result lists under "Left as-is, still interactive" is still live. It is not a lock on the file, though, and a full PDF editor can still alter page content. To make the copy open only with a password, use Protect PDF next. Unlike this tool it does not stay in your browser: Protect PDF encrypts on pdf.xyz's secure worker, reached over TLS, which deletes the uploaded input when the job finishes; the protected copy's link lasts ${PROTECT_LINK_MINUTES} minutes.`,
    },
    {
      q: "Does it flatten comments, annotations and layers too?",
      a: "No. Only fillable AcroForm fields are flattened: their widgets are removed from each page and their appearances drawn in. Sticky notes, highlights, ink markup and optional-content layers stay in the file as annotations and layers.",
    },
    {
      q: 'Why does it say "No fillable AcroForm fields were detected"?',
      a: "The form may only look fillable: lines and boxes printed on the page, or a scan, have no fields behind them. Running the tool anyway just re-saves the file; Edit PDF can place your answers as text on such a page instead. A PDF whose only fields are signature fields gets this note too, because signature fields are left as they are. A dynamic XFA form, whose fields exist only in Adobe's XFA layer, shows a different note. It is refused before anything is saved, with advice to open it in Adobe Acrobat Reader and print it to PDF.",
    },
    {
      q: "Why was a form with answers in Bengali, Chinese or Arabic refused?",
      a: "An answer that has to be redrawn with the form's built-in font must fit the WinAnsi character set, which covers English and other Western European languages. That applies to a field with no saved appearance, and to any text box, dropdown or list box on a form flagged for its reader to redraw fields (NeedAppearances). Any character outside the set stops the job, and the message lists the first eight with a count of any others. An answer whose saved appearance is drawn as it is is not checked. So a Bengali, Chinese or Arabic answer that the filling app already drew correctly flattens normally on a form without that flag. When a list box is redrawn, every option is checked, because its redrawn appearance lists them all. Labels printed on the page are never checked.",
    },
    {
      q: "Can I fill in the form and flatten it in one go?",
      a: 'Yes, if you fill it on pdf.xyz: Fill Forms has a "Flatten after filling" checkbox. If a form cannot be flattened there, the result is titled "Form filled — not flattened" and you get the filled copy with live fields. Bring that copy here: Flatten PDF handles one field at a time, so it can often flatten that copy, leaving any field it cannot draw live and listed. Use Flatten PDF for a form completed in another app too.',
    },
  ],

  relatedGuides: ["how-to-fill-out-a-pdf-form"],
};

export default content;
