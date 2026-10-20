/**
 * Everything the command palette can find, as search documents: every tool,
 * every task (the jobs people name a tool by), every guide, the site's pages
 * and the palette's own actions.
 *
 * Each set is DERIVED from the module that owns it — the catalogue, `TASKS`,
 * the generated guide meta, the site's nav — so a tool, a guide or a page
 * added tomorrow is findable without this file changing
 * (`palette-index.test.ts` holds each set to its source both ways).
 *
 * Imported only by the palette's lazy chunk. The catalogue it reads is the
 * shared one (`lazy-chunks.test.ts`: one chunk carries it); the guides come
 * from `meta.generated.ts`, never the article catalogue, which would bring a
 * dozen modules of interpolated figures into a chunk budgeted at 12 KB gz.
 */
import { GUIDE_META } from "@/lib/guides/meta.generated";
import { footerNav, primaryNav } from "@/lib/site";
import { tools } from "@/lib/tools";
import { TASKS } from "@/lib/tools/intents";
import { toolDocs, type SearchDoc } from "./search";

/** What an action option does; the palette performs it. */
export type PaletteAction = "open-file" | "workspace" | "clear-history";

export interface PaletteDoc extends SearchDoc {
  /** Where choosing it goes; actions have none. */
  readonly href?: string;
  /** The second line: a tool's tagline, a task's tool, "Guide". */
  readonly detail?: string;
  /** The tool it opens, for tools and tasks (measured as a suggestion). */
  readonly toolSlug?: string;
  readonly action?: PaletteAction;
}

/** The palette's own actions, in the order it lists them. */
export const PALETTE_ACTIONS: readonly {
  readonly action: PaletteAction;
  readonly name: string;
  readonly detail: string;
  readonly keywords: readonly string[];
}[] = [
  {
    action: "open-file",
    name: "Open a file…",
    detail: "Choose files from this device",
    keywords: ["upload", "choose", "browse", "add files", "pick"],
  },
  {
    action: "workspace",
    name: "Open workspace",
    detail: "Stage several files and run tools on them",
    keywords: ["workspace", "batch", "files"],
  },
  {
    action: "clear-history",
    name: "Clear local history",
    detail: "Forget recent tools and saved workspace files in this browser",
    keywords: ["forget", "delete", "recents", "reset", "privacy", "storage"],
  },
];

const toolName = new Map(tools.map((t) => [t.slug, t.name]));

/** Every document, in the order the palette groups them. */
export function paletteDocs(): PaletteDoc[] {
  const toolEntries: PaletteDoc[] = toolDocs(tools).map(({ tool, ...doc }) => ({
    ...doc,
    href: `/tools/${tool.slug}`,
    detail: tool.tagline,
    toolSlug: tool.slug,
  }));

  const taskEntries: PaletteDoc[] = TASKS.map((task, i) => ({
    kind: "task",
    id: `task:${i}:${task.slug}`,
    name: task.label,
    keywords: [toolName.get(task.slug) ?? ""].filter(Boolean),
    href: `/tools/${task.slug}`,
    detail: toolName.get(task.slug),
    toolSlug: task.slug,
  }));

  const guideEntries: PaletteDoc[] = GUIDE_META.map((guide) => ({
    kind: "guide",
    id: `guide:${guide.slug}`,
    name: guide.title,
    keywords: guide.keywords,
    href: `/guides/${guide.slug}`,
    detail: "Guide",
  }));

  const seen = new Set<string>();
  const pageEntries: PaletteDoc[] = [];
  for (const item of [
    ...primaryNav,
    ...footerNav.flatMap((column) => column.items),
  ]) {
    if (!item.href || seen.has(item.href)) continue;
    seen.add(item.href);
    pageEntries.push({
      kind: "page",
      id: `page:${item.href}`,
      name: item.label,
      href: item.href,
      detail: "Page",
    });
  }

  const actionEntries: PaletteDoc[] = PALETTE_ACTIONS.map((a) => ({
    kind: "action",
    id: `action:${a.action}`,
    name: a.name,
    keywords: a.keywords,
    detail: a.detail,
    action: a.action,
  }));

  return [
    ...taskEntries,
    ...toolEntries,
    ...guideEntries,
    ...pageEntries,
    ...actionEntries,
  ];
}
