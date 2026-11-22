// @vitest-environment node
/**
 * Repair PDF asks its refusal question and its warnings question ONCE
 * (audit repair-pdf#7).
 *
 * The page authored "Why was my file refused before the repair started?" and
 * "What do the warnings after a repair mean?", and `factFaq` derived "Which
 * damaged files can Repair PDF take?" and "What does it mean when the repair
 * lists warnings?". `pageFaq` drops a derived question only when the author
 * asked it word for word, so the live page (and its FAQPage JSON-LD) carried
 * both of each pair. The authored entries now ask the derived questions in
 * the derived words, which retires the derived copies, and answer with the
 * derived fact PLUS the detail only the authored answer had.
 *
 * The topic patterns are held to every question the page has shipped on
 * these two topics (the corpus), and to a question on neither (the control).
 */
import { describe, expect, it } from "vitest";
import { getToolBySlug } from "@/lib/tools";
import { pageFaq } from "@/lib/tools/page-copy";
import { REPAIR_TAKES, REPAIR_WARNINGS_ANSWER } from "@/lib/tools/tool-facts";

const REFUSAL_TOPIC = /\brefused\b|\bwhich (?:damaged )?files\b/i;
const WARNINGS_TOPIC = /\bwarnings?\b/i;

/** Every question Repair PDF has shipped on the two topics. */
const SHIPPED = {
  refusal: [
    "Why was my file refused before the repair started?",
    "Which damaged files can Repair PDF take?",
  ],
  warnings: [
    "What do the warnings after a repair mean?",
    "What does it mean when the repair lists warnings?",
  ],
};

const repair = getToolBySlug("repair-pdf")!;

describe("Repair PDF asks each FAQ topic once", () => {
  it("the patterns catch every shipped question on their topic, and not the others", () => {
    for (const q of SHIPPED.refusal) {
      expect(q).toMatch(REFUSAL_TOPIC);
      expect(q).not.toMatch(WARNINGS_TOPIC);
    }
    for (const q of SHIPPED.warnings) {
      expect(q).toMatch(WARNINGS_TOPIC);
      expect(q).not.toMatch(REFUSAL_TOPIC);
    }
    const other = "Does repairing change how my pages look?";
    expect(other).not.toMatch(REFUSAL_TOPIC);
    expect(other).not.toMatch(WARNINGS_TOPIC);
  });

  it("health: the page has a FAQ of plausible size", () => {
    expect(repair).toBeDefined();
    expect(pageFaq(repair).length).toBeGreaterThanOrEqual(5);
  });

  it("one refusal question and one warnings question", () => {
    const qs = pageFaq(repair).map((f) => f.question);
    expect(
      qs.filter((q) => REFUSAL_TOPIC.test(q)),
      JSON.stringify(qs),
    ).toHaveLength(1);
    expect(
      qs.filter((q) => WARNINGS_TOPIC.test(q)),
      JSON.stringify(qs),
    ).toHaveLength(1);
    expect(new Set(qs.map((q) => q.toLowerCase())).size).toBe(qs.length);
  });

  it("no fact is lost: the derived answers and the authored detail are both still said", () => {
    const faq = pageFaq(repair);
    const refusal = faq.find((f) => REFUSAL_TOPIC.test(f.question))!;
    const warnings = faq.find((f) => WARNINGS_TOPIC.test(f.question))!;
    expect(refusal.answer).toContain(REPAIR_TAKES);
    expect(refusal.answer).toContain("%PDF-");
    expect(refusal.answer).toMatch(/HTML error page/);
    expect(refusal.answer).toMatch(/not retried/);
    expect(warnings.answer).toContain(REPAIR_WARNINGS_ANSWER);
    expect(warnings.answer).toMatch(/cross-reference table/);
  });
});
