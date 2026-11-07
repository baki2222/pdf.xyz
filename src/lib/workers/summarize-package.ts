/**
 * Reading a Summarize PDF package back in the browser, so the panel can SHOW
 * the summary instead of handing over only a ZIP.
 *
 * The worker writes the package (`./summarize/engine.ts` buildPackage) with
 * these entry names, imported from here, so a rename on either side moves both.
 * The bytes are already in the page — `runSecurityJob` fetches the artifact as
 * soon as the job completes — so reading them locally sends nothing anywhere.
 *
 * JSZip is imported lazily: the panel itself is a lazily loaded chunk, and the
 * reader is fetched only once a summary has actually arrived.
 */

export const SUMMARY_PACKAGE_FILES = {
  /** The summary with its provenance header (Markdown). */
  markdown: "summary.md",
  /** The model's summary exactly as written, nothing added. */
  text: "summary.txt",
} as const;

export interface SummaryReadBack {
  /** `summary.txt`: what the panel shows and Copy puts on the clipboard. */
  text: string;
  /** `summary.md`: the Markdown download, header and disclosures included. */
  markdown: string;
}

/**
 * Both entries, or `null` when the bytes are not a package of this shape (a
 * damaged download, a different archive, an empty summary). `null` means
 * "show the ZIP only", never "show nothing and claim a summary".
 */
export async function readSummaryFromPackage(
  output: Uint8Array,
): Promise<SummaryReadBack | null> {
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(output);
    const textEntry = zip.file(SUMMARY_PACKAGE_FILES.text);
    const markdownEntry = zip.file(SUMMARY_PACKAGE_FILES.markdown);
    if (!textEntry || !markdownEntry) return null;
    const [text, markdown] = await Promise.all([
      textEntry.async("string"),
      markdownEntry.async("string"),
    ]);
    if (text.trim().length === 0) return null;
    return { text, markdown };
  } catch {
    return null;
  }
}

/**
 * The single-file download name, from the ZIP's: `report-summary.zip` becomes
 * `report-summary.txt` / `report-summary.md`.
 */
export function summaryFileName(zipName: string, ext: "txt" | "md"): string {
  const stem = zipName.replace(/\.zip$/i, "") || "summary";
  return `${stem}.${ext}`;
}
