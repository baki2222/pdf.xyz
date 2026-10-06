// @vitest-environment node
/**
 * Each AI tool's page publishes the allowance in the unit the route charges IT.
 *
 * Audited at 67e8d0f: Summarize PDF, Chat with PDF and AI Extract all published
 * "30,774 free characters of AI text a day for your connection" — as a fact line
 * and as the FAQPage answer to "Is X free?". That figure is TRANSLATE's: it is
 * `TRANSLATE_MAX_INPUT_CHARS × runs`, and it is true only for a client that
 * declares how many characters a job holds. Only the translate panel did. Every
 * other AI job arrived undeclared, and `POST /api/jobs` reserved a whole call's
 * worth for it (`deliveryCapFor({}, …)`), so each summary, question or
 * extraction cost a fixed third of the bucket whatever its length. A
 * 2,000-character memo bought 3 summaries, not ~15; a 300-page report read
 * "30,774 characters a day" beside "reads up to 500,000 characters" and looked
 * impossible, yet ran — and was charged exactly what the memo was. The refusal
 * then told a user who had summarised three short memos that their "30,774 free
 * characters" were gone.
 *
 * Nothing caught it because every allowance guard checked the ONE sentence
 * against the ONE tool it was derived from (translate), and the other three
 * pages imported the same constant — "one copy" was true, and was the defect.
 *
 * ── REWRITTEN AT THE MERGE WITH PER-CALL PRICING (L10), HISTORY KEPT ────────
 *
 * This file was written (L04, 885f2e1) when the unit a tool was charged in
 * followed from whether its CLIENT declared characters, so it discovered the
 * declaring clients and required the copy to be keyed on that set, and it
 * required each undeclared tool's page to publish the exact count the route
 * allowed ("3 summaries a day"). L10 (9a7624a, 2988ccc) then made every AI
 * client declare and priced Summarize, Chat and Extract PER CALL
 * (`aiReservationFor`): a run costs what it sends, clamped at one whole run,
 * and only while the running worker proves its read cap (`aiReadCap`); an
 * image without the proof charges every run the ceiling. Two of this file's
 * assertions pinned the pre-L10 world and are INVERTED here:
 *
 *  - "matches the set the copy is keyed on, in both directions" required a
 *    declaring set strictly between empty and all. After L10 it is all four,
 *    and the copy is keyed on `AI_RUN_PRICING` — the map the route prices by.
 *    It now requires that map to cover exactly the AI tools, both kinds to
 *    exist, and every per-call client to declare (the discount needs it).
 *  - "a per-run page's count equals the jobs the real route allows" required
 *    the EXACT count. On a proving worker a short document now gets more, so
 *    the page publishes the per-run CEILING and the FLOOR it guarantees, true
 *    of every worker image; the real route is spent at the costliest run
 *    each tool can send, and must allow exactly that floor.
 *
 * The discovery of the declaring clients, the render of the real pages and
 * the spend through the real route are unchanged.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { unwireJobRoute, wireJobRoute } from "@/tests/wired-job-route";
import { tools } from "@/lib/tools";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import {
  AI_ALLOWANCE_USED_MESSAGE,
  AI_CHARACTER_ALLOWANCE,
  AI_CHARACTER_ALLOWANCE_DELIVERED,
  AI_JOB_DELIVERY_LIMITS,
  AI_PER_CALL_ALLOWANCE_FACT,
  AI_PER_CALL_RUNS_PER_DAY_AT_LEAST,
  AI_PER_CALL_RUN_CEILING,
  aiAllowanceFactFor,
  aiRunUnitFor,
} from "@/lib/jobs/ai-allowance";
import { AI_RUN_PRICING, aiReservationFor } from "@/lib/jobs/delivery-cap";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit";
import { resetRateLimitGuardForTests } from "@/lib/ratelimit/guard";
import { POST } from "@/app/api/jobs/route";
import {
  renderToolPages,
  type RenderedToolPage,
} from "@/tests/rendered-tool-pages";

const ROOT = process.cwd();

/**
 * The compiler through `createRequire`, never a static import — the bundler
 * would otherwise transform TypeScript's own bundle and hunt for its absent
 * sourcemap (the idiom of `client-bundle-node-free.test.ts`).
 */
const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const aiTools = () =>
  tools.filter((t) => capabilityForMode(t.processing) === "ai");
const perCallTools = () =>
  aiTools().filter((t) => AI_RUN_PRICING[t.slug] === "per-call");
const perCharacterTools = () =>
  aiTools().filter((t) => AI_RUN_PRICING[t.slug] === "per-character");

/* ------------------------------------------------------------------ *
 *  Which clients declare — read from the call sites, not from a list
 * ------------------------------------------------------------------ */

/**
 * slug → whether the browser client passes `declaredCharacters` (the sixth
 * positional argument of `runSecurityJob`). Every non-test module under
 * `src/lib/workers` is parsed; a call whose tool argument is not a string
 * literal is skipped (office/structure clients pass a variable, and none of
 * them is an AI tool — the coverage assertion below would say so if one were).
 */
function discoverDeclaringClients(): Map<string, boolean> {
  const found = new Map<string, boolean>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test."))
        visitFile(full);
    }
  };
  const visitFile = (file: string) => {
    const sf = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: TS.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "runSecurityJob"
      ) {
        const first = node.arguments[0];
        if (first && ts.isStringLiteral(first)) {
          found.set(
            first.text,
            (found.get(first.text) ?? false) || node.arguments.length >= 6,
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  };
  walk(path.join(ROOT, "src", "lib", "workers"));
  return found;
}

/* ------------------------------------------------------------------ *
 *  What the page publishes, read the way a reader reads it
 * ------------------------------------------------------------------ */

const DELIVERED = AI_CHARACTER_ALLOWANCE_DELIVERED.toLocaleString("en-US");
const CEILING = AI_PER_CALL_RUN_CEILING.toLocaleString("en-US");

/**
 * Problems with an allowance sentence published for a tool priced per call.
 * Empty means it states the most one run can take, the floor of runs a day
 * that ceiling guarantees (and that the route allows at the costliest run),
 * and that the allowance is shared.
 *
 * WAS `perRunProblems`, which also refused any mention of the character
 * figure: under undeclared pricing that figure was not the tool's unit at all.
 * Per-call pricing charges characters, so the figure is the tool's too — but
 * never ALONE: without the per-run ceiling it reads as "your document's
 * length", which is true only on a proving worker.
 */
function perCallProblems(text: string, floor: number): string[] {
  const problems: string[] = [];
  if (!text.includes(`never counts more than ${CEILING}`))
    problems.push(`states no per-run ceiling (${CEILING})`);
  const count = /\bat least (\d[\d,]*) ([a-z ]+?) fits? in a day\b/.exec(text);
  if (!count) problems.push("states no floor of runs a day");
  else if (Number(count[1]!.replace(/,/g, "")) !== floor)
    problems.push(
      `publishes at least ${count[1]} a day; the route allows ${floor} at the costliest run`,
    );
  if (!/\bshared\b|\bsame allowance\b/i.test(text))
    problems.push(
      "does not say the allowance is shared with the other AI tools",
    );
  return problems;
}

/** Verbatim from production /tools/summarize-pdf at 67e8d0f. */
const SHIPPED_SUMMARIZE_FACT =
  "30,774 free characters of AI text a day for your connection — the allowance resets daily.";

/** L04's sentence (885f2e1), true only of a worker that has not proved aiReadCap. */
const L04_SUMMARIZE_FACT =
  "Each summary uses a fixed share of the free daily AI allowance for your connection, whatever the document's length — 3 summaries a day if nothing else draws on it. The allowance is shared with the other AI tools and resets daily.";

/* ------------------------------------------------------------------ *
 *  The route, spent for real
 * ------------------------------------------------------------------ */

/**
 * A valid options body per AI tool, so the request reaches the allowance. A
 * newly discovered AI tool with no entry here is a FATAL gap, not a skip.
 */
const VALID_OPTIONS: Record<string, Record<string, unknown>> = {
  "summarize-pdf": { length: "brief", format: "bullets" },
  "chat-with-pdf": { question: "What is this document about?" },
  "ai-extract": { mode: "prompt", prompt: "List every date." },
  "translate-pdf": { targetLanguage: "fr", sourceLanguage: "auto" },
};

/**
 * How many jobs of `slug`, submitted the way its browser client submits them,
 * the day allows. `declared` is what a declaring client adds to the body.
 */
async function jobsTheRouteAllows(
  slug: string,
  declared: { declaredCharacters?: number; declaredTextPages?: number } = {},
): Promise<number> {
  const options = VALID_OPTIONS[slug];
  if (!options) throw new Error(`no valid options fixture for AI tool ${slug}`);
  let allowed = 0;
  for (let i = 0; i < 50; i += 1) {
    const response = await POST(
      new Request("http://localhost/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tool: slug,
          inputs: ["f_probe0000000000"],
          options,
          ...declared,
        }),
      }),
    );
    if (response.status === 429) return allowed;
    if (response.status === 400)
      throw new Error(
        `${slug}: the probe was rejected as malformed (${await response.text()}) — fix the fixture`,
      );
    allowed += 1;
  }
  throw new Error(`${slug}: 50 jobs were never refused`);
}

let pages: Map<string, RenderedToolPage>;
beforeAll(() => {
  pages = renderToolPages();
}, 180_000);

// A WIRED deployment, so each admitted job is created and its charge stands:
// since the integration of wave1/l01-page-leak a job that is NOT created is
// given its allowance back, and against an unconfigured worker no probe here
// would ever be refused (`@/tests/wired-job-route`).
beforeEach(() => {
  resetRateLimitGuardForTests();
  process.env[RATE_LIMIT_ENV.provider] = "local-memory";
  wireJobRoute();
});
afterEach(() => {
  resetRateLimitGuardForTests();
  delete process.env[RATE_LIMIT_ENV.provider];
  unwireJobRoute();
  vi.unstubAllGlobals();
});

describe("which AI clients declare their characters", () => {
  it("is read from every runSecurityJob call, and covers every AI tool", () => {
    const discovered = discoverDeclaringClients();
    expect(
      discovered.size,
      "implausibly few runSecurityJob callers — the parse has gone blind",
    ).toBeGreaterThanOrEqual(5);
    const missing = aiTools()
      .map((t) => t.slug)
      .filter((slug) => !discovered.has(slug));
    expect(
      missing,
      "these AI tools have no browser client call site this walk can see",
    ).toEqual([]);
  });

  it("the copy is keyed on the pricing the route charges by, and every per-call client declares", () => {
    // INVERTED at the merge with L10, history in the file header. The copy's
    // classification is `AI_RUN_PRICING`, the map `aiReservationFor` reads —
    // one definition for the charge and the sentence.
    const priced = Object.keys(AI_RUN_PRICING).sort();
    expect(
      priced,
      "AI_RUN_PRICING and the catalogue's AI tools differ",
    ).toEqual(
      aiTools()
        .map((t) => t.slug)
        .sort(),
    );
    // Health, both ways: at least one tool of each kind, or the branches of
    // aiAllowanceFactFor below are compared against nothing.
    expect(perCharacterTools().length).toBeGreaterThan(0);
    expect(perCallTools().length).toBeGreaterThan(0);
    // A per-call run is priced by its size only when it declares one; a
    // client that stopped would pay the ceiling on every run while the page
    // promised a floor it still keeps — true, but a discount quietly gone.
    const discovered = discoverDeclaringClients();
    expect(
      perCallTools()
        .map((t) => t.slug)
        .filter((slug) => discovered.get(slug) !== true),
      "these per-call clients send no declaration",
    ).toEqual([]);
    // The two branches, as the pages receive them.
    for (const tool of perCharacterTools())
      expect(aiAllowanceFactFor(tool.slug)).not.toContain(CEILING);
    for (const tool of perCallTools())
      expect(
        aiAllowanceFactFor(tool.slug).startsWith(AI_PER_CALL_ALLOWANCE_FACT),
      ).toBe(true);
  });
});

describe("each AI page publishes what the route lets that tool do", () => {
  it("the detector flags the sentences that shipped on Summarize (positive controls)", () => {
    const floor = AI_PER_CALL_RUNS_PER_DAY_AT_LEAST;
    expect(perCallProblems(`Yes — ${SHIPPED_SUMMARIZE_FACT}`, floor)).toEqual(
      expect.arrayContaining([
        `states no per-run ceiling (${CEILING})`,
        "states no floor of runs a day",
      ]),
    );
    // L04's exact count is not a floor, and names no ceiling.
    expect(perCallProblems(L04_SUMMARIZE_FACT, floor)).toEqual(
      expect.arrayContaining([
        `states no per-run ceiling (${CEILING})`,
        "states no floor of runs a day",
      ]),
    );
  });

  it("a per-call page's floor is what the real route allows its costliest run", async () => {
    const perCall = perCallTools();
    expect(perCall.length, "no per-call AI tool — blind").toBeGreaterThan(0);
    for (const tool of perCall) {
      // The costliest runs a client can send: undeclared, and declared far
      // past any real document. Either way no proving heartbeat is served
      // here, so this is also every run on an image built before the proof.
      resetRateLimitGuardForTests();
      const undeclared = await jobsTheRouteAllows(tool.slug);
      resetRateLimitGuardForTests();
      const huge = await jobsTheRouteAllows(tool.slug, {
        declaredCharacters: 400_000,
        declaredTextPages: 120,
      });
      expect(
        undeclared,
        `${tool.slug}: the route allows no job`,
      ).toBeGreaterThan(0);
      expect(
        [undeclared, huge],
        "the published floor is not what the route allows at the costliest run",
      ).toEqual([
        AI_PER_CALL_RUNS_PER_DAY_AT_LEAST,
        AI_PER_CALL_RUNS_PER_DAY_AT_LEAST,
      ]);

      const page = pages.get(tool.slug)!;
      const free = page.faq.find((e) => /\bfree\?$/.test(e.question));
      expect(
        free,
        `${tool.slug}: no "Is it free?" answer is served`,
      ).toBeDefined();
      expect(
        perCallProblems(free!.answer, undeclared),
        `${tool.slug} FAQPage`,
      ).toEqual([]);
      const fact = aiAllowanceFactFor(tool.slug);
      expect(perCallProblems(fact, undeclared), `${tool.slug} fact`).toEqual(
        [],
      );
      expect(
        page.text,
        `${tool.slug}: the fact line is not what the page renders`,
      ).toContain(fact);
    }
  });

  it("CONTROL: the floor is a floor — a short run on a proving worker costs less", async () => {
    // Priced through the route's own function and limits, with the proof
    // present: a one-page document pays what it sends, so more runs fit than
    // the page promises at least. (per-call-pricing.test.ts spends the real
    // route over a served heartbeat for the same property.)
    for (const tool of perCallTools()) {
      const { charge } = await aiReservationFor(
        tool.slug,
        {
          declaredCharacters: 2_000,
          options: VALID_OPTIONS[tool.slug],
        },
        { ...AI_JOB_DELIVERY_LIMITS, readCapEnforced: async () => true },
      );
      expect(
        Math.floor(AI_CHARACTER_ALLOWANCE / charge),
        `${tool.slug}: a short proven run is not cheaper than the ceiling`,
      ).toBeGreaterThan(AI_PER_CALL_RUNS_PER_DAY_AT_LEAST);
    }
  });

  it("a per-character page keeps the character figure, and says it is shared", () => {
    const perCharacter = perCharacterTools();
    expect(perCharacter.length).toBeGreaterThan(0);
    for (const tool of perCharacter) {
      const page = pages.get(tool.slug)!;
      const free = page.faq.find((e) => /\bfree\?$/.test(e.question))!;
      expect(free.answer).toContain(DELIVERED);
      expect(free.answer).toMatch(/\bsame allowance\b/);
    }
  });

  it("chat's page says a question is a run, and states the floor in questions", () => {
    // Was "chat's floor is what the real route allows its costliest question",
    // under chat's own per-question cap. Per-call pricing clamps every
    // per-call run at one ceiling, so chat's floor is spent in the loop above;
    // what stays chat's own is that a QUESTION is the run.
    const page = pages.get("chat-with-pdf")!;
    const free = page.faq.find((e) => /\bfree\?$/.test(e.question))!;
    expect(free.answer).toContain(
      "Each question counts against the allowance as a run of its own",
    );
    expect(free.answer).toContain(
      `at least ${AI_PER_CALL_RUNS_PER_DAY_AT_LEAST} chat questions fit in a day`,
    );
    expect(page.text).toContain(aiAllowanceFactFor("chat-with-pdf"));
  });

  it("the refusal claims no character count was spent, and names every per-call run", () => {
    // It said "The 30,774 free characters of AI text for this connection are
    // used up" — false after three one-page summaries.
    expect(AI_ALLOWANCE_USED_MESSAGE).not.toMatch(
      /\bThe [\d,]+ free characters\b[^.]*\bare used up\b/,
    );
    // It then said "… or 3 summaries or extractions, shared across the AI
    // tools" — the exact count, false on a proving worker. It now states the
    // per-run ceiling and names each per-call tool's run, from the SAME table
    // its page's floor is written in (aiRunUnitFor), never a typed list.
    const perCall = perCallTools();
    expect(perCall.length, "positive control: per-call AI tools exist").toBe(
      aiTools().length - perCharacterTools().length,
    );
    const units = perCall.map((t) => aiRunUnitFor(t.slug));
    // Every per-call tool names its own run — the generic fallback is a
    // missing entry, not a noun.
    expect(units.filter((u) => u.one === "run")).toEqual([]);
    for (const [i, tool] of perCall.entries()) {
      expect(aiAllowanceFactFor(tool.slug)).toContain(
        `at least ${AI_PER_CALL_RUNS_PER_DAY_AT_LEAST} ${units[i]!.many} fit`,
      );
    }
    const clause =
      /\b((?:an? [a-z ]+?)(?:, an? [a-z ]+?)*(?: or an? [a-z ]+?)?) never counts more than ([\d,]+) of them\b/.exec(
        AI_ALLOWANCE_USED_MESSAGE,
      );
    expect(
      clause,
      "the refusal names no per-run ceiling for the tools priced per call",
    ).not.toBeNull();
    expect(clause![2]).toBe(CEILING);
    expect(
      new Set(clause![1]!.split(/, | or /).map((a) => a.replace(/^an? /, ""))),
    ).toEqual(new Set(units.map((u) => u.one)));
  });
});

/* ------------------------------------------------------------------ *
 *  Everything else a per-call page SERVES about the charge
 * ------------------------------------------------------------------ */

/**
 * Charge claims true of ONE worker image only, with the sentences that
 * shipped them.
 *
 * Added 2026-10-06. The checks above read the "Is it free?" answer and the
 * fact line — the two sentences `aiAllowanceFactFor` writes. The same pages
 * also SERVE their own authored FAQ (`page-copy`), and on all three per-call
 * pages it answered "How many … a day?" in the pre-L10 world: "This tool does
 * not count your document's text before uploading it, so every summary is
 * charged a fixed 10,258 characters … that comes to 3 summaries a day". Every
 * panel has counted since L10, and on a proving worker a short document costs
 * what it sends, so the page contradicted its own fact line two answers
 * further down. Its figures were computed with `deliveryCapFor({}, …)`, a
 * function the route no longer prices per-call runs with. The guard read the
 * author's sentence, not the page.
 *
 * Both directions, as the house rule asks: every pattern must catch each
 * sentence listed for it (the corpus test below), and the served pages must
 * carry none of them.
 */
const ONE_IMAGE_CHARGE_CLAIMS: readonly {
  what: string;
  pattern: RegExp;
  shipped: readonly string[];
}[] = [
  {
    what: "a fixed or flat per-run charge",
    pattern: /\b(?:fixed|flat)\s+[\d,]+\s+characters\b/i,
    shipped: [
      "every summary is charged a fixed 10,258 characters of that pool",
      "each run is charged a flat 10,258 characters of it",
      "each question, follow-ups included, costs a flat 10,258 characters of that pool",
    ],
  },
  {
    what: "an exact count of runs a day, not a floor",
    pattern:
      /(?<!\bat least )\b\d+ (?:summar(?:y|ies)|extractions?|(?:chat )?questions?|runs?) a day\b/i,
    shipped: [
      "that comes to 3 summaries a day when nothing else has drawn on it",
      "3 extractions a day if no other AI job has used the pool",
      "That is 3 questions a day if nothing else has used the pool",
    ],
  },
  {
    what: "the page does not count the document (every per-call client declares)",
    pattern:
      /\b(?:does not|doesn't) (?:count|measure) your document|\bsends no count of your document/i,
    shipped: [
      "This tool does not count your document's text before uploading it",
      "The extraction panel sends no count of your document's text",
      "The page does not measure your document before sending it",
    ],
  },
];

/** A PDF whose pages carry no selectable text, as the browser extractor reports one. */
const NO_TEXT_PDF = async () => ({
  pageCount: 2,
  pages: [
    { pageNumber: 1, text: "", characterCount: 0 },
    { pageNumber: 2, text: "", characterCount: 0 },
  ],
  text: "",
  characterCount: 0,
  hasText: false,
});

/** The same shape, for a PDF that HAS text: the control a refusal needs. */
const SOME_TEXT_PDF = async () => ({
  pageCount: 1,
  pages: [{ pageNumber: 1, text: "Invoice total 42", characterCount: 16 }],
  text: "Invoice total 42",
  characterCount: 16,
  hasText: true,
});

/** A real one-page PDF, with or without a line of selectable text. */
async function realPdf(withText: boolean): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  if (withText) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Invoice total 42", { x: 20, y: 200, size: 14, font });
  }
  return doc.save();
}

/**
 * Does the tool's browser client stop a PDF with no text BEFORE anything is
 * uploaded or charged? Answered by RUNNING the check each panel runs, never by
 * reading copy. Keyed by slug; a per-call tool missing here is fatal below.
 * `noText` false asks the same check about a PDF WITH text, which must not be
 * refused — the control that shows each check can answer "no".
 *
 * INVERTED 2026-10-06, history kept. The extract entry used to ask
 * `countDeclaredCharacters` (null for a scan) and return a hard-coded
 * `false`: "the extract panel counts and sends … the worker's refusal comes
 * after the charge". That was not the check the panel runs. The panel calls
 * `runWorkerAiExtract` → `runSecurityJob`, whose step 0 refuses a PDF with
 * no selectable text in the browser, before any request (`readsOnlySelectableText`
 * lists ai-extract). So this entry certified the page's "a scan that is
 * turned away still costs a run" as true, and required the page to say it.
 * It now drives that real client on a real PDF and counts the requests.
 */
const REFUSES_NO_TEXT_BEFORE_UPLOAD: Record<
  string,
  (noText: boolean) => Promise<boolean>
> = {
  "summarize-pdf": async (noText) => {
    const { preflightSummarize } =
      await import("@/lib/workers/summarize-client");
    return !(
      await preflightSummarize(
        new Uint8Array([1]),
        noText ? NO_TEXT_PDF : SOME_TEXT_PDF,
      )
    ).ok;
  },
  "chat-with-pdf": async (noText) => {
    const { measureChatDocument } =
      await import("@/lib/workers/chat-with-pdf-client");
    return (
      (
        await measureChatDocument(
          new Uint8Array([1]),
          noText ? NO_TEXT_PDF : SOME_TEXT_PDF,
        )
      ).kind === "no-text"
    );
  },
  "ai-extract": async (noText) => {
    const { runWorkerAiExtract } =
      await import("@/lib/workers/ai-extract-client");
    const requests: string[] = [];
    await runWorkerAiExtract(
      {
        filename: "scan.pdf",
        bytes: await realPdf(!noText),
        declaredCharacters: null,
        mode: "prompt",
        prompt: "List every date.",
      },
      {
        fetchImpl: async (input) => {
          requests.push(String(input));
          return new Response("{}", { status: 503 });
        },
        sleep: async () => {},
        maxPollAttempts: 1,
      },
    );
    return requests.length === 0;
  },
};

/**
 * An FAQ entry about a PDF with no text that says it is charged anyway. Read
 * per ENTRY, question and answer together, not per sentence: Summarize's
 * shipped answer named the scan in its question and first sentence and the
 * charge three sentences later, and a sentence-level match was blind to it.
 */
const ABOUT_NO_TEXT = /\b(?:scan|scanned|no text|image-only)\b/i;
const STILL_CHARGED = /\bstill (?:costs?|uses?)\b/i;
const saysNoTextIsCharged = (entry: { question: string; answer: string }) =>
  ABOUT_NO_TEXT.test(`${entry.question} ${entry.answer}`) &&
  STILL_CHARGED.test(entry.answer);

/** Every sentence a page serves, visible text and FAQPage answers alike. */
const servedSentences = (page: RenderedToolPage) =>
  [page.text, ...page.faq.map((e) => e.answer)]
    .join(" ")
    .split(/(?<=[.!?])\s+/);

describe("everything a per-call page serves about the charge is true of every worker image", () => {
  it("each pattern catches every sentence that shipped it (the corpus, both directions)", () => {
    for (const claim of ONE_IMAGE_CHARGE_CLAIMS) {
      expect(claim.shipped.length, claim.what).toBeGreaterThan(0);
      for (const sentence of claim.shipped) {
        expect(
          claim.pattern.test(sentence),
          `${claim.what}: "${sentence}"`,
        ).toBe(true);
      }
    }
    // And the floor the pages DO state is not caught as an exact count.
    expect(
      ONE_IMAGE_CHARGE_CLAIMS[1]!.pattern.test(
        `at least ${AI_PER_CALL_RUNS_PER_DAY_AT_LEAST} summaries fit in a day`,
      ),
    ).toBe(false);
    // The three scan answers that shipped, each saying a PDF with no text is
    // charged, and each false: all three browsers refuse first. (Extract's
    // was certified true here until 2026-10-06 — see the INVERTED note on
    // REFUSES_NO_TEXT_BEFORE_UPLOAD.) Abridged to the words that matter.
    for (const entry of [
      {
        question: "Can it summarize a scanned PDF?",
        answer:
          "Not directly. This tool reads only text stored in the PDF as text. The refusal comes from the worker after the job has been submitted, so it still uses one summary's share of the daily allowance.",
      },
      {
        question: "Why does it say my PDF has no text to answer from?",
        answer:
          "The allowance is reserved on submit, before the worker opens the file, so a refused scan still costs a question's 10,258 characters of the day's allowance.",
      },
      {
        question: "How many extractions can I run a day?",
        answer:
          "It is deducted at submission, once the upload is done and before the worker opens the file, so a scan that is turned away still costs a run.",
      },
    ]) {
      expect(saysNoTextIsCharged(entry), entry.question).toBe(true);
    }
    // And an entry about a scan that says nothing is charged is not caught.
    expect(
      saysNoTextIsCharged({
        question: "Can it summarize a scanned PDF?",
        answer:
          "It is stopped in your browser; nothing is uploaded or charged.",
      }),
    ).toBe(false);
  });

  it.each(["summarize-pdf", "chat-with-pdf", "ai-extract"] as const)(
    "%s serves no charge claim that holds on one worker image only",
    (slug) => {
      expect(perCallTools().map((t) => t.slug)).toContain(slug);
      const page = pages.get(slug)!;
      const offenders = servedSentences(page).filter((sentence) =>
        ONE_IMAGE_CHARGE_CLAIMS.some((claim) => claim.pattern.test(sentence)),
      );
      expect(offenders, `${slug} serves these`).toEqual([]);
    },
  );

  it("every per-call page says whether a PDF with no text is charged, as its browser client behaves", async () => {
    const perCall = perCallTools();
    expect(perCall.length).toBeGreaterThanOrEqual(3);
    const answers: Record<string, boolean> = {};
    const wrong: string[] = [];
    for (const tool of perCall) {
      const check = REFUSES_NO_TEXT_BEFORE_UPLOAD[tool.slug];
      expect(
        check,
        `${tool.slug}: no browser no-text check is known`,
      ).toBeDefined();
      const refusedFirst = await check!(true);
      // Control: the same check, on a PDF WITH text, refuses nothing.
      expect(await check!(false), `${tool.slug} refuses a PDF with text`).toBe(
        false,
      );
      answers[tool.slug] = refusedFirst;
      const charged = pages
        .get(tool.slug)!
        .faq.filter(saysNoTextIsCharged)
        .map((e) => e.question);
      if (refusedFirst && charged.length > 0) {
        wrong.push(
          `${tool.slug}: its browser stops a PDF with no text before uploading ` +
            `it, yet "${charged.join('", "')}" says such a PDF is still charged`,
        );
      }
      if (!refusedFirst && charged.length === 0) {
        wrong.push(
          `${tool.slug}: a PDF with no text is charged before the worker ` +
            "refuses it, and no answer on the page says so",
        );
      }
    }
    expect(wrong).toEqual([]);
    // INVERTED 2026-10-06: this said "both kinds exist today, so neither
    // branch is vacuous" and required {true, false}; the false was the extract
    // entry asking the wrong function. Every per-call client now refuses
    // first, so the second branch is vacuous TODAY by fact, not by blindness:
    // each check was just shown to answer false on a PDF with text.
    expect(Object.values(answers)).toEqual(perCall.map(() => true));
  });
});
