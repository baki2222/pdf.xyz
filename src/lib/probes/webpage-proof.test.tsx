// @vitest-environment jsdom
/**
 * The page the Webpage to PDF proof renders is one of ours, its expected text
 * is what our route renders, and its URL never appears in its own body.
 *
 * Until 2026-10-09 the proof rendered https://example.com/ and required
 * "Example Domain" — typed beside the spec, and true of the page only until
 * its owner replaced it (now it is only the `<title>`, which a correct render
 * never prints). These tests hold the replacement to OUR source in both
 * directions: the visible text is the `<h1>` the guide route renders, and the
 * print-footer check (`printChromeLeaks`, the predicate the proof runs) finds
 * nothing in that page's own visible text — but does find the URL the moment
 * it is printed, so the check can still fail.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GuidePage, {
  dynamicParams,
  generateStaticParams,
} from "@/app/guides/[slug]/page";
import { guides } from "@/lib/guides";
import { siteConfig } from "@/lib/site";
import { printChromeLeaks } from "@/lib/workers/html-render/print-chrome";
import {
  WEBPAGE_PROOF_MISSING_SLUG,
  pageShowsText,
  webpageProof404Url,
  webpageProofPage,
} from "./webpage-proof";

const page = webpageProofPage();
const slugOf = (url: string) => new URL(url).pathname.split("/").at(-1)!;

/** The guide as the route renders it, with what a print shows: no scripts. */
async function rendered(): Promise<Document> {
  const doc = new DOMParser().parseFromString(
    renderToStaticMarkup(
      await GuidePage({ params: Promise.resolve({ slug: slugOf(page.url) }) }),
    ),
    "text/html",
  );
  doc.querySelectorAll("script, style").forEach((el) => el.remove());
  return doc;
}

const prerendered = () => generateStaticParams().map((p) => p.slug);

describe("the page the proof renders", () => {
  it("is a guide our route prerenders, at the canonical origin", () => {
    expect(guides.length, "health: no guides").toBeGreaterThan(0);
    const url = new URL(page.url);
    expect(url.origin).toBe(new URL(siteConfig.url).origin);
    expect(url.pathname).toBe(`/guides/${slugOf(page.url)}`);
    expect(prerendered()).toContain(slugOf(page.url));
  });

  it("expects the h1 the route renders, and the rendered body shows it", async () => {
    const doc = await rendered();
    const h1 = doc.querySelectorAll("h1");
    expect(h1).toHaveLength(1);
    expect(h1[0]!.textContent).toBe(page.visible);
    expect(pageShowsText(doc.body.textContent ?? "", page.visible)).toBe(true);
  });

  it("never prints its own URL, so a URL in the PDF can only be the print footer", async () => {
    const body = (await rendered()).body.textContent ?? "";
    expect(body.length, "health: the page rendered no text").toBeGreaterThan(
      page.visible.length,
    );
    expect(printChromeLeaks(body, { sourceUrl: page.url })).toEqual([]);
  });

  it("POSITIVE CONTROL: the same check finds the URL once a footer prints it", async () => {
    const body = (await rendered()).body.textContent ?? "";
    expect(
      printChromeLeaks(`${body} ${page.url} 1/3`, { sourceUrl: page.url }),
    ).toContain("the page URL");
  });
});

describe("the 404 control", () => {
  it("names a guide slug the route refuses with a real 404", () => {
    // `dynamicParams = false`: a slug outside generateStaticParams is a 404,
    // not a soft one rendered with 200. That is what the control relies on.
    expect(dynamicParams).toBe(false);
    expect(prerendered()).not.toContain(WEBPAGE_PROOF_MISSING_SLUG);
    const url = new URL(webpageProof404Url());
    expect(url.origin).toBe(new URL(siteConfig.url).origin);
    expect(url.pathname).toBe(`/guides/${WEBPAGE_PROOF_MISSING_SLUG}`);
  });
});

describe("pageShowsText", () => {
  it("reads a ligature back however the extractor gives it", () => {
    expect(
      pageShowsText("How to merge PDF ﬁles Updated", "How to merge PDF files"),
    ).toBe(true);
    expect(
      pageShowsText("How to merge PDF fi les", "How to merge PDF files"),
    ).toBe(true);
    expect(
      pageShowsText("How  to\nmerge PDF files", "How to merge PDF files"),
    ).toBe(true);
  });

  it("refuses text the page does not show, and an empty expectation", () => {
    expect(pageShowsText("How to split a PDF", "How to merge PDF files")).toBe(
      false,
    );
    expect(pageShowsText("anything", "  ")).toBe(false);
  });
});

describe("the harness", () => {
  const harness = readFileSync("scripts/worker-prove-tools.ts", "utf8");

  it("renders this page and refuses this 404, and no longer relies on example.com", () => {
    const specs = harness
      .split(/\n  \{\n/)
      .filter((block) => block.includes('tool: "webpage-to-pdf"'));
    expect(specs, "health: the webpage-to-pdf specs are gone").toHaveLength(2);
    expect(specs.join("\n")).toContain("url: WEBPAGE_PROOF.url");
    expect(specs.join("\n")).toContain(
      "verifyPageOnly(WEBPAGE_PROOF.visible, {",
    );
    expect(specs.join("\n")).toContain("sourceUrl: WEBPAGE_PROOF.url");
    expect(specs.join("\n")).toContain("url: webpageProof404Url()");
    expect(harness).toContain("const WEBPAGE_PROOF = webpageProofPage();");
    expect(harness).not.toContain("example.com");
  });

  it("judges visible text with the ligature-tolerant reader", () => {
    const verify = harness.slice(harness.indexOf("function verifyPageOnly"));
    expect(verify.slice(0, verify.indexOf("\n}\n"))).toContain(
      "pageShowsText(text, visible)",
    );
  });
});
