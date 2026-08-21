// @vitest-environment node
/**
 * THE PROPERTY: no surface on a tool's page may state an input ceiling that
 * tool will not honour.
 *
 * Not "the FAQ must say 10,258" — that is a mechanism, and it goes stale the
 * moment a fifth AI tool arrives with its own bound. The property is a
 * relationship: for every AI tool, every character-ceiling a visitor can read
 * on its page equals the ceiling the tool's own enforcement compares against.
 *
 * WHY THIS FILE EXISTS WHEN `translate-ceiling.test.ts` ALREADY DOES. That
 * guard asserts "the translate PANEL states TRANSLATE's number" — it names
 * where the bug was FOUND, not where it can APPEAR, and contains zero
 * references to `tool-facts.ts` or the FAQ. So on 2026-08-20 the same page
 * carried two ceilings 49x apart: the panel said 10,258 characters (correct,
 * derived) while the FAQ said 500,000 — and shipped that figure to crawlers
 * as FAQPage JSON-LD, the channel `legal-pages.test.ts` records carrying a
 * previous false claim. `legal-pages.test.ts` had already written this exact
 * lesson down ("scoped to where the overclaims were FOUND, not to where they
 * can APPEAR") for a different guard family; it was never carried to this one.
 *
 * DERIVED SETS, never typed:
 *  - the AI tools come from the catalogue (`processing: "ai"`);
 *  - each tool's engine is DISCOVERED by scanning `src/lib/workers/[asterisk]/engine.ts`
 *    for its exported `*_TOOL` slug — renaming a directory moves the guard;
 *  - each tool's honoured ceiling is CLASSIFIED from the enforcement source
 *    (an engine that refuses via `translateMaxInputChars(...)` is bounded by
 *    output; one that truncates at `AI_INPUT_LIMITS.maxInputCharacters` is
 *    bounded by reading) — an unclassifiable engine FAILS, it is not skipped;
 *  - each tool's panel comes from the real dispatch in
 *    `src/app/tools/[slug]/page.tsx` plus its own import table — the two
 *    artifacts rendering actually depends on.
 *
 * WHAT IS VERIFIED BEHAVIOURALLY, not just structurally: the output-bound
 * engine is RUN. A document one character over the published ceiling must be
 * refused before the provider is called (refuse-before-paying — the measured
 * failure cost a user 49 seconds and one of three daily runs); a document at
 * exactly the ceiling must reach the provider. Loading a module is not running
 * a function, and a classification the engine never enforces is decoration.
 *
 * WHAT IS NOT PROVEN HERE, recorded rather than discovered: the three
 * read-bound engines are not run against their 500,000-character window —
 * their derivation from the shared constant is pinned by source scan here and
 * in `ai-input-limit.test.ts`, but no probe feeds them 500,001 characters and
 * watches the truncation land. If a read-bound engine ever gains a refusal
 * path, add its probe to {@link OUTPUT_BOUND_PROBES} — the completeness check
 * below will demand it by name.
 *
 * THE EXIT CONDITION names the property: an entry leaves this guard only when
 * the surface derives its figure from the same constant its engine enforces —
 * never because the two numbers happen to agree today.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { TranslateOptions } from "@/lib/jobs/translate-pdf";
import type {
  AiCompletionRequest,
  AiCompletionResult,
  AiProvider,
} from "@/lib/workers/ai/provider";
import { AI_INPUT_LIMITS } from "@/lib/jobs/types";
import {
  TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS,
  translateMaxInputChars,
} from "@/lib/jobs/translate-limits";
import { runTranslate, type PdfTextExtractor } from "@/lib/workers/translate/engine";
import { tools } from "./index";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { howToSteps, toolFacts, toolFaq } from "./tool-facts";
import { copyFiles, flattenForPhraseSearch, withoutComments } from "./copy-surface";
import type { Tool } from "./types";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(file, "utf8");
const relative = (file: string) =>
  path.relative(ROOT, file).replace(/\\/g, "/");

/**
 * Page floors at the measured densities, derived HERE, independently of
 * whatever helper the copy uses — a second bound sees a wrong number where a
 * shared definition can only agree with itself.
 */
const pagesAtDensest = (characters: number) =>
  Math.floor(characters / AI_INPUT_LIMITS.densestCharactersPerPage);
const pagesAtSparsest = (characters: number) =>
  Math.floor(characters / AI_INPUT_LIMITS.sparsestCharactersPerPage);

/* ------------------------------------------------------------------ *
 *  Set 1 — the AI tools, from the catalogue.
 * ------------------------------------------------------------------ */

const aiTools: readonly Tool[] = tools.filter(
  (tool) => capabilityForMode(tool.processing) === "ai",
);

/* ------------------------------------------------------------------ *
 *  Set 2 — each tool's engine, DISCOVERED from the `*_TOOL` exports.
 * ------------------------------------------------------------------ */

/** slug → engine source file, discovered by scanning for the definition. */
function discoverEngines(): Map<string, string> {
  const bySlug = new Map<string, string>();
  const workersDir = path.join(ROOT, "src", "lib", "workers");
  for (const entry of readdirSync(workersDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const engineFile = path.join(workersDir, entry.name, "engine.ts");
    let source: string;
    try {
      source = read(engineFile);
    } catch {
      continue;
    }
    for (const match of source.matchAll(
      /export const \w+_TOOL\s*=\s*"([\w-]+)"/g,
    )) {
      bySlug.set(match[1]!, engineFile);
    }
  }
  return bySlug;
}

const engines = discoverEngines();

/**
 * The ceiling a tool's enforcement actually compares against, classified from
 * the engine's own refusal/truncation source. Throws on an engine this cannot
 * classify — a new AI engine with a third kind of bound must extend the
 * classification, loudly, not slide past it.
 */
function honouredCeiling(slug: string): number {
  const engineFile = engines.get(slug);
  if (!engineFile) {
    throw new Error(
      `no engine exports a *_TOOL constant for "${slug}" under src/lib/workers/*/engine.ts`,
    );
  }
  const source = read(engineFile);
  const refusesByOutputBudget = /translateMaxInputChars\s*\(/.test(source);
  const truncatesAtSharedCap = source.includes(
    "AI_INPUT_LIMITS.maxInputCharacters",
  );
  if (refusesByOutputBudget) {
    // The refusal runs against the OUTPUT-derived ceiling; the shared reading
    // cap, if also present, is only the truncation window above it. The
    // honoured bound is the smaller of the two.
    const refusal = translateMaxInputChars(TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS);
    return truncatesAtSharedCap
      ? Math.min(refusal, AI_INPUT_LIMITS.maxInputCharacters)
      : refusal;
  }
  if (truncatesAtSharedCap) return AI_INPUT_LIMITS.maxInputCharacters;
  throw new Error(
    `${relative(engineFile)} enforces neither translateMaxInputChars(...) nor ` +
      "AI_INPUT_LIMITS.maxInputCharacters — classify its bound here before " +
      "any page may state one",
  );
}

/* ------------------------------------------------------------------ *
 *  Set 3 — each tool's panel, from the page dispatch + its import table.
 * ------------------------------------------------------------------ */

const PAGE = path.join(ROOT, "src", "app", "tools", "[slug]", "page.tsx");

/**
 * slug → panel source file, read off the REAL dispatch: the chained
 * `tool.slug === "..."` ternaries in the page template, resolved through the
 * page's own import statements. A typed slug→panel table here would be a list,
 * and a list cannot see the panel it does not name.
 */
function panelsFromDispatch(): Map<string, string> {
  const source = withoutComments(read(PAGE));
  const imports = new Map<string, string>();
  for (const match of source.matchAll(
    /import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g,
  )) {
    for (const name of match[1]!.split(",")) {
      imports.set(name.trim(), match[2]!);
    }
  }
  const bySlug = new Map<string, string>();
  let pending: string[] = [];
  for (const token of source.matchAll(
    /tool\.slug === "([\w-]+)"|<([A-Z][A-Za-z0-9]*)/g,
  )) {
    if (token[1]) {
      pending.push(token[1]);
      continue;
    }
    if (pending.length === 0) continue;
    const module = imports.get(token[2]!);
    // The first component in a slug branch that the page imports from the
    // tools components tree is that branch's panel (ErrorBoundary and shared
    // UI live elsewhere).
    if (!module?.startsWith("@/components/tools/")) continue;
    const file = path.join(
      ROOT,
      "src",
      module.replace(/^@\//, "").replace(/\//g, path.sep) + ".tsx",
    );
    for (const slug of pending) bySlug.set(slug, file);
    pending = [];
  }
  return bySlug;
}

const panels = panelsFromDispatch();

/* ------------------------------------------------------------------ *
 *  The claim extractor, shared by the checks and their positive control.
 * ------------------------------------------------------------------ */

/** Every "N characters" figure in a rendered sentence, comma-tolerant. */
function characterClaims(text: string): number[] {
  return [...text.matchAll(/(\d[\d,]*)\s+characters\b/gi)].map((m) =>
    Number(m[1]!.replace(/,/g, "")),
  );
}

/** Every bare number in a rendered sentence — for the page-range check. */
function allNumbers(text: string): number[] {
  return [...text.matchAll(/\d[\d,]*/g)].map((m) =>
    Number(m[0].replace(/,/g, "")),
  );
}

/** The rendered strings a tool's page shows: facts, FAQ (→ JSON-LD), steps. */
function renderedStrings(tool: Tool): string[] {
  return [
    ...toolFacts(tool.slug).map((fact) => `${fact.label}: ${fact.value}`),
    ...toolFaq(tool).map((entry) => `${entry.question} ${entry.answer}`),
    ...howToSteps(tool),
  ];
}

/* ------------------------------------------------------------------ *
 *  The behavioural probes for engines that REFUSE at their ceiling.
 * ------------------------------------------------------------------ */

interface ProbeResult {
  overCeiling: { refused: boolean; quoted: number | undefined; paid: boolean };
  atCeiling: { reachedProvider: boolean };
}

function recordingProvider(): AiProvider & { calls: AiCompletionRequest[] } {
  const calls: AiCompletionRequest[] = [];
  const success: AiCompletionResult = {
    ok: true,
    text: "texte traduit",
    model: "claude-sonnet-5",
    usage: { inputTokens: 10, outputTokens: 5 },
  };
  return {
    id: "anthropic",
    model: "claude-sonnet-5",
    calls,
    async complete(request) {
      calls.push(request);
      return success;
    },
  };
}

function extractorFor(text: string): PdfTextExtractor {
  const extracted: ExtractedPdfText = {
    pageCount: 3,
    pages: [],
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
  return vi.fn(async () => extracted);
}

const TRANSLATE_OPTIONS: TranslateOptions = {
  targetLanguage: "fr",
  sourceLanguage: "auto",
};

/**
 * Every output-bound engine must have a probe here, keyed by slug — the
 * completeness check below demands one by name. A probe RUNS the engine at
 * ceiling+1 and at the ceiling, so the classified number is the enforced one.
 */
const OUTPUT_BOUND_PROBES: Record<
  string,
  (ceiling: number) => Promise<ProbeResult>
> = {
  "translate-pdf": async (ceiling) => {
    const over = recordingProvider();
    const overRun = await runTranslate(
      new Uint8Array([1, 2, 3]),
      TRANSLATE_OPTIONS,
      { extract: extractorFor("a".repeat(ceiling + 1)), provider: over },
    );
    const at = recordingProvider();
    await runTranslate(new Uint8Array([1, 2, 3]), TRANSLATE_OPTIONS, {
      extract: extractorFor("a".repeat(ceiling)),
      provider: at,
    });
    return {
      overCeiling: {
        refused: !overRun.ok && overRun.kind === "too_much_text",
        quoted: overRun.ok ? undefined : overRun.ceilingCharacters,
        paid: over.calls.length > 0,
      },
      atCeiling: { reachedProvider: at.calls.length === 1 },
    };
  },
};

/* ------------------------------------------------------------------ *
 *  The checks.
 * ------------------------------------------------------------------ */

describe("the derived sets are alive", () => {
  it("the catalogue yields the AI tools (vacuity bound: 4 known today)", () => {
    // `[] ⊆ X` is vacuously true; a filter that quietly returned nothing would
    // report the strongest possible pass on every per-tool check below.
    expect(aiTools.length).toBeGreaterThanOrEqual(4);
    // The anchor: the tool this defect shipped on. If it ever leaves the
    // derived set, every assertion about it below evaporates silently.
    expect(aiTools.map((t) => t.slug)).toContain("translate-pdf");
  });

  it("engine discovery is implausibly-small-proof and covers every AI tool", () => {
    // The discovery walks ALL worker engines (13+ dirs today); a walk that
    // finds fewer slugs than the AI tools alone is broken, not strict.
    expect(engines.size).toBeGreaterThanOrEqual(aiTools.length);
    for (const tool of aiTools) {
      expect(
        engines.has(tool.slug),
        `no engine under src/lib/workers/*/engine.ts exports a *_TOOL constant ` +
          `for "${tool.slug}" — the honoured ceiling cannot be derived`,
      ).toBe(true);
    }
  });

  it("the page dispatch yields a real panel file for every AI tool", () => {
    for (const tool of aiTools) {
      const panel = panels.get(tool.slug);
      expect(
        panel,
        `src/app/tools/[slug]/page.tsx has no dispatch branch rendering a ` +
          `@/components/tools panel for "${tool.slug}"`,
      ).toBeDefined();
      expect(() => read(panel!), `${panel} does not exist`).not.toThrow();
    }
  });

  it("every output-bound engine has a behavioural probe, by name", () => {
    const outputBound = aiTools
      .map((t) => t.slug)
      .filter((slug) => /translateMaxInputChars\s*\(/.test(read(engines.get(slug)!)));
    // Positive control on the classifier itself: translate IS output-bound.
    expect(outputBound).toContain("translate-pdf");
    for (const slug of outputBound) {
      expect(
        OUTPUT_BOUND_PROBES[slug],
        `${slug} refuses by an output-derived ceiling but has no probe — a ` +
          "classification the engine is never RUN against is decoration",
      ).toBeDefined();
    }
  });
});

describe("the enforcement honours the classified ceiling (run, not read)", () => {
  it.each(Object.keys(OUTPUT_BOUND_PROBES))(
    "%s refuses one character over its ceiling BEFORE paying, and accepts the ceiling",
    async (slug) => {
      const ceiling = honouredCeiling(slug);
      const probe = await OUTPUT_BOUND_PROBES[slug]!(ceiling);
      expect(
        probe.overCeiling.refused,
        `${slug} accepted ${ceiling + 1} characters — the published ceiling is ` +
          "not the enforced one",
      ).toBe(true);
      // The refusal quotes the same number the pages will state.
      expect(probe.overCeiling.quoted).toBe(ceiling);
      // Refuse-before-paying: the measured production failure was accepted,
      // uploaded, extracted, sent, billed, and refused after 49 seconds.
      expect(
        probe.overCeiling.paid,
        `${slug} called the provider for a document it then refused`,
      ).toBe(false);
      expect(
        probe.atCeiling.reachedProvider,
        `${slug} refused a document AT its published ceiling — the page ` +
          "under-promises what the engine honours",
      ).toBe(true);
    },
  );
});

describe("every stated ceiling is the honoured one", () => {
  it.each(aiTools.map((tool) => [tool.slug, tool] as const))(
    "%s's rendered page states its own ceiling and no other",
    (slug, tool) => {
      const honoured = honouredCeiling(slug);
      const claims = renderedStrings(tool).flatMap(characterClaims);
      // Vacuity bound: the page must STATE the ceiling somewhere a reader
      // meets it before uploading — zero claims is a blind census, not a pass.
      expect(
        claims.length,
        `${slug}'s page never states a character ceiling at all`,
      ).toBeGreaterThanOrEqual(1);
      for (const claim of claims) {
        expect(
          claim,
          `${slug} states "${claim.toLocaleString("en-US")} characters" but its ` +
            `engine honours ${honoured.toLocaleString("en-US")} — a visitor ` +
            "sized their document against a number the tool will not accept",
        ).toBe(honoured);
      }
    },
  );

  it.each(aiTools.map((tool) => [tool.slug, tool] as const))(
    "%s's page-range figures re-derive from ITS ceiling, not the shared one",
    (slug, tool) => {
      // A right number with a stale page range beside it is the same defect
      // one notch over. Every number in a ceiling-stating sentence must be the
      // ceiling itself or a floor derived from it at a measured density.
      const honoured = honouredCeiling(slug);
      const allowed = new Set([
        honoured,
        pagesAtDensest(honoured),
        pagesAtSparsest(honoured),
      ]);
      const ceilingSentences = renderedStrings(tool).filter(
        (text) => characterClaims(text).length > 0,
      );
      expect(ceilingSentences.length).toBeGreaterThanOrEqual(1);
      for (const sentence of ceilingSentences) {
        for (const value of allNumbers(sentence)) {
          expect(
            allowed.has(value),
            `${slug}'s ceiling sentence carries ${value.toLocaleString("en-US")}, ` +
              `which is neither its ceiling (${honoured.toLocaleString("en-US")}) nor ` +
              `a page floor derived from it (${pagesAtDensest(honoured)} dense / ` +
              `${pagesAtSparsest(honoured)} sparse): "${sentence}"`,
          ).toBe(true);
        }
      }
    },
  );

  it.each(aiTools.map((tool) => [tool.slug] as const))(
    "%s's panel references the constant its engine enforces, and not the other",
    (slug) => {
      const honoured = honouredCeiling(slug);
      const panel = withoutComments(read(panels.get(slug)!));
      const readBound = honoured === AI_INPUT_LIMITS.maxInputCharacters;
      const required = readBound
        ? "AI_INPUT_LIMITS.maxInputCharacters"
        : "TRANSLATE_MAX_INPUT_CHARS";
      const forbidden = readBound
        ? "TRANSLATE_MAX_INPUT_CHARS"
        : "AI_INPUT_LIMITS";
      expect(
        panel,
        `${relative(panels.get(slug)!)} must state its limit via ${required}`,
      ).toContain(required);
      expect(
        panel,
        `${relative(panels.get(slug)!)} references ${forbidden}, which is the ` +
          "other bound's constant — the two numbers were 49x apart on 2026-08-11",
      ).not.toContain(forbidden);
    },
  );
});

describe("the third surface someone adds next month", () => {
  it("no copy file hand-writes a ceiling-scale character figure", () => {
    // Every rendered ceiling above reaches the reader through interpolation of
    // an owned constant. A literal "500,000 characters" in source is a figure
    // nothing can keep true — the characters unit of the numbers census, which
    // deliberately scopes to MB/minutes/files/tools/languages/runs.
    const offenders = copyFiles().filter((file) =>
      /(?:\d{1,3}(?:,\d{3})+|\d{4,})\s+characters\b/.test(
        flattenForPhraseSearch(withoutComments(read(file)))),
    );
    expect(
      offenders.map(relative),
      "these files hand-write a ceiling-scale character figure instead of " +
        "deriving it from the constant the engine enforces",
    ).toEqual([]);
  });

  it("every copy file referencing a ceiling constant is an attributed surface", () => {
    // A new component quoting AI_INPUT_LIMITS (or TRANSLATE_MAX_INPUT_CHARS)
    // is a new ceiling surface. It must land in the attribution above — the
    // per-tool panel map or the rendered tool-facts strings — or this fails
    // and names it, instead of a third surface shipping unchecked.
    const attributed = new Set(
      [...panels.entries()]
        .filter(([slug]) => aiTools.some((t) => t.slug === slug))
        .map(([, file]) => relative(file)),
    );
    attributed.add("src/lib/tools/tool-facts.ts");
    const offenders = copyFiles()
      .filter((file) => {
        const source = withoutComments(read(file));
        return (
          source.includes("AI_INPUT_LIMITS") ||
          source.includes("TRANSLATE_MAX_INPUT_CHARS")
        );
      })
      .map(relative)
      .filter((file) => !attributed.has(file));
    expect(
      offenders,
      "these copy files state an AI ceiling outside the attributed surfaces — " +
        "wire them into the per-tool checks in this file before they ship",
    ).toEqual([]);
  });
});

describe("controls", () => {
  it("positive control: the checker catches the sentence production carried on 2026-08-20", () => {
    // The EXACT shape tool-facts built for translate until this guard: the
    // shared reading cap and its page floors, offered as translate's ceiling.
    // If the extractor or the comparison ever go blind, this stops failing it,
    // and "no offenders" stops meaning anything.
    const shipped =
      `Up to ${AI_INPUT_LIMITS.maxInputCharacters.toLocaleString("en-US")} characters ` +
      `of selectable text — roughly ${pagesAtDensest(AI_INPUT_LIMITS.maxInputCharacters)} pages of dense text, or about ` +
      `${pagesAtSparsest(AI_INPUT_LIMITS.maxInputCharacters)} of sparsely-set pages.`;
    const honoured = honouredCeiling("translate-pdf");
    const claims = characterClaims(shipped);
    expect(claims.length).toBeGreaterThanOrEqual(1);
    expect(claims.some((claim) => claim !== honoured)).toBe(true);
  });

  it("health check: the extractor sees numbers in known-good copy", () => {
    // A blind extractor reports the strongest possible pass above.
    expect(characterClaims("Up to 500,000 characters of text")).toEqual([
      500_000,
    ]);
    expect(characterClaims("Up to 10,258 characters translated")).toEqual([
      10_258,
    ]);
    expect(allNumbers("roughly 81 pages, or about 291 of them")).toEqual([
      81, 291,
    ]);
  });
});
