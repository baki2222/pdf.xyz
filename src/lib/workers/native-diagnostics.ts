/**
 * Turning a native binary's chatter into lines that are safe to show a user.
 *
 * Two tools now need this and the logic is identical, so it lives once. qpdf
 * reports a recovered document on exit 3 and says what it reconstructed;
 * Ghostscript's PDF/A conversion **deletes** what PDF/A cannot represent and
 * announces each deletion on stdout/stderr while exiting 0. In both cases the
 * process's prose is the only record of what happened to the document, and in
 * both cases we were discarding it.
 *
 * TWO RULES, AND THEY PULL AGAINST EACH OTHER.
 *
 * The binary names the file it is talking about, and that name is OUR temp path.
 * So: known paths are removed first, and any line that STILL holds a path
 * separator is dropped **whole** — a half-scrubbed path is still a leak, and
 * partial redaction is how one survives.
 *
 * But a list that quietly shrinks reads as "nothing happened", which is the
 * opposite of what it means. So every dropped or overflowing line is COUNTED and
 * the count is reported.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: parse. These are prose messages from
 * third-party binaries, and they change between versions — the worker's
 * Ghostscript is 10.00.0 today and will not be forever. A classifier that
 * silently stops matching after an upgrade is the same defect one level up: a
 * measuring instrument that reports "nothing" when it means "I no longer
 * understand". The text goes through as text.
 */
import { looksLikePath } from "@/lib/jobs/tool-notes";

/**
 * Max lines handed to a caller. Everything beyond is counted, not dropped
 * silently.
 *
 * RE-EXAMINED 2026-08-11, because it was sized against a stream that was mostly
 * boilerplate. Ghostscript now runs with `-dQUIET` and qpdf only speaks when
 * something is wrong, so what reaches here is notices, and identical lines are
 * de-duplicated before the bound applies — a document that trips one condition
 * on every page produces ONE line, not one per page.
 *
 * What ten still protects: a pathological document tripping many DISTINCT
 * conditions. It bounds what is persisted onto a job record and what a panel
 * renders, at roughly 2 KB worst case. It should now be far from binding, and
 * if it ever does bind, the overflow count says so rather than the list
 * quietly ending.
 */
export const MAX_DIAGNOSTIC_LINES = 10;
/** Each surviving line is clipped to this many characters. */
export const MAX_DIAGNOSTIC_CHARS = 200;

/**
 * Does this line still contain something shaped like a filesystem path?
 *
 * TWO RULES SHIPPED HERE AND BOTH DELETED REAL DIAGNOSTICS. The history is the
 * documentation, because the next plausible-looking regex will be wrong too:
 *
 *  1. "contains a slash" (#90) deleted the Ghostscript notice it was written
 *     for — `PDF/A1` has a slash inside a word.
 *  2. Adding `(^|\s)\/\S` — start-of-line-or-space, slash, non-space — deleted
 *     ALL NINE structural qpdf diagnostics, because **that is exactly the shape
 *     of a PDF name object**: ` /Root`, `/Encrypt`, ` /Type`. It fixed the case
 *     it was written for and deleted the case that dominates. Structural
 *     diagnostics are the entire domain of `repair-pdf`; that was not an edge.
 *
 * THE RULE ITSELF LIVES IN `@/lib/jobs/tool-notes` and is imported, not copied.
 * It was briefly defined in both places, described as deliberate duplication for
 * defence in depth. The depth is real and is kept — both boundaries call it —
 * but duplicating the implementation cost the entire fix for one commit: this
 * copy was corrected and the persistence copy was not, so the worker passed all
 * nine structural diagnostics and the job record dropped all nine. Read the
 * forced trade (`/Root` and `/etc` are the same shape) at the definition.
 *
 * NOT REVIEWED BY READING. `native-diagnostics.corpus.ts` holds the real
 * captured qpdf and Ghostscript output, and the test beside it runs every line
 * through this rule and prints a verdict. Any change gets executed against that
 * corpus first.
 *
 * ONE COST IS THIS FILE'S OWN, because it is created by the argv rather than the
 * rule: a font-substitution notice names a path inside the Ghostscript install,
 * so the rule drops and counts it. Since `-dQUIET` was added to the PDF/A argv
 * that line is not emitted at all, so for PDF/A it is now unobservable rather
 * than merely unshown. Font substitution is a real change to a document, so this
 * is a genuine reduction in what we can tell a user, recorded as a known gap:
 * recovering it would mean running gs loudly and filtering the boilerplate back
 * out — the classifier this file argues against.
 */

/**
 * Tidy what path removal leaves behind.
 *
 * Stripping `/tmp/pdfxyz-pdfa-ab12/input.pdf` out of
 * `WARNING: /tmp/…/input.pdf: file is damaged` leaves `WARNING: : file is
 * damaged` — observed on production, 2026-08-11. The orphaned punctuation is not
 * a lie, but it is read by someone who has just watched a file break, and it
 * looks like the tool is malfunctioning at the moment it is trying to be honest.
 */
function tidy(line: string): string {
  return line
    .replace(/\s{2,}/g, " ")
    .replace(/:\s*(?=:)/g, "")
    .replace(/:\s*:/g, ":")
    .replace(/^[\s:,-]+/, "")
    .trim();
}

/**
 * Sanitize a native tool's captured output into user-safe lines.
 *
 * `paths` are the temp paths this run created; they are removed longest-first so
 * `<dir>/input.pdf` goes before `<dir>`. `stripPrefix` removes a tool's own
 * name-tag (`qpdf: `) where it adds nothing.
 */
export function sanitizeNativeDiagnostics(
  raw: string,
  paths: readonly string[],
  stripPrefix?: RegExp,
): string[] {
  const stripped = raw.split(/\r?\n/).map((line) => {
    let out = line;
    for (const p of [...paths].sort((a, b) => b.length - a.length)) {
      if (p) out = out.split(p).join("");
    }
    if (stripPrefix) out = out.replace(stripPrefix, "");
    return tidy(out);
  });

  const kept: string[] = [];
  let withheld = 0;
  for (const line of stripped) {
    if (line.length === 0) continue;
    if (looksLikePath(line)) {
      withheld += 1;
      continue;
    }
    const clipped = line.slice(0, MAX_DIAGNOSTIC_CHARS);
    // Native tools repeat the same message once per offending object; the user
    // needs to know it happened, not how many objects were involved.
    if (!kept.includes(clipped)) kept.push(clipped);
  }

  const overflow = Math.max(0, kept.length - MAX_DIAGNOSTIC_LINES);
  const result = kept.slice(0, MAX_DIAGNOSTIC_LINES);
  const unreported = withheld + overflow;
  if (unreported > 0) {
    result.push(`${unreported} further message(s) not shown.`);
  }
  return result;
}
