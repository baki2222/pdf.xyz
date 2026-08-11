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
 * Not "contains a slash": a Ghostscript message about `PDF/A1` legitimately has
 * one, and dropping it would delete the very notice this seam exists to carry.
 * See `workers/native-diagnostics` for where that was first got wrong.
 */
function looksLikePath(line: string): boolean {
  return (
    /(^|\s)\/\S/.test(line) ||
    /(^|\s)[A-Za-z]:[\\/]/.test(line) ||
    /\\\\/.test(line) ||
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
