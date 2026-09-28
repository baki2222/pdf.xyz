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
 * in the page must land in an arm, and every arm's component must be imported
 * and exported where the page says.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ComponentType } from "react";
import { getToolBySlug } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";

export const TOOL_PAGE = path.resolve("src/app/tools/[slug]/page.tsx");

export interface PanelArm {
  slugs: string[];
  component: string;
  specifier: string;
}

export function panelDispatchArms(): PanelArm[] {
  const source = readFileSync(TOOL_PAGE, "utf8");
  const imports = new Map<string, string>();
  for (const m of source.matchAll(
    /import \{ (\w+) \} from "(@\/components\/tools\/[^"]+)";/g,
  ))
    imports.set(m[1]!, m[2]!);
  const arms: PanelArm[] = [];
  for (const m of source.matchAll(
    /((?:tool\.slug === "[^"]+"\s*(?:\|\|\s*)?)+)\?\s*\(([\s\S]*?)<(\w+) tool=\{tool\} \/>/g,
  )) {
    const slugs = [...m[1]!.matchAll(/"([^"]+)"/g)].map((s) => s[1]!);
    const component = m[3]!;
    const specifier = imports.get(component);
    if (!specifier)
      throw new Error(`${component} is dispatched but not imported`);
    arms.push({ slugs, component, specifier });
  }
  const compared = [...source.matchAll(/tool\.slug === "/g)].length;
  const parsed = arms.reduce((n, arm) => n + arm.slugs.length, 0);
  if (compared !== parsed)
    throw new Error(
      `page.tsx compares ${compared} slugs; the dispatch parse found ${parsed}`,
    );
  return arms;
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
