import type { ToolContent } from "./types";
import {
  ANNOTATION_GROUPS,
  annotationGroup,
} from "@/lib/pdf/annotation-groups";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import { getRunnerKind } from "@/lib/pdf/registry";

// The byte ceiling of the runner kind this tool mounts (`metadata`), read
// through the registry, so a move to another kind moves the number.
const MAX_MB = Math.round(
  RUNNER_FILE_CEILINGS[getRunnerKind("remove-annotations")!] / (1024 * 1024),
);

const lower = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);
const list = (labels: readonly string[]) =>
  labels.length <= 2
    ? labels.join(" and ")
    : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;

// Every group, its default and its consequence come from the table the
// panel draws (`annotation-groups.ts`).
const ALL_GROUPS = list(ANNOTATION_GROUPS.map((g) => lower(g.label)));
const ON = ANNOTATION_GROUPS.filter((g) => g.defaultOn).map((g) =>
  lower(g.label),
);
const OFF = ANNOTATION_GROUPS.filter((g) => !g.defaultOn).map((g) =>
  lower(g.label),
);
const FORM_FIELDS = annotationGroup("form-fields");
const REDACTION = annotationGroup("redaction-marks");

const content: ToolContent = {
  slug: "remove-annotations",

  seoTitle: "Remove PDF Annotations — Comments & Highlights",

  metaDescription:
    "Delete comments, highlights, drawings, stamps, attachments, links or form fields from a PDF, kind by kind — removed from the file, not hidden. No upload.",

  intro: [
    `Annotations are what reviewers and PDF apps add on top of a page: sticky notes and their replies, highlights, freehand ink, stamps, attached files, links and form fields. Remove Annotations opens a PDF, lists what it carries by kind with a count for each — ${ALL_GROUPS} — and saves a copy without the kinds you tick. The page text and images under them are not touched.`,
    `It runs in your browser with pdf-lib, so the PDF you pick is not uploaded. The file gate refuses PDFs over ${MAX_MB} MB, and encrypted PDFs are turned away with a note to unlock them first. Removed means removed from the file, not hidden: an annotation's text, the appearance a reader draws for it, its pop-up window and the replies to it are deleted, and so is a file attached only through a removed attachment pin. The one exception is something a kept part of the file still uses, such as a picture a kept page also draws; it stays so that page still shows. Signature fields are never removed, whatever you tick, but the copy is a rewritten file, so a digital signature in the original no longer verifies in it.`,
    `It is not Flatten PDF. Flatten PDF draws a filled form's answers into the page and then removes the fields, and leaves comments as they are. Remove Annotations draws nothing: a removed form field takes its value with it. To keep a form's answers and delete everything else, flatten the form first, then remove the comments here.`,
  ],

  useCases: [
    {
      title: "Sending a clean copy after review",
      body: "A contract or report comes back covered in reviewers' notes and highlights. Remove the comments and markup and send the clean copy, keeping the marked-up original for your records.",
    },
    {
      title: "Taking reviewers' names out of a file",
      body: "Every comment carries its author's name, and the text of each note stays in the file even where a reader hides it. Removing the comments deletes both, along with the replies under them.",
    },
    {
      title: "Dropping attached files before sharing",
      body: "A PDF can carry other files pinned to its pages. Remove the attachments and the copy no longer contains those files, unless the PDF also lists one as an attachment of its own, which the result tells you.",
    },
    {
      title: "A blank form from a filled one",
      body: `Remove only Form fields to get a copy with no fillable fields and none of the values typed into them. ${FORM_FIELDS.consequence}`,
    },
  ],

  steps: [
    {
      title: "Open the PDF",
      body: `Drop the PDF on the box or browse for it; it takes one file at a time, up to ${MAX_MB} MB. Its annotations are read on your device and listed under “Annotations to remove”, each kind with its count and a line saying what removing it does.`,
    },
    {
      title: "Choose the kinds to remove",
      body: `Tick or untick each kind. ${list(ON).charAt(0).toUpperCase()}${list(ON).slice(1)} start ticked; ${list(OFF)} start unticked. Under “By page”, each page lists how many annotations go from it.`,
    },
    {
      title: "Remove and download",
      body: `The button says how many annotations will go; press it. When it finishes, the result, titled “Annotations removed”, lists each kind with how many were removed and how many kept, counted from the saved copy. Press “Download PDF” to save it with -annotations-removed added to its name.`,
    },
  ],

  faqs: [
    {
      q: "Is my PDF uploaded to remove its annotations?",
      a: "No. The file is read, changed and saved in your browser tab. The page loads from pdf.xyz, but the PDF you pick is not sent to us.",
    },
    {
      q: "Are the annotations really gone, or just hidden?",
      a: "Gone from the saved file. Each removed annotation is deleted with its text, its author's name, the appearance a reader draws for it, its pop-up window and any replies, and a file attached only through a removed pin is deleted too. A file the PDF also lists as an attachment of its own is not, and the result says how many such files are still in the copy. Something a kept part of the file still uses, such as a picture a kept page also draws, stays so that page still shows.",
    },
    {
      q: "How is this different from Flatten PDF?",
      a: "Flatten PDF works on form fields only: it draws each field's answer into the page and then removes the field, and it leaves comments, highlights and other annotations as they are. Remove Annotations deletes the kinds you tick and draws nothing in their place, so a removed form field's answer is gone. Flatten first if you want to keep the answers.",
    },
    {
      q: "What does it not remove?",
      a: `Signature fields, ever. Marks that are part of the page itself rather than annotations, such as a scanned handwritten note or a highlight an app drew into the page, are page content and stay; use Redact PDF or Edit PDF for those. ${REDACTION.consequence} In a tagged PDF, the structure entry that pointed at a removed annotation is left pointing at nothing, which readers treat as empty.`,
    },
    {
      q: "Can I remove one comment or one link instead of a whole kind?",
      a: "Not here: it removes every annotation of each kind you tick, on every page. To delete a single link, open the PDF in Edit PDF, where links already in the file are outlined and can be deleted one by one.",
    },
  ],

  relatedGuides: [],
};

export default content;
