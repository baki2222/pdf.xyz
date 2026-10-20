// @vitest-environment jsdom
/**
 * The guide article as a route into its tool (design spec D.9, WP-13).
 *
 * Each property is read from the RENDERED page of every guide the route
 * prerenders — never from a typed list of guides or anchors:
 *
 *  - contents: one list of the article's own section anchors, as a
 *    `<details>` below `lg` and a sticky list in the left column from `lg`
 *    (the spec says `xl`; guide-contents.tsx says why the page uses `lg`);
 *    its links are exactly the `section[id]`s the article renders, so a
 *    section added later is listed by existing;
 *  - the sticky "Open {tool}" bar is the article's LAST child, so it rides
 *    the whole article and stops at its end, and it sits above the consent
 *    banner (`bottom: var(--sf-bottom-inset, 0px)`, published by the
 *    banner);
 *  - body copy is 16px at every width and in the reading colour (B.4);
 *  - "Related guides" lists only guides that share a tool with this one,
 *    never the guide itself. The predicate's positive control is below.
 */
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import GuidePage, { generateStaticParams } from "./[slug]/page";
import { getGuideBySlug, guides, type Guide } from "@/lib/guides";
import { getToolBySlug } from "@/lib/tools";

function parse(element: ReactElement): Document {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(element),
    "text/html",
  );
}

async function renderGuide(slug: string): Promise<Document> {
  return parse(await GuidePage({ params: Promise.resolve({ slug }) }));
}

const slugs = generateStaticParams().map((p) => p.slug);
const cls = (el: Element | null) => el?.getAttribute("class") ?? "";
const hasClass = (el: Element | null, c: string) =>
  cls(el).split(/\s+/).includes(c);

/** Why the related list `listed` is wrong for `guide`, or [] when it is not. */
function relatedProblems(guide: Guide, listed: readonly string[]): string[] {
  const problems: string[] = [];
  for (const slug of listed) {
    if (slug === guide.slug) problems.push(`${slug}: the guide itself`);
    const other = getGuideBySlug(slug);
    if (!other) {
      problems.push(`${slug}: not a guide`);
      continue;
    }
    if (!other.tools.some((t) => guide.tools.includes(t)))
      problems.push(`${slug}: shares no tool with ${guide.slug}`);
  }
  return problems;
}

describe("health", () => {
  it("the corpus is every guide the route prerenders", () => {
    expect(slugs).toEqual(guides.map((g) => g.slug));
    expect(slugs.length).toBeGreaterThanOrEqual(11);
  });
});

describe("contents", () => {
  it("lists exactly the article's own sections, collapsed below lg and sticky from lg", async () => {
    const wrong: string[] = [];
    for (const slug of slugs) {
      const doc = await renderGuide(slug);
      const sections = [...doc.querySelectorAll("article section[id]")].map(
        (s) => `#${s.id}`,
      );
      if (sections.length < 3)
        wrong.push(`${slug}: ${sections.length} sections`);

      const details = doc.querySelector("details[data-guide-contents]");
      const rail = doc.querySelector("nav[data-guide-contents]");
      if (!details || !rail) {
        wrong.push(
          `${slug}: contents missing (details ${!!details}, rail ${!!rail})`,
        );
        continue;
      }
      if (!hasClass(details, "lg:hidden"))
        wrong.push(`${slug}: the <details> shows from lg`);
      if (!hasClass(rail, "max-lg:hidden"))
        wrong.push(`${slug}: the rail shows below lg`);
      if (!hasClass(rail, "lg:sticky"))
        wrong.push(`${slug}: the rail is not sticky`);
      for (const [name, box] of [
        ["details", details],
        ["rail", rail],
      ] as const) {
        const hrefs = [...box.querySelectorAll("a")].map(
          (a) => a.getAttribute("href") ?? "",
        );
        if (JSON.stringify(hrefs) !== JSON.stringify(sections))
          wrong.push(
            `${slug} ${name}: ${hrefs.join(" ")} != ${sections.join(" ")}`,
          );
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("the sticky open bar", () => {
  it("is the article's last child, below lg only, above the consent banner, and opens the primary tool", async () => {
    const wrong: string[] = [];
    for (const slug of slugs) {
      const guide = getGuideBySlug(slug)!;
      const primary = getToolBySlug(guide.tools[0]!)!;
      const doc = await renderGuide(slug);
      const bar = doc.querySelector("article")?.lastElementChild ?? null;
      for (const c of ["sticky", "lg:hidden"])
        if (!hasClass(bar, c)) wrong.push(`${slug}: last child lacks ${c}`);
      // The banner's inset, with a 0px fallback: unset, a bare var() would
      // make `bottom` invalid, and a sticky bar with no bottom never sticks.
      // An inline style (the stylesheet is at its ceiling), so read that.
      const bottom = bar?.getAttribute("style")?.replace(/\s+/g, "") ?? "";
      if (!bottom.includes("bottom:var(--sf-bottom-inset,0px)"))
        wrong.push(`${slug}: the bar does not sit on --sf-bottom-inset`);
      const link = bar?.querySelector(`a[href="/tools/${primary.slug}"]`);
      if (!link?.textContent?.includes(`Open ${primary.name}`))
        wrong.push(`${slug}: the bar does not open ${primary.name}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("body copy is 16px at every width, in the reading colour", () => {
  it("intro, steps, section paragraphs and FAQ answers", async () => {
    const wrong: string[] = [];
    for (const slug of slugs) {
      const guide = getGuideBySlug(slug)!;
      const doc = await renderGuide(slug);
      const texts = [
        ...guide.intro,
        ...guide.steps,
        ...guide.sections.flatMap((s) => s.body),
        ...guide.faq.map((f) => f.answer),
      ];
      for (const text of texts) {
        const el = [...doc.body.querySelectorAll("*")]
          .filter((e) => e.textContent?.trim() === text)
          .at(-1);
        const c = cls(el ?? null);
        // Unprefixed text-base: 16px at 390 as well as 1440. A smaller size
        // anywhere on the element (text-[15px], text-sm) is the old setting.
        if (
          !/(?:^|\s)text-base(?:\s|$)/.test(c) ||
          /text-\[1[0-5]px\]|text-sm|text-xs/.test(c)
        )
          wrong.push(`${slug}: size "${c}" — ${text.slice(0, 40)}`);
        if (!/(?:^|\s)text-fg(?:\s|$)/.test(c))
          wrong.push(`${slug}: colour "${c}" — ${text.slice(0, 40)}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("related guides", () => {
  it("POSITIVE CONTROL: the predicate rejects the guide itself and a guide sharing no tool", () => {
    const merge = getGuideBySlug("how-to-merge-pdf-files")!;
    const stranger = guides.find(
      (g) => !g.tools.some((t) => merge.tools.includes(t)),
    )!;
    expect(stranger).toBeDefined();
    expect(relatedProblems(merge, [merge.slug])).toHaveLength(1);
    expect(relatedProblems(merge, [stranger.slug])).toHaveLength(1);
  });

  it("are derived — each shares a tool — and exclude the current guide", async () => {
    const wrong: string[] = [];
    let listedAnywhere = 0;
    for (const slug of slugs) {
      const guide = getGuideBySlug(slug)!;
      const doc = await renderGuide(slug);
      const box = doc.querySelector("[data-related-guides]");
      const heading = [...doc.querySelectorAll("h2")].find(
        (h) => h.textContent?.trim() === "Related guides",
      );
      const sharing = guides.filter(
        (g) => g.slug !== slug && g.tools.some((t) => guide.tools.includes(t)),
      );
      if (sharing.length === 0) {
        // Nothing shares a tool: no heading may claim relatedness.
        if (heading) wrong.push(`${slug}: "Related guides" with no neighbour`);
        continue;
      }
      if (!box || !heading) {
        wrong.push(
          `${slug}: no Related guides, though ${sharing.length} share a tool`,
        );
        continue;
      }
      const listed = [...box.querySelectorAll("a[href^='/guides/']")]
        .map((a) => a.getAttribute("href")!.replace("/guides/", ""))
        .filter((s) => s.length > 0);
      listedAnywhere += listed.length;
      if (listed.length === 0) wrong.push(`${slug}: empty Related guides`);
      wrong.push(...relatedProblems(guide, listed));
    }
    expect(wrong).toEqual([]);
    // Health: the walk saw real lists.
    expect(listedAnywhere).toBeGreaterThanOrEqual(slugs.length);
  });
});
