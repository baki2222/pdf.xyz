// @vitest-environment node
/**
 * The allowance copy matches what the limiter can distinguish.
 *
 * INVERTED 2026-08-11, then RE-ARMED the same day — the history is the point,
 * and both halves of it are.
 *
 * It used to assert that the copy must NOT claim per-person accounting, because
 * `deriveClientToken` returned {@link SHARED_BUCKET_TOKEN} for every caller and
 * there was genuinely one bucket for the whole product. It ended with: *"The
 * moment identity keys on a real per-client address, the first test here goes
 * red and the copy must be re-strengthened ON PURPOSE."*
 *
 * That moment arrived by a route the guard did not anticipate. **Identity was
 * not changed — the deployment was.** `deriveClientToken` still returns the
 * shared token unless `trustForwardedFor` is on AND a salt is configured AND a
 * forwarded address is present; production sets all three, and its posture reads
 * `remote-configured` rather than `remote-configured-shared`. So the precondition
 * as originally written — "two clients share a bucket in the DEFAULT
 * configuration" — is *still true*, and stayed true while the claim it protected
 * became false. The anchor therefore moves to the configuration the product
 * actually runs, and the dependency is stated rather than assumed.
 *
 * **AND THEN THE EXIT CONDITION ITSELF WAS WRONG.** It said the ban could lift
 * "the moment identity keys on a real per-client address". It does — and an
 * address is not a person. The bucket is `sha256(salt ␀ address)` over a
 * forwarded address, so an office, a campus, a café and a mobile CGNAT range are
 * each ONE reader as far as this counter is concerned. Re-strengthening the copy
 * to *"You have used your 3 free AI runs"* replaced a false claim about everyone
 * with a false claim about the reader.
 *
 * THE MECHANISM, AND IT IS THE ONE THIS PROGRAMME KEEPS CATALOGUING. The retired
 * list banned `/\byou'?ve used your\b/`. The replacement said "You **have** used
 * your" — the same sentence, spelled out, and the regex missed it. **A
 * word-pattern guard does not report "no claim"; it reports "no claim in the
 * words I know."** So the list below is written as SHAPES (second person + a
 * spend verb; a possessive over the allowance itself) rather than phrases, and
 * it is held to a corpus in both directions: every banned shape must catch a
 * real sentence this product has shipped, and every shipped sentence must be
 * caught by some shape. A pattern nothing exercises is decoration; an example
 * nothing catches is a hole.
 *
 * THE PROPERTY, stated once so a future rewrite can check itself against it:
 * **no sentence may assert what the reader personally did.** The allowance may
 * be attributed to the connection, which is what the limiter actually counts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  copyFiles,
  flattenForPhraseSearch,
  withoutComments,
} from "@/lib/tools/copy-surface";
import { SHARED_BUCKET_TOKEN, deriveClientToken } from "./identity";
import { AI_ALLOWANCE_USED_MESSAGE } from "./response";
import { AI_ALLOWANCE_FACT } from "@/lib/tools/tool-facts";
import { AI_DAILY_ALLOWANCE_NOTE } from "@/lib/workers/ai-tool-availability";
import { tools } from "@/lib/tools";
import { capabilityForMode } from "@/lib/jobs/capabilities";

/** Two genuinely different callers, as a proxy/CDN would present them. */
const headersFor = (address: string) =>
  new Headers({ "x-forwarded-for": address });

/** The configuration production runs: forwarded addresses trusted, salt set. */
const PRODUCTION_SHAPED = {
  trustForwardedFor: true,
  keySalt: "a-shared-salt-of-sufficient-length-for-the-validator",
};

const COPY: { where: string; text: string }[] = [
  {
    where: "tool-facts AI_ALLOWANCE_FACT (4 tool pages + FAQPage JSON-LD)",
    text: AI_ALLOWANCE_FACT,
  },
  {
    where: "ai-tool-availability AI_DAILY_ALLOWANCE_NOTE (the AI panels)",
    text: AI_DAILY_ALLOWANCE_NOTE,
  },
  { where: "the 429 body", text: AI_ALLOWANCE_USED_MESSAGE },
];

/**
 * Claims the limiter cannot support, as SHAPES.
 *
 * Each is a form of "this counter knows who you are". It does not: it knows an
 * address. Every entry is exercised by {@link SHIPPED_CLAIMS} below, so none of
 * them is decoration.
 */
const PERSONAL_CONDUCT_CLAIMS: { name: string; pattern: RegExp }[] = [
  {
    name: "an accounting unit smaller than the address",
    pattern: /\bper\s+(?:device|user|person|visitor|browser)\b/i,
  },
  {
    // The intervening words are bounded by COUNT and by PUNCTUATION: `[A-Za-z']+`
    // cannot cross a comma or a full stop, so the subject stays inside one
    // clause. The bound started at two and the corpus below immediately failed
    // on "You may have already used them" — which is the corpus doing its job,
    // and the reason a ban list without one is a list of words someone thought of.
    name: "second person plus a spend verb — a claim about the reader's conduct",
    pattern:
      /\byou\b(?:'ve|\s+have|\s+had)?(?:\s+[A-Za-z']+){0,4}\s+(?:used|spent|consumed|exhausted|reached|hit|run)\b/i,
  },
  {
    name: "a possessive over the allowance itself — whose runs these are",
    pattern:
      /\byour\s+(?:own\s+)?(?:\d[\d,]*\s+)?(?:free\s+)?(?:daily\s+)?(?:ai\s+)?(?:runs?|allowance)\b/i,
  },
];

const offendingPatterns = (text: string) =>
  PERSONAL_CONDUCT_CLAIMS.filter(({ pattern }) => pattern.test(text));

/**
 * THE POSITIVE CONTROL: sentences this product has actually shipped, or shipped
 * one word away from. Every one must be caught. The first two are the pair that
 * proves the point — identical in meaning, and the retired list knew only the
 * contraction.
 */
const SHIPPED_CLAIMS = [
  "You have used your 3 free AI runs for today.",
  "You've used your 3 free AI runs for today.",
  "Your own 3 free AI runs a day — the allowance resets daily.",
  "3 free AI runs a day, per device.",
  "You may have already used them.",
];

/**
 * THE HEALTH CHECK: true sentences that must survive. A ban list that rejects
 * everything mentioning the reader passes the test above while making the copy
 * unwritable, and the next person deletes it rather than argues with it.
 */
const TRUE_SENTENCES = [
  "3 free AI runs a day for your connection — the allowance resets daily.",
  "The 3 free AI runs for this connection are used up for today.",
  "On a shared network that can include runs made by someone else.",
  "Runs are counted for your connection, not for you.",
];

describe("the AI allowance copy matches what the limiter can distinguish", () => {
  it("separates two clients under the configuration production runs", () => {
    // THE PRECONDITION, re-anchored. The copy below attributes the allowance to
    // a connection; this is the fact that makes even that much true. If it ever
    // fails, the copy is claiming a distinction the limiter cannot draw.
    const a = deriveClientToken(headersFor("203.0.113.7"), PRODUCTION_SHAPED);
    const b = deriveClientToken(headersFor("198.51.100.42"), PRODUCTION_SHAPED);
    expect(a).not.toBe(SHARED_BUCKET_TOKEN);
    expect(
      b,
      "two different clients now key into the SAME bucket under production's " +
        "own configuration — the allowance copy distinguishes connections and " +
        "would be false",
    ).not.toBe(a);
  });

  it("still shares one bucket in the DEFAULT configuration, which the copy depends on", () => {
    // Stated rather than assumed: the claim is deployment-dependent. A default
    // build — no trusted proxy, no salt — really does put everyone in one
    // bucket, and there the copy would be wrong. That is not invisible: the
    // posture reports `remote-configured-shared` for exactly this case and
    // alerts on it, which is the mechanism that makes a static sentence
    // survivable.
    const off = {
      trustForwardedFor: false,
      keySalt: PRODUCTION_SHAPED.keySalt,
    };
    expect(deriveClientToken(headersFor("203.0.113.7"), off)).toBe(
      SHARED_BUCKET_TOKEN,
    );
    // And with the proxy trusted but NO salt, it refuses to key per client
    // rather than bucketing each instance differently.
    expect(
      deriveClientToken(headersFor("203.0.113.7"), {
        trustForwardedFor: true,
        keySalt: undefined,
      }),
    ).toBe(SHARED_BUCKET_TOKEN);
  });

  it("catches every claim this product has shipped, including the spelled-out one", () => {
    // Positive control. Without it the list below is a list of words someone
    // once thought of, and "no offenders" means nothing.
    const missed = SHIPPED_CLAIMS.filter(
      (s) => offendingPatterns(s).length === 0,
    );
    expect(
      missed,
      "these sentences claim the reader's own conduct and NO pattern caught " +
        "them — which is exactly how `You have used your` walked past a list " +
        "that banned `you've used your`",
    ).toEqual([]);
  });

  it("leaves true sentences alone, so the list stays writable", () => {
    // The other half. A guard that also rejects the correct copy gets weakened
    // by whoever next has to ship a sentence.
    const falsePositives = TRUE_SENTENCES.flatMap((s) =>
      offendingPatterns(s).map(({ name }) => `${name} rejected: ${s}`),
    );
    expect(falsePositives, falsePositives.join("\n")).toEqual([]);
  });

  it("exercises every banned shape, so none of them is decoration", () => {
    // Pins the list to the corpus in the OTHER direction: a pattern no real
    // sentence trips is untested and may not match what its name says.
    const unexercised = PERSONAL_CONDUCT_CLAIMS.filter(
      ({ pattern }) => !SHIPPED_CLAIMS.some((s) => pattern.test(s)),
    ).map(({ name }) => name);
    expect(
      unexercised,
      "no shipped sentence exercises these patterns — add the example that " +
        "motivated each, or drop it",
    ).toEqual([]);
  });

  it("asserts nothing about what the reader personally did", () => {
    // THE RULE, applied to what actually renders. `deriveClientToken` hashes a
    // forwarded ADDRESS with no cookie and no session, so everyone behind one
    // NAT is one reader to this counter — and a first-time visitor told they
    // have used their three has been told something false about themself.
    const offenders = COPY.flatMap(({ where, text }) =>
      offendingPatterns(text).map(
        ({ name }) =>
          `${where}: ${name} — "${text}". The bucket is sha256(salt, address); ` +
          "an address is an office, a campus or a CGNAT range, not a person.",
      ),
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no longer tells a first-time visitor a stranger may have spent their runs", () => {
    // The claim that went stale. It was true when written and the system was
    // fixed underneath it; `policy.ts` has said `per client per day` throughout.
    for (const { where, text } of COPY) {
      expect(text, `${where} still claims the allowance is shared`).not.toMatch(
        /shared across everyone/i,
      );
      expect(
        text,
        `${where} still hedges that the count may not be the visitor's own`,
      ).not.toMatch(/may not reflect your own/i);
    }
  });

  it("names the scope the runs are counted against, rather than leaving it out", () => {
    // Not merely the absence of the false claim — the presence of the true one.
    // A silently-scopeless "3 free AI runs a day" leaves the reader to guess,
    // and the guess a stranger makes after a refusal is the wrong one in both
    // directions: either "someone stole mine" or "the whole site is out".
    for (const { where, text } of COPY) {
      expect(
        text,
        `${where} does not say what the allowance is counted against`,
      ).toMatch(/\bconnection\b/i);
    }
  });
});

/**
 * The shapes above, run over every allowance sentence a visitor can READ — not
 * over the three constants {@link COPY} names.
 *
 * WHY, and it is rule 4 in the house style. `COPY` is a hand-typed list, and a
 * named list cannot see a string it does not name. On 2026-09-27 Chat with PDF
 * gained `CHAT_QUESTION_COST_NOTE` ("Each question counts this PDF's text ...
 * against the daily allowance ..."), rendered directly after
 * `AI_DAILY_ALLOWANCE_NOTE` in the panel. It is allowance copy by any reading,
 * and not one test in the block above ever saw it: planting "You have used
 * your allowance" in it left every test above green.
 *
 * THE SET IS DERIVED from `copyFiles()` — the one visitor-readable surface the
 * other honesty guards already walk, and which `copy-surface.test.ts` holds to
 * every file that DEFINES an allowance sentence. Inside each file, comments are
 * stripped and wraps flattened (the three evasions `flattenForPhraseSearch`
 * closes), and a window is cut around every mention of the allowance in any
 * spelling this product has used for it. The shapes run over the windows.
 *
 * KNOWN BOUND, stated rather than discovered: a window is anchored on an
 * allowance word, so a personal-conduct claim more than {@link WINDOW} flattened
 * characters from any such word is outside it. A whole-file scan was measured
 * and rejected: it flags five non-allowance sentences (status, tool, workspace,
 * guides and facts pages) that are not this property's business, and a guard
 * that cries wolf gets weakened.
 */
const WINDOW = 200;
const ALLOWANCE_ANCHOR =
  /allowance|free\s+(?:ai\s+)?(?:runs?|characters)|per\s+day|a\s+day|for\s+today|daily/gi;

/** Every window of readable text around an allowance mention in `source`. */
const allowanceWindows = (source: string): string[] => {
  const text = flattenForPhraseSearch(withoutComments(source));
  return [...text.matchAll(ALLOWANCE_ANCHOR)].map((match) =>
    text.slice(Math.max(0, match.index - WINDOW), match.index + WINDOW),
  );
};

describe("no allowance sentence ANYWHERE a visitor reads claims the reader's conduct", () => {
  const scanned = copyFiles().map((file) => ({
    file: path.relative(process.cwd(), file).replaceAll("\\", "/"),
    windows: allowanceWindows(readFileSync(file, "utf8")),
  }));
  const withWindows = scanned.filter(({ windows }) => windows.length > 0);
  const windowCount = withWindows.reduce((n, s) => n + s.windows.length, 0);

  it("reads a plausibly sized corpus (97 windows in 13 files when written)", () => {
    // Both directions: a walk that collapses reports the strongest pass, and
    // one that explodes (an anchor matching code) drowns the signal.
    expect(windowCount).toBeGreaterThanOrEqual(60);
    expect(windowCount).toBeLessThan(1000);
    expect(withWindows.length).toBeGreaterThanOrEqual(8);
  });

  it("reaches the chat panel's per-question cost note, the sentence COPY never named", () => {
    const chat = withWindows.find(({ file }) =>
      file.endsWith("components/tools/chat-with-pdf-worker-panel.tsx"),
    );
    expect(
      chat?.windows.some((w) => w.includes("Each question counts")),
      "the derived corpus does not reach CHAT_QUESTION_COST_NOTE",
    ).toBe(true);
  });

  it("POSITIVE CONTROL: every shipped claim is caught when set beside the allowance sentence", () => {
    // Through the SAME extractor, so a window or anchor bug shows here.
    const missed = SHIPPED_CLAIMS.filter((claim) => {
      const source = `export const X = \`${AI_ALLOWANCE_FACT} ${claim}\`;`;
      return !allowanceWindows(source).some(
        (w) => offendingPatterns(w).length > 0,
      );
    });
    expect(missed).toEqual([]);
  });

  it("CONTROL: true sentences beside the allowance sentence pass the same extractor", () => {
    const rejected = TRUE_SENTENCES.filter((sentence) => {
      const source = `export const X = \`${AI_ALLOWANCE_FACT} ${sentence}\`;`;
      return allowanceWindows(source).some(
        (w) => offendingPatterns(w).length > 0,
      );
    });
    expect(rejected).toEqual([]);
  });

  it("finds no personal-conduct claim in any window", () => {
    const offenders = withWindows.flatMap(({ file, windows }) =>
      windows.flatMap((w) =>
        offendingPatterns(w).map(({ name }) => `${file}: ${name} — "${w}"`),
      ),
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

/**
 * The refusal is ONE sentence served to EVERY AI tool.
 *
 * `rateLimitErrorResult` picks `AI_ALLOWANCE_USED_MESSAGE` by action, and the
 * route passes no tool — so whatever the sentence says about how the allowance
 * was spent, it says on the chat, summarize, translate and extract pages
 * alike. Until 2026-09-27 it said "text translated by someone else", and the
 * page it was met on most was Chat with PDF, where every question cost a third
 * of the day.
 *
 * The corpus is DERIVED from the catalogue — every AI tool's action word, from
 * its slug — so a fifth AI tool is checked the day it lands.
 */
describe("the allowance refusal is true on every AI tool's page", () => {
  const aiTools = tools.filter(
    (tool) => capabilityForMode(tool.processing) === "ai",
  );
  /** A tool's action, from its slug: `translate-pdf` → `transl`. */
  const actionStems = (slug: string) =>
    slug
      .split("-")
      .filter((word) => !["pdf", "with", "ai"].includes(word))
      .map((word) => word.slice(0, 6));
  const stems = aiTools.flatMap((tool) =>
    actionStems(tool.slug).map((stem) => ({ slug: tool.slug, stem })),
  );
  const toolSpecific = (text: string) =>
    stems.filter(({ stem }) => text.toLowerCase().includes(stem));

  it("derives an action for every AI tool (vacuity bound: 4 known today)", () => {
    expect(aiTools.length).toBeGreaterThanOrEqual(4);
    for (const tool of aiTools) {
      expect(
        actionStems(tool.slug).length,
        `${tool.slug} yielded no action word — the check below would skip it`,
      ).toBeGreaterThan(0);
    }
  });

  it("POSITIVE CONTROL: catches the sentence that shipped until 2026-09-27", () => {
    const shipped =
      "The 30,774 free characters of AI text for this connection are used up for today. On a shared network that can include text translated by someone else.";
    expect(toolSpecific(shipped).map(({ slug }) => slug)).toContain(
      "translate-pdf",
    );
  });

  it("names no single tool's action", () => {
    expect(
      toolSpecific(AI_ALLOWANCE_USED_MESSAGE),
      "the refusal every AI tool serves describes one tool's use — false on " +
        "the others' pages",
    ).toEqual([]);
  });
});
