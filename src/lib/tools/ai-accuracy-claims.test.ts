// @vitest-environment node
/**
 * THE PROPERTY: no surface promises that an AI model's output is correct.
 *
 * The four AI tool panels told users the model "never invents an answer" /
 * "never fabricates data", and the chat package said "Nothing was answered
 * from outside the document". The only safeguard is an instruction in the
 * system prompt; nothing checks the output against the document. A user who
 * reads the chat bubble (the one surface everyone reads) was told a language
 * model cannot be wrong, while the caveat sat inside a ZIP.
 *
 * What IS true, and stays: the JOB fails instead of guessing when there is no
 * model, no selectable text, or an empty / non-JSON reply. Those sentences
 * describe the pipeline, not the model, and the controls below keep them
 * legal so this list cannot turn into a ban on the word "fabricate".
 *
 * EXIT CONDITION (the property): a pattern lifts only when the output is
 * VERIFIED against the document by something other than the model — never
 * because the prompt got stricter or a new provider claims better accuracy.
 *
 * Corpus in both directions (CLAUDE.md rule 1): every sentence that shipped
 * must be caught by some pattern, and every pattern must catch some shipped
 * sentence.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  copyFiles,
  flattenForPhraseSearch,
  withoutComments,
} from "./copy-surface";

const ROOT = process.cwd();
const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/");

/** Model-accuracy guarantees, as SHAPES rather than strings. */
const PATTERNS: readonly RegExp[] = [
  // "never invents an answer", "never fabricates data / a summary / a translation"
  /\bnever (?:invents?|fabricates?|makes? up) (?:an? |any )?(?:answers?|values?|data|summary|summaries|translations?|facts?)\b/i,
  // "does not invent content", "won't make up facts"
  /\b(?:does not|doesn't|will not|won't|cannot|can't) (?:invent|fabricate|make up|hallucinate) (?:any )?(?:content|answers?|values?|data|facts?)\b/i,
  // "Nothing was answered from outside the document"
  /\bnothing (?:was|is) answered from outside\b/i,
];

/** Every sentence of this shape the product shipped (audit at 67e8d0f). */
const SHIPPED: readonly string[] = [
  "It never fabricates answers: with no AI model configured, a scanned PDF with no selectable text, or an empty model reply, it fails honestly instead of guessing.",
  "The worker answers only from the PDF's selectable text with a configured AI model — it does not read scanned images (run OCR first) and never invents an answer.",
  "It never fabricates data: with no AI model configured, a scanned PDF with no selectable text, or a model reply that isn't valid JSON, it fails honestly instead of guessing.",
  "The worker extracts only the PDF's selectable text with a configured AI model — it does not read scanned images (run OCR first) and never invents values.",
  "It never fabricates a summary: with no AI model configured, or a scanned PDF with no selectable text, it fails honestly instead of guessing.",
  "The worker summarizes only the PDF's selectable text with a configured AI model — it does not read scanned images (run OCR first) and does not invent content.",
  "It produces translated text (not a layout-preserving PDF) and never fabricates a translation: with no AI model configured, or a scanned PDF with no selectable text, it fails honestly instead of guessing.",
  "The worker translates only the PDF's selectable text with a configured AI model — it does not read scanned images (run OCR first) and does not invent content.",
  "The model may still err — verify against the original before relying on it. Nothing was answered from outside the document.",
];

/** True sentences that must survive (so the list is not a word ban). */
const MUST_SURVIVE: readonly string[] = [
  "With no AI model configured, or a scanned PDF with no selectable text, the job fails instead of guessing.",
  "Repair rewrites the PDF through qpdf's parser/writer on an isolated secure worker, recovering readable structure when possible. It never fabricates pages or content: if qpdf cannot produce a valid PDF, the job fails honestly.",
  "The AI provider did not return valid JSON, so no honest extraction could be produced. No data was fabricated. Retrying may succeed.",
  "The model was instructed not to use outside knowledge.",
];

const hits = (text: string) => PATTERNS.filter((p) => p.test(text));

/** The copy walk plus every worker engine, whose notes ship inside packages. */
function corpus(): string[] {
  const engines: string[] = [];
  const workers = path.join(ROOT, "src", "lib", "workers");
  for (const dir of readdirSync(workers)) {
    const engine = path.join(workers, dir, "engine.ts");
    try {
      if (statSync(engine).isFile()) engines.push(engine);
    } catch {
      // not an engine directory
    }
  }
  return [...copyFiles(), ...engines];
}

describe("AI accuracy guarantees — the ban list and its corpus", () => {
  it("every shipped sentence is caught by some pattern", () => {
    for (const sentence of SHIPPED) {
      expect(hits(sentence), sentence).not.toEqual([]);
    }
  });

  it("every pattern catches some shipped sentence", () => {
    for (const pattern of PATTERNS) {
      expect(
        SHIPPED.some((s) => pattern.test(s)),
        `${pattern} catches nothing that shipped — decoration`,
      ).toBe(true);
    }
  });

  it("the honest fail-closed sentences survive", () => {
    for (const sentence of MUST_SURVIVE) {
      expect(hits(sentence), sentence).toEqual([]);
    }
  });
});

describe("no surface makes a model-accuracy guarantee", () => {
  const files = corpus();

  it("health: the walk reaches every AI panel and the AI engines", () => {
    const names = new Set(files.map(rel));
    const panels = readdirSync(path.join(ROOT, "src", "components", "tools"))
      .filter((f) => /-worker-panel\.tsx$/.test(f))
      .map((f) => `src/components/tools/${f}`);
    expect(panels.length).toBeGreaterThanOrEqual(10);
    for (const panel of panels) expect(names.has(panel), panel).toBe(true);
    for (const engine of [
      "chat-with-pdf",
      "summarize",
      "translate",
      "ai-extract",
    ]) {
      expect(names.has(`src/lib/workers/${engine}/engine.ts`), engine).toBe(
        true,
      );
    }
  });

  it("finds no guarantee in what a reader receives", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = flattenForPhraseSearch(
        withoutComments(readFileSync(file, "utf8")),
      );
      for (const pattern of PATTERNS) {
        const m = text.match(pattern);
        if (m) offenders.push(`${rel(file)}: "${m[0]}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
