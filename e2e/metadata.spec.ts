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

/** One route per distinct layout shape, so a regression anywhere is visible. */
const ROUTES = [
  { path: "/", title: "pdf.xyz — Every PDF tool. Private by design." },
  { path: "/tools", title: "All PDF tools — pdf.xyz" },
  { path: "/tools/merge-pdf", title: "Merge PDF — pdf.xyz" },
  { path: "/tools/ocr-pdf", title: "OCR PDF — pdf.xyz" },
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

      const titles = titlesIn(await res.text());

      // The HTML spec allows one title element in a head; more than one also
      // means something outside the `metadata` export is emitting document
      // metadata, which is where the shadowing came from.
      expect(
        titles,
        `expected a single <title>, got ${titles.length}: ${JSON.stringify(titles)}`,
      ).toHaveLength(1);
      expect(titles[0]).toBe(route.title);
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
