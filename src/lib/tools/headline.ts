/**
 * The words a tool page puts in its one `<h1>`, when they should say more
 * than the tool's short name.
 *
 * Cards, lists, menus and breadcrumbs keep `tool.name`; only the tool page
 * itself reads this module (`src/app/tools/[slug]/page.tsx`). A headline
 * exists where people search for a file format the short name leaves out:
 * "pdf to ppt" and "pdf to pptx" are asked for ahead of "pdf to powerpoint"
 * (audit search-demand#3), and the page's H1 said neither. The H1 names
 * only the format the tool writes.
 *
 * `headline.test.ts` holds that every key is a real tool and that every
 * headline still starts with the tool's own name, so the H1 and the card
 * never name two different things. `tool-page-layout.test.ts` reads the
 * rendered H1 of every page against `toolHeadline`.
 */
export const TOOL_HEADLINES: Readonly<Record<string, string>> = {
  // Not "(PPT, PPTX)": the tool writes .pptx only, and the page says the old
  // .ppt is not written, so a heading listing PPT promised a format it does
  // not make (review of 7b498d92). "PDF to PPT", the search term, stays in
  // the <title> and intro, where the page says the file is a .pptx.
  "pdf-to-powerpoint": "PDF to PowerPoint (PPTX)",
};

/** The `<h1>` text for a tool page: its headline, or else its name. */
export function toolHeadline(tool: {
  readonly slug: string;
  readonly name: string;
}): string {
  return TOOL_HEADLINES[tool.slug] ?? tool.name;
}
