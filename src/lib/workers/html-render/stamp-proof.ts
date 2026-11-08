/**
 * The deployment proof's verdict for Webpage to PDF's "Add the address and
 * date" (audit webpage-to-pdf#7), read from the PDF a person downloads.
 *
 * Two things change, and both are in the file:
 *
 *   1. Every page's foot carries `Captured from <url> on <d Month yyyy,
 *      hh:mm> UTC` (`./stamp`, `stampText`), the address the job asked for,
 *      at a time inside the window the proof ran in.
 *   2. The PDF has bookmarks built from the page's headings
 *      (`WEBPAGE_OUTLINE_PARAMS`), one of them the page's own h1.
 *
 * A worker older than the option ignores `stamp` and prints neither: a
 * valid PDF of the page, which `isPdf` and the plain webpage proof pass.
 *
 * Health: the page's own visible text must be in the PDF, so a blank or
 * wrong render cannot pass on a footer alone.
 *
 * Text is compared with whitespace removed and NFKC-normalised, like
 * `pageShowsText` (`@/lib/probes/webpage-proof`): an extractor splits "fi"
 * or reads it as a ligature, and the address of a guide has an "fi" in it.
 *
 * Pure (pdf-lib, text passed in), so the unit tests and
 * `scripts/worker-prove-tools.ts` ask the same question; the harness
 * extracts each page's text with pdfjs.
 */
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
} from "pdf-lib";

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";
const MONTH_LIST = MONTHS.split("|");

const squeeze = (text: string) => text.normalize("NFKC").replace(/\s+/g, "");

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every bookmark title in the file, depth first, bounded. Throws on a non-PDF. */
export async function outlineTitles(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const root = doc.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  const titles: string[] = [];
  const stack: PDFDict[] = [];
  const first = root?.lookupMaybe(PDFName.of("First"), PDFDict);
  if (first) stack.push(first);
  const seen = new Set<PDFDict>();
  while (stack.length > 0 && titles.length < 1000) {
    const item = stack.pop()!;
    if (seen.has(item)) continue;
    seen.add(item);
    const title = item.lookup(PDFName.of("Title"));
    if (title instanceof PDFString || title instanceof PDFHexString)
      titles.push(title.decodeText());
    const next = item.lookupMaybe(PDFName.of("Next"), PDFDict);
    if (next) stack.push(next);
    const child = item.lookupMaybe(PDFName.of("First"), PDFDict);
    if (child) stack.push(child);
  }
  return titles;
}

/**
 * The verdict. `url` is the address the job asked for, `visible` the text
 * the page's body shows (its h1), and `window` the times the stamp may
 * name: the proof's start (less a minute, the stamp has no seconds) to now.
 */
export async function stampProofVerdict(
  bytes: Uint8Array,
  pageTexts: readonly string[],
  want: { url: string; visible: string; window: { from: Date; to: Date } },
): Promise<{ ok: boolean; detail: string }> {
  const fail = (detail: string) => ({ ok: false, detail });
  let titles: string[];
  try {
    titles = await outlineTitles(bytes);
  } catch (error) {
    return fail(`the download could not be read: ${(error as Error).message}`);
  }
  if (pageTexts.length === 0) return fail("the PDF has no pages");
  const all = squeeze(pageTexts.join(" "));
  const visible = squeeze(want.visible);
  if (visible.length === 0 || !all.includes(visible))
    return fail(
      `the page's own text "${want.visible}" is not in the PDF, so a stamp alone would prove nothing`,
    );
  const line = new RegExp(
    `Capturedfrom${escapeRegExp(squeeze(want.url))}on(\\d{1,2})(${MONTHS})(\\d{4}),(\\d{2}):(\\d{2})UTC`,
  );
  const stamps = pageTexts.map((t) => line.exec(squeeze(t)));
  const missing = stamps.flatMap((m, i) => (m ? [] : [i + 1]));
  const summary = `${pageTexts.length} page(s), the stamp on ${pageTexts.length - missing.length}, ${titles.length} bookmark(s)`;
  if (missing.length > 0)
    return fail(
      `${summary}; page(s) ${missing.slice(0, 8).join(", ")} carry no "Captured from ${want.url} on … UTC" line`,
    );
  const from = Math.floor(want.window.from.getTime() / 60_000) * 60_000;
  const late = stamps.flatMap((m, i) => {
    const [, d, month, y, h, min] = m!;
    const at = Date.UTC(
      Number(y),
      MONTH_LIST.indexOf(month!),
      Number(d),
      Number(h),
      Number(min),
    );
    return at < from || at > want.window.to.getTime() ? [i + 1] : [];
  });
  if (late.length > 0)
    return fail(
      `${summary}; page(s) ${late.slice(0, 8).join(", ")} name a time outside the run (${want.window.from.toISOString()} to ${want.window.to.toISOString()})`,
    );
  if (!titles.some((t) => squeeze(t) === visible))
    return fail(
      `${summary}; no bookmark is the page's heading "${want.visible}"${titles.length ? ` (first: ${JSON.stringify(titles[0])})` : ""}`,
    );
  return {
    ok: true,
    detail: `${summary}: every page stamped with the address and a time inside the run, the h1 bookmarked`,
  };
}
