// @vitest-environment node
/**
 * The authored How-it-works steps never reach the browser.
 *
 * They rode in the client catalogue until 2026-10-24 — thirty tools' steps on
 * every tool page, to render one page's three on the server — and the option
 * PRs #206–#210 lengthened them until markdown-to-pdf went 0.4 KB gz over the
 * every-tool-page ceiling. They now live in `tools/catalog-how.ts`, which only
 * `howToSteps` (server-rendered) reads. One client import of that module, or
 * of a module that re-exports it, would ship them all again; this reads the
 * built chunks for them.
 *
 * Both directions (CLAUDE.md rule 1): every step is looked for in the client
 * chunks and must be absent, and the same search must FIND them in the server
 * output — a search that sees nothing anywhere would pass the first half
 * vacuously.
 *
 * Runs under `pnpm test:bundle` (it needs `.next`), never `pnpm test`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOOL_HOW } from "@/lib/tools/catalog-how";

const NEXT_DIR = path.join(process.cwd(), ".next");

function files(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory()
      ? files(full, ext)
      : full.endsWith(ext)
        ? [full]
        : [];
  });
}

/** Steps long and literal enough to search for: no template holes. */
const STEPS = Object.values(TOOL_HOW)
  .flat()
  .filter((s) => s.length >= 40);

describe("authored How-it-works steps stay on the server", () => {
  const built = existsSync(path.join(NEXT_DIR, "static", "chunks"));

  it("has a build to measure", () => {
    // Skipping when `.next` is absent would read green in exactly the case
    // where nothing was checked.
    expect(built, "no .next — run `pnpm build` first (CI does)").toBe(true);
  });

  it("health: there are steps to look for", () => {
    expect(Object.keys(TOOL_HOW).length).toBeGreaterThanOrEqual(20);
    expect(STEPS.length).toBeGreaterThanOrEqual(40);
  });

  it("no client chunk carries one, and the server output does", () => {
    if (!built) return;
    const client = files(path.join(NEXT_DIR, "static", "chunks"), ".js").map(
      (f) => readFileSync(f, "utf8"),
    );
    const server = files(path.join(NEXT_DIR, "server"), ".html").map((f) =>
      readFileSync(f, "utf8"),
    );
    expect(client.length).toBeGreaterThan(20);
    // A step is JSON-escaped in a chunk and HTML-escaped on a page; compare
    // on a stretch with neither quotes nor ampersands nor apostrophes.
    const probe = (s: string) =>
      s
        .split(/["'&<>’“”—…]/)
        .sort((a, b) => b.length - a.length)[0]!
        .trim();
    // A stretch the client catalogue also says (a tagline or description
    // repeating a step) ships for its own reason and proves nothing here.
    const catalogue = readFileSync(
      path.join(process.cwd(), "src", "lib", "tools", "catalog.ts"),
      "utf8",
    );
    const probes = STEPS.map(probe).filter(
      (p) => p.length >= 30 && !catalogue.includes(p),
    );
    expect(probes.length).toBeGreaterThanOrEqual(30);
    const shipped = probes.filter((p) => client.some((c) => c.includes(p)));
    expect(shipped, "steps found in client chunks").toEqual([]);
    // The search can see a step where one IS shipped. Not all of them: a tool
    // whose content file authors its own How it works renders those instead,
    // so only the tools that fall back to these steps put them in a page.
    const rendered = probes.filter((p) => server.some((h) => h.includes(p)));
    expect(rendered.length).toBeGreaterThanOrEqual(3);
  });
});
