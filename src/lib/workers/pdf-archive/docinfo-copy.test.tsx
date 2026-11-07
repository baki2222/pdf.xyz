// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import content from "@/lib/tools/content/pdf-to-pdfa";
import { guides } from "@/lib/guides/catalog";
import { factFaq } from "@/lib/tools/tool-facts";
import { getToolBySlug } from "@/lib/tools";
import { PdfANotes } from "@/components/tools/pdfa-notes";
import type { Job } from "@/lib/jobs/types";
import { CARRIED_DOCINFO_RULE, CARRIED_DOCINFO_WORDS } from "./docinfo-words";

/**
 * Review 2026-11-08 (audit pdf-to-pdfa#3): the page intro said the server
 * writes the title, author, subject and keywords "into the copy itself, so
 * that notice does not mean they are gone", and the tool facts said they
 * "are written into the copy separately". Neither carried the condition,
 * and for a curly apostrophe, an accented letter, another script or an
 * encrypted file both were false.
 *
 * The guard DISCOVERS its subjects: every paragraph, on every surface that
 * reaches a reader of PDF to PDF/A, that names the carried fields. Each one
 * must state CARRIED_DOCINFO_RULE. A count bound keeps the corpus honest in
 * both directions.
 */
afterEach(cleanup);

function paragraphs(): Array<{ where: string; text: string }> {
  const out: Array<{ where: string; text: string }> = [];
  content.intro.forEach((text, i) => out.push({ where: `intro[${i}]`, text }));
  content.faqs.forEach((f) => out.push({ where: `faq: ${f.q}`, text: f.a }));
  content.steps.forEach((s) =>
    out.push({ where: `step: ${s.title}`, text: s.body }),
  );
  const tool = getToolBySlug("pdf-to-pdfa")!;
  factFaq(tool).forEach((f) =>
    out.push({ where: `tool fact: ${f.question}`, text: f.answer }),
  );
  const guide = guides.find((g) => g.slug === "how-to-convert-pdf-to-pdfa")!;
  JSON.stringify(guide, (_key, value: unknown) => {
    if (typeof value === "string") out.push({ where: "guide", text: value });
    return value;
  });
  const job = {
    results: { pdfa: { hadNotes: true, notes: ["discarding DOCINFO"] } },
  } as unknown as Job;
  const { container } = render(<PdfANotes job={job} />);
  container
    .querySelectorAll("p")
    .forEach((p) =>
      out.push({ where: "notes block", text: p.textContent ?? "" }),
    );
  return out;
}

describe("every sentence that says the fields are carried states the rule", () => {
  it("each paragraph naming the carried fields carries CARRIED_DOCINFO_RULE", () => {
    const naming = paragraphs().filter((p) =>
      p.text.includes(CARRIED_DOCINFO_WORDS),
    );
    // Intro, DOCINFO FAQ, tool fact, guide section, guide FAQ, notes block.
    // Fewer means a surface stopped being read; more means a new sentence.
    expect(naming.map((p) => p.where)).toHaveLength(6);
    for (const p of naming)
      expect(p.text, p.where).toContain(CARRIED_DOCINFO_RULE);
  });

  it("no surface says the notice does not mean the fields are gone, unqualified", () => {
    for (const p of paragraphs())
      if (/does not mean (they|those fields) are gone/.test(p.text))
        expect(p.text, p.where).toContain(CARRIED_DOCINFO_RULE);
  });
});
