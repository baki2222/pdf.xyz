/**
 * EVERY sentence of HTML to PDF's static copy that says something about a
 * ZIP says WHEN: "when our server can open ZIP files" (or one of its two
 * shipped respellings). Static copy cannot know whether the running worker
 * proves `htmlZip`, and while it does not, production refuses every ZIP (a
 * 501 at the upload, a refusal at the pick) — so an unhedged ZIP sentence
 * is false of the running system for as long as the worker image is old.
 *
 * Behaviour review 2026-11-14 found two that were not: the size sentence
 * ("One HTML file, pasted page or ZIP of up to X per run") and the guide's
 * "How large can the HTML file be?". The implementer's own rule — every ZIP
 * sentence carries the hedge — was a comment, and a comment is not a guard.
 *
 * THE CORPUS IS DISCOVERED, not named: every string reachable from the
 * tool's content, its FAQ entries, every guide that lists the tool, and the
 * panel's string literals. A question makes no claim, so strings ending in
 * "?" are not judged. Both directions are held (house rule 1): every
 * sentence the review caught must FAIL the predicate, and every hedge
 * shape must be exercised by some shipped string.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getToolContent } from "@/lib/tools/content";
import { guides } from "@/lib/guides/catalog";
import { modeFaq, toolFacts, toolFaq } from "@/lib/tools/tool-facts";
import { getToolBySlug } from "@/lib/tools";

const SLUG = "html-to-pdf";

/** The shapes of the hedge, each one shipped (see the corpus check below). */
const HEDGES: Record<string, RegExp> = {
  server: /\bwhen our server can open ZIP files\b/i,
  page: /\bwhen the page offers ZIP\b/i,
  dropZone: /\bwhen the drop zone takes a ZIP\b/i,
};

const mentionsZip = (s: string) => /\bzip\b/i.test(s);
const hedged = (s: string) => Object.values(HEDGES).some((re) => re.test(s));
const judged = (s: string) => mentionsZip(s) && !s.trim().endsWith("?");

/** What the review caught, as shipped: each must be refused by the predicate. */
const CAUGHT_UNHEDGED = [
  "One HTML file, pasted page or ZIP of up to 20.0 MB per run, the most Chromium is handed: a larger file is refused as soon as you pick it, before anything is uploaded, and pasted code over it is marked in the box and not sent.",
  "One HTML file, pasted page or ZIP of up to 20.0 MB is accepted per run.",
  "Up to 20 MB, one file, pasted page or ZIP per run; a larger file is refused when you pick it, before anything is sent, and pasted code over it is marked in the box and not sent.",
  "Yes, within a fixed budget of rendering time, so a chart or table built by script can appear, in pasted code and in a ZIP's page too.",
  "The PDF is named after your file, ending in .pdf instead of .html, .htm or .zip; pasted code becomes pasted.pdf.",
];

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === "object")
    for (const v of Object.values(value)) strings(v, out);
  return out;
}

function corpus(): { source: string; text: string }[] {
  const tool = getToolBySlug(SLUG)!;
  const out: { source: string; text: string }[] = [];
  for (const text of strings(getToolContent(SLUG)))
    out.push({ source: "content", text });
  for (const text of strings([toolFaq(tool), modeFaq(tool), toolFacts(SLUG)]))
    out.push({ source: "faq", text });
  for (const guide of guides.filter((g) => g.tools.includes(SLUG)))
    for (const text of strings(guide))
      out.push({ source: `guide ${guide.slug}`, text });
  // The panel's static words (its spec row and intro): every string literal.
  const panel = readFileSync(
    path.join(
      process.cwd(),
      "src/components/tools/html-render-worker-panel.tsx",
    ),
    "utf8",
  );
  for (const m of panel.matchAll(/"([^"\n]{12,})"/g))
    out.push({ source: "panel", text: m[1]! });
  return out;
}

describe("HTML to PDF's ZIP sentences say when", () => {
  it("health: the corpus is the copy, not a fragment of it", () => {
    const all = corpus();
    const bySource = (prefix: string) =>
      all.filter((s) => s.source.startsWith(prefix));
    expect(bySource("content").length).toBeGreaterThan(30);
    expect(bySource("guide ").length).toBeGreaterThan(50);
    expect(bySource("faq").length).toBeGreaterThan(3);
    expect(bySource("panel").length).toBeGreaterThan(5);
    // The ZIP sentences themselves: as many as shipped with the feature.
    expect(all.filter((s) => judged(s.text)).length).toBeGreaterThanOrEqual(10);
  });

  it("every judged string carries the hedge", () => {
    const bare = corpus()
      .filter((s) => judged(s.text) && !hedged(s.text))
      .map((s) => `${s.source}: ${s.text.slice(0, 140)}`);
    expect(bare).toEqual([]);
  });

  it("POSITIVE CONTROL: every sentence the review caught is refused by the predicate", () => {
    for (const sentence of CAUGHT_UNHEDGED) {
      expect(judged(sentence), sentence).toBe(true);
      expect(hedged(sentence), sentence).toBe(false);
    }
  });

  it("every hedge shape is exercised by a shipped string (a shape nothing uses is decoration)", () => {
    const texts = corpus().map((s) => s.text);
    for (const [name, re] of Object.entries(HEDGES))
      expect(
        texts.some((t) => re.test(t)),
        name,
      ).toBe(true);
  });
});
