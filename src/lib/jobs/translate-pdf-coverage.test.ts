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
import { translatePdfProofVerdict } from "@/lib/workers/translate/pdf-proof-verdict";

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
    // "About this tool" and the WebApplication JSON-LD (review r1, 2026-11-16:
    // the sentence served there was outside this list and every guard).
    tool.description,
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
  /**
   * The count the sentence gives: a number, "all" for "all 21 languages" /
   * "all of them", or "most" for "most (target) languages" — the word the
   * catalogue description uses, since catalog.ts cannot import the gate.
   */
  readonly count: number | "all" | "most";
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
      (/\ball (?:\d+ languages|of them)\b/.test(sentence)
        ? "all"
        : /\bmost (?:target )?languages\b/.test(sentence)
          ? "most"
          : null);
    if (counted === null) continue;
    out.push({
      sentence,
      count:
        counted === "all" || counted === "most" ? counted : Number(counted),
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
    if (claim.count === "most") {
      // "most" holds while more than half the target languages are gated.
      if (coverage.withPdf * 2 <= coverage.total)
        problems.push(
          `says most, gate says ${coverage.withPdf} of ${coverage.total}: "${claim.sentence}"`,
        );
    } else if (claim.count !== expected)
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

  // HISTORY (2026-11-15, slice 2): this was "health: the derived list is
  // non-empty today, and is what the copy names" — ar, zh, ja and ko were not
  // proven, and the copy's "every one but …" had to name exactly them.
  // INVERTED, not deleted, when the CJK slice put zh, ja and ko in the gate
  // (Arabic had joined with #331): the set is empty, so the shipped copy must
  // name no exception at all and say "all 21 languages" — the branch the
  // full-set control below already exercised.
  it("health: today every language is in the gate, so the copy names no exception and says all of them", () => {
    expect(derived).toEqual([]);
    const claims = pdfClaimsIn(toolPageTexts());
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.some((c) => c.excepts)).toBe(false);
    expect(
      toolPageTexts().some((t) =>
        t.includes(`all ${TRANSLATE_LANGUAGES.length} languages`),
      ),
    ).toBe(true);
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

  it("the catalogue description's 'most' is read, and fails once the gate is half the languages or fewer", () => {
    const description = getToolBySlug("translate-pdf")!.description;
    const claims = pdfClaimsIn([description]);
    // Health: the served description is a claim the extractor sees.
    expect(claims.map((c) => c.count)).toEqual(["most"]);
    expect(claimProblems(claims, TRANSLATE_PDF_CI_REQUIRED)).toEqual([]);
    // Control: the gate before slice 2 (en, es, bn) makes "most" false.
    expect(claimProblems(claims, ["en", "es", "bn"]).length).toBeGreaterThan(0);
    // Boundary: exactly half is not most; one more is.
    const half = TRANSLATE_LANGUAGES.slice(
      0,
      Math.floor(TRANSLATE_LANGUAGES.length / 2),
    );
    expect(claimProblems(claims, half).length).toBeGreaterThan(0);
    expect(
      claimProblems(claims, TRANSLATE_LANGUAGES.slice(0, half.length + 1)),
    ).toEqual([]);
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

describe("the proof CI runs in the worker image fails on exactly the gate", () => {
  /*
   * Review r1 (2026-11-16): this block used to read the script's SOURCE —
   * the import is present, the identifier before `.filter(…passing)` is the
   * constant, no `*REQUIRED*` const. Three variants kept that shape and put
   * back the drift it is named for, all green: the check narrowed inline
   * (`.filter((l) => ["en", "es", "bn"].includes(l))`), Thai dropped inside
   * the predicate, and `return 0` after "not proven". The verdict now lives
   * in a pure function, and the property is tested by RUNNING it.
   */
  it("health: the gate is not trivially small", () => {
    expect(TRANSLATE_PDF_CI_REQUIRED.length).toBeGreaterThanOrEqual(3);
  });

  it("every required language proven, no false drop: exit 0", () => {
    const v = translatePdfProofVerdict([...TRANSLATE_PDF_CI_REQUIRED], 0);
    expect(v.exitCode).toBe(0);
    expect(v.notProven).toEqual([]);
    expect(v.lines).toEqual(["PASS"]);
    // Extra languages proven beyond the gate change nothing.
    expect(translatePdfProofVerdict([...TRANSLATE_LANGUAGES], 0).exitCode).toBe(
      0,
    );
  });

  it("any ONE required language missing: exit 1, naming it — for every language in the gate", () => {
    const passed: TranslateLanguage[] = [];
    for (const missing of TRANSLATE_PDF_CI_REQUIRED) {
      const v = translatePdfProofVerdict(
        TRANSLATE_PDF_CI_REQUIRED.filter((l) => l !== missing),
        0,
      );
      if (v.exitCode === 0) passed.push(missing);
      else expect(v.notProven, missing).toEqual([missing]);
    }
    expect(passed, "languages the gate lets go unproven").toEqual([]);
  });

  it("nothing proven fails with the whole gate; a false drop alone fails too", () => {
    const none = translatePdfProofVerdict([], 0);
    expect(none.exitCode).toBe(1);
    expect(none.notProven).toEqual(TRANSLATE_PDF_CI_REQUIRED);
    const dropped = translatePdfProofVerdict([...TRANSLATE_PDF_CI_REQUIRED], 1);
    expect(dropped.exitCode).toBe(1);
    expect(dropped.lines.join("\n")).not.toContain("PASS");
  });

  it("a named other failure alone fails, and is printed; none passes", () => {
    // The CJK slice's ToUnicode rewrite cases and radical-glyph facts reach
    // the verdict this way (2026-11-16), so the script keeps one way to pass.
    const all = [...TRANSLATE_PDF_CI_REQUIRED];
    const other = translatePdfProofVerdict(all, 0, [
      "2 ToUnicode rewrite case(s)",
    ]);
    expect(other.exitCode).toBe(1);
    expect(other.notProven).toEqual([]);
    expect(other.lines).toContain("FAIL — 2 ToUnicode rewrite case(s)");
    expect(other.lines).not.toContain("PASS");
    const clean = translatePdfProofVerdict(all, 0, []);
    expect(clean.exitCode).toBe(0);
    expect(clean.lines).toEqual(["PASS"]);
  });

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

  /** How the script reaches its verdict, read from its source. */
  function wiringOf(source: string) {
    const code = withoutComments(source);
    return {
      // Called with the probe's own list, unfiltered, and the drop count.
      calls: [
        ...code.matchAll(/\btranslatePdfProofVerdict\(\s*([^)]*?)\s*\)/g),
      ].map((m) => m[1]!.replace(/\s+/g, " ")),
      // Every value main() can return: the verdict, or 2 (cannot conclude).
      returns: [...code.matchAll(/\breturn\s+([^;]+);/g)]
        .map((m) => m[1]!.trim())
        .sort(),
      // A local list that looks like a required set.
      localRequired: [
        ...code.matchAll(/\b(?:const|let|var)\s+(\w*REQUIRED\w*)\b/gi),
      ].map((m) => m[1]!),
      // A check of the probe's verdicts that bypasses the function.
      ownChecks: [...code.matchAll(/\.passing\b(?!\.join\()/g)].length,
    };
  }

  const WIRED = {
    calls: ["probe.passing, summary.falseDrops, otherFailures,"],
    returns: ["2", "verdict.exitCode"],
    localRequired: [],
    // The one `.passing` is the verdict call's argument; `.join(` is a log.
    ownChecks: 1,
  };

  it("the script CI runs returns the verdict of the probe's own list, and nothing else", () => {
    expect(wiringOf(read(proofScriptFile()))).toEqual(WIRED);
  });

  it("positive controls: the shapes the review found are each caught", () => {
    const now = read(proofScriptFile());
    const variants: Record<string, string> = {
      "local REQUIRED (the script before slice 2)": now.replace(
        "const verdict =",
        'const REQUIRED = ["en", "es", "bn"];\n  const verdict =',
      ),
      "narrowed inline": now.replace(
        "probe.passing,\n    summary.falseDrops",
        'probe.passing.concat(["th"]),\n    summary.falseDrops',
      ),
      "own check beside the verdict": now.replace(
        "return verdict.exitCode;",
        'if (!probe.passing.includes("en")) return 1;\n  return verdict.exitCode;',
      ),
      "exit 0 whatever the verdict": now.replace(
        "return verdict.exitCode;",
        "return 0;",
      ),
    };
    for (const [name, source] of Object.entries(variants)) {
      // The mutation's health check: it landed.
      expect(source, `${name}: the variant did not apply`).not.toBe(now);
      expect(wiringOf(source), name).not.toEqual(WIRED);
    }
  });
});
