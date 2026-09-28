// @vitest-environment jsdom
/**
 * Where the homepage's "Start for free" buttons go.
 *
 * WHAT SHIPPED: both (the hero and the closing band) linked `/workspace`, a
 * noindex staging page that processes nothing, reached with no files. The
 * drop zone that does start something sat beside the first of them.
 *
 * THE PROPERTY, read from the rendered homepage: every "Start for free" is a
 * fragment link to an element ON THE SAME PAGE, and that element holds a file
 * input. The set of buttons is discovered from the render, not named, and is
 * bounded so a render that lost them cannot pass by having none.
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

/** "Start for free" links that do not land on a file input on this page. */
function strandedStarts(doc: Document): string[] {
  return [...doc.querySelectorAll("a")]
    .filter((a) => /Start for free/.test(a.textContent ?? ""))
    .map((a) => a.getAttribute("href") ?? "")
    .filter((href) => {
      if (!href.startsWith("#")) return true;
      const target = doc.getElementById(href.slice(1));
      return !target?.querySelector('input[type="file"]');
    });
}

describe("Start for free", () => {
  it("appears on the homepage at all (the health check)", () => {
    const starts = [...home().querySelectorAll("a")].filter((a) =>
      /Start for free/.test(a.textContent ?? ""),
    );
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(starts.length).toBeLessThanOrEqual(4);
  });

  it("the predicate sees the shape that shipped", () => {
    // Positive control: the render with its targets pointed back at the old
    // destination, and with the zone's id removed.
    const doc = home();
    const starts = [...doc.querySelectorAll("a")].filter((a) =>
      /Start for free/.test(a.textContent ?? ""),
    );
    const target = starts[0]!.getAttribute("href") ?? "";
    starts[0]!.setAttribute("href", "/workspace");
    expect(strandedStarts(doc)).toEqual(["/workspace"]);
    // And a fragment whose element is gone strands every button aimed at it.
    const again = home();
    again.getElementById(target.slice(1))?.removeAttribute("id");
    expect(strandedStarts(again)).toEqual(starts.map(() => target));
  });

  it("every one lands on the drop zone on the same page", () => {
    expect(strandedStarts(home())).toEqual([]);
  });
});
