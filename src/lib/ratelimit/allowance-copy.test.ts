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
import { aiDailyAllowanceNote } from "@/lib/workers/ai-tool-availability";
import { tools } from "@/lib/tools";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { readWorkerError } from "@/lib/workers/read-error";
import { rateLimitHeaders, rateLimitErrorResult } from "./response";
import { AI_ALLOWANCE_ACTION } from "@/lib/jobs/ai-allowance";
import { PERSONAL_CONDUCT_CLAIMS } from "@/tests/identity-claims";
import { scopeOf } from "@/tests/allowance-scope";
import { ALLOWANCE_SCOPE } from "@/lib/jobs/ai-allowance";
import { PER_CLIENT_KEYING_DISCLOSED } from "@/lib/privacy/keying";
import { RATE_LIMIT_ENV, resolveRateLimitConfig } from "./config";
import type { RateLimitDecision } from "./types";

/**
 * What a panel actually shows on an exhausted allowance: the 429 body PLUS
 * the wait the browser client now reads from `Retry-After` and says in words.
 * Composed through the real builders and the real reader, so the added
 * sentence is held to the same no-personal-conduct shapes as the body.
 */
const ALLOWANCE_DECISION = {
  allowed: false,
  action: AI_ALLOWANCE_ACTION,
  policyId: "ai-characters",
  provider: "memory",
  enforced: true,
  retryAfterSeconds: 11_400,
  retryAfterBucket: "15m+",
} as unknown as RateLimitDecision;
const PANEL_ALLOWANCE_MESSAGE = (
  await readWorkerError(
    new Response(
      JSON.stringify(rateLimitErrorResult(ALLOWANCE_DECISION).body),
      {
        status: 429,
        headers: rateLimitHeaders(ALLOWANCE_DECISION),
      },
    ),
    "fallback",
  )
).message;

/** Two genuinely different callers, as a proxy/CDN would present them. */
const headersFor = (address: string) =>
  new Headers({ "cf-connecting-ip": address });

/**
 * A per-client configuration, handed to `deriveClientToken` directly.
 *
 * WAS "the configuration production runs", and that stopped being true twice:
 * production reported `remote-configured-shared` at the wire on 2026-10-10,
 * and the same day `isTrustForwardedFor` began requiring the privacy
 * disclosure, so NO environment can produce this config while /privacy says
 * the counters are shared. A config built by hand skips that gate — which is
 * why it now proves only what `deriveClientToken` CAN do, and the scope the
 * copy states is checked through the real env chain below.
 */
const PER_CLIENT_SHAPED = {
  trustForwardedFor: true,
  clientIpHeader: "cf-connecting-ip",
  keySalt: "a-shared-salt-of-sufficient-length-for-the-validator",
};

/** Everything per-client keying needs from the environment. */
const PER_CLIENT_ENV = {
  [RATE_LIMIT_ENV.provider]: "redis",
  [RATE_LIMIT_ENV.trustForwardedFor]: "true",
  [RATE_LIMIT_ENV.keySalt]: PER_CLIENT_SHAPED.keySalt,
  [RATE_LIMIT_ENV.clientIpHeader]: "cf-connecting-ip",
};

const COPY: { where: string; text: string }[] = [
  {
    where: "tool-facts AI_ALLOWANCE_FACT (4 tool pages + FAQPage JSON-LD)",
    text: AI_ALLOWANCE_FACT,
  },
  // Per tool since the allowance became per-tool copy: ONE panel note used to
  // serve all four AI panels, quoting translate's character figure on the
  // three tools charged per run. Walked from the catalogue, never listed —
  // which also covers the two notes a sibling lane named here by hand (the
  // translate note and the per-call note Summarize, Chat and Extract show):
  // since the merge each of those panels shows exactly its own entry below.
  ...tools
    .filter((t) => capabilityForMode(t.processing) === "ai")
    .map((t) => ({
      where: `ai-tool-availability aiDailyAllowanceNote("${t.slug}") (its panel, its fact line, its FAQPage answer)`,
      text: aiDailyAllowanceNote(t.slug),
    })),
  { where: "the 429 body", text: AI_ALLOWANCE_USED_MESSAGE },
  {
    where: "the panel's 429 message (body + the client's wait)",
    text: PANEL_ALLOWANCE_MESSAGE,
  },
];

/**
 * Claims the limiter cannot support, as SHAPES — `PERSONAL_CONDUCT_CLAIMS`,
 * imported from `src/tests/identity-claims.ts` since 2026-10-09 so the AI
 * ceiling message's test and the copy-reach check run the same list (one
 * definition, no second copy).
 *
 * Each is a form of "this counter knows who you are". It does not: it knows an
 * address. Every entry is exercised by {@link SHIPPED_CLAIMS} below, so none of
 * them is decoration.
 */
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
  /*
   * INVERTED 2026-10-10, history kept. This was "separates two clients under
   * the configuration production runs", and it handed `deriveClientToken` a
   * config built by hand — so it stayed green while production was keyed
   * SHARED (`remote-configured-shared`, read at the wire on 2026-10-10) and
   * every allowance sentence said "for your connection". The precondition was
   * the wrong proposition: what the copy needs is not that the function CAN
   * separate clients but that the deployment DOES. The mechanism half stays
   * (first test); the property is now read through the env chain (second).
   */
  it("deriveClientToken separates two clients when handed a per-client config", () => {
    const a = deriveClientToken(headersFor("203.0.113.7"), PER_CLIENT_SHAPED);
    const b = deriveClientToken(headersFor("198.51.100.42"), PER_CLIENT_SHAPED);
    expect(a).not.toBe(SHARED_BUCKET_TOKEN);
    expect(b).not.toBe(a);
  });

  it("the scope the copy names is the scope the full env chain keys by", () => {
    // THE PRECONDITION, re-anchored a second time. env → resolveRateLimitConfig
    // → deriveClientToken is the path every route takes; the copy may name the
    // connection only while that path separates two callers.
    const config = resolveRateLimitConfig(PER_CLIENT_ENV);
    const a = deriveClientToken(headersFor("203.0.113.7"), config);
    const b = deriveClientToken(headersFor("198.51.100.42"), config);
    const separates = a !== b;
    expect(separates).toBe(PER_CLIENT_KEYING_DISCLOSED);
    expect(ALLOWANCE_SCOPE).toBe(separates ? "connection" : "everyone");
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
      keySalt: PER_CLIENT_SHAPED.keySalt,
    };
    expect(deriveClientToken(headersFor("203.0.113.7"), off)).toBe(
      SHARED_BUCKET_TOKEN,
    );
    // And with the proxy trusted but NO salt, it refuses to key per client
    // rather than bucketing each instance differently.
    expect(
      deriveClientToken(headersFor("203.0.113.7"), {
        trustForwardedFor: true,
        clientIpHeader: "cf-connecting-ip",
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

  /*
   * INVERTED 2026-10-10, history kept. This was "no longer tells a first-time
   * visitor a stranger may have spent their runs", and it banned
   * `/shared across everyone/` outright — written when production keyed per
   * connection. Production now keys everyone together, and the ban pinned the
   * copy to the false side: it would have failed the one true sentence. The
   * claim is banned while the limiter keys per connection and REQUIRED while
   * it does not; the conduct hedge stays banned in both states.
   */
  it("says the allowance is shared by everyone exactly while the limiter keys everyone together", () => {
    for (const { where, text } of COPY) {
      const scope = scopeOf(text);
      expect(
        scope,
        `${where} states the "${scope}" scope; the limiter keys ${ALLOWANCE_SCOPE === "everyone" ? "everyone together" : "per connection"}`,
      ).toBe(ALLOWANCE_SCOPE);
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
    //
    // AMENDED 2026-10-10: it required `/\bconnection\b/` — the only true scope
    // while production keyed per connection, and a false one since. The scope
    // must still be named; WHICH one is the limiter's (the test above).
    for (const { where, text } of COPY) {
      expect(
        scopeOf(text),
        `${where} does not say what the allowance is counted against`,
      ).not.toBe("neither");
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
 * your allowance" in it left every test above green. (The same day the
 * sentence moved into chat's own allowance fact, which `COPY` now walks too;
 * the derived walk below is what does not depend on that.)
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

  it("reaches chat's per-question cost sentence, wherever it is defined", () => {
    // It was CHAT_QUESTION_COST_NOTE in the chat panel when this was written,
    // and this asserted that FILE. Since 2026-09-27 the sentence is part of
    // chat's own allowance fact (`aiAllowanceFactFor` in jobs/ai-allowance.ts),
    // so the panel, the fact line and the FAQPage answer are one string. What
    // this checks is unchanged: the derived corpus reaches the sentence.
    const reached = withWindows.filter(({ windows }) =>
      windows.some((w) => w.includes("Each question counts")),
    );
    expect(
      reached.map(({ file }) => file),
      "the derived corpus does not reach chat's per-question cost sentence",
    ).not.toEqual([]);
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

  /** The AI tools whose action `text` names, as a sorted list. */
  const named = (text: string) =>
    [...new Set(toolSpecific(text).map(({ slug }) => slug))].sort();
  const everyTool = aiTools.map((tool) => tool.slug).sort();

  /*
   * AMENDED 2026-09-27, when two lanes met: this asserted the refusal names NO
   * tool's action (`toEqual([])`). The copy lane had meanwhile made the refusal
   * state what the allowance covers in each tool's unit — true on every page,
   * because it names every tool — and the two rules could not both hold. The
   * property was always "never ONE tool's use"; naming none is one way to keep
   * it, naming all is the other. Naming some is what is refused.
   */
  it("names every AI tool's action or none — never one tool's use", () => {
    expect(
      [[], everyTool],
      "the refusal every AI tool serves names only some tools — false on " +
        `the others' pages (it names: ${named(AI_ALLOWANCE_USED_MESSAGE).join(", ")})`,
    ).toContainEqual(named(AI_ALLOWANCE_USED_MESSAGE));
  });

  it("CONTROL: the same refusal with one tool's clause dropped is caught", () => {
    // Through the same detector: without chat's clause the sentence still
    // names the other three, and says nothing true about a chat question.
    const withoutChat = AI_ALLOWANCE_USED_MESSAGE.replace(
      /(?:,| and) a chat question[^—]*/,
      "",
    );
    expect(withoutChat, "the control's edit did not land").not.toBe(
      AI_ALLOWANCE_USED_MESSAGE,
    );
    expect([[], everyTool]).not.toContainEqual(named(withoutChat));
  });
});
