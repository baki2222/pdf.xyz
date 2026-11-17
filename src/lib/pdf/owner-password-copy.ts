// A leaf: it imports nothing, so a tool's page copy (server) and the field
// itself (`src/components/tools/runner/owner-password.tsx`, a lazy chunk)
// name the field the same way without either carrying the other.
/**
 * The tools whose refusal of a restricted PDF carries the owner-password
 * field (competitor-audit backlog #11), by catalogue slug.
 */
export const OWNER_PASSWORD_TOOLS = [
  "merge-pdf",
  "extract-pages",
  "remove-pages",
  "rotate-pdf",
  "extract-images",
] as const;

export type OwnerPasswordTool = (typeof OWNER_PASSWORD_TOOLS)[number];

/** The field's label, as the page copy quotes it. */
export const OWNER_PASSWORD_LABEL = "Owner password";

/** Its button. */
export const OWNER_PASSWORD_BUTTON = "Use owner password";
