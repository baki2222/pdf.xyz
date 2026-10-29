/**
 * The conflict oracle for `cn()`, which joins and does NOT merge.
 *
 * Until 2026-10-29 `cn()` was `twMerge(clsx(...))`, and tailwind-merge's
 * default config was ~8.5 KB gz in EVERY page's first load. Measured over
 * that build, it changed 43 of 35,735 class attributes the site prerendered
 * (3 distinct shapes); the component suite and the source scan below found
 * 14 call sites in all — each a base class and an override from the same
 * family (`size-4` and a caller's `size-3`). Those sites now say ONE class
 * per family, and `cn()` is `clsx`. Without a merge, two classes from one family resolve by the
 * order Tailwind emits them, not the order they were written — so a new one
 * is a bug, and this module is what finds it.
 *
 * tailwind-merge stays, as a TEST-ONLY oracle: `droppedClasses(list)` is what
 * it would have removed. It is extended with this project's theme where its
 * defaults guess wrong — it reads `text-display-1` (a font size, globals.css
 * `--text-display-*`) as a COLOUR, so under the old runtime merge
 * `cn("text-fg", "text-display-2")` silently lost `text-fg`.
 *
 * Callers:
 *  - `src/lib/cn-conflicts.test.ts` — every `cn()` call in src, each
 *    combination its branches can produce (derived from the AST).
 *  - `src/deploy/ssr-content.test.ts` — every class attribute of every page
 *    the build prerendered (the consumer's side: what a reader receives).
 *  - `src/tests/setup.ts` — every `cn()` the component suite actually calls.
 */
import { extendTailwindMerge } from "tailwind-merge";

const merge = extendTailwindMerge({
  extend: {
    theme: {
      // globals.css @theme: --text-display-1, --text-display-2.
      text: ["display-1", "display-2"],
    },
  },
});

/** The classes a merge would have removed from `list` — empty when none conflict. */
export function droppedClasses(list: string): string[] {
  const written = [...new Set(list.split(/\s+/).filter(Boolean))];
  const kept = new Set(merge(list).split(/\s+/).filter(Boolean));
  return written.filter((c) => !kept.has(c));
}
