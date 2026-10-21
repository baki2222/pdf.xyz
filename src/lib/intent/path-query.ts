/**
 * A missing address as the words a reader meant: `/merge` is "merge",
 * `/pdf-to-doc` is "pdf to doc", `/tools/pdf-to-docx` is "pdf to docx".
 *
 * The 404's search box is pre-filled with these, so the reader edits a query
 * instead of retyping one. Pure and catalogue-free: it runs on the 404,
 * which ships with every route, so it must not pull the tool catalogue into
 * any first load (`bundle-budget.test.ts`).
 */
export function pathQuery(pathname: string): string {
  const segment = pathname.split("/").filter(Boolean).pop();
  if (!segment) return "";
  let raw = segment;
  try {
    raw = decodeURIComponent(segment);
  } catch {
    // A malformed escape is still words.
  }
  return raw
    .toLowerCase()
    .replace(/\.(html?|php|aspx?)$/, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join(" ");
}
