/**
 * The worker panels the tool page actually renders, read from the page.
 *
 * `app/tools/[slug]/page.tsx` routes a slug to its panel with a chain of
 * `tool.slug === "…" ? <XWorkerPanel tool={tool} />` arms. A guard that walks
 * those arms checks exactly the panels users get, and a slug routed to a new
 * panel is checked without the guard being edited. Tools that fall through to
 * `WorkerPreview` are not panels — they are previews of tools that have not
 * shipped.
 *
 * A broken link is FATAL rather than a smaller corpus: every slug comparison
 * in the page must land in an arm, and every arm's component must resolve to
 * the module that defines it.
 *
 * SINCE 2026-10-09 the page does not import the panels itself: it imports
 * them from `@/components/tools/worker-panels`, which re-exports each as a
 * `next/dynamic` loader so a tool page's first load carries only its own
 * panel. This used to be a regex over single-name `import { X } from "…"`
 * lines, which that change would have turned into "X is dispatched but not
 * imported" for all 13 panels. The arms are now read by the shared AST reader
 * (`./tool-panel-modules`), which follows each component through static
 * imports AND dynamic loaders to the module that defines it — the module a
 * test must render, because the loader renders nothing until it resolves.
 */
import path from "node:path";
import type { ComponentType } from "react";
import { getToolBySlug } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import { TOOL_PAGE, specifierOf, workerPanelArms } from "./tool-panel-modules";

export { TOOL_PAGE };

export interface PanelArm {
  slugs: string[];
  /** The component's name in the module that defines it. */
  component: string;
  /** That module, as an `@/` specifier. */
  specifier: string;
}

export function panelDispatchArms(): PanelArm[] {
  return workerPanelArms().map((arm) => ({
    slugs: arm.keys,
    component: arm.resolved.name,
    specifier: specifierOf(arm.resolved.file),
  }));
}

export async function panelComponent(
  arm: PanelArm,
): Promise<ComponentType<{ tool: Tool }>> {
  const mod = (await import(
    /* @vite-ignore */ arm.specifier.replace(
      /^@\//,
      `${path.resolve("src").replace(/\\/g, "/")}/`,
    )
  )) as Record<string, unknown>;
  const component = mod[arm.component];
  if (typeof component !== "function")
    throw new Error(`${arm.specifier} does not export ${arm.component}`);
  return component as ComponentType<{ tool: Tool }>;
}

export function catalogTool(slug: string): Tool {
  const tool = getToolBySlug(slug);
  if (!tool) throw new Error(`dispatched slug ${slug} is not in the catalog`);
  return tool;
}
