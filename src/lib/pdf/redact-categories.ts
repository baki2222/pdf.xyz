/**
 * Redact PDF's "Detect personal data" categories: their ids, the labels and
 * hints the runner shows, and the cap on a list. A leaf, so the runner can
 * draw the checkboxes without loading the text reader (`redact-find.ts`),
 * which arrives the first time Find or Detect is pressed.
 */

export const PII_CATEGORIES = [
  "email",
  "phone",
  "card",
  "iban",
  "dob",
] as const;
export type PiiCategory = (typeof PII_CATEGORIES)[number];

export const PII_LABEL: Record<PiiCategory, string> = {
  email: "Email addresses",
  phone: "Phone numbers",
  card: "Payment card numbers",
  iban: "IBANs",
  dob: "Dates of birth",
};

/** The labels as they read inside a sentence. */
export const PII_NOUN: Record<PiiCategory, string> = {
  email: "email addresses",
  phone: "phone numbers",
  card: "payment card numbers",
  iban: "IBANs",
  dob: "dates of birth",
};

/** What each category matches, in the words the runner shows under it. */
export const PII_HINT: Record<PiiCategory, string> = {
  email: "name@example.com",
  phone: "+44 20 7946 0958, (415) 555-0132",
  card: "13–19 digits that pass the card checksum",
  iban: "Checked with the IBAN checksum",
  dob: "Only after a “Date of birth” or “DOB” label",
};

/** The checkboxes the runner renders, in order. */
export const PII_OPTIONS: readonly {
  id: PiiCategory;
  label: string;
  hint: string;
}[] = PII_CATEGORIES.map((id) => ({
  id,
  label: PII_LABEL[id],
  hint: PII_HINT[id],
}));

/** The most matches one Find or Detect lists; past it the result says so. */
export const MAX_FOUND = 500;
