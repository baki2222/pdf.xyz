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

/** Max lines handed to a caller. Everything beyond is counted, not dropped silently. */
export const MAX_DIAGNOSTIC_LINES = 10;
/** Each surviving line is clipped to this many characters. */
export const MAX_DIAGNOSTIC_CHARS = 200;

/**
 * Does this line still contain something shaped like a filesystem path?
 *
 * NOT simply "contains a slash". The first version of this rule was exactly
 * that, and the real Ghostscript message it was written for —
 * `"…cannot be represented in XMP for PDF/A1, discarding DOCINFO"` — was dropped
 * whole, because a PDF/A standard's own name has a slash in it. A rule that
 * silently deletes the very messages it exists to surface is worse than no rule.
 *
 * A path is: an absolute POSIX token (` /tmp`), a Windows drive (`C:\`), a UNC
 * prefix, or any single token with two or more separators
 * (`Resource/Font/NimbusSans-Regular`). One slash inside a word is prose.
 *
 * COST, STATED: a font-substitution notice names a path inside the Ghostscript
 * install, so it is dropped and counted rather than shown. That is the fail-
 * closed side of the trade, and inventing an exception for "paths that are only
 * ours" would put back the judgement call this rule exists to remove.
 */
function looksLikePath(line: string): boolean {
  return (
    /(^|\s)\/\S/.test(line) ||
    /(^|\s)[A-Za-z]:[\\/]/.test(line) ||
    /\\\\/.test(line) ||
    /\S*[/\\]\S*[/\\]\S*/.test(line)
  );
}

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
