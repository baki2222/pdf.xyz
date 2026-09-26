/**
 * The app's pages, discovered the way Next discovers them — one definition for
 * every guard that needs "all the routes".
 *
 * `route-indexability.test.ts` carried this walk inline; the internal-link
 * graph (`render-site-links.ts`) needs the same set, and two copies of a
 * discovery rule are the start of two different answers to "which pages
 * exist".
 */
import { readdirSync } from "node:fs";
import path from "node:path";

export const APP_DIR = path.join(process.cwd(), "src", "app");

export interface PageFile {
  /** Absolute path of the page file. */
  file: string;
  /** Path relative to `src/app`, POSIX separators, no extension: `tools/[slug]/page`. */
  fromApp: string;
  /** Route pattern, e.g. `/tools/[slug]`. */
  pattern: string;
}

/**
 * Every `page.{ts,tsx}` under `src/app` — Next's own convention for "this
 * directory is a route", which is the artifact the framework already depends
 * on. Route groups `(name)` contribute no path segment; `_private` folders and
 * `@parallel` slots are not routes at all.
 */
export function discoverPageFiles(
  dir = APP_DIR,
  segments: string[] = [],
): PageFile[] {
  const found: PageFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_") || entry.name.startsWith("@")) continue;
      const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
      found.push(
        ...discoverPageFiles(
          path.join(dir, entry.name),
          isGroup ? segments : [...segments, entry.name],
        ),
      );
    } else if (/^page\.tsx?$/.test(entry.name)) {
      const fromApp = path
        .relative(APP_DIR, path.join(dir, entry.name))
        .split(path.sep)
        .join("/")
        .replace(/\.tsx?$/, "");
      found.push({
        file: path.join(dir, entry.name),
        fromApp,
        pattern: `/${segments.join("/")}`,
      });
    }
  }
  return found;
}

/** `/tools/[slug]` + `{ slug: "merge-pdf" }` → `/tools/merge-pdf`. */
export function concreteRoute(
  pattern: string,
  params: Record<string, string>,
): string {
  return pattern.replace(/\[(\.{3})?(\w+)\]/g, (_m, _rest, key: string) =>
    String(params[key]),
  );
}
