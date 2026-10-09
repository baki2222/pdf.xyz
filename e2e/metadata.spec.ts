import { test, expect } from "@playwright/test";

/**
 * Document metadata in the SERVED markup.
 *
 * These assertions deliberately use the `request` fixture rather than `page`,
 * because the bug they exist to catch is invisible to a browser. The root
 * layout used to render a hand-written `<title>` next to its `metadata`
 * export, so every page below it served two title elements with the generic
 * brand one first. React then hoists a corrected title during hydration, which
 * means `document.title` — and therefore `expect(page).toHaveTitle(...)` — was
 * already RIGHT while the served HTML was wrong. A test written the obvious way
 * would have passed throughout, and consumers that never run JavaScript (social
 * unfurlers, feed readers, most SEO crawlers, `curl`) kept reading the first,
 * generic title. Fetch the bytes; do not ask the DOM.
 */

/**
 * A tool page's title is its OWN when it is the title its metadata export
 * declared, which the same export also serves as `og:title`, and when it
 * names the tool the page's H1 names. These rows were the literals
 * "Merge PDF — pdf.xyz" and "OCR PDF — pdf.xyz"; the seo/content merge gave
 * every tool an authored search title, the served page became "Merge PDF
 * Files Online — Combine in Your Browser — pdf.xyz", and the spec failed on
 * wording while the property held. Importing the app's pageTitle() was tried
 * and cannot load here: the copy modules reach pdf.js, which Playwright's
 * loader cannot evaluate. So the expectation is read from the served bytes,
 * as everything else in this file is.
 */
const OWN = "the page's own title" as const;

function attr(html: string, property: string): string | undefined {
  const tag = html.match(
    new RegExp(`<meta[^>]*property="${property}"[^>]*>`),
  )?.[0];
  return tag?.match(/content="([^"]*)"/)?.[1];
}

function ownTitle(html: string, path: string): string {
  const og = attr(html, "og:title");
  const h1 = html
    .match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]
    ?.replace(/<[^>]+>/g, "")
    .trim();
  // Health checks: without both, "equals og:title" could hold vacuously.
  expect(og, `${path}: no og:title served`).toBeTruthy();
  expect(h1, `${path}: no h1 served`).toBeTruthy();
  expect(og, `${path}: og:title is the brand's, not the page's`).not.toBe(
    "pdf.xyz — Every PDF tool. Private by design.",
  );
  expect(og, `${path}: the title does not name the page's H1`).toContain(h1);
  return og!;
}

/** One route per distinct layout shape, so a regression anywhere is visible. */
const ROUTES = [
  { path: "/", title: "pdf.xyz — Every PDF tool. Private by design." },
  { path: "/tools", title: "All PDF tools — pdf.xyz" },
  // A category landing page — the shape added with /tools/category/[category].
  {
    path: "/tools/category/ai",
    title: "AI PDF tools: chat, summarize, translate — pdf.xyz",
  },
  { path: "/tools/merge-pdf", title: OWN },
  { path: "/tools/ocr-pdf", title: OWN },
  { path: "/workspace", title: "Workspace — pdf.xyz" },
  // The guides section — two shapes: the index and an article.
  { path: "/guides", title: "PDF guides — pdf.xyz" },
  {
    path: "/guides/how-to-merge-pdf-files",
    title: "How to merge PDF files — pdf.xyz",
  },
];

/** Title elements in source order, exactly as a non-JS consumer parses them. */
function titlesIn(html: string): string[] {
  return [...html.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/g)].map(
    (m) => m[1]!,
  );
}

test.describe("served document metadata", () => {
  for (const route of ROUTES) {
    test(`${route.path} serves exactly one title, and it is the page's own`, async ({
      request,
    }) => {
      const res = await request.get(route.path);
      expect(res.status()).toBe(200);

      const html = await res.text();
      const titles = titlesIn(html);

      // The HTML spec allows one title element in a head; more than one also
      // means something outside the `metadata` export is emitting document
      // metadata, which is where the shadowing came from.
      expect(
        titles,
        `expected a single <title>, got ${titles.length}: ${JSON.stringify(titles)}`,
      ).toHaveLength(1);
      expect(titles[0]).toBe(
        route.title === OWN ? ownTitle(html, route.path) : route.title,
      );
    });
  }

  test("no route serves the brand title ahead of a page title", async ({
    request,
  }) => {
    // The failure this pins is specifically about ORDER: two titles where the
    // generic one happens to come second would still be wrong markup, but it
    // would not have changed what crawlers displayed. Assert the shape that
    // actually misled them.
    const generic = "pdf.xyz — Every PDF tool. Private by design.";
    for (const route of ROUTES.filter((r) => r.path !== "/")) {
      const titles = titlesIn(await (await request.get(route.path)).text());
      expect(titles[0], `${route.path} leads with the brand title`).not.toBe(
        generic,
      );
    }
  });
});
