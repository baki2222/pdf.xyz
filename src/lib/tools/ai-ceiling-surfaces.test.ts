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
 *  - each tool's ENGINE ceiling is CLASSIFIED from the enforcement source
 *    (an engine that refuses via `translateMaxInputChars(...)` is bounded by
 *    output; one that truncates at `AI_INPUT_LIMITS.maxInputCharacters` is
 *    bounded by reading) — an unclassifiable engine FAILS, it is not skipped;
 *  - a per-call tool's HONOURED ceiling is MEASURED above its engine: the tools
 *    come from the route's pricing table (`AI_RUN_PRICING`), the pricing
 *    function from the route's own call, the processors from the worker's
 *    registry and wiring (see {@link measureReadCeiling});
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
 * INVERTED 2026-10-06, history kept: until then this read "WHAT IS NOT PROVEN
 * HERE — the two engines still on the SHARED reading cap are not run against
 * their 500,000-character window". Nor was anything ABOVE the engine. The read
 * a per-call run gets is `min(engine window, the bound the route handed it)`
 * (`processor/read-cap-limit.ts`), and the bound is whatever the route's
 * pricing returns, so an engine-source classification certified the window
 * whatever the pricing and the processor did to it. A lane that clamped the
 * bound to a day's allowance stayed green here over pages stating 500,000; and
 * its own replacement guard measured the lane's pricing function, not the one
 * the route calls. Now every per-call tool's ceiling is MEASURED through the
 * composed chain, see {@link measureReadCeiling}: the pricing function is
 * DISCOVERED from `src/app/api/jobs/route.ts` (the call whose `.delivery`
 * reaches the adapter), priced for an honest declaration under BOTH answers of
 * the running worker's read-cap witness, and the real processor, wired with
 * the worker's own limits, is run on a document longer than any window. What
 * reaches the provider is the ceiling; the smaller of the two witness states
 * is the one a page may state. If a read-bound engine ever gains a refusal
 * path, add its probe to {@link OUTPUT_BOUND_PROBES} — the completeness check
 * below will demand it by name.
 *
 * A THIRD CLASS, added 2026-09-27: PER-QUESTION. Chat with PDF read up to the
 * shared 500,000 characters on a 41,032-character charge; its reading ceiling
 * is now its charge ceiling, `CHAT_MAX_CHARACTERS_PER_QUESTION`, and it covers
 * the document AND the conversation. That class IS run —
 * {@link PER_QUESTION_PROBES} feeds the engine one character over and measures
 * the document and the conversation in the request the provider receives.
 *
 * THE EXIT CONDITION names the property: an entry leaves this guard only when
 * the surface derives its figure from the same constant its engine enforces —
 * never because the two numbers happen to agree today.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import {
  AI_DELIVERY_LIMITS,
  AI_RUN_PRICING,
  aiReservationFor,
  type AiReservation,
} from "@/lib/jobs/delivery-cap";
import { AI_READ_LIMITS, aiReadLimitFor } from "@/lib/jobs/ai-read-limit";
import { createProcessorRegistry } from "@/lib/workers/processor";
import { summarizeDeps } from "@/lib/workers/summarize/native";
import { aiExtractDeps } from "@/lib/workers/ai-extract/native";
import { chatWithPdfDeps } from "@/lib/workers/chat-with-pdf/native";
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
import { runChatWithPdf } from "@/lib/workers/chat-with-pdf/engine";
import { CHAT_MAX_CHARACTERS_PER_QUESTION } from "@/lib/jobs/chat-with-pdf";
import { tools } from "./index";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { toolFacts } from "./tool-facts";
import {
  pageContent,
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "./page-copy";
import {
  copyFiles,
  flattenForPhraseSearch,
  toolContentFiles,
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
 * The three kinds of bound an AI engine enforces, and the constant each one's
 * surfaces must state it through. The constant NAMES are what the panel check
 * below requires and forbids, so they live beside the classification that
 * picks them rather than in a second table.
 */
type BoundKind = "output" | "per-question" | "shared-read";
const BOUND_CONSTANTS: Record<BoundKind, string> = {
  output: "TRANSLATE_MAX_INPUT_CHARS",
  "per-question": "CHAT_MAX_CHARACTERS_PER_QUESTION",
  "shared-read": "AI_INPUT_LIMITS.maxInputCharacters",
};

/** Which kind of bound a tool's engine enforces — classified from its source. */
function boundKind(slug: string): BoundKind {
  const engineFile = engines.get(slug);
  if (!engineFile) {
    throw new Error(
      `no engine exports a *_TOOL constant for "${slug}" under src/lib/workers/*/engine.ts`,
    );
  }
  const source = read(engineFile);
  if (/translateMaxInputChars\s*\(/.test(source)) return "output";
  if (source.includes(BOUND_CONSTANTS["per-question"])) return "per-question";
  if (source.includes(BOUND_CONSTANTS["shared-read"])) return "shared-read";
  throw new Error(
    `${relative(engineFile)} enforces none of ${Object.values(BOUND_CONSTANTS).join(", ")} — ` +
      "classify its bound here before any page may state one",
  );
}

/**
 * The ceiling a tool's ENGINE compares against, classified from the engine's
 * own refusal/truncation source. Throws on an engine this cannot classify — a
 * new AI engine with a third kind of bound must extend the classification,
 * loudly, not slide past it.
 *
 * For a per-call tool this is only the most the processor could pass on: what
 * one run honours is MEASURED above the engine, see {@link honouredCeiling}.
 */
function engineCeiling(slug: string): number {
  if (boundKind(slug) === "per-question") {
    // A reading ceiling that is also the charge ceiling. The job's delivery
    // cap can only LOWER it (the conversation is paid out of the same
    // reservation), so this is the most any page may promise.
    return CHAT_MAX_CHARACTERS_PER_QUESTION;
  }
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
 *  Set 2b — what a per-call run reads, MEASURED through the route's
 *  pricing and the real processor.
 * ------------------------------------------------------------------ */

const ROUTE = path.join(ROOT, "src", "app", "api", "jobs", "route.ts");

/** The tools the route prices per call — the ones whose read the processor bounds. */
const PER_CALL_TOOLS = Object.entries(AI_RUN_PRICING)
  .filter(([, pricing]) => pricing === "per-call")
  .map(([slug]) => slug)
  .sort();

type RoutePricing = (
  tool: string,
  request: { readonly declaredCharacters?: number },
  limits: {
    readonly fallbackCharacters: number;
    readonly headroom: number;
    readonly readCapEnforced: () => Promise<boolean>;
  },
) => Promise<AiReservation>;

/**
 * The pricing function `POST /api/jobs` calls and the limits object it spreads
 * into it, DISCOVERED from the route rather than named here: the call whose
 * result's `.delivery` the route hands to `adapter.createJob`, resolved through
 * the route's own import statements. A guard that names the function it trusts
 * certifies that function, whatever the route has moved on to — the shape that
 * let a lane's guard measure `deliveryCapFor` while the route it merged into
 * priced through `aiReservationFor`. Every broken link is FATAL.
 */
async function discoverRoutePricing(): Promise<{
  name: string;
  specifier: string;
  price: RoutePricing;
  limitsName: string;
  limits: { readonly fallbackCharacters: number; readonly headroom: number };
}> {
  const source = withoutComments(read(ROUTE));
  const handed = /createJob\(\s*[\w.]+\s*,\s*(\w+)\??\.delivery\s*\)/.exec(
    source,
  );
  if (!handed) {
    throw new Error(
      `${relative(ROUTE)} no longer hands a reservation's .delivery to createJob — ` +
        "find what bounds a per-call run before any page states its read",
    );
  }
  const priced = new RegExp(
    `\\b${handed[1]}\\s*=\\s*await\\s+(\\w+)\\(\\s*tool\\.slug\\s*,\\s*[\\w.]+\\s*,\\s*\\{\\s*\\.\\.\\.(\\w+)`,
  ).exec(source);
  if (!priced) {
    throw new Error(
      `${relative(ROUTE)}: no "${handed[1]} = await <pricing>(tool.slug, …, { ...<limits>" call`,
    );
  }
  const imports = new Map<string, string>();
  for (const match of source.matchAll(
    /import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g,
  )) {
    for (const name of match[1]!.split(",")) {
      imports.set(name.replace(/^\s*type\s+/, "").trim(), match[2]!);
    }
  }
  const [name, limitsName] = [priced[1]!, priced[2]!];
  const specifier = imports.get(name);
  const limitsSpecifier = imports.get(limitsName);
  if (!specifier || !limitsSpecifier) {
    throw new Error(
      `${relative(ROUTE)} calls ${name} with ...${limitsName}, and does not import both`,
    );
  }
  const pricingModule = (await import(/* @vite-ignore */ specifier)) as Record<
    string,
    unknown
  >;
  const limitsModule = (await import(
    /* @vite-ignore */ limitsSpecifier
  )) as Record<string, unknown>;
  const price = pricingModule[name];
  const limits = limitsModule[limitsName] as
    { fallbackCharacters?: unknown; headroom?: unknown } | undefined;
  if (
    typeof price !== "function" ||
    typeof limits?.fallbackCharacters !== "number" ||
    typeof limits.headroom !== "number"
  ) {
    throw new Error(
      `${specifier} exports no ${name} function, or ${limitsSpecifier}'s ${limitsName} is not a limits object`,
    );
  }
  return {
    name,
    specifier,
    price: price as RoutePricing,
    limitsName,
    limits: limits as { fallbackCharacters: number; headroom: number },
  };
}

/**
 * The document every measurement reads: longer than anything a page states,
 * so a run that reads it all is one whose ceiling was not met. Health-checked
 * below against every published figure.
 */
const LONG_DOCUMENT = 1_000_000;
/** Document text, and nothing else: no prompt or option contains it. */
const MARK = "░";

/** The worker's production limits for each per-call processor, with the probe's extractor and provider. */
function perCallRegistry(text: string, provider: AiProvider) {
  const extract = vi.fn(async (): Promise<ExtractedPdfText> => ({
    pageCount: 1,
    // No page metadata, as `extractorFor` below: the document region the
    // model receives is then the text and nothing else.
    pages: [],
    text,
    characterCount: text.length,
    hasText: true,
  }));
  // The worker's own wiring, so the limits the processors run under are the
  // ones production passes — with no provider or extractor resolved from an
  // environment this test does not have.
  const wiring = { extract, provider };
  return createProcessorRegistry({
    summarize: { ...summarizeDeps({}), ...wiring },
    aiExtract: { ...aiExtractDeps({}), ...wiring },
    chatWithPdf: { ...chatWithPdfDeps({}), ...wiring },
  });
}

/** The smallest body each per-call tool's contract accepts. */
const MINIMAL_OPTIONS: Record<string, Record<string, unknown>> = {
  "summarize-pdf": {},
  "chat-with-pdf": { question: "What does it say?" },
  "ai-extract": { mode: "prompt", prompt: "Extract the total." },
};

/**
 * What one run of `slug` put in front of the model of a `LONG_DOCUMENT`
 * document under `delivery`: the document characters, plus — for a
 * per-question engine, whose ceiling covers both — the conversation sent with
 * it. `null` when the run did not reach the provider.
 */
async function readByProcessor(
  slug: string,
  delivery: AiReservation["delivery"],
  length = LONG_DOCUMENT,
): Promise<number | null> {
  const provider = recordingProvider('{"probe": "probe"}');
  const processor = perCallRegistry(MARK.repeat(length), provider).resolve(
    slug,
  );
  if (!processor) throw new Error(`no processor resolves ${slug}`);
  const options = MINIMAL_OPTIONS[slug];
  if (!options) throw new Error(`no minimal options for ${slug}`);
  const result = await processor.process({
    tool: slug,
    options,
    inputs: [
      {
        fileId: "f_ceilingprobe",
        filename: "probe.pdf",
        contentType: "application/pdf",
        bytes: new Uint8Array([1, 2, 3]),
      },
    ],
    ...(delivery ? { delivery } : {}),
  });
  if (!result.ok || provider.calls.length === 0) return null;
  let read = 0;
  for (const call of provider.calls) {
    for (const part of [
      call.system ?? "",
      ...call.messages.map((m) => m.content),
    ]) {
      for (const ch of part) if (ch === MARK) read += 1;
    }
    if (boundKind(slug) === "per-question") {
      read += call.messages.reduce((sum, m) => sum + m.content.length, 0);
    }
  }
  return read;
}

/**
 * What one run of a per-call tool reads, priced by the route's own function
 * for the LEAST an honest browser declares of a `LONG_DOCUMENT` document (its
 * count can under-run the worker's by the headroom factor, never more), then
 * run through the real processor under the bound that pricing returned — once
 * per answer of the running worker's read-cap witness.
 */
async function measureReadCeiling(slug: string): Promise<{
  proven: number | null;
  unproven: number | null;
  deliveries: Record<"proven" | "unproven", AiReservation["delivery"]>;
}> {
  const route = await discoverRoutePricing();
  const declared = Math.ceil(LONG_DOCUMENT / route.limits.headroom);
  const deliveryWhen = async (enforced: boolean) =>
    (
      await route.price(
        slug,
        { declaredCharacters: declared },
        { ...route.limits, readCapEnforced: async () => enforced },
      )
    ).delivery;
  const deliveries = {
    proven: await deliveryWhen(true),
    unproven: await deliveryWhen(false),
  };
  return {
    proven: await readByProcessor(slug, deliveries.proven),
    unproven: await readByProcessor(slug, deliveries.unproven),
    deliveries,
  };
}

/** slug → what one run reads under each witness state; filled once, before any check. */
const measuredReads = new Map<
  string,
  Awaited<ReturnType<typeof measureReadCeiling>>
>();

beforeAll(async () => {
  for (const slug of PER_CALL_TOOLS) {
    measuredReads.set(slug, await measureReadCeiling(slug));
  }
});

/**
 * The ceiling one run of `slug` honours — the figure every surface of its
 * page must state.
 *
 * For a per-call tool, MEASURED (above): the smaller of the two witness
 * states, because a visitor reads the page before anyone knows which worker
 * image will run the job. A run that never reached the provider is not a
 * ceiling, it is a broken probe, and throws. Otherwise the engine's own
 * classified ceiling.
 */
function honouredCeiling(slug: string): number {
  if (AI_RUN_PRICING[slug] !== "per-call") return engineCeiling(slug);
  const measured = measuredReads.get(slug);
  if (!measured || measured.proven === null || measured.unproven === null) {
    throw new Error(
      `${slug} is priced per call, and no run of it reached the provider under ` +
        "both witness states — the read ceiling was not measured",
    );
  }
  return Math.min(measured.proven, measured.unproven);
}

/**
 * The constant a panel's Limit row must state its ceiling through. A per-call
 * tool's figure is the one derived from the route's pricing
 * (`@/lib/jobs/ai-read-limit`), never an engine constant on its own.
 */
const READ_LIMIT_FUNCTION = "aiReadLimitFor";
function panelConstant(slug: string): string {
  return AI_RUN_PRICING[slug] === "per-call"
    ? READ_LIMIT_FUNCTION
    : BOUND_CONSTANTS[boundKind(slug)];
}
/** Every name a panel could state an AI ceiling through. */
const CEILING_NAMES: readonly string[] = [
  ...Object.values(BOUND_CONSTANTS),
  READ_LIMIT_FUNCTION,
  "AI_READ_LIMITS",
];

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
/**
 * Figures in characters that are NOT a statement of how much of the document
 * a tool reads — each with the shipped sentence that needs it.
 *
 * Added 2026-09-27, when this guard moved from the derived FAQ to everything
 * the page renders (`page-copy`). The authored content states other quantities
 * in the same unit: what a run COSTS from the daily allowance, and how long a
 * box the reader types into may be. Read as ceilings, a true page failed four
 * times ("chat-with-pdf states 10,258 characters but its engine honours
 * 500,000"); the checker was answering "is there a number before
 * `characters`?" while claiming to answer "what does this page say the tool
 * reads?".
 *
 * Classified by the words BESIDE the figure, never by its value: the published
 * per-run charge is 10,258 — the same number as translate's ceiling, by
 * construction — so a value exemption would license exactly the 49x defect
 * this guard was built for ("Chat reads up to 10,258 characters"). The control
 * below keeps that sentence red.
 */
const NOT_A_CEILING: readonly {
  what: string;
  /** Tested against ~48 characters either side of the figure. */
  near: RegExp;
  shipped: string;
}[] = [
  {
    what: "a charge against the daily allowance",
    near: /\b(?:allowance|pool|charged|costs?)\b/i,
    shipped:
      "each question, follow-ups included, costs a flat 10,258 characters of that pool",
  },
  {
    what: "the length of a box the reader types into",
    near: /\b(?:box|field|focus|instructions?|a name of|type up to)\b/i,
    shipped:
      "Write it in the Your question box in plain language, up to 2,000 characters",
  },
];

const CLAIM = /(\d[\d,]*)\s+characters\b/gi;

/** Is the figure at `index` in `text` one of the NOT_A_CEILING quantities? */
function notACeiling(text: string, index: number, length: number): boolean {
  const window = text.slice(Math.max(0, index - 48), index + length + 48);
  return NOT_A_CEILING.some((kind) => kind.near.test(window));
}

/**
 * The CEILING claims in a rendered string: every "N characters" that is not
 * one of the other quantities above, sentence by sentence so a neighbouring
 * sentence cannot excuse one.
 */
function characterClaims(text: string): number[] {
  const out: number[] = [];
  for (const sentence of sentencesOf(text)) {
    for (const m of sentence.matchAll(CLAIM)) {
      if (notACeiling(sentence, m.index ?? 0, m[0].length)) continue;
      out.push(Number(m[1]!.replace(/,/g, "")));
    }
  }
  return out;
}

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
}

/** Every "N characters" figure in a rendered sentence, comma-tolerant. */
function rawCharacterClaims(text: string): number[] {
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

/**
 * The rendered strings a tool's page shows — through `page-copy`, the same
 * accessors the page renders: facts, the FAQ (→ FAQPage JSON-LD), the steps
 * (→ HowTo JSON-LD), the intro and use cases, and the meta description.
 * Until 2026-09-27 this read `toolFaq`/`howToSteps` directly; the page moved
 * to authored content that day, and reading the old accessors would have
 * certified strings the page no longer showed.
 */
function renderedStrings(tool: Tool): string[] {
  const content = pageContent(tool);
  return [
    ...toolFacts(tool.slug).map((fact) => `${fact.label}: ${fact.value}`),
    ...pageFaq(tool).map((entry) => `${entry.question} ${entry.answer}`),
    ...pageSteps(tool).map(stepText),
    ...pageIntro(tool),
    ...pageUseCases(tool).map((u) => `${u.title}. ${u.body}`),
    ...(content ? [content.seoTitle, content.metaDescription] : []),
  ];
}

/* ------------------------------------------------------------------ *
 *  The behavioural probes for engines that REFUSE at their ceiling.
 * ------------------------------------------------------------------ */

interface ProbeResult {
  overCeiling: { refused: boolean; quoted: number | undefined; paid: boolean };
  atCeiling: { reachedProvider: boolean };
}

/**
 * A provider that answers at once and records every request. `text` defaults
 * to a translation; the per-call measurement passes a JSON object, the one
 * reply all three of its engines (a summary, an answer, an extraction) accept.
 */
function recordingProvider(
  text = "texte traduit",
): AiProvider & { calls: AiCompletionRequest[] } {
  const calls: AiCompletionRequest[] = [];
  const success: AiCompletionResult = {
    ok: true,
    text,
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

/**
 * Every per-question engine must have a probe here, keyed by slug. A probe RUNS
 * the engine with NO job cap — its own ceiling, the one the page states — and
 * measures, in the request the provider received, the document plus the
 * conversation sent with it: the ceiling covers both ("conversation included"
 * on the panel). Until 2026-09-27 (history kept) it measured the document
 * alone, and the engine sent a full ceiling of document with the question on
 * top whenever a job arrived without a cap — which, once chat was priced per
 * call, is every undeclared question and every question until the worker
 * proves its read cap. `sentAt` is a document that exactly fits beside the
 * question, so "all of one that fits" still asks about a whole document.
 */
const PER_QUESTION_PROBES: Record<
  string,
  (ceiling: number) => Promise<{ sentOver: number; sentAt: number }>
> = {
  "chat-with-pdf": async (ceiling) => {
    const START = "--- DOCUMENT START ---\n";
    const END = "\n--- DOCUMENT END ---";
    const QUESTION = "What does it say?";
    /** Document plus conversation, read off the request — or -1 if absent. */
    const readIn = (provider: { calls: AiCompletionRequest[] }) => {
      const call = provider.calls[0];
      const system = call?.system ?? "";
      const start = system.indexOf(START);
      const end = system.indexOf(END);
      if (!call || start < 0 || end < 0) return -1;
      const conversation = call.messages.reduce(
        (sum, message) => sum + message.content.length,
        0,
      );
      return end - (start + START.length) + conversation;
    };
    const over = recordingProvider();
    await runChatWithPdf(
      new Uint8Array([1, 2, 3]),
      { question: QUESTION },
      { extract: extractorFor("a".repeat(ceiling + 1)), provider: over },
    );
    const at = recordingProvider();
    await runChatWithPdf(
      new Uint8Array([1, 2, 3]),
      { question: QUESTION },
      {
        extract: extractorFor("a".repeat(ceiling - QUESTION.length)),
        provider: at,
      },
    );
    return { sentOver: readIn(over), sentAt: readIn(at) };
  },
};

/**
 * NO EXEMPTIONS. Every AI tool in the catalogue goes through every per-tool
 * check below, with no list of slugs to leave out.
 *
 * INVERTED 2026-09-27, history kept. For one commit this file carried a
 * `PENDING_COPY` map that took chat-with-pdf out of both "states its own
 * ceiling" checks, because chat's FAQ answer "How much of my PDF does Chat
 * with PDF read?" is built in `tool-facts.ts` (owned by a separate copy
 * change) and still said 500,000 characters after chat's engine began reading
 * at most `CHAT_MAX_CHARACTERS_PER_QUESTION`. Each entry was asserted to be
 * "still wrong", so it would go red when the copy was fixed. That did not make
 * it safe: while the entry stood, the false answer shipped as FAQPage JSON-LD
 * with every guard that could see it switched off for that page. A guard that
 * exempts a defect lets it ship, and the exemption reads like an argument that
 * it was fine. If a page's copy lags its engine, this file goes RED and the
 * change waits for the copy. It does not carve the page out.
 */

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

  it("every per-question engine has a behavioural probe, by name", () => {
    const perQuestion = aiTools
      .map((t) => t.slug)
      .filter((slug) => boundKind(slug) === "per-question");
    // Positive control on the classifier: chat IS per-question.
    expect(perQuestion).toContain("chat-with-pdf");
    for (const slug of perQuestion) {
      expect(
        PER_QUESTION_PROBES[slug],
        `${slug} is classified per-question but has no probe`,
      ).toBeDefined();
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

describe("a per-call run's read is measured through the route's own pricing", () => {
  it("the route's pricing function is discovered, and is the one that prices per-call runs", async () => {
    const route = await discoverRoutePricing();
    // Positive control on the discovery: today the route calls
    // aiReservationFor (through the `@/lib/jobs` barrel, so by identity, not
    // by specifier) with the shared limits object. If it moves, this names
    // where to — and every measurement below follows it without being edited.
    expect(route.price, `${route.specifier}#${route.name}`).toBe(
      aiReservationFor,
    );
    expect(route.limits).toBe(AI_DELIVERY_LIMITS);
  });

  it("the per-call set is alive, and every member is a catalogue AI tool with a measurement", () => {
    // Vacuity bound: three per-call tools today. A filter that returned none
    // would make every per-call check below pass over nothing.
    expect(PER_CALL_TOOLS.length).toBeGreaterThanOrEqual(3);
    for (const slug of PER_CALL_TOOLS) {
      expect(aiTools.map((t) => t.slug)).toContain(slug);
      expect(measuredReads.has(slug), `${slug} was not measured`).toBe(true);
    }
  });

  it("health: the measured document is longer than every figure any page states", () => {
    for (const slug of PER_CALL_TOOLS) {
      expect(LONG_DOCUMENT).toBeGreaterThan(engineCeiling(slug));
      expect(LONG_DOCUMENT).toBeGreaterThan(aiReadLimitFor(slug));
    }
  });

  it("both witness states are really priced, and priced differently", () => {
    // "the smaller of two states" is vacuous if the pricing never asks the
    // witness: a proven worker is handed a bound, an unproven one none.
    for (const slug of PER_CALL_TOOLS) {
      const { deliveries } = measuredReads.get(slug)!;
      expect(
        deliveries.proven,
        `${slug}: no bound under a proving worker`,
      ).toBeDefined();
      expect(
        deliveries.unproven,
        `${slug}: a bound under an unproven worker`,
      ).toBeUndefined();
    }
  });

  it.each(PER_CALL_TOOLS.map((slug) => [slug] as const))(
    "%s: POSITIVE CONTROL — the measurement sees a bound the pricing hands down",
    async (slug) => {
      // Without this, a measurement that ignored `delivery` (a registry wired
      // past the processor, a run that never reached the provider) would
      // report the engine window as "what the pricing allows" forever.
      const small = 400;
      const read = await readByProcessor(slug, { characters: small });
      expect(read, `${slug} did not reach the provider`).not.toBeNull();
      const conversation =
        boundKind(slug) === "per-question"
          ? (MINIMAL_OPTIONS[slug]!.question as string).length
          : 0;
      expect(read).toBe(small + conversation);
    },
  );

  it.each(PER_CALL_TOOLS.map((slug) => [slug] as const))(
    "%s: the processor never reads past its engine, and the published figure IS what one run reads",
    (slug) => {
      const honoured = honouredCeiling(slug);
      // The processor can only lower the engine's window, never raise it.
      expect(honoured).toBeLessThanOrEqual(engineCeiling(slug));
      expect(honoured).toBeGreaterThan(0);
      // The figure every surface interpolates, derived from the pricing in
      // `ai-read-limit.ts`, against what the route's pricing and the real
      // processor actually let through. Two derivations, one number.
      expect(
        AI_READ_LIMITS[slug],
        `ai-read-limit publishes ${AI_READ_LIMITS[slug]?.toLocaleString("en-US")} ` +
          `characters for ${slug}, but one run reads ${honoured.toLocaleString("en-US")} ` +
          "through the route's pricing and the processor",
      ).toBe(honoured);
    },
  );

  it.each(PER_CALL_TOOLS.map((slug) => [slug] as const))(
    "%s: a proving worker and an unproven one read the same amount, so one figure is true of both",
    (slug) => {
      // The published figure is the smaller of the two (`ai-read-limit`), so
      // it never promises a read some image will not give. But the pages also
      // say a longer document "is read up to that point only": on an image that
      // read MORE, that sentence is false in the other direction. If the two
      // states ever part, the copy has to say which image reads what before
      // this goes green again — not quietly state the smaller one.
      const { proven, unproven } = measuredReads.get(slug)!;
      expect(
        proven,
        `${slug} reads ${proven?.toLocaleString("en-US")} under a worker that ` +
          `proves its read cap and ${unproven?.toLocaleString("en-US")} under one ` +
          "that does not",
      ).toBe(unproven);
    },
  );

  it("ai-read-limit publishes a figure for exactly the per-call tools", () => {
    expect(Object.keys(AI_READ_LIMITS).sort()).toEqual(PER_CALL_TOOLS);
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

describe("the per-question engine reads exactly its ceiling (run, not read)", () => {
  it.each(Object.keys(PER_QUESTION_PROBES))(
    "%s sends the model no more than its ceiling, conversation included, and all of a document that fits",
    async (slug) => {
      // The ENGINE's ceiling: this runs the engine with no job cap. What the
      // route's pricing and the processor make of it is measured separately.
      const ceiling = engineCeiling(slug);
      const probe = await PER_QUESTION_PROBES[slug]!(ceiling);
      expect(
        probe.sentOver,
        `${slug} sent ${probe.sentOver} characters of document and conversation ` +
          `for a ${ceiling + 1}-character document — the ceiling the page ` +
          "states is not the one it reads to",
      ).toBe(ceiling);
      expect(probe.sentAt).toBe(ceiling);
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
      // Sentence by sentence: a FAQ answer can state the ceiling in one
      // sentence and the allowance in the next, and only the first is held
      // to the ceiling's page floors. File sizes (MB) are `file-ceilings`'
      // subject, not this one's.
      const ceilingSentences = renderedStrings(tool)
        .flatMap(sentencesOf)
        .filter((text) => characterClaims(text).length > 0)
        .map((text) => text.replace(/\d[\d,]*\s*(?:MB|GB)\b/g, ""));
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
      // A per-call tool's panel states the figure derived from the route's
      // pricing (`aiReadLimitFor`), and no engine constant beside it: until
      // 2026-10-06 the summarize and extract rows interpolated
      // AI_INPUT_LIMITS.maxInputCharacters directly, true only while nothing
      // between the engine and the run lowered it.
      const panel = withoutComments(read(panels.get(slug)!));
      const required = panelConstant(slug);
      // USED, not merely imported: an import line satisfied this check while
      // the row beside it hand-wrote the figure (mutation-checked 2026-10-06).
      const body = panel.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
      expect(
        body,
        `${relative(panels.get(slug)!)} must state its limit via ${required}`,
      ).toContain(required);
      // Every OTHER ceiling name is forbidden — by its root name, so
      // "AI_INPUT_LIMITS" catches any field of it, not just the one we know.
      for (const other of CEILING_NAMES) {
        if (other === required) continue;
        const forbidden = other.split(".")[0]!;
        expect(
          panel,
          `${relative(panels.get(slug)!)} references ${forbidden}, which is ` +
            "another bound's constant — translate's and the shared cap were " +
            "49x apart on 2026-08-11, chat's and the shared cap 12x on 2026-09-27",
        ).not.toContain(forbidden);
      }
    },
  );

  it.each(aiTools.map((tool) => [tool.slug, tool] as const))(
    "%s's panel, AS RENDERED, states its own ceiling and no other",
    async (slug, tool) => {
      // The panel a visitor receives, not its source (wave1/l01-page-leak): a
      // source scan for the constant's NAME is satisfied by any sentence that
      // interpolates it, whatever else the rendered row says beside it.
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
});

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
    // A new component quoting AI_INPUT_LIMITS, aiReadLimitFor or TRANSLATE_MAX_INPUT_CHARS
    // is a new ceiling surface. It must land in the attribution above — the
    // per-tool panel map or the rendered tool-facts strings — or this fails
    // and names it, instead of a third surface shipping unchecked.
    const attributed = new Set(
      [...panels.entries()]
        .filter(([slug]) => aiTools.some((t) => t.slug === slug))
        .map(([, file]) => relative(file)),
    );
    attributed.add("src/lib/tools/tool-facts.ts");
    // Each AI tool's authored content file: its strings reach the page through
    // `page-copy`, which `renderedStrings` reads per tool — so the checks
    // above hold them. Derived from the content index, not named.
    const contentFiles = toolContentFiles();
    for (const tool of aiTools) {
      const file = contentFiles.get(tool.slug);
      if (file) attributed.add(relative(file));
    }
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
        return CEILING_NAMES.some((constant) =>
          source.includes(constant.split(".")[0]!),
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
        /TRANSLATE_MAX_INPUT_CHARS\s*\.\s*toLocaleString/.test(source),
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

  it("the not-a-ceiling classes are exercised both ways", () => {
    // Every class exempts the sentence that needed it...
    for (const kind of NOT_A_CEILING) {
      expect(rawCharacterClaims(kind.shipped).length, kind.what).toBe(1);
      expect(characterClaims(kind.shipped), kind.what).toEqual([]);
    }
    // ...and none exempts a ceiling, including one whose VALUE is the charge.
    for (const ceiling of [
      "Chat with PDF reads up to 10,258 characters of your document.",
      "The model is sent at most 10,258 characters of the extracted text.",
      "Up to 500,000 characters of selectable text — roughly 81 pages.",
    ]) {
      expect(characterClaims(ceiling).length, ceiling).toBe(1);
    }
    // A neighbouring sentence does not excuse a ceiling.
    expect(
      characterClaims(
        "Each run costs a share of the allowance. It reads 10,258 characters.",
      ),
    ).toEqual([10_258]);
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
