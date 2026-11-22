import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveSpecifier } from "./tool-panel-modules";

const ROOT = process.cwd();
const relOf = (file: string) =>
  path.relative(ROOT, file).split(path.sep).join("/");

/**
 * The tools a shared runner hands to a host module of their own, read from
 * the runner itself: `const slug = useToolRun()?.slug;` then
 * `if (slug === "x") return <Host />`, the host imported from "./…". The
 * slugs it does not name stay with the runner's own drop box.
 *
 * Added with audit platform#1 (2026-11-22): Edit PDF Metadata's runner kind
 * is shared with Remove Annotations and Edit PDF Bookmarks, and Multiple
 * Pages per Sheet's with Booklet, and only the first of each has a batch. A
 * guard that read the kind's runner as one module gave the batch (and its
 * ZIP) to all of them. Read by `batch-claims.test.ts` and
 * `output-honesty.test.ts`, so the two walks cannot disagree on which
 * module is a tool's.
 *
 * FATAL, never a smaller answer (CLAUDE.md rule 4): a runner that reads the
 * page's slug but names no host, or names a host this cannot resolve.
 *
 * `runner` is repo-relative, POSIX separators; so are the hosts returned.
 */
export function slugHostsOf(runner: string): Map<string, string> {
  const source = readFileSync(path.join(ROOT, runner), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const hosts = new Map<string, string>();
  if (!/useToolRun\(\)\?\.slug/.test(source)) return hosts;
  for (const m of source.matchAll(
    /slug === "([a-z0-9-]+)"\)\s*\{?\s*return\s*<([A-Z]\w*)\s*\/>/g,
  )) {
    const slug = m[1]!;
    const component = m[2]!;
    const imported = new RegExp(
      `import\\s*\\{[^}]*\\b${component}\\b[^}]*\\}\\s*from\\s*"(\\.\\.?/[^"]+)"`,
    ).exec(source);
    if (!imported)
      throw new Error(`${runner}: ${component} for ${slug} is not imported`);
    const resolved = resolveSpecifier(path.join(ROOT, runner), imported[1]!);
    if (!resolved)
      throw new Error(`${runner}: cannot resolve ${imported[1]} for ${slug}`);
    hosts.set(slug, relOf(resolved));
  }
  if (hosts.size === 0)
    throw new Error(
      `${runner} reads the page's slug but names no host module: a walk cannot tell its tools apart`,
    );
  return hosts;
}
