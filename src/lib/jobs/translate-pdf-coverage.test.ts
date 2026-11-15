// @vitest-environment node
/**
 * Which languages Translate PDF's static copy says get a reflowed PDF, read
 * from the RENDERED copy (competitor audit #29, slice 2, 2026-11-15).
 *
 * The copy may name exactly the languages CI makes the built worker image
 * prove (`TRANSLATE_PDF_CI_REQUIRED`), and must name the rest as the ones
 * without a PDF. Three guards:
 *
 *  1. THE DERIVED LIST, at the point of consumption: every served sentence
 *     that counts the reflowed PDF's languages states the count of the gate,
 *     and every "every one but …" sentence names exactly
 *     `TRANSLATE_LANGUAGES − TRANSLATE_PDF_CI_REQUIRED` — read from what the
 *     tool page and the guide render, not from the constant. Positive
 *     controls recompute the copy with Thai dropped from the gate (it must
 *     name Thai) and with every language in it (it must read "all 21").
 *  2. THE GATE IS THE CONSTANT: the proof script CI runs in the image — found
 *     through `container.yml` → `package.json` → file, never named here —
 *     imports `TRANSLATE_PDF_CI_REQUIRED` and checks its verdicts against
 *     that and nothing else. A local list there would let the copy and the
 *     gate drift apart, which is the defect this slice exists to prevent.
 *  3. HEALTH: the extractor sees the sentences it is meant to see, on both
 *     surfaces, so a copy rewrite cannot make the check vacuous.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LANGUAGE_NAMES,
  TRANSLATE_LANGUAGES,
  TRANSLATE_PDF_CI_REQUIRED,
  type TranslateLanguage,
} from "./translate-pdf";
import {
  translatePdfCoverage,
  translatePdfCoverageSentence,
} from "./translate-pdf-coverage";
import { getToolBySlug } from "@/lib/tools";
import {
  pageDescription,
  pageFaq,
  pageIntro,
  pageSteps,
  pageTitle,
} from "@/lib/tools/page-copy";
import { guides } from "@/lib/guides";
import { withoutComments } from "@/lib/tools/copy-surface";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** The rendered copy of the tool page. */
function toolPageTexts(): string[] {
  const tool = getToolBySlug("translate-pdf");
  if (!tool) throw new Error("translate-pdf is not in the catalogue");
  return [
    // A step's title is optional; an absent field is not copy.
    pageTitle(tool),
    pageDescription(tool),
    ...pageIntro(tool),
    ...pageSteps(tool).flatMap((s) => [s.title, s.text]),
    ...pageFaq(tool).flatMap((e) => [e.question, e.answer]),
  ].filter((text): text is string => typeof text === "string");
}

/** The rendered copy of every guide whose primary tool is Translate PDF. */
function guideTexts(): string[] {
  const own = guides.filter((g) => g.tools[0] === "translate-pdf");
  if (own.length === 0) throw new Error("no guide has translate-pdf first");
  return own.flatMap((g) => [
    g.title,
    g.description,
    ...g.intro,
    ...g.steps,
    ...g.sections.flatMap((s) => [s.heading, ...s.body]),
    ...g.faq.flatMap((e) => [e.question, e.answer]),
  ]);
}

const sentencesOf = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** A language's name as a reader sees it named: "Chinese (Simplified)" → "Chinese". */
const spoken = (code: TranslateLanguage) =>
  LANGUAGE_NAMES[code].split(" (")[0]!;

interface PdfClaim {
  readonly sentence: string;
  /** The count the sentence gives, or "all" for "all 21 languages"/"all of them". */
  readonly count: number | "all";
  /** Every target language the sentence names. */
  readonly named: readonly TranslateLanguage[];
  /** True for the "every one but …" form, whose names are the exceptions. */
  readonly excepts: boolean;
}

/**
 * The sentences that say how many languages get the reflowed PDF. THE SAME
 * FUNCTION reads the served copy and the positive controls.
 */
function pdfClaimsIn(texts: readonly string[]): PdfClaim[] {
  const out: PdfClaim[] = [];
  for (const sentence of texts.flatMap(sentencesOf)) {
    if (!/\breflowed PDF\b/i.test(sentence)) continue;
    const counted =
      /\b(\d+) of (?:the \d+ languages|them)\b/.exec(sentence)?.[1] ??
      (/\ball (?:\d+ languages|of them)\b/.test(sentence) ? "all" : null);
    if (counted === null) continue;
    out.push({
      sentence,
      count: counted === "all" ? "all" : Number(counted),
      named: TRANSLATE_LANGUAGES.filter((code) =>
        new RegExp(`\\b${spoken(code)}\\b`).test(sentence),
      ),
      excepts: /\bevery one but\b/.test(sentence),
    });
  }
  return out;
}

/** What a claim must say for a given gate, or why it does not. */
function claimProblems(
  claims: readonly PdfClaim[],
  required: readonly TranslateLanguage[],
): string[] {
  const coverage = translatePdfCoverage(required);
  const want = [...coverage.without].sort();
  const problems: string[] = [];
  for (const claim of claims) {
    const expected = coverage.without.length === 0 ? "all" : coverage.withPdf;
    if (claim.count !== expected)
      problems.push(
        `says ${claim.count}, gate says ${expected}: "${claim.sentence}"`,
      );
    // Compared as sets: both sides sorted the same way.
    if (claim.excepts && [...claim.named].sort().join() !== want.join())
      problems.push(
        `names ${claim.named.join(",") || "none"}, gate leaves ${want.join(",") || "none"}: "${claim.sentence}"`,
      );
    if (!claim.excepts && claim.named.length > 0)
      problems.push(
        `names languages outside an exception list: "${claim.sentence}"`,
      );
  }
  return problems;
}

describe("Translate PDF's copy names the PDF's languages from the CI gate", () => {
  const derived = TRANSLATE_LANGUAGES.filter(
    (code) => !TRANSLATE_PDF_CI_REQUIRED.includes(code),
  );

  it("the gate is a subset of the target languages, without repeats", () => {
    expect(new Set(TRANSLATE_PDF_CI_REQUIRED).size).toBe(
      TRANSLATE_PDF_CI_REQUIRED.length,
    );
    for (const code of TRANSLATE_PDF_CI_REQUIRED)
      expect(TRANSLATE_LANGUAGES).toContain(code);
  });

  it("the tool page and the guide state the gate's count and name exactly the languages it leaves out", () => {
    for (const [surface, texts] of [
      ["tool page", toolPageTexts()],
      ["guide", guideTexts()],
    ] as const) {
      const claims = pdfClaimsIn(texts);
      // Health: each surface makes the claim (tool: meta + intro; guide:
      // description, intro, section, FAQ). Fewer means the extractor or the
      // copy went blind, and an empty set would pass everything below.
      expect(
        claims.length,
        `${surface}: too few PDF-coverage sentences`,
      ).toBeGreaterThanOrEqual(2);
      expect(claimProblems(claims, TRANSLATE_PDF_CI_REQUIRED), surface).toEqual(
        [],
      );
      if (derived.length > 0) {
        // While some language has no PDF, each surface must NAME them.
        expect(
          claims.some((c) => c.excepts),
          `${surface}: no sentence names the languages without a PDF`,
        ).toBe(true);
      } else {
        expect(
          texts.some((t) =>
            t.includes(`all ${TRANSLATE_LANGUAGES.length} languages`),
          ),
          `${surface}: every language is proven, so the copy says all ${TRANSLATE_LANGUAGES.length}`,
        ).toBe(true);
      }
    }
  });

  it("health: the derived list is non-empty today, and is what the copy names", () => {
    // Today (2026-11-15) ar, zh, ja and ko are not proven. When the Arabic
    // and CJK slices add theirs to the gate this shrinks, and the branch
    // above that requires "all 21 languages" takes over — it is exercised by
    // the full-set control below so it is not dead code on that day.
    expect(derived.length).toBeGreaterThan(0);
    const named = pdfClaimsIn(toolPageTexts()).find((c) => c.excepts)!.named;
    expect([...named].sort()).toEqual([...derived].sort());
  });

  it("positive control: with Thai dropped from the gate, the copy names Thai and counts one fewer", () => {
    const without = TRANSLATE_PDF_CI_REQUIRED.filter((c) => c !== "th");
    const claims = pdfClaimsIn([
      translatePdfCoverageSentence(translatePdfCoverage(without)),
    ]);
    expect(claims).toHaveLength(1);
    expect(claims[0]!.named).toContain("th");
    expect(claims[0]!.count).toBe(TRANSLATE_PDF_CI_REQUIRED.length - 1);
    expect(claimProblems(claims, without)).toEqual([]);
    // …and the shipped copy, judged against that gate, is caught.
    expect(
      claimProblems(pdfClaimsIn(toolPageTexts()), without).length,
    ).toBeGreaterThan(0);
  });

  it("positive control: with every language in the gate, the copy reads all 21 and names none", () => {
    const sentence = translatePdfCoverageSentence(
      translatePdfCoverage(TRANSLATE_LANGUAGES),
    );
    expect(sentence).toContain(`all ${TRANSLATE_LANGUAGES.length} languages`);
    const claims = pdfClaimsIn([sentence]);
    expect(claims).toHaveLength(1);
    expect(claims[0]!.count).toBe("all");
    expect(claims[0]!.named).toEqual([]);
    expect(claimProblems(claims, TRANSLATE_LANGUAGES)).toEqual([]);
  });

  it("positive control: a hard-coded exception list is caught once the gate moves", () => {
    // Mutation m2's shape, as a planted sentence: the four names typed, with
    // Arabic then proven.
    const planted =
      "For 17 of the 21 languages, every one but Arabic, Chinese, Japanese and Korean, a reflowed PDF of the same text comes with it.";
    const gate: TranslateLanguage[] = [...TRANSLATE_PDF_CI_REQUIRED, "ar"];
    expect(claimProblems(pdfClaimsIn([planted]), gate).length).toBeGreaterThan(
      0,
    );
  });
});

describe("the proof CI runs in the worker image reads the shared gate", () => {
  const SCRIPT = "worker:translate-pdf-proof";

  /** container.yml → package.json script → file: three things CI already needs. */
  function proofScriptFile(): string {
    const workflow = read(".github/workflows/container.yml");
    expect(workflow, "container.yml no longer runs the proof").toContain(
      `pnpm ${SCRIPT}`,
    );
    const scripts = (
      JSON.parse(read("package.json")) as { scripts: Record<string, string> }
    ).scripts;
    const command = scripts[SCRIPT];
    const file = command ? /\btsx\s+(\S+\.ts)\b/.exec(command)?.[1] : undefined;
    if (!file)
      throw new Error(`package.json "${SCRIPT}" runs no .ts file: ${command}`);
    return file;
  }

  /** What the script's source says about its required set. */
  function gateOf(source: string) {
    const code = withoutComments(source);
    return {
      imports:
        /import\s*\{[^}]*\bTRANSLATE_PDF_CI_REQUIRED\b[^}]*\}\s*from\s*"@\/lib\/jobs\/translate-pdf"/.test(
          code,
        ),
      // Every list the probe's verdicts are checked against.
      checkedAgainst: [
        ...code.matchAll(
          /\b([A-Za-z_$][\w$]*)\s*\.filter\(\s*\(?\s*\w+\s*\)?\s*=>[^)]*\.passing\b/g,
        ),
      ].map((m) => m[1]!),
      // A local declaration that looks like a required set.
      localRequired: [
        ...code.matchAll(/\b(?:const|let|var)\s+(\w*REQUIRED\w*)\b/gi),
      ].map((m) => m[1]!),
    };
  }

  it("imports TRANSLATE_PDF_CI_REQUIRED and checks the verdicts against it alone", () => {
    const gate = gateOf(read(proofScriptFile()));
    expect(gate.imports).toBe(true);
    expect(
      gate.checkedAgainst.length,
      "found no verdict check at all",
    ).toBeGreaterThan(0);
    expect(
      gate.checkedAgainst.every((n) => n === "TRANSLATE_PDF_CI_REQUIRED"),
    ).toBe(true);
    expect(gate.localRequired).toEqual([]);
  });

  it("positive control: the script as it was (a local REQUIRED) is caught", () => {
    const before = `import type { TranslateLanguage } from "@/lib/jobs/translate-pdf";
const REQUIRED: readonly TranslateLanguage[] = ["en", "es", "bn"];
const missing = REQUIRED.filter((l) => !probe.passing.includes(l));`;
    const gate = gateOf(before);
    expect(gate.imports).toBe(false);
    expect(gate.checkedAgainst).toEqual(["REQUIRED"]);
    expect(gate.localRequired).toEqual(["REQUIRED"]);
  });
});
