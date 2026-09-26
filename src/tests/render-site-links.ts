/**
 * Render every page in the sitemap — inside the header and footer the root
 * layout wraps it in — and print `{route: [internal link targets]}` as JSON on
 * stdout. Not a test: a subprocess entrypoint for
 * `src/app/internal-links.test.ts`, which builds the inbound-link graph from
 * what a crawler actually receives.
 *
 * A SUBPROCESS for the reason `render-tool-pages.ts` gives: the tool page
 * imports panels another test file evaluates under `vi.mock`, and
 * `isolate: false` would hand this census that file's stubs. A fresh process
 * has a fresh module registry.
 *
 * THE SET is `sitemap()` — the URLs the site asks crawlers to index — and
 * each is mapped to its page through the same discovery the indexability guard
 * uses. A sitemap URL with no page is FATAL rather than skipped: skipping is
 * how a graph quietly shrinks to the pages that happened to render.
 *
 * Spawned as `node node_modules/tsx/dist/cli.mjs <this file>` (see
 * `render-tool-pages.ts` for why not the `.bin` shim).
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pathToFileURL } from "node:url";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import sitemap from "@/app/sitemap";
import { siteConfig } from "@/lib/site";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { concreteRoute, discoverPageFiles } from "./app-routes";

const ROUTER = {
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
} as never;

type PageModule = {
  default: (props: {
    params: Promise<Record<string, string>>;
    searchParams: Promise<Record<string, string>>;
  }) => ReactElement | Promise<ReactElement>;
  generateStaticParams?: () => Array<Record<string, string>>;
};

/** Internal link targets as pathnames — fragments dropped, queries kept. */
function linkTargets(markup: string): string[] {
  const origin = new URL(siteConfig.url).origin;
  const out = new Set<string>();
  for (const match of markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
    const href = (match[1] ?? "").replace(/&amp;/g, "&");
    if (!href.startsWith("/") && !href.startsWith(origin)) continue;
    if (href.startsWith("//")) continue;
    const url = new URL(href, origin);
    if (url.origin !== origin) continue;
    out.add(`${url.pathname}${url.search}`);
  }
  return [...out].sort();
}

async function main(): Promise<void> {
  const wanted = new Set(sitemap().map((e) => new URL(e.url).pathname));
  const pages = new Map<
    string,
    { mod: PageModule; params: Record<string, string> }
  >();

  for (const page of discoverPageFiles()) {
    const mod = (await import(pathToFileURL(page.file).href)) as PageModule;
    const paramSets = mod.generateStaticParams
      ? mod.generateStaticParams()
      : [{}];
    for (const params of paramSets) {
      const route = concreteRoute(page.pattern, params);
      if (wanted.has(route)) pages.set(route, { mod, params });
    }
  }

  const missing = [...wanted].filter((route) => !pages.has(route));
  if (missing.length > 0) {
    throw new Error(`sitemap URLs with no page: ${missing.join(", ")}`);
  }

  const graph: Record<string, string[]> = {};
  for (const route of [...wanted].sort()) {
    const { mod, params } = pages.get(route)!;
    const element = await mod.default({
      params: Promise.resolve(params),
      searchParams: Promise.resolve({}),
    });
    const markup = renderToStaticMarkup(
      createElement(
        PathnameContext.Provider,
        { value: route },
        createElement(
          AppRouterContext.Provider,
          { value: ROUTER },
          createElement(SiteHeader),
          element,
          createElement(SiteFooter),
        ),
      ),
    );
    graph[route] = linkTargets(markup);
  }
  process.stdout.write(JSON.stringify(graph));
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
