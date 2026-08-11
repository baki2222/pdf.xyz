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
import { describe, expect, it } from "vitest";
import { SHARED_BUCKET_TOKEN, deriveClientToken } from "./identity";
import { AI_ALLOWANCE_USED_MESSAGE } from "./response";
import { AI_ALLOWANCE_FACT } from "@/lib/tools/tool-facts";
import { AI_DAILY_ALLOWANCE_NOTE } from "@/lib/workers/ai-tool-availability";

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
