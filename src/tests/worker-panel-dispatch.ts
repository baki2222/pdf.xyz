/**
 * The worker panels the tool page actually renders, read from the registry
 * the page indexes.
 *
 * `app/tools/[slug]/page.tsx` renders `WORKER_PANELS[tool.slug]` from
 * `src/components/tools/worker-panels.tsx`, whose routes are
 * `{ slugs: [...], Panel: XWorkerPanel, boundary: "…" }` entries. A guard that
 * walks those routes checks exactly the panels users get, and a slug routed
 * to a new panel is checked without the guard being edited.
 *
 * WAS a parse of the page's own chain of `tool.slug === "…" ?
 * <XWorkerPanel tool={tool} />` ternaries, which ended in a `WorkerPreview`
 * fallback for any tool the chain did not name. That fallback is gone (WP-06):
 * nothing falls through to a preview now, because
 * `src/app/tools/tool-page-registry.test.ts` requires every slug to resolve to
 * an in-browser runner or a route here, and holds this parse equal to the
 * runtime registry, component for component.
 *
 * Five guards used to carry a private copy of the chain parse
 * (`claims-vs-capability`, `ai-ceiling-surfaces`, `worker-tool-answers`,
 * `worker-panel-ceiling-refusal`, and this file); all of them read this one.
 *
 * A broken link is FATAL rather than a smaller corpus: the page must index
 * the registry, every route the registry spells must be parsed, and every
 * route's component must be imported where the registry says.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ComponentType } from "react";
import { getToolBySlug } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";

export const TOOL_PAGE = path.resolve("src/app/tools/[slug]/page.tsx");
export const WORKER_PANELS_MODULE = path.resolve(
  "src/components/tools/worker-panels.tsx",
);

export interface PanelArm {
  slugs: string[];
  /** The panel component's exported name, e.g. `OcrWorkerPanel`. */
  component: string;
  /** Its module, as imported: `@/components/tools/ocr-worker-panel`. */
  specifier: string;
  /** The error boundary's crash label the page wraps it in. */
  boundary: string;
}

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");

export function panelDispatchArms(): PanelArm[] {
  // The page → registry link. Without it the registry could be complete and
  // correct and render nowhere.
  const page = withoutComments(readFileSync(TOOL_PAGE, "utf8"));
  if (
    !/import\s*\{[^}]*\bWORKER_PANELS\b[^}]*\}\s*from\s*"@\/components\/tools\/worker-panels"/.test(
      page,
    ) ||
    !page.includes("WORKER_PANELS[")
  )
    throw new Error(
      "page.tsx no longer renders WORKER_PANELS from @/components/tools/worker-panels",
    );

  const source = withoutComments(readFileSync(WORKER_PANELS_MODULE, "utf8"));
  const imports = new Map<string, string>();
  for (const m of source.matchAll(
    /import\s*\{\s*(\w+)\s*\}\s*from\s*"(@\/components\/tools\/[^"]+)";/g,
  ))
    imports.set(m[1]!, m[2]!);
  const arms: PanelArm[] = [];
  for (const m of source.matchAll(
    /\{\s*slugs:\s*\[([^\]]*)\],\s*Panel:\s*(\w+),\s*boundary:\s*"([^"]+)",?\s*\}/g,
  )) {
    const slugs = [...m[1]!.matchAll(/"([^"]+)"/g)].map((s) => s[1]!);
    const component = m[2]!;
    const specifier = imports.get(component);
    if (!specifier) throw new Error(`${component} is routed but not imported`);
    arms.push({ slugs, component, specifier, boundary: m[3]! });
  }
  const spelled = [...source.matchAll(/\bslugs:\s*\[/g)].length;
  if (spelled !== arms.length || arms.length === 0)
    throw new Error(
      `worker-panels.tsx spells ${spelled} routes; the parse found ${arms.length}`,
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

/** The module file a route's panel lives in, relative to the repo root. */
export function panelFile(arm: PanelArm): string {
  return `src/${arm.specifier.replace(/^@\//, "")}.tsx`;
}

export function catalogTool(slug: string): Tool {
  const tool = getToolBySlug(slug);
  if (!tool) throw new Error(`dispatched slug ${slug} is not in the catalog`);
  return tool;
}
