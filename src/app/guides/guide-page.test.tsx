// @vitest-environment jsdom
/**
 * Long-form reading: the guides and the two policy pages, as rendered.
 *
 * WHAT SHIPPED: the guides are the pages written for search, and their body
 * copy was `text-muted text-sm leading-relaxed`, 14px across the full 768px
 * article column, well over 100 characters a line. `legal-page.tsx` did the
 * same while its docblock promised "a constrained measure". Nothing checked
 * the docblock, so it was a claim in the one place no test could fail. The
 * only way from a guide's steps to its tool was a small text link placed
 * above them.
 *
 * THE PROPERTY, for every string of guide body copy a reader receives (intro,
 * steps, section paragraphs, FAQ answers; enumerated from the catalogue, for
 * every guide the route prerenders) and for each policy page's body: the
 * nearest measure is set in `ch` on an element whose own font is at least
 * 15px, and the text itself is at least 15px. A `ch` width set on an element
 * with a different font size measures the wrong font, so the two must sit on
 * the same element.
 *
 * The POSITIVE CONTROL runs the predicate over the markup that shipped.
 */
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import GuidePage, { generateStaticParams } from "./[slug]/page";
import PrivacyPage from "../privacy/page";
import TermsPage from "../terms/page";
import { getGuideBySlug, guides, type Guide } from "@/lib/guides";

const MEASURE = /(?:^|\s)max-w-\[(\d+)ch\](?:\s|$)/;
/** Tailwind size classes at or above 15px, and the ones below it. */
const SIZE_OK =
  /(?:^|\s)(?:text-\[(1[5-9]|2\d)px\]|text-(?:base|lg|xl))(?:\s|$)/;
const SIZE_ANY =
  /(?:^|\s)(?:text-\[\d+px\]|text-(?:xs|sm|base|lg|xl|\dxl))(?:\s|$)/;

function parse(element: ReactElement): Document {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(element),
    "text/html",
  );
}

const cls = (el: Element) => el.getAttribute("class") ?? "";

function closest(el: Element, pattern: RegExp): Element | null {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (pattern.test(cls(n))) return n;
  }
  return null;
}

/** Why `el` is not set for reading, or null when it is. */
function unreadable(el: Element): string | null {
  const sized = closest(el, SIZE_ANY);
  if (!sized || !SIZE_OK.test(cls(sized))) {
    return `text size ${sized ? cls(sized) : "(none)"}`;
  }
  const measured = closest(el, MEASURE);
  if (!measured) return "no ch measure";
  const ch = Number(MEASURE.exec(cls(measured))?.[1]);
  if (ch < 45 || ch > 80) return `measure ${ch}ch`;
  if (!SIZE_OK.test(cls(measured))) {
    return `ch set on an element without its own reading size: ${cls(measured)}`;
  }
  return null;
}

/** Every body string a guide's reader receives. */
function bodyCopy(guide: Guide): string[] {
  return [
    ...guide.intro,
    ...guide.steps,
    ...guide.sections.flatMap((s) => s.body),
    ...guide.faq.map((f) => f.answer),
  ];
}

/** The innermost element whose whole text is `text`. */
function elementOf(doc: Document, text: string): Element | null {
  const all = [...doc.body.querySelectorAll("*")].filter(
    (el) => el.textContent?.trim() === text,
  );
  return all.at(-1) ?? null;
}

async function renderGuide(slug: string): Promise<Document> {
  return parse(await GuidePage({ params: Promise.resolve({ slug }) }));
}

const slugs = generateStaticParams().map((p) => p.slug);

describe("guide body copy is set for reading", () => {
  it("the corpus is every guide the route prerenders, and each has body copy", () => {
    expect(slugs).toEqual(guides.map((g) => g.slug));
    expect(slugs.length).toBeGreaterThanOrEqual(11);
    for (const slug of slugs) {
      expect(bodyCopy(getGuideBySlug(slug)!).length).toBeGreaterThan(5);
    }
  });

  it("the predicate rejects the markup that shipped", () => {
    const shipped = new DOMParser().parseFromString(
      `<article class="mx-auto max-w-3xl"><p class="text-muted text-sm leading-relaxed">x</p></article>`,
      "text/html",
    );
    expect(unreadable(shipped.querySelector("p")!)).toMatch(/text size/);
    // Size fixed, measure missing.
    const unmeasured = new DOMParser().parseFromString(
      `<article class="max-w-3xl"><p class="text-base">x</p></article>`,
      "text/html",
    );
    expect(unreadable(unmeasured.querySelector("p")!)).toBe("no ch measure");
    // A ch width on a wrapper at a different size measures the wrong font.
    const split = new DOMParser().parseFromString(
      `<div class="max-w-[70ch] text-sm"><p class="text-base">x</p></div>`,
      "text/html",
    );
    expect(unreadable(split.querySelector("p")!)).toMatch(/ch set on/);
  });

  it("every body string of every guide", async () => {
    const wrong: string[] = [];
    for (const slug of slugs) {
      const doc = await renderGuide(slug);
      for (const text of bodyCopy(getGuideBySlug(slug)!)) {
        const el = elementOf(doc, text);
        const why = el ? unreadable(el) : "not rendered";
        if (why) wrong.push(`${slug}: ${why} — ${text.slice(0, 50)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("every guide offers its tool as a button again after the steps", async () => {
    const wrong: string[] = [];
    for (const slug of slugs) {
      const guide = getGuideBySlug(slug)!;
      const doc = await renderGuide(slug);
      const steps = doc.getElementById("steps");
      const article = doc.querySelector("article");
      const after = [
        ...doc.querySelectorAll(`article a[href="/tools/${guide.tools[0]}"]`),
      ].filter(
        (a) =>
          steps &&
          steps.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
      if (!article || !steps || after.length === 0) wrong.push(slug);
    }
    expect(wrong).toEqual([]);
  });
});

describe("the policy pages keep the measure their shell promises", () => {
  for (const [name, Page] of [
    ["privacy", PrivacyPage],
    ["terms", TermsPage],
  ] as const) {
    it(`/${name}: every body paragraph is set for reading`, () => {
      const doc = parse(<Page />);
      const body = doc.querySelector(".legal-prose");
      expect(body, "the policy body container").not.toBeNull();
      const all = [...body!.querySelectorAll("p, li")];
      // A control's status line (the analytics choice on /privacy, an
      // `aria-live` region) is interface, not prose, and sets its own size.
      // Bounded, so the exclusion cannot quietly swallow the page.
      const paragraphs = all.filter((p) => !p.closest("[aria-live]"));
      expect(all.length - paragraphs.length).toBeLessThanOrEqual(2);
      // Health check: a policy with a handful of paragraphs rendered wrong.
      expect(paragraphs.length).toBeGreaterThan(10);
      const wrong = paragraphs
        .map((p) => [unreadable(p), p.textContent?.slice(0, 40)] as const)
        .filter(([why]) => why !== null);
      expect(wrong).toEqual([]);
    });
  }
});
