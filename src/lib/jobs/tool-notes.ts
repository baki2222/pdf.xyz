/**
 * The persistence boundary for anything a native binary said about a document.
 *
 * Two tools report this now — `repair-pdf` (what qpdf reconstructed) and
 * `pdf-to-pdfa` (what Ghostscript deleted) — and the bounding rules are the same
 * for both, so they live once.
 *
 * The path check here is DELIBERATELY DUPLICATED from the worker's sanitizer.
 * That one runs where the temp paths are known and can be removed precisely;
 * this one is the boundary that never trusts its caller. It fails CLOSED — a
 * line still carrying a path is dropped whole, because a half-scrubbed path is
 * still a leak — and it COUNTS what it dropped, because a list that quietly
 * shrinks reads as "nothing happened", which is the opposite of what it means.
 */

/** Max lines persisted onto a job record. */
export const MAX_TOOL_NOTES = 10;
/** Max characters kept per line. */
export const MAX_TOOL_NOTE_CHARS = 200;

/**
 * Whether a line still looks like a filesystem path.
 *
 * THE SINGLE DEFINITION. It lives in `jobs/` because that is the lower layer —
 * `workers/native-diagnostics.ts` imports it, never the reverse.
 *
 * It was duplicated here for one commit, with a comment calling the duplication
 * deliberate: two trust boundaries, one in the worker where the temp paths are
 * known and one at persistence which trusts nobody. **The defence in depth is
 * real and is kept** — both boundaries still call this. Duplicating the
 * IMPLEMENTATION was the mistake, and it was not theoretical. The worker copy
 * was corrected to the two-separator rule and this one was not, so for one
 * commit the worker passed all nine structural qpdf diagnostics through and this
 * boundary dropped all nine. Measured end to end through the real chain:
 * *fed in 9, survived the worker 9, survived persistence 0* — the user would
 * have seen "9 further message(s) not shown." The fix was inert and nothing
 * said so.
 *
 * THE DISCRIMINATOR is separator count PER TOKEN: a path-shaped token has two or
 * more, a PDF name object has exactly one. `\S*` cannot cross a space, so
 * `/Fields key of /AcroForm` is two names in two tokens and survives, while
 * `/tmp/pdfxyz-ab12/input.pdf` is one token with three and does not.
 *
 * THE TRADE IS FORCED, NOT CHOSEN — and this is the half that went unrecorded
 * before. A PDF name object and a one-component absolute path are
 * **syntactically identical**: `/Root` and `/etc` have the same shape. No rule
 * can separate them, so every rule must choose which to sacrifice. Dropping
 * `/Root` loses the diagnostic a repair tool exists to give; letting `/etc`
 * through risks a bare directory name — and our own temp paths are always
 * multi-segment AND are removed by exact string match before this net is
 * reached. So the single segment survives. That is a ruling, not an oversight.
 */
export function looksLikePath(line: string): boolean {
  return (
    // A Windows drive: `C:\`.
    /(^|\s)[A-Za-z]:[\\/]/.test(line) ||
    // A UNC prefix: `\\server`.
    /\\\\/.test(line) ||
    // Two or more separators inside ONE token.
    /\S*[/\\]\S*[/\\]\S*/.test(line)
  );
}

/** Re-bound untrusted native-tool notes for persistence. */
export function boundToolNotes(lines: unknown): string[] {
  const input = Array.isArray(lines) ? lines : [];
  const kept: string[] = [];
  let withheld = 0;

  for (const line of input) {
    if (typeof line !== "string") {
      withheld += 1;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (looksLikePath(trimmed) || kept.length >= MAX_TOOL_NOTES) {
      withheld += 1;
      continue;
    }
    kept.push(trimmed.slice(0, MAX_TOOL_NOTE_CHARS));
  }

  if (withheld > 0) kept.push(`${withheld} further message(s) not shown.`);
  return kept;
}
