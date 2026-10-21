// @vitest-environment node
/**
 * The home page's tool cards speak to a first-time visitor (owner's brief,
 * 2026-10-21: "it looks like advanced developer style; users struggle to
 * understand"). Each card carries `cardSummary(tool)` and its mode's
 * `plain` badge; this file holds both to a length and a vocabulary.
 *
 * THE BAN LIST HAS A CORPUS, IN BOTH DIRECTIONS (CLAUDE.md rule 1). The
 * corpus is what a visitor was actually shown before this change: the
 * taglines the home page's catalogue printed for these tools, and the mono
 * mode labels every row carried — the latter DERIVED from `processingMeta`,
 * so a renamed label is still in it. Every corpus entry must be caught by
 * some pattern (a synonym cannot walk past), and every pattern must catch
 * some entry (a pattern nothing exercises is decoration).
 */
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { processingMeta } from "./processing";
import { cardSummary } from "./page-copy";

/** The longest one-line summary a card may carry. */
const CARD_SUMMARY_MAX = 90;

/**
 * Words a card must not say to a visitor. Each is the specialist's word for
 * something the card can say plainly — or, for the mode labels, the
 * infrastructure's name for "a server".
 */
const CARD_JARGON: readonly RegExp[] = [
  /\bworkers?\b/i,
  /\bin-browser\b/i,
  /\bhybrid\b/i,
  /\blineari[sz]/i,
  /\bghostscript\b/i,
  /\bPDF\/A-\d/i,
  /\bDOCX?\b/,
  /\bCSV\b/,
  /\bTL;DR\b/i,
  /\bstructured\b/i,
  /\blossless(ly)?\b/i,
  /\brender\b/i,
];

/**
 * What shipped: the taglines the home catalogue showed for the tools that now
 * carry a `cardSummary` (verbatim, 2026-10-21), and the mode labels.
 */
const SHIPPED_JARGON: readonly string[] = [
  "Analyze size and optimize losslessly.",
  "Fast-loading, linearized PDFs.",
  "DOCX and DOC into a shareable PDF.",
  "Render HTML files as PDF.",
  "Archive-oriented PDF/A-2b, made with Ghostscript.",
  "Detected tables into CSV/Excel.",
  "Key points and TL;DR in seconds.",
  "Pull structured fields from PDFs.",
  "Editable DOCX from a PDF's text and pictures.",
  "Export pages as lossless PNGs.",
  "Render pages as JPG images.",
  // The mono labels each row wore, from the table they came from. "AI" is
  // the one that stays: it is a word visitors use.
  ...Object.values(processingMeta)
    .map((m) => m.short)
    .filter((s) => s !== "AI"),
];

const jargonIn = (text: string) =>
  CARD_JARGON.filter((p) => p.test(text)).map(String);

describe("the home card's words", () => {
  it("health: the corpus and the summaries are the real sets", () => {
    expect(SHIPPED_JARGON.length).toBeGreaterThanOrEqual(14);
    expect(tools.length).toBeGreaterThanOrEqual(40);
    // The mono labels are in it, so the derivation found the table.
    expect(SHIPPED_JARGON).toContain("Secure worker");
    expect(SHIPPED_JARGON).toContain("In-browser");
  });

  it("every shipped specialist line is caught by some pattern", () => {
    expect(SHIPPED_JARGON.filter((s) => jargonIn(s).length === 0)).toEqual([]);
  });

  it("every pattern catches some shipped line", () => {
    expect(
      CARD_JARGON.filter((p) => !SHIPPED_JARGON.some((s) => p.test(s))).map(
        String,
      ),
    ).toEqual([]);
  });

  it("no card summary uses a word on the list", () => {
    const offenders = tools
      .map((t) => ({ slug: t.slug, text: cardSummary(t) }))
      .filter((c) => jargonIn(c.text).length > 0)
      .map((c) => `${c.slug}: ${c.text} (${jargonIn(c.text).join(", ")})`);
    expect(offenders).toEqual([]);
  });

  it(`every card summary is one short line: at most ${CARD_SUMMARY_MAX} characters, one sentence`, () => {
    const offenders = tools
      .map((t) => ({ slug: t.slug, text: cardSummary(t) }))
      .filter(
        (c) =>
          c.text.length > CARD_SUMMARY_MAX ||
          c.text.length < 10 ||
          // One sentence: a full stop only at the end.
          /\.\s+\S/.test(c.text),
      )
      .map((c) => `${c.slug} (${c.text.length}): ${c.text}`);
    expect(offenders).toEqual([]);
  });

  it("positive control: the length and sentence predicates fire", () => {
    const long = "x".repeat(CARD_SUMMARY_MAX + 1);
    expect(long.length > CARD_SUMMARY_MAX).toBe(true);
    expect(/\.\s+\S/.test("One thing. Another.")).toBe(true);
  });

  it("every mode's badge is in plain words", () => {
    for (const [mode, meta] of Object.entries(processingMeta))
      expect(jargonIn(meta.plain), mode).toEqual([]);
  });

  it("a summary that replaces a tagline is a different line, not a copy", () => {
    for (const t of tools)
      if (t.cardSummary !== undefined)
        expect(t.cardSummary, t.slug).not.toBe(t.tagline);
  });
});
