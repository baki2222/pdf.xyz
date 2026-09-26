import type { ToolCategoryId } from "./types";

/**
 * The one place a category's URL is spelled.
 *
 * Until the category landing pages shipped, every category link on the site —
 * the header's "AI tools", the footer, the homepage's "View all", the AI
 * section's CTA and fifty tool-page breadcrumbs — pointed at
 * `/tools?category=<id>`: a filtered view of `/tools` whose canonical IS
 * `/tools`. The site spent a site-wide link and a breadcrumb level on URLs that
 * declared themselves duplicates, and eight category intents ("PDF converter",
 * "AI PDF tools") had no page that could rank.
 *
 * Every link is built here so a link cannot be spelled on its own and go stale.
 * `category-href.test.ts` DISCOVERS every source file that writes a
 * `?category=` link and fails any outside the explorer, which still reads the
 * query string so old shared URLs keep filtering.
 */
export const CATEGORY_PATH_PREFIX = "/tools/category/";

export function categoryHref(id: ToolCategoryId): string {
  return `${CATEGORY_PATH_PREFIX}${id}`;
}
