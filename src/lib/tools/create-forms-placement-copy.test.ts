// @vitest-environment node
/**
 * Create Fillable Forms places a field on its page preview (backlog #17,
 * 2026-11-17): a click, a drag or the arrow keys write X and Y on the card.
 * Until then it placed fields only by typed numbers, and the copy said so in
 * five places. The feature rewrote three and the review found two more that
 * still served on /tools/create-forms (the visible FAQ and its FAQPage
 * JSON-LD): "placed by coordinates" in the signature answer and "By numbers:
 * pick the Page…" as the whole answer to "How do I place a field?". The
 * rewrite's own rule — every sentence that says placement is numbers-only
 * goes — was a commit message, and a commit message is not a guard.
 *
 * THE CORPUS IS DISCOVERED, not named: every string of the tool's content,
 * its FAQ entries and facts, every guide that lists the tool, and the source
 * text of every `create-forms*` runner module (the runner's own help is JSX).
 * Each is split into sentences and EACH is judged.
 *
 * Both directions are held (house rule 1): every sentence the product shipped
 * saying placement is numbers-only must be caught by some shape, and every
 * shape must catch some shipped sentence.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getToolContent } from "@/lib/tools/content";
import { guides } from "@/lib/guides/catalog";
import { modeFaq, toolFacts, toolFaq } from "@/lib/tools/tool-facts";
import { getToolBySlug } from "@/lib/tools";

const SLUG = "create-forms";

/** Shapes of "a field is placed by typed numbers, and only so". */
const NUMBERS_ONLY: Record<string, RegExp> = {
  placedBy:
    /\b(?:placed|places fields|adds [^.]*fields) by (?:typed )?(?:coordinates|(?:the )?numbers)\b/i,
  byNumbers: /^By numbers\b/i,
  noCanvas: /\bno canvas\b/i,
  dragElsewhere: /\bdrag fields into place on the page instead\b/i,
};

const OPEN = String.fromCodePoint(0x201c);
const CLOSE = String.fromCodePoint(0x201d);
const DASH = String.fromCodePoint(0x2014);

/** Sentences the product shipped, each a numbers-only claim (git history). */
const SHIPPED = [
  // the runner's coordinate help, until 3893026e
  "This adds classic fillable AcroForm fields by coordinates.",
  // the guide "How to create a fillable PDF form", until 3893026e
  "This tool places fields by typed coordinates.",
  "To drag fields into place on the page instead, or to add an empty signature field for someone to sign later, use Edit PDF: the tools in its Forms group drag out text fields, checkboxes, dropdowns, radio groups and signature fields, saved as real form fields, also in your browser.",
  // the tool page's intro, until 3893026e
  "This builder has no canvas for dragging fields into place and no signature field type: Edit PDF does both with the field tools in its Forms group, also in your browser.",
  // the FAQ "Can I style the fields or drag them into place?", until 3893026e
  "Not here: fields come in one plain default style, with no choice of font, colour or border, and are placed by the numbers on each card.",
  // the two offline answers the review of 12d551c5 found
  "No. It adds text fields, checkboxes, dropdowns, radio groups and list boxes, placed by coordinates.",
  `By numbers: pick the ${OPEN}Page${CLOSE}, then set ${OPEN}X${CLOSE} and ${OPEN}Y${CLOSE} ${DASH} points from the page's bottom-left corner, 72 to an inch ${DASH} and the field's ${OPEN}Width${CLOSE} and ${OPEN}Height${CLOSE}.`,
];

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === "object")
    for (const v of Object.values(value)) strings(v, out);
  return out;
}

const sentences = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * A sentence that also names the preview is not a numbers-ONLY claim: the
 * numbers on the card ARE how a field is placed, and the preview sets them.
 * Each served sentence a shape matches and only this lets through is listed
 * in {@link WITH_PREVIEW}, and each entry must still be served.
 */
const NAMES_PREVIEW = /\bpreview\b/i;

const caught = (sentence: string) =>
  NAMES_PREVIEW.test(sentence)
    ? []
    : Object.entries(NUMBERS_ONLY)
        .filter(([, re]) => re.test(sentence))
        .map(([name]) => name);

/** Served sentences a shape matches, true because they name the preview. */
const WITH_PREVIEW = [
  "Each field is placed by the numbers on its card, which you can type or set on a preview of the page: click where the field's bottom-left corner belongs, drag its box, or nudge it with the arrow keys.",
];

interface Said {
  source: string;
  text: string;
}

function corpus(): Said[] {
  const tool = getToolBySlug(SLUG)!;
  const out: Said[] = [];
  const add = (source: string, texts: string[]) => {
    for (const text of texts)
      for (const s of sentences(text)) out.push({ source, text: s });
  };
  add("content", strings(getToolContent(SLUG)));
  add("faq", strings([toolFaq(tool), modeFaq(tool), toolFacts(SLUG)]));
  for (const guide of guides.filter((g) => g.tools.includes(SLUG)))
    add(`guide ${guide.slug}`, strings(guide));
  const dir = path.join(process.cwd(), "src/components/tools/runner");
  for (const file of readdirSync(dir).filter(
    (f) => /^create-forms.*\.tsx?$/.test(f) && !/\.test\./.test(f),
  ))
    add(file, [readFileSync(path.join(dir, file), "utf8")]);
  return out;
}

describe("Create Forms: no sentence says a field is placed only by typed numbers", () => {
  it("every shipped numbers-only sentence is caught, and every shape catches one", () => {
    for (const s of SHIPPED) expect(caught(s), s).not.toEqual([]);
    // Every exemption is one: a shape matches it, and only the preview
    // lets it through.
    for (const s of WITH_PREVIEW) {
      expect(caught(s), s).toEqual([]);
      expect(
        Object.values(NUMBERS_ONLY).some((re) => re.test(s)),
        s,
      ).toBe(true);
    }
    for (const name of Object.keys(NUMBERS_ONLY))
      expect(
        SHIPPED.some((s) => caught(s).includes(name)),
        `${name} catches a shipped sentence`,
      ).toBe(true);
  });

  it("nothing served or rendered for the tool says so now", () => {
    const said = corpus();
    // Health: the corpus is the tool's whole copy, not a sliver of it, and
    // it holds the answer this guard was written for.
    const sources = new Set(said.map((s) => s.source));
    expect(sources.has("content")).toBe(true);
    expect(sources.has("faq")).toBe(true);
    expect([...sources].some((s) => s.startsWith("guide "))).toBe(true);
    expect(sources.has("create-forms-runner.tsx")).toBe(true);
    expect(sources.has("create-forms-preview.tsx")).toBe(true);
    expect(said.length).toBeGreaterThan(150);
    expect(said.some((s) => s.text === "How do I place a field?")).toBe(true);
    for (const s of WITH_PREVIEW)
      expect(
        said.some((d) => d.text === s),
        `exemption still served: ${s}`,
      ).toBe(true);
    const found = said
      .map((s) => ({ ...s, shapes: caught(s.text) }))
      .filter((s) => s.shapes.length > 0);
    expect(found).toEqual([]);
  });
});
