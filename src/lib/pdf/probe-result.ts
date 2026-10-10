/**
 * What the file probe (`./probe`) reports, apart from the probe itself — so
 * a consumer that only READS findings (the suggestion ranking, a page that
 * renders them) never loads the module that parses PDFs.
 */

/** Which lock a PDF carries, as a viewer meets it. */
export type PdfLock = "none" | "restricted" | "password-required" | "unknown";

/** What a sampled page draws. */
export type PageContent = "text" | "image-only" | "blank" | "unknown";

export interface PdfProbe {
  /** Whether the bytes were read: over the caller's ceiling, or not a PDF. */
  readonly read: "ok" | "too-large" | "unreadable";
  readonly lock: PdfLock;
  /** Page count, or null when it could not be established. */
  readonly pages: number | null;
  /** AcroForm fields, or null when they could not be read (or it is locked). */
  readonly formFields: number | null;
  /** Pages 1…min(samplePages, pages), in order; empty when none were read. */
  readonly sample: readonly PageContent[];
}

/**
 * The pages the claim may name: every sampled page image-only, so "No
 * selectable text on pages 1–3" — or null, when any page is anything else.
 */
export function imageOnlyRange(
  probe: Pick<PdfProbe, "sample">,
): { from: number; to: number } | null {
  if (probe.sample.length === 0) return null;
  return probe.sample.every((page) => page === "image-only")
    ? { from: 1, to: probe.sample.length }
    : null;
}
