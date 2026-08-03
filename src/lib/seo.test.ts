// @vitest-environment node
/**
 * Drift guard between a share-card image route and the page that has to point at it.
 *
 * Next.js will pick up an `opengraph-image.tsx` by file convention — but only if
 * nothing sets `openGraph.images` explicitly, and `buildMetadata` always does (it
 * falls back to the site-wide card). So an explicit value silently beats the file,
 * and a page that ships a beautiful custom card while still declaring the default
 * one renders the default. Nothing errors. Nothing warns. The card is simply never
 * used, and you only find out by pasting the link somewhere.
 *
 * That is two files that must agree with nothing tying them together — the same
 * shape as every other bug this codebase keeps finding. This is the tie: add a card
 * without wiring it, or wire a page at a card that does not exist, and the build
 * fails here instead of in someone's Slack preview.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildMetadata } from "./seo";

const APP_DIR = path.join(process.cwd(), "src", "app");

/** Every `opengraph-image.tsx` under `src/app`, as a route path. */
function cardRoutes(): { route: string; dir: string }[] {
  const found: { route: string; dir: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "opengraph-image.tsx") {
        const rel = path.relative(APP_DIR, dir).split(path.sep).filter(Boolean);
        found.push({ route: `/${rel.join("/")}`, dir });
      }
    }
  };
  walk(APP_DIR);
  return found;
}

/**
 * The site-wide card at `src/app/opengraph-image.tsx` is the one exception: it IS
 * `DEFAULT_SHARE_IMAGE_PATH`, so every page points at it by doing nothing.
 */
const SITE_WIDE = "/";

const routes = cardRoutes().filter((entry) => entry.route !== SITE_WIDE);

describe("buildMetadata leaves the title to the root layout when it has none", () => {
  /**
   * Next distinguishes a metadata object with NO `title` key from one whose
   * `title` is present and `undefined`. The first inherits the root layout's
   * `title.default`; the second declares the page has no title and wins over it,
   * leaving the document with none at all. Returning `{ title }` unconditionally
   * meant the homepage — the one page that passes no title — served zero title
   * elements the moment the layout stopped hand-writing one.
   *
   * `toHaveProperty` is the assertion that separates the two cases;
   * `expect(md.title).toBeUndefined()` passes either way and would not have
   * caught this.
   */
  it("omits the key entirely when no title is given", () => {
    expect(buildMetadata({ path: "/" })).not.toHaveProperty("title");
  });

  it("carries the title through when one is given", () => {
    expect(buildMetadata({ title: "Merge PDF", path: "/tools/merge-pdf" })).toHaveProperty(
      "title",
      "Merge PDF",
    );
  });
});

describe("share cards are wired to the pages they belong to", () => {
  it("finds the page cards, so a rename cannot quietly empty this suite", () => {
    // A guard that silently checks nothing is worse than no guard: it reads green.
    expect(routes.length).toBeGreaterThanOrEqual(3);
  });

  it.each(routes)("$route sets imagePath at its own card", ({ route, dir }) => {
    const page = path.join(dir, "page.tsx");
    const source = readFileSync(page, "utf8");
    // A dynamic segment builds the path from the slug, so match the literal route
    // for static pages and the segment-shaped template for dynamic ones.
    const expected = route.includes("[")
      ? "/opengraph-image`"
      : `imagePath: "${route}/opengraph-image"`;
    expect(
      source.includes(expected),
      `${route}/page.tsx ships an opengraph-image.tsx but never points imagePath at it, so buildMetadata's default card wins and the custom one is dead weight`,
    ).toBe(true);
  });

  it.each(routes)("$route pairs its card with a Twitter card", ({ route, dir }) => {
    // X reads `twitter:image` and ignores `og:image`, so a card that exists only as
    // an OpenGraph route is invisible on the platform people paste links into most.
    const twitter = path.join(dir, "twitter-image.tsx");
    expect(
      readdirSync(dir).includes("twitter-image.tsx"),
      `${route} has an opengraph-image.tsx but no twitter-image.tsx`,
    ).toBe(true);
    // Re-exported, never re-implemented — two hand-written cards drift.
    expect(readFileSync(twitter, "utf8")).toContain("./opengraph-image");
  });
});
