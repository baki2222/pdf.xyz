// @vitest-environment node
/**
 * A 404 must not claim to be the home page.
 *
 * WHAT SHIPPED: the root layout's metadata carried `alternates: { canonical:
 * "/" }` and `robots: { index: true, follow: true }`. Next merges metadata by
 * key down the tree, and `not-found.tsx` declared none, so production's
 * https://pdf.xyz/tools/nope (status 404) served the home page's title,
 * `<meta name="robots" content="index, follow"/>` next to Next's own
 * `noindex`, and `<link rel="canonical" href="https://pdf.xyz"/>` — every dead
 * URL declared itself a duplicate of `/`. Measured 2026-09-20.
 *
 * THE PROPERTY: page identity (canonical, og:url, an explicit index/follow)
 * is declared per page, never inherited from a layout; and the 404 declares
 * its own title and `noindex`. The layouts are DISCOVERED by walking
 * `src/app`, so a nested layout added later is held to the same rule.
 *
 * The 404's head is modelled here with Next's merge rule (a child key
 * replaces the parent's key wholesale). The model is not the consumer — the
 * built `_not-found` head was also read from `next build` output when this
 * landed — so the model is kept deliberately to that one rule.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { describe, expect, it, vi } from "vitest";
import { siteConfig } from "@/lib/site";

// The layout's fonts are build-time Next transforms with no meaning under
// vitest; only the `metadata` export is under test.
vi.mock("next/font/local", () => ({ default: () => ({ variable: "" }) }));
vi.mock("geist/font/sans", () => ({ GeistSans: { variable: "" } }));
vi.mock("geist/font/mono", () => ({ GeistMono: { variable: "" } }));

const APP = path.join(process.cwd(), "src", "app");

function discoverLayouts(dir = APP): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...discoverLayouts(full));
    else if (/^layout\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

async function metadataOf(file: string): Promise<Metadata> {
  const rel = path
    .relative(APP, file)
    .split(path.sep)
    .join("/")
    .replace(/\.tsx?$/, "");
  const mod = (await import(/* @vite-ignore */ `./${rel}`)) as {
    metadata?: Metadata;
  };
  return mod.metadata ?? {};
}

/** Next's merge, reduced to the one rule that matters here. */
function merged(parent: Metadata, child: Metadata): Metadata {
  return { ...parent, ...child };
}

describe("page identity is never inherited from a layout", () => {
  it("the walk finds the root layout (health check)", () => {
    const layouts = discoverLayouts().map((f) => path.relative(APP, f));
    expect(layouts, `layouts: ${layouts.join(", ")}`).toContain("layout.tsx");
    expect(layouts.length).toBeLessThan(10);
  });

  it("no layout declares a canonical, an og:url, or robots", async () => {
    const offenders: string[] = [];
    for (const file of discoverLayouts()) {
      const meta = await metadataOf(file);
      const where = path.relative(APP, file);
      if (meta.alternates?.canonical !== undefined)
        offenders.push(`${where}: alternates.canonical`);
      if (meta.openGraph && "url" in meta.openGraph)
        offenders.push(`${where}: openGraph.url`);
      if (meta.robots !== undefined) offenders.push(`${where}: robots`);
    }
    expect(offenders).toEqual([]);
  });

  it("the 404 resolves to its own title, noindex, and no canonical", async () => {
    const root = await metadataOf(path.join(APP, "layout.tsx"));
    const notFound = (await import("./not-found")).metadata;
    const head = merged(root, notFound);

    expect(head.title).toBe("Page not found");
    expect(head.robots).toMatchObject({ index: false });
    expect(head.alternates?.canonical).toBeUndefined();
    expect(head.openGraph && "url" in head.openGraph).toBeFalsy();
  });

  it("positive control: the home page still resolves its own canonical and robots", async () => {
    // Without this, the checks above pass just as well for a site where NO
    // page has a canonical — the root's was the home page's only source once.
    const root = await metadataOf(path.join(APP, "layout.tsx"));
    const home = merged(root, (await import("./page")).metadata);
    expect(home.alternates?.canonical).toBe(
      new URL("/", siteConfig.url).toString(),
    );
    expect(home.robots).toMatchObject({ index: true, follow: true });
    expect(home.openGraph && "url" in home.openGraph).toBeTruthy();
  });
});
