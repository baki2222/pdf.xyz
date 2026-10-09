// @vitest-environment jsdom
/**
 * Where the homepage's start links go.
 *
 * WHAT SHIPPED: both "Start for free" buttons (the hero and the closing band)
 * linked `/workspace`, a noindex staging page that processes nothing,
 * reached with no files. The drop zone that does start something sat beside
 * the first of them.
 *
 * THE PROPERTY, read from the rendered homepage: every start link is a
 * fragment link to an element ON THE SAME PAGE, and that element holds a file
 * input. The set of links is discovered from the render, not named, and is
 * bounded so a render that lost them cannot pass by having none.
 *
 * INVERTED 2026-10-10 (WP-05), history kept. This file found its links by
 * the words "Start for free" and required two to four of them. The desk made
 * "Choose files" the page's first action — the hero's own button is now the
 * desk's picker, and the closing band says "Choose files" and opens it — so
 * a search for the old words found none and the health check went red, for
 * the right reason. The set is now DISCOVERED by shape as well as by words:
 * every bare fragment link on the page, and every link reading "Choose
 * files" or "Start for free" (so a returning old label is still held to the
 * rule), with at least one required. Each must land on a file input inside
 * the desk itself.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";

function home(): Document {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(<HomePage />),
    "text/html",
  );
}

const START_WORDS = /Choose files|Start for free/i;

/** The page's start links: bare fragments, and the start CTA's words. */
function startLinks(doc: Document): HTMLAnchorElement[] {
  return [...doc.querySelectorAll("a")].filter(
    (a) =>
      (a.getAttribute("href") ?? "").startsWith("#") ||
      START_WORDS.test(a.textContent ?? ""),
  );
}

/** Start links that do not land on the desk's file input on this page. */
function strandedStarts(doc: Document): string[] {
  return startLinks(doc)
    .map((a) => a.getAttribute("href") ?? "")
    .filter((href) => {
      if (!href.startsWith("#")) return true;
      const target = doc.getElementById(href.slice(1));
      return !target?.querySelector('[data-desk] input[type="file"]');
    });
}

describe("the homepage's start links", () => {
  it("appear on the homepage at all (the health check)", () => {
    const starts = startLinks(home());
    expect(starts.length).toBeGreaterThanOrEqual(1);
    expect(starts.length).toBeLessThanOrEqual(4);
  });

  it("the predicate sees the shape that shipped", () => {
    // Positive control: the render with its target pointed back at the old
    // destination, and with the desk's id removed.
    const doc = home();
    const starts = startLinks(doc);
    const target = starts[0]!.getAttribute("href") ?? "";
    starts[0]!.setAttribute("href", "/workspace");
    expect(strandedStarts(doc)).toEqual(["/workspace"]);
    // And a fragment whose element is gone strands every link aimed at it.
    const again = home();
    again.getElementById(target.slice(1))?.removeAttribute("id");
    expect(strandedStarts(again)).toEqual(startLinks(again).map(() => target));
  });

  it("every one lands on the desk's picker, on the same page", () => {
    expect(strandedStarts(home())).toEqual([]);
  });

  it("the desk's own first action is its picker, a labelled file input", () => {
    const doc = home();
    const input = doc.querySelector<HTMLInputElement>(
      '[data-desk] input[type="file"]',
    );
    expect(input?.closest("label")?.textContent).toMatch(/Choose files/);
  });
});
