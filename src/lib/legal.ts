/**
 * The handful of facts both policy pages share.
 *
 * Kept in one place so the two documents cannot drift into disagreeing about a
 * date, an address, or a contact — the same reason `DEFAULT_RETENTION` is a
 * constant rather than a number typed into three files. A privacy policy and a
 * set of terms that name different entities is the kind of small inconsistency
 * that undermines both.
 */

/** The company behind pdf.xyz, as registered. */
export const LEGAL_ENTITY = {
  name: "BENEERA LLC",
  /** Used in the governing-law clause and to describe the entity accurately. */
  jurisdiction: "Wyoming, United States",
  /** Registered address, one line per rendered line. */
  address: ["30 N Gould St # 44190", "Sheridan, WY 82801", "United States"],
} as const;

/** Where privacy requests, legal notices, and takedowns go. Confirmed active. */
export const LEGAL_CONTACT = "legal@pdf.xyz";

/**
 * The date shown on both documents, ISO. Update it whenever the substance
 * changes — not for a typo fix, and never without changing the text, because a
 * date that moves without the content moving teaches people to ignore it.
 */
export const LEGAL_UPDATED = "2026-10-10";

/** The youngest age at which someone may use pdf.xyz (terms §2). */
export const MINIMUM_AGE = 13;

/**
 * The highest age any EU country sets for agreeing, on your own, to things
 * like analytics (GDPR Art. 8 lets each set 13 to 16). Above our minimum age,
 * so /privacy tells a reader below it where they live to decline analytics.
 */
export const HIGHEST_DIGITAL_CONSENT_AGE = 16;
