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
 * runtime registry, route for route.
 *
 * Five guards used to carry a private copy of the chain parse
 * (`claims-vs-capability`, `ai-ceiling-surfaces`, `worker-tool-answers`,
 * `worker-panel-ceiling-refusal`, and this file); all of them read this one.
 *
 * AND SINCE 2026-10-09 (#175) the registry does not bind the panels
 * themselves: each `Panel` is a `next/dynamic` loader from
 * `worker-panel-loaders.tsx`, so a tool page's first load carries only its
 * own panel. The routes are therefore read by the shared AST reader
 * (`./tool-panel-modules`), which finds the registry FROM the page and follows
 * each `Panel` through the loader to the module that DEFINES it — the module
 * a test must render, because a loader renders nothing until it resolves.
 * (WP-06's first version of this file was a regex over single-name
 * `import { X } from "@/components/tools/…"` lines in the registry; against
 * the loaders it would have read "X is routed but not imported" for all 13.)
 *
 * A broken link is FATAL rather than a smaller corpus: the page must index
 * exactly one registry, every route the registry spells must be read, and
 * every route's component must resolve to the module that defines it.
 */
import path from "node:path";
import type { ComponentType } from "react";
import { getToolBySlug } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import {
  TOOL_PAGE,
  rel,
  specifierOf,
  workerPanelArms,
} from "./tool-panel-modules";

export { TOOL_PAGE };

export interface PanelArm {
  slugs: string[];
  /** The panel component's name in the module that defines it, e.g. `OcrWorkerPanel`. */
  component: string;
  /** That module, as an `@/` specifier: `@/components/tools/ocr-worker-panel`. */
  specifier: string;
  /** That module's file, repo-relative with POSIX separators. */
  file: string;
  /** The error boundary's crash label the page wraps it in. */
  boundary: string;
  /**
   * What the registry entry itself binds as its `Panel` — the thing the page
   * renders (a `next/dynamic` loader since #175): the module it is imported
   * from, as an `@/` specifier, and its exported name there.
   */
  registered: { specifier: string; name: string };
}

export function panelDispatchArms(): PanelArm[] {
  return workerPanelArms().map((arm) => {
    const first = arm.resolved.hops[0];
    if (!first)
      throw new Error(
        `${arm.component} is declared in the registry itself — a route must bind a panel from another module`,
      );
    return {
      slugs: arm.keys,
      component: arm.resolved.name,
      specifier: specifierOf(arm.resolved.file),
      file: rel(arm.resolved.file),
      boundary: arm.boundary,
      registered: { specifier: specifierOf(first.file), name: first.name },
    };
  });
}

/** `@/…` → an absolute specifier a test can `import()` at run time. */
const importable = (specifier: string) =>
  specifier.replace(/^@\//, `${path.resolve("src").replace(/\\/g, "/")}/`);

/** The panel component itself, from the module that defines it. */
export async function panelComponent(
  arm: PanelArm,
): Promise<ComponentType<{ tool: Tool }>> {
  const mod = (await import(
    /* @vite-ignore */ importable(arm.specifier)
  )) as Record<string, unknown>;
  const component = mod[arm.component];
  if (typeof component !== "function")
    throw new Error(`${arm.specifier} does not export ${arm.component}`);
  return component as ComponentType<{ tool: Tool }>;
}

/**
 * What the registry entry binds, from the module it is imported from — the
 * value the page renders. Not a function since #175: a `next/dynamic` loader
 * is a `forwardRef` object.
 */
export async function registeredPanel(arm: PanelArm): Promise<unknown> {
  const mod = (await import(
    /* @vite-ignore */ importable(arm.registered.specifier)
  )) as Record<string, unknown>;
  if (!(arm.registered.name in mod))
    throw new Error(
      `${arm.registered.specifier} does not export ${arm.registered.name}`,
    );
  return mod[arm.registered.name];
}

/** The module file a route's panel is defined in, relative to the repo root. */
export function panelFile(arm: PanelArm): string {
  return arm.file;
}

export function catalogTool(slug: string): Tool {
  const tool = getToolBySlug(slug);
  if (!tool) throw new Error(`dispatched slug ${slug} is not in the catalog`);
  return tool;
}
