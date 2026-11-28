/**
 * The attached-file formats "Remove text under boxes" can check for chosen
 * text: those whose raw text IS their content, so a plain search of the
 * bytes is a search of what a reader sees. Any other attachment can spell a
 * name another way (an HTML or XML entity, a JSON escape, a base64 e-mail
 * body, an RTF control word) and is refused as one that cannot be checked
 * (review 2026-11-28; redact-attachments.test.ts). One list, read by the
 * engine (redact-remove.ts), its refusal sentence and the page copy
 * (content/redact-pdf.ts), so the copy cannot name a format the check does
 * not take.
 */
export const PLAIN_TEXT_ATTACHMENT_EXTENSIONS = ["txt", "csv", "tsv"] as const;

export const PLAIN_TEXT_ATTACHMENT_TYPES = [
  "text/plain",
  "text/csv",
  "text/tab-separated-values",
] as const;

/** ".txt, .csv and .tsv" (or "or" with `joiner`). */
export function plainTextAttachmentList(joiner: "and" | "or"): string {
  const names = PLAIN_TEXT_ATTACHMENT_EXTENSIONS.map((e) => `.${e}`);
  return `${names.slice(0, -1).join(", ")} ${joiner} ${names.at(-1)}`;
}
