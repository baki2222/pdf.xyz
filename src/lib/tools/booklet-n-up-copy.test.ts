// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  BOOKLET_BACK_COVER_LABEL,
  BOOKLET_BINDINGS,
  BOOKLET_DOUBLE_LABEL,
  BOOKLET_FLIPS,
  BOOKLET_RESULT_TITLE,
  BOOKLET_RUN_LABEL,
} from "@/lib/pdf/booklet";
import { N_UP_ORDERS, N_UP_RTL_LABEL, N_UP_SHEETS } from "@/lib/pdf/n-up";
import {
  N_UP_RESULT_TITLE,
  N_UP_RUN_LABEL,
} from "@/components/tools/runner/n-up-runner";
import { getToolContent } from "@/lib/tools/content";
import type { ToolContent } from "@/lib/tools/content/types";
import { getToolBySlug } from "@/lib/tools";
import { getGuideBySlug } from "@/lib/guides";

/**
 * Multiple Pages per Sheet and PDF Booklet Maker share one runner kind
 * ('n-up'), so one panel module holds both editors' words, and a guard that
 * reads "the runner's labels" for a page reads its sibling's too. This holds
 * the other direction: neither page's content quotes a control, run label
 * or result title only its SIBLING draws — a step telling a booklet maker
 * to press “Create sheets” would be a button that is not on their page.
 *
 * Labels the two editors share by design (the paper names, the margins,
 * “Download PDF”) are not in either set.
 */
const N_UP_ONLY = [
  N_UP_RUN_LABEL,
  N_UP_RESULT_TITLE,
  N_UP_RTL_LABEL,
  ...N_UP_ORDERS.map((o) => o.label),
  N_UP_SHEETS.find((s) => s.id === "source")!.label,
  "Pages per sheet",
  "Draw a thin border around each page",
];

const BOOKLET_ONLY = [
  BOOKLET_RUN_LABEL,
  BOOKLET_RESULT_TITLE,
  BOOKLET_BACK_COVER_LABEL,
  BOOKLET_DOUBLE_LABEL,
  ...BOOKLET_BINDINGS.map((b) => b.label),
  ...BOOKLET_FLIPS.map((f) => f.label),
];

/** Every sentence the page renders from its content file. */
const textOf = (c: ToolContent) =>
  [
    c.seoTitle,
    c.metaDescription,
    ...c.intro,
    ...c.useCases.flatMap((u) => [u.title, u.body]),
    ...c.steps.flatMap((s) => [s.title, s.body]),
    ...c.faqs.flatMap((f) => [f.q, f.a]),
  ].join("\n");

const quoted = (text: string, labels: readonly string[]) =>
  labels.filter((l) => text.toLowerCase().includes(l.toLowerCase()));

const nUp = getToolContent("n-up-pdf")!;
const booklet = getToolContent("booklet-pdf")!;

describe("the two pages on the 'n-up' runner do not quote each other's controls", () => {
  it("health check: both sets are real, and each page quotes its OWN labels", () => {
    expect(N_UP_ONLY.length).toBeGreaterThanOrEqual(6);
    expect(BOOKLET_ONLY.length).toBeGreaterThanOrEqual(6);
    expect(quoted(textOf(nUp), N_UP_ONLY).length).toBeGreaterThanOrEqual(3);
    expect(quoted(textOf(booklet), BOOKLET_ONLY).length).toBeGreaterThanOrEqual(
      5,
    );
    // The sets are disjoint, or a shared label would fail both pages.
    expect(quoted(N_UP_ONLY.join("\n"), BOOKLET_ONLY)).toEqual([]);
    expect(quoted(BOOKLET_ONLY.join("\n"), N_UP_ONLY)).toEqual([]);
  });

  it("Booklet's page quotes none of Multiple Pages per Sheet's", () => {
    expect(quoted(textOf(booklet), N_UP_ONLY)).toEqual([]);
  });

  it("Multiple Pages per Sheet's page quotes none of Booklet's", () => {
    expect(quoted(textOf(nUp), BOOKLET_ONLY)).toEqual([]);
  });

  it("positive control: one injected cross label is caught, each way", () => {
    const bad = {
      ...booklet,
      steps: [
        ...booklet.steps,
        { title: "Run", body: `Press “${N_UP_RUN_LABEL}”.` },
      ],
    };
    expect(quoted(textOf(bad), N_UP_ONLY)).toEqual([N_UP_RUN_LABEL]);
    const bad2 = {
      ...nUp,
      faqs: [
        ...nUp.faqs,
        { q: "Flip?", a: `Choose ${BOOKLET_FLIPS[1]!.label}.` },
      ],
    };
    expect(quoted(textOf(bad2), BOOKLET_ONLY)).toEqual([
      BOOKLET_FLIPS[1]!.label,
    ]);
  });
});

describe("the two tools point at each other", () => {
  const guide = getGuideBySlug("how-to-print-multiple-pages-per-sheet")!;
  const bookletName = getToolBySlug("booklet-pdf")!.name;
  const nUpName = getToolBySlug("n-up-pdf")!.name;

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
    expect(guide.tools).toContain("booklet-pdf");
    const related = guide.sections.find((s) => s.id === "related-jobs")!;
    expect(related.body.join(" ")).toContain(bookletName);
  });

  it("Booklet's page offers the guide that names both tools", () => {
    expect(booklet.relatedGuides).toContain(guide.slug);
    expect(JSON.stringify(guide)).toContain(nUpName);
  });
});
