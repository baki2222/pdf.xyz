/**
 * Render every `/tools/[slug]` page to plain text and print `{slug: text}` as
 * JSON on stdout. Not a test — a subprocess entrypoint for
 * `src/lib/tools/file-ceilings.test.ts`, which needs the markup a reader
 * receives rather than the helpers that feed it.
 *
 * With `--html` it prints the raw markup instead, for a census that must read
 * structure the text flattens away — which guide each Guides-band card links
 * and what it is labelled (`src/lib/guides/tool-page-guides-band.test.ts`).
 *
 * WHY A SUBPROCESS, and it is not performance. `vitest.config.ts` runs
 * `isolate: false`, so every test file in a worker shares one module cache, and
 * `tests/mock-isolation.test.ts` forbids any test file from importing a module
 * another test file has poisoned with `vi.mock`. The tool page statically
 * imports all fourteen worker panels, and `chat-with-pdf-worker-panel.test.tsx`
 * mocks `@/lib/workers/chat-with-pdf-client` before importing its panel — so a
 * test file that imported the page would become that stub's observer, and its
 * "rendered page" could be a page rendered against another file's fake driver.
 * That is not a rule to route around: it is the exact hazard for an assertion
 * about what a page renders.
 *
 * A fresh process has a fresh module registry, so this census is affected by no
 * other test file at all. It costs one `tsx` spawn per suite run.
 *
 * Spawned as `node node_modules/tsx/dist/cli.mjs <this file>`, never through
 * `node_modules/.bin/tsx` — that shim is a shebang script Windows cannot exec,
 * which is why `release-gate/cli.smoke.test.ts` fails there.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import ToolPage from "@/app/tools/[slug]/page";
import { tools } from "@/lib/tools";

/**
 * Satisfies `useRouter` for the runner components the page mounts. A real
 * context provider, not a module mock — nothing here may alter a module.
 */
const ROUTER = {
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
} as never;

function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&middot;|&#183;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `--markup` (or `--html`) prints each page's raw markup instead of its text,
 * for a reader that must parse what a crawler parses — the JSON-LD script
 * bodies, the Guides band's cards — rather than a flattened string. Two lanes
 * added the same flag under two names (`rendered-tool-pages.ts` passes
 * `--markup`, `guides/tool-page-guides-band.test.ts` passes `--html`); both
 * are kept so neither caller changes.
 */
const RAW =
  process.argv.includes("--markup") || process.argv.includes("--html");

async function main(): Promise<void> {
  const census: Record<string, string> = {};
  for (const tool of tools) {
    const element = await ToolPage({
      params: Promise.resolve({ slug: tool.slug }),
    });
    const markup = renderToStaticMarkup(
      createElement(AppRouterContext.Provider, { value: ROUTER }, element),
    );
    census[tool.slug] = RAW ? markup : textOf(markup);
  }
  process.stdout.write(JSON.stringify(census));
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
