// A leaf: it imports nothing, so a tool's page copy (server) and its runner
// (`src/components/tools/runner/restricted-grant.tsx`) name a permission the
// same way without either carrying the other.
/**
 * The words for the one /P permission a non-editor tool asks of a PDF its
 * author restricted (ISO 32000-1 Table 22):
 *  - `assemble` — bit 11, "assemble the document" (insert, rotate or delete
 *    pages): Rotate PDF;
 *  - `copy` — bit 5, "copy or otherwise extract text and graphics": Extract
 *    Images.
 */
export const GRANT_PERMISSION_NAME = {
  assemble: "page assembly",
  copy: "content copying",
} as const;
