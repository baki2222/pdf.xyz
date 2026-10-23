import type { ToolCategoryId } from "./types";

/**
 * The fold, said once: a category's family is the first part of its id
 * (`convert-to` and `convert-from` → `convert`). Catalogue-free, so a client
 * surface that has only a tool's category (the workspace's summaries) can
 * colour its tile without shipping the catalogue; `./families` builds the
 * chips from the same function.
 */
export function familyIdOf(category: ToolCategoryId): string {
  return category.split("-")[0]!;
}
