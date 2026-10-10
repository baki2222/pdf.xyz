/**
 * The line boxes of a row in the suggestions slot, shared by everything the
 * slot holds — the tools panel before any file, the placeholder while the
 * files are read, and the suggestions — so the slot is ONE box whichever of
 * the three it shows, and a swap changes its words, not its height.
 *
 * A row is a name (one `text-sm` line), then these two lines, each HELD at
 * two lines from the start: a line with less to say keeps the room.
 *
 * WAS each line one line high in the tools panel and the placeholder while a
 * suggestion's lines wrapped as they pleased: "No selectable text on page 1
 * of scan.pdf" and "SECURE WORKER · you'll add the files there · uploads
 * only when you start it" take two lines in a real row, so the list came in
 * 18px taller than its placeholder at 1280 and 37px at 390, and what was
 * under the slot moved (review, 2026-10-09).
 */

/**
 * The second line: what the files hold (or, before any file, what the tool
 * does). Clamped at its two lines, because what fills it is open-ended: it
 * names files, and a name has any length. A name like
 * `Scanned_Contract_ACME_Corporation_2026_10_09.pdf` has no break
 * opportunity either, so the line breaks anywhere rather than run out of
 * the row (it pushed /workspace to 411px at 390). What the clamp cuts is
 * still the link's description, for assistive technology. (`min-h` before
 * `line-clamp-2`: the other way round reads "2 min" to the figure scanner in
 * src/lib/tools/numbers-honesty.test.ts.)
 */
export const FACTS_LINE =
  "min-h-[2lh] line-clamp-2 text-xs leading-relaxed wrap-anywhere";

/**
 * The third line: where the tool runs, and how the files reach it — "uploads
 * only when you start it" among them. Held at two lines but NEVER clamped: a
 * row that has to say where a file goes says all of it. Its words are a
 * closed set, and a secure-worker tool's — the longest a row shows for
 * files that open — fits two lines at the widths the staging cases in
 * e2e/layout-stability.spec.ts hold the slot to (390, 1280; measured at
 * 1024 too, 255px). On a 360px phone, or with a third term ("after Unlock
 * PDF"), it takes a third line and that row grows, on purpose: measured, the
 * list then comes in 18px taller than its placeholder.
 */
export const WHERE_LINE = "min-h-[2lh] text-[11px] leading-relaxed";
