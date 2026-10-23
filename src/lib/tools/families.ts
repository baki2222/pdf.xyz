import { categories } from "./categories";
import { tools } from "./catalog";
import { familyIdOf } from "./family-id";
import type { Tool, ToolCategoryId } from "./types";

/**
 * The home page's filter chips: the catalogue's categories, folded where two
 * of them are one job to a visitor. "Convert to PDF" and "Convert from PDF"
 * are a single "Convert" to someone who has a file in one format and wants
 * another.
 *
 * DERIVED, never typed. A category joins the family named by the first part
 * of its id (`convert-to` and `convert-from` → `convert`); a family of one
 * takes its category's `short` name, and a family of several takes the word
 * their names begin with. A new category appears as a chip by existing, and
 * a renamed one renames its chip. `families.test.ts` holds the fold, the
 * order (the catalogue's) and that every tool is in exactly one family.
 */
export interface ToolFamily {
  /** Stable id: the shared first part of its categories' ids. */
  readonly id: string;
  /** The chip's word. */
  readonly label: string;
  readonly categories: readonly ToolCategoryId[];
  readonly tools: readonly Tool[];
}

/** The fold, said once (`./family-id`): the first part of the category id. */
const familyId = familyIdOf;

/** The first word every one of `names` starts with, or the first name. */
function sharedFirstWord(names: readonly string[]): string {
  const first = names[0]!.split(/\s+/)[0]!;
  return names.every((n) => n.split(/\s+/)[0] === first) ? first : names[0]!;
}

export function toolFamilies(): ToolFamily[] {
  const order: string[] = [];
  const members = new Map<string, ToolCategoryId[]>();
  for (const category of categories) {
    const id = familyId(category.id);
    if (!members.has(id)) {
      members.set(id, []);
      order.push(id);
    }
    members.get(id)!.push(category.id);
  }
  return order.map((id) => {
    const ids = members.get(id)!;
    const own = categories.filter((c) => ids.includes(c.id));
    const label =
      own.length === 1
        ? own[0]!.short
        : sharedFirstWord(own.map((c) => c.name));
    return {
      id,
      label,
      categories: ids,
      tools: tools.filter((t) => ids.includes(t.category)),
    };
  });
}

/** The family a tool's category belongs to. */
export function familyOf(tool: Tool): string {
  return familyId(tool.category);
}
