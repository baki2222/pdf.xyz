// @vitest-environment node
/**
 * The anchor census: every internal link resolves to something that renders.
 *
 * TASK-02 deleted a pricing tier whose "Talk to us" pointed at `/#contact` —
 * which happened to exist, but only because the about-section had been built
 * for exactly that dangling link months earlier ("linked from the footer long
 * before either existed", its own docblock says). Nothing checks this; a
 * renamed section id or a removed tool slug turns nav and footer links into
 * silent no-ops that scroll nowhere or 404.
 *
 * v1 scope, mechanical and total: every `href="/#x"` and `href="/tools/y"`
 * in the user-facing sources must resolve — fragments against the `id="…"`
 * attributes rendered by the homepage's sections, tool slugs against the
 * compiled catalogue. Route-level hrefs (`/workspace`, `/privacy`, …) are
 * checked against the app directory's page files.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAllToolSlugs } from "@/lib/tools";
import { getAllGuideSlugs } from "@/lib/guides";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test."))
      out.push(full);
  }
  return out;
}

function sources(): string[] {
  return [
    ...walk(path.join(ROOT, "src", "components")),
    ...walk(path.join(ROOT, "src", "app")),
    path.join(ROOT, "src", "lib", "site.ts"),
  ].filter((f) => {
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  });
}

function relative(file: string): string {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

describe("every internal link resolves to something that renders", () => {
  const files = sources();
  const bodies = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

  it("finds the sources, so a move cannot quietly empty this census", () => {
    expect(files.length).toBeGreaterThanOrEqual(50);
  });

  it("every /#fragment link targets a rendered id", () => {
    const ids = new Set<string>();
    for (const body of bodies.values()) {
      for (const m of body.matchAll(/\bid="([a-z0-9-]+)"/gi)) ids.add(m[1]!);
    }
    const offenders: string[] = [];
    for (const [file, body] of bodies) {
      for (const m of body.matchAll(/href="\/#([a-z0-9-]+)"/gi)) {
        if (!ids.has(m[1]!)) offenders.push(`${relative(file)} → /#${m[1]}`);
      }
    }
    expect(
      offenders,
      `these fragment links scroll nowhere (no element renders that id):\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every /tools/<slug> link names a catalogue slug", () => {
    const slugs = new Set(getAllToolSlugs());
    const offenders: string[] = [];
    for (const [file, body] of bodies) {
      for (const m of body.matchAll(/href="\/tools\/([a-z0-9-]+)"/gi)) {
        if (!slugs.has(m[1]!))
          offenders.push(`${relative(file)} → /tools/${m[1]}`);
      }
    }
    expect(
      offenders,
      `these tool links 404 (the slug is not in the catalogue):\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every /guides/<slug> link names a guides-catalogue slug", () => {
    // Mirror of the /tools census above, added with the /guides section: the
    // bare-route check below is single-segment only, so a concrete guide link
    // would otherwise be the one internal href nothing validates.
    const slugs = new Set(getAllGuideSlugs());
    const offenders: string[] = [];
    for (const [file, body] of bodies) {
      for (const m of body.matchAll(/href="\/guides\/([a-z0-9-]+)"/gi)) {
        if (!slugs.has(m[1]!))
          offenders.push(`${relative(file)} → /guides/${m[1]}`);
      }
    }
    expect(
      offenders,
      `these guide links 404 (the slug is not in the guides catalogue):\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every bare route link has a page file", () => {
    const offenders: string[] = [];
    for (const [file, body] of bodies) {
      for (const m of body.matchAll(/href="(\/[a-z0-9-]*)"(?![#?])/gi)) {
        const route = m[1]!;
        if (route === "/") continue;
        const dir = path.join(ROOT, "src", "app", ...route.slice(1).split("/"));
        const hasPage = ["page.tsx", "page.ts", "route.ts"].some((p) =>
          existsSync(path.join(dir, p)),
        );
        if (!hasPage) offenders.push(`${relative(file)} → ${route}`);
      }
    }
    expect(
      offenders,
      `these route links have no page:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
