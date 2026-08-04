/**
 * The handful of facts both policy pages share.
 *
 * Kept in one place so the two documents cannot drift into disagreeing about a
 * date or a contact address — the same reason `DEFAULT_RETENTION` is a constant
 * rather than a number typed into three files.
 */

/** Where privacy requests, legal notices, and takedowns go. */
export const LEGAL_CONTACT = "legal@pdf.xyz";

/**
 * The date shown on both documents, ISO. Update it whenever the substance
 * changes — not for a typo fix, and never without changing the text, because a
 * date that moves without the content moving teaches people to ignore it.
 */
export const LEGAL_UPDATED = "2026-08-04";
