// @vitest-environment jsdom
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { BOOKLET_RUN_LABEL } from "@/lib/pdf/booklet";
import { getRunnerKind } from "@/lib/pdf/registry";
import {
  N_UP_RUN_LABEL,
  NUpEditor,
} from "@/components/tools/runner/n-up-editor";
import { BookletEditor } from "@/components/tools/runner/booklet-editor";
import type { LoadedPdf } from "@/components/tools/runner/use-single-pdf";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { getToolContent } from "@/lib/tools/content";
import { getToolBySlug, tools } from "@/lib/tools";
import { cardSummary } from "@/lib/tools/card-summary";
import { getGuideBySlug } from "@/lib/guides";
import {
  renderToolPages,
  type RenderedToolPage,
} from "@/tests/rendered-tool-pages";

/**
 * Multiple Pages per Sheet and PDF Booklet Maker share one runner kind
 * ('n-up'), so one panel module holds both editors' words, and a guard that
 * reads "the runner's labels" for a page reads its sibling's too. This holds
 * the other direction: neither page tells its reader to use a control, a
 * run button or a result only its SIBLING draws — a step telling a booklet
 * maker to press “Create sheets” is a button that is not on their page.
 *
 * Both halves are DERIVED (review of feat/booklet-pdf, 2026-11-10):
 *  - the labels are what each editor DRAWS — its section titles, chips,
 *    checkbox labels, buttons and result title, read off the rendered
 *    editor — minus what the other draws too (the paper names, the
 *    margins, “Download PDF”). WAS two typed lists that left out n-up's
 *    Orientation and Order and Booklet's Binding, Flip and Page order, so
 *    "Under Orientation, pick Landscape" on Booklet's page passed;
 *  - the words are what each page SERVES — the rendered page up to its
 *    Related tools band (the other tools' cards are theirs), plus the head
 *    copy and the catalogue's card lines the markup does not carry. WAS the
 *    content file alone, so the catalogue description the page renders
 *    under "About this tool" was never read: “Create sheets” quoted there
 *    passed 1,743 tests.
 */

afterEach(() => {
  cleanup();
  resetAnnouncer();
});

/** The editor each page on the 'n-up' kind draws (NUpRunner picks by slug). */
const EDITORS: Record<string, { editor: typeof NUpEditor; run: string }> = {
  "n-up-pdf": { editor: NUpEditor, run: N_UP_RUN_LABEL },
  "booklet-pdf": { editor: BookletEditor, run: BOOKLET_RUN_LABEL },
};

async function loaded(count: number): Promise<LoadedPdf> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= count; i += 1)
    doc.addPage([300, 400]).drawText(`P${i}`, { x: 20, y: 360, font });
  const bytes = await doc.save();
  return {
    file: new File([new Uint8Array(bytes)], "a.pdf", {
      type: "application/pdf",
    }),
    bytes,
    pageCount: count,
    rotations: Array(count).fill(0),
    digitalSignatures: 0,
  };
}

/** Every label an element draws for a control or a section. */
function labelsIn(root: HTMLElement): string[] {
  const text = (el: Element) =>
    (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return [
    ...[...root.querySelectorAll("h2, h3")].map(text),
    ...[...root.querySelectorAll("button")].map(text),
    // A checkbox's label is the first line of its text, before the hint.
    ...[...root.querySelectorAll("label:has(input[type=checkbox])")].map((l) =>
      text(l.querySelector("span > span") ?? l),
    ),
  ].filter((l) => l.length > 0);
}

/** What an editor draws, before and after a run (its result's title). */
async function drawnBy(slug: string): Promise<Set<string>> {
  const { editor: Editor, run } = EDITORS[slug]!;
  const pdf = await loaded(6);
  const element: ReactElement = <Editor pdf={pdf} onReset={() => {}} />;
  const { container } = render(element);
  const before = labelsIn(container);
  fireEvent.click(screen.getByRole("button", { name: run }));
  const headings = new Set(before);
  await screen.findByRole("button", { name: /download pdf/i });
  const after = labelsIn(container).filter((l) => !headings.has(l));
  cleanup();
  return new Set([...before, ...after]);
}

/** A label as a reader would meet it named as a control: letters, not "4". */
const isWordLabel = (l: string) => (l.match(/\p{L}/gu) ?? []).length >= 2;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether `text` names the control `label`: quoted (“label”, any case), or
 * spelled as the control spells it (case-sensitive, whole words) anywhere
 * but a sentence's first word — "Flip the stack" is a verb, "Under Flip"
 * is the control. Every catalogue tool's NAME is removed first: "Multiple
 * Pages per Sheet" is a tool, not the "Pages per sheet" control.
 */
function names(text: string, label: string): boolean {
  if (text.toLowerCase().includes(`“${label.toLowerCase()}”`)) return true;
  const word = new RegExp(
    `(?<![\\p{L}\\d])${escape(label)}(?![\\p{L}\\d])`,
    "gu",
  );
  for (const m of text.matchAll(word)) {
    const before = text.slice(0, m.index).trimEnd();
    if (before === "" || /[.!?:\n“"(]$/.test(before)) continue;
    return true;
  }
  return false;
}

const TOOL_NAMES = tools.map((t) => t.name).sort((a, b) => b.length - a.length);
const withoutToolNames = (text: string) =>
  TOOL_NAMES.reduce((t, name) => t.split(name).join("·"), text);

const named = (text: string, labels: Iterable<string>) => {
  const clean = withoutToolNames(text);
  return [...labels].filter((l) => names(clean, l));
};

const RELATED = "Related tools";

/** Everything a page on the kind serves in its own words. */
function servedText(slug: string, page: RenderedToolPage): string {
  const lines = page.blockText.split(String.fromCharCode(10));
  const cut = lines.indexOf(RELATED);
  if (cut < 0) {
    throw new Error(
      `${slug}: no "${RELATED}" band in the rendered page — the cut that keeps other tools' cards out is broken`,
    );
  }
  const tool = getToolBySlug(slug)!;
  const content = getToolContent(slug)!;
  return [
    content.seoTitle,
    content.metaDescription,
    tool.tagline,
    cardSummary(tool),
    tool.description,
    ...lines.slice(0, cut),
  ].join(String.fromCharCode(10));
}

let pages: Map<string, RenderedToolPage>;
const served = new Map<string, string>();
const only = new Map<string, string[]>();
const KIND = tools.filter((t) => getRunnerKind(t.slug) === "n-up");

beforeAll(async () => {
  pages = renderToolPages();
  for (const t of KIND)
    served.set(t.slug, servedText(t.slug, pages.get(t.slug)!));
  const drawn = new Map<string, Set<string>>();
  for (const slug of Object.keys(EDITORS)) drawn.set(slug, await drawnBy(slug));
  for (const [slug, labels] of drawn) {
    const others = [...drawn]
      .filter(([s]) => s !== slug)
      .flatMap(([, l]) => [...l]);
    only.set(
      slug,
      [...labels].filter((l) => !others.includes(l) && isWordLabel(l)),
    );
  }
}, 180_000);

describe("the two pages on the 'n-up' runner do not name each other's controls", () => {
  it("health: the kind's tools are exactly the two editors, and each set is real", () => {
    expect(KIND.map((t) => t.slug).sort()).toEqual(Object.keys(EDITORS).sort());
    const nUp = only.get("n-up-pdf")!;
    const booklet = only.get("booklet-pdf")!;
    // The controls the typed lists missed are in the derived ones.
    for (const l of [N_UP_RUN_LABEL, "Orientation", "Order", "Sheets created"])
      expect(nUp).toContain(l);
    for (const l of [
      BOOKLET_RUN_LABEL,
      "Binding",
      "Flip",
      "Page order",
      "Booklet created",
    ])
      expect(booklet).toContain(l);
    // Bounded both ways: neither collapsed, neither swallowed the page.
    for (const set of [nUp, booklet]) {
      expect(set.length).toBeGreaterThanOrEqual(8);
      expect(set.length).toBeLessThanOrEqual(40);
    }
    // Shared labels are in neither.
    expect(nUp.filter((l) => booklet.includes(l))).toEqual([]);
    expect(nUp).not.toContain("Margin");
  });

  it("health: each served text holds the page's own words and stops before its sibling's card", () => {
    for (const [slug, text] of served) {
      const content = getToolContent(slug)!;
      expect(text).toContain(getToolBySlug(slug)!.description);
      expect(text).toContain(content.steps.at(-1)!.body);
      expect(text).toContain(content.faqs.at(-1)!.a);
      const sibling = KIND.find((t) => t.slug !== slug)!;
      // The sibling's card is on the full page, and not in the cut.
      expect(pages.get(slug)!.blockText).toContain(cardSummary(sibling));
      expect(text).not.toContain(cardSummary(sibling));
    }
    // And each page names its OWN controls, so the predicate can see them.
    for (const [slug, text] of served) {
      expect(named(text, only.get(slug)!).length).toBeGreaterThanOrEqual(3);
    }
  });

  for (const slug of Object.keys(EDITORS)) {
    it(`${slug}'s page names none of its sibling's controls`, () => {
      const siblings = Object.keys(EDITORS).filter((s) => s !== slug);
      expect(
        named(
          served.get(slug)!,
          siblings.flatMap((s) => only.get(s)!),
        ),
      ).toEqual([]);
    });
  }

  it("positive controls: the sentences that got past the old guard are caught", () => {
    const booklet = served.get("booklet-pdf")!;
    const nUp = served.get("n-up-pdf")!;
    const nUpOnly = only.get("n-up-pdf")!;
    const bookletOnly = only.get("booklet-pdf")!;
    // In the catalogue description, which the old guard never read.
    expect(named(`${booklet}\nPress “Create sheets”.`, nUpOnly)).toEqual([
      N_UP_RUN_LABEL,
    ]);
    expect(
      named(`${booklet}\nUnder Orientation, pick Landscape.`, nUpOnly),
    ).toContain("Orientation");
    expect(
      named(
        `${nUp}\nFor a booklet, set Flip to the edge your printer turns and Binding to the side it opens from.`,
        bookletOnly,
      ).sort(),
    ).toEqual(["Binding", "Flip"]);
    // A sentence's first word is not a control; a tool's name is not either.
    expect(named("Flip the stack over.", bookletOnly)).toEqual([]);
    expect(named("Try Multiple Pages per Sheet.", ["Pages per sheet"])).toEqual(
      [],
    );
  });
});

describe("the two tools point at each other", () => {
  const guide = getGuideBySlug("how-to-print-multiple-pages-per-sheet")!;
  const bookletName = getToolBySlug("booklet-pdf")!.name;
  const nUpName = getToolBySlug("n-up-pdf")!.name;
  const booklet = getToolContent("booklet-pdf")!;

  it("each catalogue row lists the other as related", () => {
    expect(getToolBySlug("n-up-pdf")!.related).toContain("booklet-pdf");
    expect(getToolBySlug("booklet-pdf")!.related).toContain("n-up-pdf");
  });

  it("the n-up guide's booklet answer sends the reader to Booklet, and lists it", () => {
    const answer = guide.faq.find((f) => /booklet/i.test(f.question))!;
    expect(answer.answer).toContain(bookletName);
    // WAS "No. … there is no booklet ordering for folding and stapling" —
    // true of n-up alone, false of the site from 2026-11-09.
    expect(answer.answer).not.toMatch(/^No\b/);
    // Listed, so Booklet's page draws this guide in its Guides band
    // (guidesForTool reads guide.tools; content.relatedGuides only orders
    // it). It took Resize PDF's slot: three at most (guides/catalog.test).
    expect(guide.tools).toContain("booklet-pdf");
    const related = guide.sections.find((s) => s.id === "related-jobs")!;
    expect(related.body.join(" ")).toContain(bookletName);
  });

  it("Booklet's page offers the guide that names both tools", () => {
    expect(booklet.relatedGuides).toContain(guide.slug);
    expect(JSON.stringify(guide)).toContain(nUpName);
  });
});

describe("Booklet's page states its figures from the engine", () => {
  it("the programme use case: no blanks at its page count, and one page fewer keeps the last page outside", async () => {
    const { PROGRAMME_PAGES, SHORT_PROGRAMME_PAGES } =
      await import("@/lib/tools/content/booklet-pdf");
    const { bookletOrder, bookletPageSlots, DEFAULT_BOOKLET_OPTIONS } =
      await import("@/lib/pdf/booklet");
    expect(bookletPageSlots(PROGRAMME_PAGES)).toBe(PROGRAMME_PAGES);
    const outer = bookletOrder(SHORT_PROGRAMME_PAGES, {
      ...DEFAULT_BOOKLET_OPTIONS,
      backCover: true,
    })[0]!;
    // Sheet 1's front is the outside: the back cover on the left half.
    expect(outer.left).toBe(SHORT_PROGRAMME_PAGES);
  });

  // WAS "On A4 with the none margin, …" (review, 2026-11-10).
  it("names the margin as its chip does, in every served sentence", () => {
    const text = served.get("booklet-pdf")!;
    expect(text).not.toMatch(/\bthe (?:none|small|large) margin\b/i);
    expect(text).toContain("with Margin set to None");
  });
});
