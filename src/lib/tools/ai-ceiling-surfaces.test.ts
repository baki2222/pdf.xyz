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
 * THE READ-BOUND TOOLS ARE RUN TOO, AND THROUGH THE PROCESSOR (2026-09-28).
 * Until then this file classified them from the ENGINE source alone
 * (`AI_INPUT_LIMITS.maxInputCharacters`, 500,000) and recorded, here, that no
 * probe ever ran them. Then the worker began enforcing what each job reserved
 * (`processor/read-cap.ts`): a run reads `min(engine window, reservation)`,
 * and the largest reservation a browser makes is one day's allowance. Every
 * read-bound page still said 500,000 and this guard stayed green — the bound
 * had moved from the engine into the PROCESSOR, and the classifier read the
 * engine. The set searched was the wrong artifact. So a read-bound tool's
 * honoured ceiling is now MEASURED, end to end in the unit a reader is given:
 * the real `declareAiRead` counts an over-long real PDF (the most a browser
 * ever declares), the route's own `deliveryCapFor` prices it, and the real
 * processor from the worker's registry — with the production deps' limits —
 * runs an over-long text under that cap and reports what it sent. The panel is
 * likewise checked as RENDERED, not as source.
 *
 * THE EXIT CONDITION names the property: an entry leaves this guard only when
 * the surface derives its figure from the same constant its engine enforces —
 * never because the two numbers happen to agree today.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { extractPdfText, type ExtractedPdfText } from "@/lib/pdf/text";
import { AI_DELIVERY_LIMITS, deliveryCapFor } from "@/lib/jobs/delivery-cap";
import {
  declareAiRead,
  READ_BOUND_AI_TOOLS,
  type ReadBoundAiTool,
} from "@/lib/workers/ai-read-declaration";
import { createProcessorRegistry } from "@/lib/workers/processor";
import type { ProcessorInput } from "@/lib/workers/processor/types";
import { summarizeDeps } from "@/lib/workers/summarize/native";
import { aiExtractDeps } from "@/lib/workers/ai-extract/native";
import { chatWithPdfDeps } from "@/lib/workers/chat-with-pdf/native";
import { translateDeps } from "@/lib/workers/translate/native";
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
import {
  runTranslate,
  type PdfTextExtractor,
} from "@/lib/workers/translate/engine";
import { tools } from "./index";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { howToSteps, toolFacts, toolFaq } from "./tool-facts";
import {
  copyFiles,
  flattenForPhraseSearch,
  withoutComments,
} from "./copy-surface";
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
function boundKind(slug: string): "output" | "read" {
  const engineFile = engines.get(slug);
  if (!engineFile) {
    throw new Error(
      `no engine exports a *_TOOL constant for "${slug}" under src/lib/workers/*/engine.ts`,
    );
  }
  const source = read(engineFile);
  if (/translateMaxInputChars\s*\(/.test(source)) return "output";
  if (source.includes("AI_INPUT_LIMITS.maxInputCharacters")) return "read";
  throw new Error(
    `${relative(engineFile)} enforces neither translateMaxInputChars(...) nor ` +
      "AI_INPUT_LIMITS.maxInputCharacters — classify its bound here before " +
      "any page may state one",
  );
}

function honouredCeiling(slug: string): number {
  if (boundKind(slug) === "output") {
    // The refusal runs against the OUTPUT-derived ceiling; the shared reading
    // cap, if also present, is only the truncation window above it. The
    // honoured bound is the smaller of the two.
    const source = read(engines.get(slug)!);
    const refusal = translateMaxInputChars(TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS);
    return source.includes("AI_INPUT_LIMITS.maxInputCharacters")
      ? Math.min(refusal, AI_INPUT_LIMITS.maxInputCharacters)
      : refusal;
  }
  // READ-bound: the engine's window is only the outer bound. What a run reads
  // is decided in the PROCESSOR, so the honoured figure is MEASURED there (see
  // `probeReadBound`) — the engine source cannot see a bound that lives above
  // it, which is exactly how 500,000 stayed "honoured" here after it wasn't.
  const probe = readProbes.get(slug);
  if (!probe) {
    throw new Error(
      `${slug} is read-bound but no processor probe ran for it — a ceiling ` +
        "classified from the engine alone cannot see the reservation the " +
        "processor enforces",
    );
  }
  return probe.honoured;
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
/** slug → the panel's module specifier and exported component, as the page imports it. */
const panelComponents = new Map<
  string,
  { specifier: string; component: string }
>();

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
    // `moduleSpecifier`, not `module`: eslint's no-assign-module-variable
    // forbids the shorter name. Rename only — the dispatch walk is unchanged.
    const moduleSpecifier = imports.get(token[2]!);
    // The first component in a slug branch that the page imports from the
    // tools components tree is that branch's panel (ErrorBoundary and shared
    // UI live elsewhere).
    if (!moduleSpecifier?.startsWith("@/components/tools/")) continue;
    const file = path.join(
      ROOT,
      "src",
      moduleSpecifier.replace(/^@\//, "").replace(/\//g, path.sep) + ".tsx",
    );
    for (const slug of pending) {
      bySlug.set(slug, file);
      panelComponents.set(slug, {
        specifier: moduleSpecifier,
        component: token[2]!,
      });
    }
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
 *  The behavioural probes for engines that READ a prefix — measured
 *  through the declaration, the charge and the PROCESSOR.
 * ------------------------------------------------------------------ */

/** The read-bound tools, as the engine classification derives them. */
const readBoundSlugs = (): string[] =>
  aiTools.map((t) => t.slug).filter((slug) => boundKind(slug) === "read");

/**
 * A real PDF longer than one day's allowance, so the declaration the real
 * extractor makes for it is the LARGEST any browser can make. Built, not
 * typed: its own count is checked against the declaration in a health test.
 */
async function overLongPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const line =
    "Quarterly report, section 4: revenue, costs and outlook for the region. ";
  for (let p = 0; p < 14; p += 1) {
    const page = doc.addPage([612, 792]);
    for (let l = 0; l < 48; l += 1) {
      page.drawText(`${line}(${p + 1}.${l + 1})`, {
        x: 20,
        y: 770 - l * 15,
        size: 8,
        font,
      });
    }
  }
  return doc.save();
}

/** Longer than every engine window, so whatever binds is visible. */
const OVER_LONG_TEXT = "The invoice total is 1200 euros. ".repeat(
  Math.ceil((AI_INPUT_LIMITS.maxInputCharacters + 20_000) / 33),
);

/**
 * The minimal valid options per read-bound processor. The completeness test
 * below demands an entry for every read-bound slug, by name.
 */
const READ_PROBE_OPTIONS: Record<string, Record<string, unknown>> = {
  "summarize-pdf": {},
  "chat-with-pdf": { question: "What is the total?" },
  "ai-extract": { mode: "prompt", prompt: "Extract the total." },
};

interface ReadProbe {
  /** Browser characters of the over-long PDF, by the real extractor. */
  documentCharacters: number;
  /** What `declareAiRead` declares for it — the largest declaration there is. */
  declared: number;
  /** Worker characters the route charges for that declaration. */
  reserved: number;
  /** Worker characters the processor reports it sent under that charge. */
  sent: number;
  /** The same processor with NO cap — the engine window alone (control). */
  sentUncapped: number;
  /** What one run honours, in the browser's unit a page states. */
  honoured: number;
}

/** The PRODUCTION deps' limits — the window the worker really runs with. */
function productionLimits() {
  return {
    summarize: summarizeDeps({}).limits,
    translate: translateDeps({}).limits,
    aiExtract: aiExtractDeps({}).limits,
    chatWithPdf: chatWithPdfDeps({}).limits,
  };
}

async function runReadProcessor(
  slug: string,
  delivery: ProcessorInput["delivery"] | undefined,
): Promise<number> {
  const extract = vi.fn(async (): Promise<ExtractedPdfText> => ({
    pageCount: 1,
    pages: [
      {
        pageNumber: 1,
        text: OVER_LONG_TEXT,
        characterCount: OVER_LONG_TEXT.length,
      },
    ],
    text: OVER_LONG_TEXT,
    characterCount: OVER_LONG_TEXT.length,
    hasText: true,
  }));
  const provider: AiProvider = {
    id: "openai",
    model: "gpt-test",
    async complete() {
      return {
        ok: true,
        text: '{"total": 1200}',
        model: "gpt-test",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
  };
  const limits = productionLimits();
  const registry = createProcessorRegistry({
    summarize: { extract, provider, limits: limits.summarize },
    translate: { extract, provider, limits: limits.translate },
    aiExtract: { extract, provider, limits: limits.aiExtract },
    chatWithPdf: { extract, provider, limits: limits.chatWithPdf },
  });
  const processor = registry.resolve(slug);
  if (!processor) throw new Error(`the worker registry resolves no ${slug}`);
  const result = await processor.process({
    tool: slug,
    options: READ_PROBE_OPTIONS[slug] ?? {},
    inputs: [
      {
        fileId: "f_abc123def456",
        filename: "report.pdf",
        contentType: "application/pdf",
        bytes: new Uint8Array([1, 2, 3]),
      },
    ],
    ...(delivery ? { delivery } : {}),
  });
  if (!result.ok) {
    throw new Error(`${slug}'s processor failed: ${JSON.stringify(result)}`);
  }
  const sent = result.results?.ai?.truncation?.charactersSent;
  if (typeof sent !== "number") {
    throw new Error(`${slug}'s job record carries no truncation window`);
  }
  return sent;
}

async function probeReadBound(
  slug: string,
  pdf: Uint8Array,
  documentCharacters: number,
): Promise<ReadProbe> {
  if (!(READ_BOUND_AI_TOOLS as readonly string[]).includes(slug)) {
    throw new Error(
      `${slug} is read-bound by its engine but declareAiRead does not know it`,
    );
  }
  const declaration = await declareAiRead(slug as ReadBoundAiTool, pdf);
  if (!declaration.ok || declaration.declaredCharacters === undefined) {
    throw new Error(`${slug}: the real PDF declared nothing`);
  }
  const declared = declaration.declaredCharacters;
  const cap = deliveryCapFor(
    { declaredCharacters: declared },
    AI_DELIVERY_LIMITS,
  );
  const sent = await runReadProcessor(slug, cap);
  const sentUncapped = await runReadProcessor(slug, undefined);
  return {
    documentCharacters,
    declared,
    reserved: cap.characters,
    sent,
    sentUncapped,
    // A document of `honoured` browser characters is admitted (it is within
    // the largest declaration) AND read whole (its worst-case worker size,
    // × headroom, is within what the processor sends). Both, so neither half
    // can move without this figure moving with it.
    honoured: Math.min(
      declared,
      Math.floor(sent / AI_DELIVERY_LIMITS.headroom),
    ),
  };
}

const readProbes = new Map<string, ReadProbe>();

beforeAll(async () => {
  const pdf = await overLongPdf();
  const documentCharacters = (await extractPdfText(pdf)).characterCount;
  for (const slug of readBoundSlugs()) {
    readProbes.set(slug, await probeReadBound(slug, pdf, documentCharacters));
  }
}, 60_000);

/**
 * COPY OWED — surfaces this guard knows are false and cannot fix from here.
 *
 * `tool-facts.ts` is a shared copy file; the lane that moved the read-bound
 * bound into the processor may not edit it, and escalated the sentence instead.
 * Each entry pins the STALE figure EXACTLY, so this is not a licence: the day
 * the corrected sentence lands, the ratchet below goes red ON PURPOSE and the
 * entry must be deleted — after which the ordinary check holds that sentence
 * to the measured ceiling like every other surface. Exit condition: the
 * sentence states what one run reads. Keep this list empty otherwise.
 */
const COPY_OWED: {
  slugs: readonly string[];
  surface: string;
  question: RegExp;
  staleFigure: number;
}[] = [
  {
    slugs: READ_BOUND_AI_TOOLS,
    surface: "src/lib/tools/tool-facts.ts FAQ (also FAQPage JSON-LD)",
    question: /^How much of my PDF does .+ read\?$/,
    staleFigure: AI_INPUT_LIMITS.maxInputCharacters,
  },
];

/** The FAQ entries on a tool's page that a {@link COPY_OWED} entry holds. */
function owedSentences(tool: Tool) {
  const owed = COPY_OWED.filter((o) => o.slugs.includes(tool.slug));
  return toolFaq(tool).filter((entry) =>
    owed.some((o) => o.question.test(entry.question)),
  );
}

/**
 * The rendered strings a tool's page shows — facts, FAQ (→ JSON-LD), steps —
 * minus any sentence listed in {@link COPY_OWED}, which the ratchet holds.
 */
function checkedStrings(tool: Tool): string[] {
  const owed = new Set(owedSentences(tool).map((entry) => entry.question));
  return [
    ...toolFacts(tool.slug).map((fact) => `${fact.label}: ${fact.value}`),
    ...toolFaq(tool)
      .filter((entry) => !owed.has(entry.question))
      .map((entry) => `${entry.question} ${entry.answer}`),
    ...howToSteps(tool),
  ];
}

/** The panel as a visitor receives it: server-rendered, tags stripped. */
async function renderedPanelText(slug: string, tool: Tool): Promise<string> {
  const entry = panelComponents.get(slug);
  if (!entry) throw new Error(`no dispatched panel component for ${slug}`);
  const mod = (await import(/* @vite-ignore */ entry.specifier)) as Record<
    string,
    ComponentType<{ tool: Tool }>
  >;
  const Panel = mod[entry.component];
  if (!Panel) {
    throw new Error(`${entry.specifier} exports no ${entry.component}`);
  }
  return renderToStaticMarkup(createElement(Panel, { tool }))
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");
}

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
      .filter((slug) =>
        /translateMaxInputChars\s*\(/.test(read(engines.get(slug)!)),
      );
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

describe("the read-bound probes are alive", () => {
  it("every read-bound engine was probed through its processor, by name", () => {
    const readBound = readBoundSlugs();
    // Vacuity bound: three read-bound tools today. A classifier that quietly
    // found none would leave every read-bound page unmeasured and green.
    expect(readBound.length).toBeGreaterThanOrEqual(3);
    // Both directions against the declaration's own list: a tool the engine
    // calls read-bound must be one the browser declares for, and vice versa.
    expect([...readBound].sort()).toEqual([...READ_BOUND_AI_TOOLS].sort());
    for (const slug of readBound) {
      expect(
        READ_PROBE_OPTIONS[slug],
        `${slug} is read-bound but has no processor options to probe it with`,
      ).toBeDefined();
      expect(readProbes.has(slug), `${slug} was never probed`).toBe(true);
    }
  });

  it.each(READ_BOUND_AI_TOOLS.map((slug) => [slug] as const))(
    "health: %s's probe used a document longer than any declaration",
    (slug) => {
      const probe = readProbes.get(slug)!;
      // Otherwise `declared` is the document's size, not the ceiling, and the
      // honoured figure below would be whatever this fixture happens to hold.
      expect(probe.documentCharacters).toBeGreaterThan(probe.declared);
      expect(OVER_LONG_TEXT.length).toBeGreaterThan(probe.sentUncapped);
    },
  );
});

describe("the read-bound processor honours the reservation (run, not read)", () => {
  it.each(READ_BOUND_AI_TOOLS.map((slug) => [slug] as const))(
    "%s reads no more than the largest charge, and all of it",
    (slug) => {
      const probe = readProbes.get(slug)!;
      expect(
        probe.sent,
        `${slug} sent ${probe.sent.toLocaleString("en-US")} characters under a ` +
          `${probe.reserved.toLocaleString("en-US")}-character charge — the ` +
          "reservation is decorative and no per-run figure is true",
      ).toBeLessThanOrEqual(probe.reserved);
      // And it is not cut short of what was paid for, inside the engine window.
      expect(probe.sent).toBe(Math.min(probe.reserved, probe.sentUncapped));
    },
  );

  it.each(READ_BOUND_AI_TOOLS.map((slug) => [slug] as const))(
    "POSITIVE CONTROL: %s uncapped reads the engine window, so the probe can see a window move",
    (slug) => {
      // Without this, "sent <= reserved" could hold because the probe's text
      // or truncation reading were blind. Uncapped, the ENGINE window binds —
      // the 500,000 that every read-bound page stated.
      expect(readProbes.get(slug)!.sentUncapped).toBe(
        AI_INPUT_LIMITS.maxInputCharacters,
      );
    },
  );
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
      const claims = checkedStrings(tool).flatMap(characterClaims);
      // Vacuity bound: the page must STATE the ceiling somewhere a reader
      // meets it before uploading — zero claims is a blind census, not a pass.
      // An owed sentence counts as stated: the ratchet below holds it.
      expect(
        claims.length + owedSentences(tool).length,
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
      const ceilingSentences = checkedStrings(tool).filter(
        (text) => characterClaims(text).length > 0,
      );
      expect(
        ceilingSentences.length + owedSentences(tool).length,
      ).toBeGreaterThanOrEqual(1);
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

  it.each(aiTools.map((tool) => [tool.slug, tool] as const))(
    "%s's panel, AS RENDERED, states its own ceiling and no other",
    async (slug, tool) => {
      // The panel a visitor receives, not its source: the Limit row said
      // "500,000 characters read" on all three read-bound panels while the
      // processor read a quarter of that, and a source scan for the constant's
      // NAME was satisfied by exactly that sentence.
      const honoured = honouredCeiling(slug);
      const text = await renderedPanelText(slug, tool);
      const claims = characterClaims(text);
      expect(
        claims.length,
        `${relative(panels.get(slug)!)} renders no character ceiling at all`,
      ).toBeGreaterThanOrEqual(1);
      for (const claim of claims) {
        expect(
          claim,
          `${relative(panels.get(slug)!)} renders "${claim.toLocaleString("en-US")} ` +
            `characters" but one run of ${slug} honours ` +
            honoured.toLocaleString("en-US"),
        ).toBe(honoured);
      }
    },
  );

  it.each(aiTools.map((tool) => [tool.slug] as const))(
    "%s's panel DERIVES its figure from its bound's owning constant, and not the other",
    (slug) => {
      // The exit condition, as a check: a panel passes because it interpolates
      // the constant its bound is defined by — never because two numbers
      // happen to agree today.
      const panel = withoutComments(read(panels.get(slug)!));
      const readBound = boundKind(slug) === "read";
      const required = readBound
        ? "AI_READ_LIMIT_CHARACTERS"
        : "TRANSLATE_MAX_INPUT_CHARS";
      const forbidden = readBound
        ? ["TRANSLATE_MAX_INPUT_CHARS", "AI_INPUT_LIMITS.maxInputCharacters"]
        : ["AI_INPUT_LIMITS", "AI_READ_LIMIT_CHARACTERS"];
      expect(
        panel,
        `${relative(panels.get(slug)!)} must state its limit via ${required}`,
      ).toContain(required);
      for (const name of forbidden) {
        expect(
          panel,
          `${relative(panels.get(slug)!)} references ${name}, which is not ` +
            `the bound one run of ${slug} honours`,
        ).not.toContain(name);
      }
    },
  );
});

describe("copy owed (a ratchet, not a licence)", () => {
  it("every owed entry names real AI tools and exactly one real FAQ question each", () => {
    for (const owed of COPY_OWED) {
      expect(owed.slugs.length).toBeGreaterThanOrEqual(1);
      for (const slug of owed.slugs) {
        const tool = aiTools.find((t) => t.slug === slug);
        expect(tool, `${slug} is not a catalogue AI tool`).toBeDefined();
        // A pattern matching nothing would exempt nothing and prove nothing;
        // one matching two would exempt a sentence nobody escalated.
        expect(
          toolFaq(tool!).filter((e) => owed.question.test(e.question)),
        ).toHaveLength(1);
      }
    }
  });

  it.each(
    COPY_OWED.flatMap((owed) =>
      owed.slugs.map((slug) => [slug, owed] as const),
    ),
  )(
    "%s: the owed sentence still states EXACTLY the stale figure (red on purpose once fixed: delete the entry)",
    (slug, owed) => {
      const tool = aiTools.find((t) => t.slug === slug)!;
      const sentence = toolFaq(tool).find((e) =>
        owed.question.test(e.question),
      )!;
      // The day this fails, the corrected copy has landed: delete the
      // COPY_OWED entry, and `checkedStrings` hands the sentence to the
      // ordinary checks above, which hold it to the measured ceiling.
      expect(characterClaims(sentence.answer)).toEqual([owed.staleFigure]);
      // And the stale figure really is not the measured one — otherwise
      // nothing is owed and the entry is a place to park a surface.
      expect(owed.staleFigure).not.toBe(honouredCeiling(slug));
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
        flattenForPhraseSearch(withoutComments(read(file))),
      ),
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
    // The allowance module derives the DAILY BUDGET from the per-call ceiling; it
    // does not state the ceiling itself. Its two sentences are attributed — and
    // checked in both directions — by `ratelimit/allowance-copy.test.ts`, whose
    // corpus imports AI_ALLOWANCE_FACT and AI_ALLOWANCE_USED_MESSAGE directly.
    // Listed here so this guard keeps its teeth for a genuinely NEW ceiling
    // surface rather than firing on the one place the budget is defined.
    attributed.add("src/lib/jobs/ai-allowance.ts");
    // The job route uses the ceiling as a NUMBER — the fallback reservation for
    // a job that declares no character count — and never renders it. A file
    // that computes with the constant is not a surface that states it, and the
    // test directly below CHECKS that rather than taking this comment's word
    // for it: an exception nothing verifies is how a guard erodes.
    attributed.add("src/app/api/jobs/route.ts");
    const offenders = copyFiles()
      .filter((file) => {
        const source = withoutComments(read(file));
        return (
          source.includes("AI_INPUT_LIMITS") ||
          source.includes("AI_READ_LIMIT_CHARACTERS") ||
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

  it("the non-copy exceptions really do not STATE the ceiling", () => {
    // The exception above says these files compute with the constant rather
    // than rendering it. That claim is checked here, so the attribution cannot
    // become a place to park a genuine copy surface.
    for (const file of ["src/app/api/jobs/route.ts"]) {
      const source = withoutComments(read(path.join(ROOT, file)));
      // A surface renders a number into text: a template hole or a
      // toLocaleString on the constant. Arithmetic does neither.
      expect(
        /\${[^}]*TRANSLATE_MAX_INPUT_CHARS/.test(source),
        file +
          " interpolates the ceiling into a string, so it IS a copy " +
          "surface and must be attributed per-tool rather than excepted here",
      ).toBe(false);
      expect(
        /TRANSLATE_MAX_INPUT_CHARSs*.s*toLocaleString/.test(source),
        file + " renders the ceiling for a reader, so it IS a copy surface",
      ).toBe(false);
    }
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

  it("positive control: the checker catches the read-bound FAQ answer and panel row shipped until 2026-09-28", () => {
    // What every read-bound page carried while the processor read a quarter
    // of it. If the measured ceiling ever collapses back onto the engine
    // window, this stops failing them.
    const shipped = [
      `Up to ${AI_INPUT_LIMITS.maxInputCharacters.toLocaleString("en-US")} characters of selectable text`,
      `25 MB/file · ${AI_INPUT_LIMITS.maxInputCharacters.toLocaleString("en-US")} characters read`,
    ];
    for (const slug of READ_BOUND_AI_TOOLS) {
      const honoured = honouredCeiling(slug);
      for (const sentence of shipped) {
        const claims = characterClaims(sentence);
        expect(claims).toHaveLength(1);
        expect(claims[0]).not.toBe(honoured);
      }
    }
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
